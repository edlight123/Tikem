import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  ORG_COOKIE,
  claimInvitesByVerifiedEmail,
  getOrgContext,
  listMemberships,
  orgDisplayName,
  teamRoleIn,
  teamSeatIn,
} from '@/lib/organizer/context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET: the orgs this account can act for (its own, if it is an organizer, and
 * every team it is on) and which one is active. Also accepts open invites sent
 * to the account's verified email, so a Google/Apple user who was invited sees
 * the org without clicking anything.
 *
 * POST { orgId }: switch the active org (web: tikem_org cookie; the app keeps
 * its own choice and sends X-Tikem-Org). Only an org the caller owns or is an
 * active member of.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await claimInvitesByVerifiedEmail(user).catch(() => 0)

  const isOrganizer = user.role === 'organizer' || user.role === 'admin' || user.role === 'super_admin'
  const [memberships, ctx, ownName] = await Promise.all([
    listMemberships(user.id),
    getOrgContext(),
    isOrganizer ? orgDisplayName(user.id) : Promise.resolve(''),
  ])
  // financeView per org: read-only finances (owner, or an admin the owner granted it).
  const withFinance = await Promise.all(
    memberships.map(async (m) => ({ ...m, financeView: Boolean((await teamSeatIn(m.orgId, user.id))?.financeView) })),
  )
  return NextResponse.json({
    own: isOrganizer ? { orgId: user.id, orgName: ownName || user.full_name || '', role: 'owner', financeView: true } : null,
    memberships: withFinance,
    active: ctx ? { orgId: ctx.orgId, role: ctx.role, financeView: ctx.financeView } : null,
  })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const orgId = String(body?.orgId || '')
  const own = orgId === user.id
  if (!orgId || (!own && !(await teamRoleIn(orgId, user.id)))) {
    return NextResponse.json({ error: 'Not a member of that organization' }, { status: 403 })
  }
  const res = NextResponse.json({ success: true, orgId })
  if (own) res.cookies.delete(ORG_COOKIE)
  else res.cookies.set(ORG_COOKIE, orgId, { path: '/', httpOnly: false, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365 })
  return res
}
