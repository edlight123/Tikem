/**
 * Friend activity: which upcoming events the viewer's friends are going to.
 * Pure (no Firestore); the loader is getFriendActivity in
 * lib/social/suggestions-server.ts. Ported from Tikra 402eea44, with a
 * stricter privacy model.
 *
 * PRIVACY. A friend's attendance is shown only when ALL of these hold:
 *  - they are an accepted connection of the viewer (never a stranger, never a
 *    one-way follower);
 *  - they CHOSE to share it: `privacy.attendance_visibility` explicitly set to
 *    'friends' or 'everyone'. Unlike the event page (where an unset value reads
 *    as the 2026-11-16 default 'everyone'), an UNSET value here means HIDDEN:
 *    a feed of "where my friends are going" is a different disclosure from a
 *    face on one event's page, so it needs an express yes;
 *  - their profile is not private and they did not opt out of being found;
 *  - neither of the two has blocked the other;
 *  - the event is publicly listed (published, not rejected/hidden/cancelled),
 *    not password-protected or unlisted, the organizer shows the guest list
 *    as faces, the viewer has not blocked its organizer, and it has not ended.
 * Nothing about the ticket itself (tier, price, quantity, status, order) is
 * ever returned: only that the friend is going.
 */
import { normalizeAttendanceVisibility } from '@/types/social'
import { eventShowsAttendees } from './event-privacy'
import { holdsTicket, toMillis } from './suggestions'

/** Did this person expressly choose to let friends see where they are going? */
export function sharesActivityWithFriends(user: Record<string, any> | null | undefined): boolean {
  if (!user) return false
  const raw = user?.privacy?.attendance_visibility
  if (raw === undefined || raw === null || raw === '') return false
  const v = normalizeAttendanceVisibility(raw)
  if (v !== 'friends' && v !== 'everyone') return false
  if (user.privacy?.profile_visibility === 'private') return false
  if (user.discoverable === false) return false
  return true
}

export interface ActivityTicket {
  event_id?: unknown
  attendee_id?: unknown
  user_id?: unknown
  status?: unknown
}

export interface FriendActivityInput {
  viewerId: string
  /** The viewer's accepted connections. */
  friendIds: readonly string[]
  /** users/{uid} docs of those friends (missing = not shown). */
  users: ReadonlyMap<string, Record<string, any> | null>
  /** Friends who blocked the viewer, and people the viewer blocked. */
  blocked: ReadonlySet<string>
  /** Organizers the viewer blocked. */
  blockedOrganizers: ReadonlySet<string>
  /** Tickets held by the friends (any event). */
  tickets: readonly ActivityTicket[]
  /** events/{id} docs for the tickets' events (missing = not shown). */
  events: ReadonlyMap<string, Record<string, any> | null>
  now: number
  limit?: number
}

export interface FriendActivityItem {
  eventId: string
  /** Friend uids going, in a stable order; at most the first few are named. */
  friendIds: string[]
}

export const FRIEND_ACTIVITY_LIMIT = 12
/** An event with no end time is treated as over this long after it starts. */
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000

function holderOf(t: ActivityTicket): string | null {
  const id = t?.attendee_id || t?.user_id
  return typeof id === 'string' && id ? id : null
}

function hasEnded(e: Record<string, any>, now: number): boolean {
  const end = toMillis(e.end_datetime)
  if (end != null) return end < now
  const start = toMillis(e.start_datetime) ?? toMillis(e.date)
  if (start == null) return true
  return start + DEFAULT_DURATION_MS < now
}

/** The friends who share their activity, minus blocks either way. */
export function visibleFriends(input: Pick<FriendActivityInput, 'viewerId' | 'friendIds' | 'users' | 'blocked'>): Set<string> {
  const out = new Set<string>()
  for (const id of input.friendIds) {
    if (!id || id === input.viewerId || input.blocked.has(id)) continue
    if (sharesActivityWithFriends(input.users.get(id) ?? null)) out.add(id)
  }
  return out
}

export function selectFriendActivity(input: FriendActivityInput): FriendActivityItem[] {
  const friends = visibleFriends(input)
  if (friends.size === 0) return []

  const going = new Map<string, Set<string>>()
  for (const t of input.tickets) {
    if (!holdsTicket(t?.status)) continue
    const holder = holderOf(t)
    if (!holder || !friends.has(holder)) continue
    const eventId = typeof t.event_id === 'string' ? t.event_id : ''
    if (!eventId) continue
    if (!going.has(eventId)) going.set(eventId, new Set())
    going.get(eventId)!.add(holder)
  }

  const items: { eventId: string; friendIds: string[]; start: number }[] = []
  going.forEach((who, eventId) => {
    const e = input.events.get(eventId)
    if (!e || !eventShowsAttendees(e) || hasEnded(e, input.now)) return
    if (e.organizer_id && input.blockedOrganizers.has(String(e.organizer_id))) return
    // The viewer's own event: they already know who is coming.
    if (e.organizer_id === input.viewerId) return
    items.push({
      eventId,
      friendIds: Array.from(who).sort(),
      start: toMillis(e.start_datetime) ?? toMillis(e.date) ?? Number.MAX_SAFE_INTEGER,
    })
  })

  items.sort((a, b) => b.friendIds.length - a.friendIds.length || a.start - b.start || a.eventId.localeCompare(b.eventId))
  return items.slice(0, input.limit ?? FRIEND_ACTIVITY_LIMIT).map(({ eventId, friendIds }) => ({ eventId, friendIds }))
}

/**
 * Card counts ("friends going" badge): the same visibility, for events the
 * caller already shows. Returns eventId -> number of visible friends going.
 */
export function countFriendsGoing(input: Omit<FriendActivityInput, 'limit'>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of selectFriendActivity({ ...input, limit: Number.MAX_SAFE_INTEGER })) {
    out[item.eventId] = item.friendIds.length
  }
  return out
}
