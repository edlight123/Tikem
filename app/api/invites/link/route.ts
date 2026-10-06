/**
 * GET|POST /api/invites/link[?eventId=...]  the caller's personal invite link:
 * https://www.tikem.co/i/{code}[?e={eventId}]. One stable code per user
 * (invite_codes/{code} -> {uid}), created on first use.
 * Behind config/auth.invites (404 feature_off when off).
 */
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import { inviteGuard, inviteMiscRateLimit, json } from '@/lib/invites/handlers'
import { inviteLinkUrl, isSafeId } from '@/lib/invites/policy'
import { eventExists, getOrCreateInviteCode } from '@/lib/invites/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(request: Request) {
  const g = await inviteGuard({
    getUser: async () => {
      const u = await getCurrentUser()
      return u ? { id: u.id } : null
    },
    flagOn: () => isSocialFlagOn('invites'),
    rateLimit: inviteMiscRateLimit,
  })
  if (!('uid' in g)) return g

  const raw = new URL(request.url).searchParams.get('eventId')
  let eventId: string | null = null
  if (raw) {
    if (!isSafeId(raw)) return json({ error: 'invalid_event' }, 400)
    if (!(await eventExists(raw))) return json({ error: 'event_not_found' }, 404)
    eventId = raw
  }
  try {
    const code = await getOrCreateInviteCode(g.uid)
    return json({ enabled: true, code, url: inviteLinkUrl(code, eventId), eventId })
  } catch (err) {
    console.error('[invites] link failed', (err as any)?.message)
    return json({ error: 'internal_error' }, 500)
  }
}

export const GET = handle
export const POST = handle
