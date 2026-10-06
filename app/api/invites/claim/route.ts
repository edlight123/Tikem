/**
 * POST /api/invites/claim  { code?, eventId? }
 *
 * Called right after sign-up. The app sends the code it saved from a
 * tikem://i/{code} link; the web sends nothing and the server reads the
 * 30-day `tikem_invite` cookie set by /i/[code] (the web session route also
 * claims from that cookie on its own, so this is the mobile path mostly).
 *
 * Only a NEW account is attributed, once ever (lib/invites/server.ts#claimInvite);
 * the response never says who the inviter is. Behind config/auth.invites.
 */
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import { inviteGuard, inviteMiscRateLimit, json } from '@/lib/invites/handlers'
import { INVITE_COOKIE, parseInviteCookie } from '@/lib/invites/policy'
import { claimInvite } from '@/lib/invites/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const g = await inviteGuard({
    getUser: async () => {
      const u = await getCurrentUser()
      return u ? { id: u.id } : null
    },
    flagOn: () => isSocialFlagOn('invites'),
    rateLimit: inviteMiscRateLimit,
  })
  if (!('uid' in g)) return g

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const cookieStore = await cookies()
  const fromCookie = parseInviteCookie(cookieStore.get(INVITE_COOKIE)?.value)
  const code = body?.code ?? fromCookie?.code
  const eventId = body?.code ? body?.eventId : fromCookie?.eventId
  if (!code) return json({ ok: true, status: 'no_code' })

  try {
    const result = await claimInvite({ uid: g.uid, code, eventId })
    if (fromCookie) cookieStore.delete(INVITE_COOKIE)
    return json({ ok: true, status: result.status })
  } catch (err) {
    console.error('[invites] claim failed', (err as any)?.message)
    return json({ error: 'internal_error' }, 500)
  }
}
