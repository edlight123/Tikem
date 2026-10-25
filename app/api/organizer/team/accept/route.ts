import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { isTeamRole } from '@/lib/organizer/teamRoles'
import { ORG_COOKIE, ORG_INVITES, activateMember, orgDisplayName, teamRoleIn } from '@/lib/organizer/context'
import { sha256Hex } from '@/app/api/staff/_utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST { invite, token }: accept an organization team invite with the signed-in
 * account. The token is the proof (it was emailed to the invitee), so the
 * account's own email does not have to match: people often accept with the
 * account they already use. Single use, 7-day expiry, revocable.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to accept this invite', code: 'unauthenticated' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const inviteId = String(body?.invite || '')
  const token = String(body?.token || '')
  if (!inviteId || !token) return NextResponse.json({ error: 'Invalid invite link', code: 'invalid' }, { status: 400 })

  const ref = adminDb.collection(ORG_INVITES).doc(inviteId) as FirebaseFirestore.DocumentReference
  const result = await adminDb.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { error: 'invalid' as const }
    const d = snap.data() || {}
    if (d.token_hash !== sha256Hex(token)) return { error: 'invalid' as const }
    if (d.revoked_at) return { error: 'revoked' as const }
    // Single use, never a re-grant: a member who was removed must not get back
    // in by reopening the link. Re-clicking while still a member is a no-op.
    if (d.accepted_at) return d.accepted_by === user.id ? { already: d } : { error: 'used' as const }
    if (d.expires_at?.toDate && d.expires_at.toDate() < new Date()) return { error: 'expired' as const }
    if (!isTeamRole(d.role) || !d.org_id) return { error: 'invalid' as const }
    if (d.org_id === user.id) return { error: 'own_org' as const }
    tx.set(ref, { accepted_at: FieldValue.serverTimestamp(), accepted_by: user.id }, { merge: true })
    return { ok: d }
  })

  if ('error' in result) {
    const status = result.error === 'invalid' ? 404 : 410
    return NextResponse.json({ error: 'This invite cannot be used', code: result.error }, { status })
  }

  if ('already' in result) {
    const d = result.already
    if (!(await teamRoleIn(d.org_id, user.id))) {
      return NextResponse.json({ error: 'This invite cannot be used', code: 'used' }, { status: 410 })
    }
    return NextResponse.json({ success: true, orgId: d.org_id, orgName: await orgDisplayName(d.org_id), role: d.role })
  }

  const d = result.ok
  await activateMember({
    orgId: d.org_id,
    uid: user.id,
    email: user.email || d.email,
    name: d.name || user.full_name || null,
    role: d.role,
    addedBy: d.invited_by || d.org_id,
  })

  const res = NextResponse.json({ success: true, orgId: d.org_id, orgName: await orgDisplayName(d.org_id), role: d.role })
  // Land them in the org they just joined.
  res.cookies.set(ORG_COOKIE, d.org_id, { path: '/', httpOnly: false, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365 })
  return res
}
