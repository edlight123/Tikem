/**
 * POST   /api/users/me/invite-mutes/[uid]  stop event invites from this person.
 * DELETE /api/users/me/invite-mutes/[uid]  allow them again.
 *
 * Stored at users/{me}/invite_mutes/{uid}: owner-readable, server-written
 * (firestore.rules). The muted person is never told; their picker shows the
 * muter as "can't invite" (lib/invites/policy.ts#pickerStateFor).
 * Behind config/auth.invites (404 feature_off when off).
 */
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { isSocialFlagOn } from '@/lib/social/flags'
import { inviteGuard, inviteMiscRateLimit, json } from '@/lib/invites/handlers'
import { isSafeId } from '@/lib/invites/policy'
import { muteInviter, unmuteInviter } from '@/lib/invites/server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ uid: string }> }

const deps = {
  getUser: async () => {
    const u = await getCurrentUser()
    return u ? { id: u.id } : null
  },
  flagOn: () => isSocialFlagOn('invites'),
  rateLimit: inviteMiscRateLimit,
}

export async function POST(_request: Request, { params }: Ctx) {
  const target = String((await params).uid || '')
  if (!isSafeId(target)) return json({ error: 'not_found' }, 404)
  const g = await inviteGuard(deps)
  if (!('uid' in g)) return g
  if (target === g.uid) return json({ error: 'self' }, 400)
  try {
    const exists = await adminDb.collection('users').doc(target).get()
    if (!exists.exists) return json({ error: 'not_found' }, 404)
    await muteInviter(g.uid, target)
    return json({ ok: true, muted: true })
  } catch (err) {
    console.error('[invites] mute failed', (err as any)?.message)
    return json({ error: 'internal_error' }, 500)
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const target = String((await params).uid || '')
  if (!isSafeId(target)) return json({ error: 'not_found' }, 404)
  const g = await inviteGuard(deps)
  if (!('uid' in g)) return g
  try {
    await unmuteInviter(g.uid, target)
    return json({ ok: true, muted: false })
  } catch (err) {
    console.error('[invites] unmute failed', (err as any)?.message)
    return json({ error: 'internal_error' }, 500)
  }
}
