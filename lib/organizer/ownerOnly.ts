import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { ORG_COOKIE, ORG_HEADER, teamRoleIn } from './context'

/**
 * Gate for the owner-only organizer routes (payouts, withdrawals, payout
 * profiles and destinations, Stripe Connect, identity verification, danger
 * zone). Those routes act on the caller's OWN account (user.id), which is the
 * org id when the caller is its owner, so a team member can never reach
 * another org's money through them. What this adds: a member who is currently
 * acting for an org they do not own (X-Tikem-Org header or tikem_org cookie,
 * validated the same way getOrgContext does) is refused instead of silently
 * being shown or moving their own personal account's money.
 *
 * Deliberately not requireOrg('owner_only'): that also rejects accounts that
 * are not organizers yet, and these routes run during organizer onboarding
 * (Stripe Connect, verification) before the role is set.
 *
 * Returns the 403 to send, or null to continue.
 */
export async function denyIfActingForAnotherOrg(userId: string): Promise<NextResponse | null> {
  if (!userId) return null
  let requested = ''
  try {
    const h = await headers()
    requested = (h.get(ORG_HEADER) || '').trim()
  } catch {
    // headers() outside a request (scripts/tests)
  }
  if (!requested) {
    try {
      const c = await cookies()
      requested = (c.get(ORG_COOKIE)?.value || '').trim()
    } catch {
      // ignore
    }
  }
  if (!requested || requested === userId) return null
  // Only an org the caller really belongs to counts as "acting for" it; an
  // unknown or stale selection falls back to their own account, as everywhere.
  const role = await teamRoleIn(requested, userId)
  if (!role) return null
  return NextResponse.json(
    { error: 'Only the organization owner can do this', code: 'owner_only' },
    { status: 403 },
  )
}
