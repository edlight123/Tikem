/**
 * GET  /api/events/[id]/invite  the invite picker: the caller's ACCEPTED
 *      connections with a state each (available / invited / going /
 *      unavailable). Public display fields only.
 * POST /api/events/[id]/invite  { friendIds: string[] } sends the invites.
 *
 * Behind config/auth.invites (404 feature_off when off). Rules and caps:
 * lib/invites/policy.ts; Firestore: lib/invites/server.ts.
 */
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import {
  handleSendInvites,
  inviteGuard,
  invitePickerRateLimit,
  inviteSendRateLimit,
  json,
} from '@/lib/invites/handlers'
import { isSafeId } from '@/lib/invites/policy'
import { getInvitePicker, sendEventInvites } from '@/lib/invites/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const getUser = async () => {
  const u = await getCurrentUser()
  return u ? { id: u.id, full_name: (u as any).full_name ?? null } : null
}
const flagOn = () => isSocialFlagOn('invites')

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params
  if (!isSafeId(id)) return json({ error: 'Event id is required' }, 400)
  const g = await inviteGuard({ getUser, flagOn, rateLimit: invitePickerRateLimit })
  if (!('uid' in g)) return g
  try {
    const result = await getInvitePicker(g.uid, id)
    if (!result.ok) return json({ enabled: true, error: result.code }, result.code === 'event_not_found' ? 404 : 400)
    return json({ enabled: true, friends: result.friends })
  } catch (err) {
    console.error('[invites] picker failed', (err as any)?.message)
    return json({ error: 'internal_error' }, 500)
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params
  if (!isSafeId(id)) return json({ error: 'Event id is required' }, 400)
  const body = await request.json().catch(() => null)
  return handleSendInvites(
    {
      getUser,
      flagOn,
      rateLimit: inviteSendRateLimit,
      send: ({ inviterUid, inviterName, friendIds }) =>
        sendEventInvites({ inviterUid, inviterName, eventId: id, friendIds }),
    },
    body
  )
}
