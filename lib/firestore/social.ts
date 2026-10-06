/**
 * Server-side helpers for the "Who's going" social layer on events.
 *
 * Privacy model (an UNSET attendance visibility reads as 'friends', the
 * default since 2026-10; an explicit 'nobody' still wins):
 *  - A user appears in the PUBLIC face pile only if their
 *    `privacy.attendance_visibility` is 'everyone'.
 *  - A user appears in a viewer's FRIENDS-going list only if they are an
 *    accepted friend AND their `attendance_visibility` is 'friends' or 'everyone'.
 *  - The raw "going" count is derived from tickets (already reflected publicly
 *    via tickets_sold), so showing a count is privacy-safe.
 */

import { adminDb } from '@/lib/firebase/admin'
import { getAcceptedFriendIds } from '@/lib/firestore/connections'
import { normalizeAttendanceVisibility, type PublicUserSummary, type AttendanceVisibility } from '@/types/social'

// A ticket counts as "going" if it is live/valid or already checked in.
// (Real ticket statuses observed: valid, confirmed, checked_in; legacy: active, used.)
const GOING_STATUSES = new Set(['valid', 'active', 'used', 'confirmed', 'checked_in'])
// Cap how many attendee profiles we scan for the public face pile to keep
// event pages responsive on large events.
const PUBLIC_SCAN_CAP = 80
const PUBLIC_PILE_LIMIT = 12

export interface EventSocialAttendance {
  totalGoing: number
  viewerIsGoing: boolean
  friendsGoing: PublicUserSummary[]
  publicGoing: PublicUserSummary[]
}

function summaryFromUserDoc(id: string, data: any): PublicUserSummary {
  return {
    uid: id,
    displayName: data?.full_name || data?.display_name || data?.displayName || 'Tikèm user',
    photoURL: data?.photo_url || data?.photoURL || '',
    isVerified: Boolean(data?.is_verified),
  }
}

function attendanceVisibilityOf(data: any): AttendanceVisibility {
  return normalizeAttendanceVisibility(data?.privacy?.attendance_visibility)
}

/** Batch-fetch raw user docs keyed by id via getAll. */
async function fetchUserDocs(ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return map

  // Resolve users by document reference (getAll) rather than a
  // `where('__name__', 'in', chunk)` query: filtering on the documentId
  // requires Key values, not bare id strings, so passing plain ids throws
  // "__key__ filter value must be a Key". getAll takes plain refs, has no
  // 30-item cap, and returns missing docs with `exists === false`.
  const refs = unique.map((id) => adminDb.collection('users').doc(id))
  const docs = await adminDb.getAll(...refs)
  docs.forEach((doc: any) => {
    if (!doc.exists) return
    map.set(doc.id, doc.data() || {})
  })
  return map
}

/**
 * Compute the social attendance view for an event from the viewer's
 * perspective. Returns only privacy-permitted profiles.
 */
export async function getEventSocialAttendance(
  eventId: string,
  viewerId: string | null
): Promise<EventSocialAttendance> {
  // 1. Collect distinct attendee ids from tickets.
  const ticketsSnap = await adminDb.collection('tickets').where('event_id', '==', eventId).get()

  const attendeeIds = new Set<string>()
  ticketsSnap.docs.forEach((doc: any) => {
    const data = doc.data() || {}
    const status = String(data.status || 'valid').toLowerCase()
    if (!GOING_STATUSES.has(status)) return
    const uid = data.attendee_id || data.user_id
    if (uid) attendeeIds.add(uid)
  })

  const totalGoing = attendeeIds.size
  const viewerIsGoing = viewerId ? attendeeIds.has(viewerId) : false

  if (totalGoing === 0) {
    return { totalGoing, viewerIsGoing, friendsGoing: [], publicGoing: [] }
  }

  // 2. Friends going (bounded by the viewer's friend count).
  let friendAttendeeIds: string[] = []
  if (viewerId) {
    const friendIds = await getAcceptedFriendIds(viewerId)
    friendAttendeeIds = friendIds.filter((id) => attendeeIds.has(id))
  }

  // 3. Sample attendees for the public face pile (bounded scan).
  const sampledAttendeeIds = Array.from(attendeeIds).slice(0, PUBLIC_SCAN_CAP)

  // Fetch the union of friend-attendees and the sampled attendees.
  const idsToFetch = Array.from(new Set([...friendAttendeeIds, ...sampledAttendeeIds]))
  const userDocs = await fetchUserDocs(idsToFetch)

  // Friends-going: visible to friends or everyone.
  const friendsGoing: PublicUserSummary[] = friendAttendeeIds
    .map((id) => ({ id, data: userDocs.get(id) }))
    .filter(({ data }) => {
      const v = attendanceVisibilityOf(data)
      return v === 'friends' || v === 'everyone'
    })
    .map(({ id, data }) => summaryFromUserDoc(id, data))

  const friendSet = new Set(friendsGoing.map((f) => f.uid))

  // Public face pile: only users who opted into 'everyone', excluding the
  // viewer and anyone already shown in the friends row.
  const publicGoing: PublicUserSummary[] = []
  for (const id of sampledAttendeeIds) {
    if (publicGoing.length >= PUBLIC_PILE_LIMIT) break
    if (id === viewerId || friendSet.has(id)) continue
    const data = userDocs.get(id)
    if (attendanceVisibilityOf(data) === 'everyone') {
      publicGoing.push(summaryFromUserDoc(id, data))
    }
  }

  return { totalGoing, viewerIsGoing, friendsGoing, publicGoing }
}

/**
 * Count how many of the viewer's friends are going to each of the given events
 * (respecting each friend's attendance visibility). Powers the "friends going"
 * badge on event cards. Returns a map of eventId -> distinct friend count.
 *
 * Efficient: one friend lookup + a bounded set of ticket queries keyed by
 * friend id, bucketed by event. Cost is independent of how many events are
 * requested, so a whole discover feed resolves in a couple of round-trips.
 */
export async function getFriendsGoingCounts(
  viewerId: string | null,
  eventIds: string[]
): Promise<Record<string, number>> {
  const wanted = new Set(eventIds.filter(Boolean))
  if (!viewerId || wanted.size === 0) return {}

  const friendIds = await getAcceptedFriendIds(viewerId)
  if (friendIds.length === 0) return {}

  // Keep only friends whose attendance is visible to friends (or everyone).
  const friendDocs = await fetchUserDocs(friendIds)
  const visibleFriendIds = friendIds.filter((id) => {
    const v = attendanceVisibilityOf(friendDocs.get(id))
    return v === 'friends' || v === 'everyone'
  })
  if (visibleFriendIds.length === 0) return {}

  // eventId -> set of friend ids going (a friend with multiple tickets counts once).
  const goingByEvent = new Map<string, Set<string>>()

  const chunks: string[][] = []
  for (let i = 0; i < visibleFriendIds.length; i += 30) {
    chunks.push(visibleFriendIds.slice(i, i + 30))
  }

  // Tickets store the holder as either `attendee_id` or (legacy) `user_id`.
  const queries: Promise<any>[] = []
  for (const chunk of chunks) {
    queries.push(adminDb.collection('tickets').where('attendee_id', 'in', chunk).get())
    queries.push(adminDb.collection('tickets').where('user_id', 'in', chunk).get())
  }

  const snaps = await Promise.all(queries)
  snaps.forEach((snap: any) => {
    snap.docs.forEach((doc: any) => {
      const data = doc.data() || {}
      const status = String(data.status || 'valid').toLowerCase()
      if (!GOING_STATUSES.has(status)) return
      const eventId = data.event_id
      if (!eventId || !wanted.has(eventId)) return
      const friendId = data.attendee_id || data.user_id
      if (!friendId) return
      if (!goingByEvent.has(eventId)) goingByEvent.set(eventId, new Set())
      goingByEvent.get(eventId)!.add(friendId)
    })
  })

  const counts: Record<string, number> = {}
  goingByEvent.forEach((set, eventId) => {
    counts[eventId] = set.size
  })
  return counts
}
