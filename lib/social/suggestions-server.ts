/**
 * Firestore reads for friend suggestions and "friends going" (Admin SDK,
 * server only). Every privacy decision is delegated to the pure functions in
 * lib/social/suggestions.ts; this file only gathers inputs, with hard caps so
 * one request stays a bounded number of reads however large the graph gets.
 *
 * What leaves the server is limited to public_profiles-style fields (name,
 * photo, username, verified) plus a reason enum and a mutual-friend count.
 * Never emails, phones, or which events anyone holds tickets to.
 */

import { adminDb } from '@/lib/firebase/admin'
import { getAcceptedFriendIds } from '@/lib/firestore/connections'
import { BLOCKED_ORGANIZERS_SUBCOLLECTION, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { guestlistVisibilityFrom } from '@/lib/guestlistVisibility'
import type { FriendSuggestion, PublicUserSummary } from '@/types/social'
import {
  type CandidatePrivacy,
  collectCandidates,
  holdsTicket,
  inSharedEventWindow,
  MAX_FRIENDS_GOING,
  MAX_SUGGESTIONS,
  preselectCandidates,
  privacyFromUserDoc,
  rankSuggestions,
  selectFriendsGoing,
  toMillis,
} from './suggestions'
import {
  type ActivityTicket,
  countFriendsGoing,
  selectFriendActivity,
  sharesActivityWithFriends,
} from './friend-activity'

const MAX_FRIENDS_SCANNED = 50
const MAX_FRIEND_CONNECTIONS = 300
const MAX_VIEWER_TICKETS = 200
const MAX_EVENTS_CONSIDERED = 60
const MAX_EVENTS_SCANNED = 15
const MAX_HOLDERS_PER_EVENT = 300
const MAX_CANDIDATE_DOCS = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function getAllDocs(refs: any[]): Promise<any[]> {
  if (refs.length === 0) return []
  return adminDb.getAll(...refs)
}

/** users/{uid} docs -> privacy bits (missing doc = not eligible). */
async function loadPrivacy(ids: string[]): Promise<Map<string, CandidatePrivacy>> {
  const out = new Map<string, CandidatePrivacy>()
  const docs = await getAllDocs(ids.map((id) => adminDb.collection('users').doc(id)))
  docs.forEach((d: any) => out.set(d.id, privacyFromUserDoc(d.exists ? d.data() : null)))
  ids.forEach((id) => {
    if (!out.has(id)) out.set(id, privacyFromUserDoc(null))
  })
  return out
}

/** Of `ids`, the ones who have blocked the viewer (users/{id}/blocked_organizers/{viewer}). */
async function blockedViewer(viewerId: string, ids: string[]): Promise<Set<string>> {
  const refs = ids.map((id) =>
    adminDb.collection('users').doc(id).collection(BLOCKED_ORGANIZERS_SUBCOLLECTION).doc(viewerId)
  )
  const docs = await getAllDocs(refs)
  const out = new Set<string>()
  docs.forEach((d: any, i: number) => {
    if (d?.exists) out.add(ids[i])
  })
  return out
}

/** Public display fields, from public_profiles first and users as a fallback. Never PII. */
async function loadPublicSummaries(ids: string[]): Promise<Map<string, PublicUserSummary & { username?: string }>> {
  const out = new Map<string, PublicUserSummary & { username?: string }>()
  if (ids.length === 0) return out
  const [pub, users] = await Promise.all([
    getAllDocs(ids.map((id) => adminDb.collection('public_profiles').doc(id))),
    getAllDocs(ids.map((id) => adminDb.collection('users').doc(id))),
  ])
  const userData = new Map<string, any>()
  users.forEach((d: any) => d?.exists && userData.set(d.id, d.data() || {}))
  const pubData = new Map<string, any>()
  pub.forEach((d: any) => d?.exists && pubData.set(d.id, d.data() || {}))
  ids.forEach((id) => {
    const p = pubData.get(id) || {}
    const u = userData.get(id) || {}
    const name = p.full_name || u.full_name || u.display_name || u.displayName || 'Tikèm user'
    const username = typeof (p.username ?? u.username) === 'string' ? String(p.username ?? u.username) : undefined
    out.set(id, {
      uid: id,
      displayName: String(name),
      photoURL: String(p.photo_url || u.photo_url || u.photoURL || ''),
      isVerified: Boolean(p.is_verified ?? u.is_verified),
      ...(username ? { username } : {}),
    })
  })
  return out
}

/** Holder uid of a ticket (current field, then legacy). */
function holderOf(data: any): string | null {
  const id = data?.attendee_id || data?.user_id
  return typeof id === 'string' && id ? id : null
}

/**
 * Up to MAX_SUGGESTIONS people the viewer may know, ranked. Friends of
 * friends (>= 2 mutual) first, then people at the same events (last 90 days
 * and upcoming) who keep their attendance public.
 */
export async function getFriendSuggestions(viewerId: string, now: number = Date.now()): Promise<FriendSuggestion[]> {
  // 1. The viewer's own connections, accepted and pending: all excluded.
  const connSnap = await adminDb.collection('connections').where('users', 'array-contains', viewerId).get()
  const connectedIds = new Set<string>()
  const friendIds: string[] = []
  connSnap.docs.forEach((doc: any) => {
    const data = doc.data() || {}
    const other = (data.users || []).find((u: string) => u !== viewerId)
    if (!other) return
    connectedIds.add(other)
    if (data.status === 'accepted') friendIds.push(other)
  })

  // 2. Friends of friends (bounded).
  const scannedFriends = friendIds.slice(0, MAX_FRIENDS_SCANNED)
  const fofSnaps = await Promise.all(
    scannedFriends.map((f) =>
      adminDb
        .collection('connections')
        .where('users', 'array-contains', f)
        .where('status', '==', 'accepted')
        .limit(MAX_FRIEND_CONNECTIONS)
        .get()
    )
  )
  const friendsOfFriends = new Map<string, string[]>()
  fofSnaps.forEach((snap: any, i: number) => {
    const f = scannedFriends[i]
    const others: string[] = []
    snap.docs.forEach((doc: any) => {
      const other = (doc.data()?.users || []).find((u: string) => u !== f)
      if (other) others.push(other)
    })
    friendsOfFriends.set(f, others)
  })

  // 3. Events the viewer holds a ticket to, in the window (bounded).
  const [byAttendee, byUser] = await Promise.all([
    adminDb.collection('tickets').where('attendee_id', '==', viewerId).limit(MAX_VIEWER_TICKETS).get(),
    adminDb.collection('tickets').where('user_id', '==', viewerId).limit(MAX_VIEWER_TICKETS).get(),
  ])
  const viewerEventIds = new Set<string>()
  ;[byAttendee, byUser].forEach((snap: any) =>
    snap.docs.forEach((doc: any) => {
      const data = doc.data() || {}
      // Only tickets the viewer CURRENTLY holds: a buyer who transferred a
      // ticket away is no longer at that event.
      if (holderOf(data) !== viewerId) return
      if (holdsTicket(data.status) && typeof data.event_id === 'string' && data.event_id) {
        viewerEventIds.add(data.event_id)
      }
    })
  )
  const eventIds = Array.from(viewerEventIds).slice(0, MAX_EVENTS_CONSIDERED)
  const eventDocs = await getAllDocs(eventIds.map((id) => adminDb.collection('events').doc(id)))
  const inWindow = eventDocs
    // An organizer who hid the guest list (count-only or hidden) has said who
    // attends is private: such events never produce "same event" suggestions,
    // matching getFriendsGoing below.
    .filter(
      (d: any) =>
        d?.exists &&
        inSharedEventWindow(d.data()?.start_datetime, now) &&
        guestlistVisibilityFrom(d.data() || {}) === 'faces'
    )
    .map((d: any) => ({ id: d.id as string, start: toMillis(d.data()?.start_datetime) ?? 0 }))
    // Nearest to now first: upcoming and recent events say the most.
    .sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now))
    .slice(0, MAX_EVENTS_SCANNED)

  const holderSnaps = await Promise.all(
    inWindow.map((e) =>
      adminDb.collection('tickets').where('event_id', '==', e.id).limit(MAX_HOLDERS_PER_EVENT).get()
    )
  )
  const eventHolders = new Map<string, string[]>()
  holderSnaps.forEach((snap: any, i: number) => {
    const holders: string[] = []
    snap.docs.forEach((doc: any) => {
      const data = doc.data() || {}
      if (!holdsTicket(data.status)) return
      const h = holderOf(data)
      if (h) holders.push(h)
    })
    eventHolders.set(inWindow[i].id, holders)
  })

  // 4. Candidates, excluding self, connections, and people the viewer blocked.
  const viewerBlocked = await getBlockedOrganizerIds(viewerId)
  const candidates = collectCandidates({
    viewerId,
    connectedIds,
    friendsOfFriends,
    eventHolders,
    blocked: viewerBlocked,
  })
  const shortlist = preselectCandidates(candidates, MAX_CANDIDATE_DOCS)
  if (shortlist.length === 0) return []

  // 5. Privacy + reverse blocks for the shortlist only.
  const ids = shortlist.map((c) => c.uid)
  const [privacy, blockedMe] = await Promise.all([loadPrivacy(ids), blockedViewer(viewerId, ids)])
  const ranked = rankSuggestions(
    shortlist.filter((c) => !blockedMe.has(c.uid)),
    privacy,
    MAX_SUGGESTIONS
  )
  if (ranked.length === 0) return []

  // 6. Public fields only.
  const summaries = await loadPublicSummaries(ranked.map((r) => r.uid))
  return ranked
    .map((r) => {
      const s = summaries.get(r.uid)
      if (!s) return null
      const item: FriendSuggestion = { ...s, reason: r.reason, mutualCount: r.mutualCount }
      return item
    })
    .filter((x): x is FriendSuggestion => x !== null)
}

/**
 * The viewer's connections holding a ticket to `eventId`, privacy applied.
 * Nobody outside the viewer's accepted connections can appear.
 */
export async function getFriendsGoing(
  viewerId: string,
  eventId: string
): Promise<{ count: number; friends: PublicUserSummary[] }> {
  const empty = { count: 0, friends: [] as PublicUserSummary[] }
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return empty
  const guestlist = guestlistVisibilityFrom(eventDoc.data() || {})
  if (guestlist !== 'faces') return empty

  const friendIds = await getAcceptedFriendIds(viewerId)
  if (friendIds.length === 0) return empty

  // Tickets to THIS event held by one of the viewer's friends. Equality-only
  // filters, so Firestore can serve them without a bespoke composite index
  // (firestore.indexes.json carries one anyway for speed).
  const queries: Promise<any>[] = []
  for (const part of chunk(friendIds, 30)) {
    queries.push(adminDb.collection('tickets').where('event_id', '==', eventId).where('attendee_id', 'in', part).get())
    queries.push(adminDb.collection('tickets').where('event_id', '==', eventId).where('user_id', 'in', part).get())
  }
  const snaps = await Promise.all(queries)
  const holderIds = new Set<string>()
  snaps.forEach((snap: any) =>
    snap.docs.forEach((doc: any) => {
      const data = doc.data() || {}
      if (!holdsTicket(data.status)) return
      const h = holderOf(data)
      if (h) holderIds.add(h)
    })
  )
  const holdingFriends = friendIds.filter((id) => holderIds.has(id))
  if (holdingFriends.length === 0) return empty

  const [privacy, viewerBlocked, blockedMe] = await Promise.all([
    loadPrivacy(holdingFriends),
    getBlockedOrganizerIds(viewerId),
    blockedViewer(viewerId, holdingFriends),
  ])
  const blocked = new Set<string>([...Array.from(viewerBlocked), ...Array.from(blockedMe)])
  const picked = selectFriendsGoing({
    friendIds: holdingFriends,
    holderIds,
    privacy,
    blocked,
    guestlist,
    limit: MAX_FRIENDS_GOING,
  })
  if (picked.count === 0) return empty

  const summaries = await loadPublicSummaries(picked.friendIds)
  const friends = picked.friendIds
    .map((id) => summaries.get(id))
    .filter((s): s is PublicUserSummary & { username?: string } => Boolean(s))
    .map(({ uid, displayName, photoURL, isVerified }) => ({ uid, displayName, photoURL, isVerified }))
  return { count: picked.count, friends }
}

// ---------------------------------------------------------------------------
// Friend activity (lib/social/friend-activity.ts holds every privacy rule).

const MAX_ACTIVITY_FRIENDS = 300

interface ActivityGraph {
  friendIds: string[]
  users: Map<string, Record<string, any> | null>
  blocked: Set<string>
  blockedOrganizers: Set<string>
  tickets: ActivityTicket[]
}

/**
 * The viewer's friends who share their activity, their tickets (reduced to
 * the four fields the selection needs), and the blocks either way. Tickets
 * are only read for friends who opted in and are not blocked.
 */
async function loadActivityGraph(viewerId: string): Promise<ActivityGraph | null> {
  const friendIds = (await getAcceptedFriendIds(viewerId)).slice(0, MAX_ACTIVITY_FRIENDS)
  if (friendIds.length === 0) return null
  const userDocs = await getAllDocs(friendIds.map((id) => adminDb.collection('users').doc(id)))
  const users = new Map<string, Record<string, any> | null>()
  userDocs.forEach((d: any) => users.set(d.id, d.exists ? d.data() || {} : null))
  const sharing = friendIds.filter((id) => sharesActivityWithFriends(users.get(id) ?? null))
  if (sharing.length === 0) return null

  const [viewerBlocked, blockedMe] = await Promise.all([
    getBlockedOrganizerIds(viewerId),
    blockedViewer(viewerId, sharing),
  ])
  const blocked = new Set<string>([...Array.from(viewerBlocked), ...Array.from(blockedMe)])
  const readable = sharing.filter((id) => !blocked.has(id))
  if (readable.length === 0) return null

  const queries: Promise<any>[] = []
  for (const part of chunk(readable, 30)) {
    queries.push(adminDb.collection('tickets').where('attendee_id', 'in', part).get())
    queries.push(adminDb.collection('tickets').where('user_id', 'in', part).get())
  }
  const tickets: ActivityTicket[] = []
  ;(await Promise.all(queries)).forEach((snap: any) =>
    snap.docs.forEach((doc: any) => {
      const d = doc.data() || {}
      // Only what the selection needs: never tier, price, order or QR data.
      tickets.push({ event_id: d.event_id, attendee_id: d.attendee_id, user_id: d.user_id, status: d.status })
    })
  )
  return { friendIds: readable, users, blocked, blockedOrganizers: viewerBlocked, tickets }
}

async function loadEvents(ids: string[]): Promise<Map<string, Record<string, any> | null>> {
  const out = new Map<string, Record<string, any> | null>()
  const docs = await getAllDocs(ids.map((id) => adminDb.collection('events').doc(id)))
  docs.forEach((d: any) => out.set(d.id, d.exists ? { id: d.id, ...(d.data() || {}) } : null))
  return out
}

export interface FriendActivityEvent {
  id: string
  title: string
  start_datetime: string | null
  venue_name: string | null
  city: string | null
  banner_image_url: string | null
  friendCount: number
  /** Up to three friends, public display fields only. */
  friends: PublicUserSummary[]
}

/** Upcoming events the viewer's friends are going to, most friends first. */
export async function getFriendActivity(viewerId: string, now = Date.now()): Promise<FriendActivityEvent[]> {
  const graph = await loadActivityGraph(viewerId)
  if (!graph) return []
  const eventIds = Array.from(
    new Set(graph.tickets.map((t) => (typeof t.event_id === 'string' ? t.event_id : '')).filter(Boolean))
  ).slice(0, 300)
  const events = await loadEvents(eventIds)
  const items = selectFriendActivity({ viewerId, ...graph, events, now })
  if (items.length === 0) return []
  const named = Array.from(new Set(items.flatMap((i) => i.friendIds.slice(0, 3))))
  const summaries = await loadPublicSummaries(named)
  return items.map((i) => {
    const e = events.get(i.eventId) || {}
    const start = toMillis(e.start_datetime) ?? toMillis(e.date)
    return {
      id: i.eventId,
      title: String(e.title || ''),
      start_datetime: start != null ? new Date(start).toISOString() : null,
      venue_name: e.venue_name ? String(e.venue_name) : null,
      city: e.city ? String(e.city) : null,
      banner_image_url: e.banner_image_url ? String(e.banner_image_url) : null,
      friendCount: i.friendIds.length,
      friends: i.friendIds
        .slice(0, 3)
        .map((id) => summaries.get(id))
        .filter((s): s is PublicUserSummary & { username?: string } => Boolean(s))
        .map(({ uid, displayName, photoURL, isVerified }) => ({ uid, displayName, photoURL, isVerified })),
    }
  })
}

/** Card badges: visible friends going to each of `eventIds` (same rules as the rail). */
export async function getFriendsGoingCountsFor(
  viewerId: string,
  eventIds: string[],
  now = Date.now()
): Promise<Record<string, number>> {
  const want = new Set(eventIds.filter((id) => typeof id === 'string' && id && !id.includes('/')))
  if (want.size === 0) return {}
  const graph = await loadActivityGraph(viewerId)
  if (!graph) return {}
  const tickets = graph.tickets.filter((t) => typeof t.event_id === 'string' && want.has(t.event_id))
  if (tickets.length === 0) return {}
  const events = await loadEvents(Array.from(new Set(tickets.map((t) => String(t.event_id)))))
  return countFriendsGoing({ viewerId, ...graph, tickets, events, now })
}
