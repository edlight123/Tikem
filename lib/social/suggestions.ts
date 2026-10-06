/**
 * Friend suggestions ("people you may know") and "friends going": the pure
 * decisions. No Firestore here, so every privacy rule is unit-tested
 * (__tests__/unit/lib/friend-suggestions.test.ts). The reads live in
 * lib/social/suggestions-server.ts.
 *
 * Privacy model (all enforced here, never on the client):
 *  - `users/{uid}.discoverable === false` removes a person from BOTH
 *    suggestions and other people's "friends going". Missing means true.
 *  - Suggesting someone because you went to the same events reveals their
 *    attendance to a stranger, so it also needs their existing attendance
 *    setting (`privacy.attendance_visibility`) to be 'everyone'. Mutual-friend
 *    suggestions do not reveal attendance and only need `discoverable`.
 *  - "Friends going" only ever lists accepted connections, and only those whose
 *    attendance setting allows friends ('friends' or 'everyone'), matching the
 *    existing Who's going rules (lib/firestore/social.ts). An organizer who
 *    hid the guest list ('count' or 'hidden') hides this too.
 *  - Blocks (either direction) exclude a person everywhere.
 */

import { isLiveTicketStatus } from '@/lib/tickets/status'
import type { GuestlistVisibility } from '@/lib/guestlistVisibility'
import type { AttendanceVisibility, SuggestionReason } from '@/types/social'

export type { SuggestionReason }

/** Mutual friends needed before "friends of friends" suggests someone. */
export const MIN_MUTUAL_FRIENDS = 2
/** How far back shared (past) events count. Upcoming events always count. */
export const SHARED_EVENTS_LOOKBACK_DAYS = 90
export const MAX_SUGGESTIONS = 20
export const MAX_FRIENDS_GOING = 5

export interface CandidatePrivacy {
  exists: boolean
  discoverable: boolean
  attendanceVisibility: AttendanceVisibility
}

export interface Candidate {
  uid: string
  mutualCount: number
  sharedEvents: number
}

export interface RankedSuggestion {
  uid: string
  reason: SuggestionReason
  mutualCount: number
}

/** Read the privacy bits we need from a raw users doc (missing doc = not eligible). */
export function privacyFromUserDoc(data: Record<string, any> | null | undefined): CandidatePrivacy {
  if (!data) return { exists: false, discoverable: false, attendanceVisibility: 'nobody' }
  const v = data?.privacy?.attendance_visibility
  return {
    exists: true,
    discoverable: data.discoverable !== false,
    attendanceVisibility: v === 'everyone' || v === 'friends' ? v : 'nobody',
  }
}

/**
 * Does this ticket put its holder at the event? Live tickets (the shared
 * vocabulary in lib/tickets/status.ts) plus checked-in ones, which are past
 * events the person actually attended.
 */
export function holdsTicket(status: unknown): boolean {
  if (isLiveTicketStatus(status)) return true
  const s = String(status ?? '').toLowerCase().trim()
  return s === 'used' || s === 'checked_in'
}

/** Milliseconds from a Firestore Timestamp, Date, ISO string or number; null if unreadable. */
export function toMillis(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  const v = value as any
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.toDate === 'function') return v.toDate().getTime()
  if (typeof v._seconds === 'number') return v._seconds * 1000
  if (typeof v.seconds === 'number') return v.seconds * 1000
  return null
}

/** Upcoming, or started within the lookback window. Unknown dates do not count. */
export function inSharedEventWindow(start: unknown, now: number): boolean {
  const t = toMillis(start)
  if (t == null) return false
  return t >= now - SHARED_EVENTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
}

export interface CollectInput {
  viewerId: string
  /** Every user the viewer has a connection doc with (accepted OR pending). */
  connectedIds: ReadonlySet<string>
  /** friendId -> that friend's accepted connections. */
  friendsOfFriends: ReadonlyMap<string, readonly string[]>
  /** eventId -> holders of a ticket to that (shared) event. */
  eventHolders: ReadonlyMap<string, readonly string[]>
  /** Blocked in either direction. */
  blocked: ReadonlySet<string>
}

/**
 * Raw candidates with their mutual-friend and shared-event counts. Excludes
 * the viewer, anyone already connected or pending, and anyone blocked.
 * A friend listed twice, or a person holding several tickets to one event,
 * counts once.
 */
export function collectCandidates(input: CollectInput): Map<string, Candidate> {
  const { viewerId, connectedIds, friendsOfFriends, eventHolders, blocked } = input
  const excluded = (id: string) => !id || id === viewerId || connectedIds.has(id) || blocked.has(id)
  const out = new Map<string, Candidate>()
  const get = (id: string) => {
    let c = out.get(id)
    if (!c) {
      c = { uid: id, mutualCount: 0, sharedEvents: 0 }
      out.set(id, c)
    }
    return c
  }

  friendsOfFriends.forEach((theirFriends, friendId) => {
    if (blocked.has(friendId)) return
    new Set(theirFriends).forEach((id) => {
      if (excluded(id)) return
      get(id).mutualCount += 1
    })
  })

  eventHolders.forEach((holders) => {
    new Set(holders).forEach((id) => {
      if (excluded(id)) return
      get(id).sharedEvents += 1
    })
  })

  return out
}

/** Which reason (if any) lets this candidate be shown, given their privacy. */
export function suggestionReason(c: Candidate, p: CandidatePrivacy | undefined): SuggestionReason | null {
  if (!p || !p.exists || !p.discoverable) return null
  if (c.mutualCount >= MIN_MUTUAL_FRIENDS) return 'mutual_friends'
  if (c.sharedEvents >= 1 && p.attendanceVisibility === 'everyone') return 'same_events'
  return null
}

/** Shared events only count toward ranking when the person's attendance is public. */
function visibleShared(c: Candidate, p: CandidatePrivacy | undefined): number {
  return p?.attendanceVisibility === 'everyone' ? c.sharedEvents : 0
}

/**
 * Before reading anyone's users doc: the strongest raw candidates, so the
 * number of reads stays bounded on a large graph. Candidates who cannot
 * qualify under any reason are dropped here.
 */
export function preselectCandidates(candidates: Map<string, Candidate>, cap: number): Candidate[] {
  return Array.from(candidates.values())
    .filter((c) => c.mutualCount >= MIN_MUTUAL_FRIENDS || c.sharedEvents >= 1)
    .sort((a, b) => b.mutualCount - a.mutualCount || b.sharedEvents - a.sharedEvents || a.uid.localeCompare(b.uid))
    .slice(0, Math.max(0, cap))
}

/**
 * Final list: eligible candidates only, mutual-friend suggestions first (more
 * mutuals first), then shared-event ones (more shared events first). Stable.
 */
export function rankSuggestions(
  candidates: Iterable<Candidate>,
  privacy: ReadonlyMap<string, CandidatePrivacy>,
  limit: number = MAX_SUGGESTIONS
): RankedSuggestion[] {
  const scored: Array<{ c: Candidate; reason: SuggestionReason; shared: number }> = []
  for (const c of Array.from(candidates)) {
    const p = privacy.get(c.uid)
    const reason = suggestionReason(c, p)
    if (!reason) continue
    scored.push({ c, reason, shared: visibleShared(c, p) })
  }
  scored.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'mutual_friends' ? -1 : 1
    const byMutual = b.c.mutualCount - a.c.mutualCount
    const byShared = b.shared - a.shared
    const primary = a.reason === 'mutual_friends' ? byMutual || byShared : byShared || byMutual
    return primary || a.c.uid.localeCompare(b.c.uid)
  })
  return scored.slice(0, Math.max(0, limit)).map(({ c, reason }) => ({
    uid: c.uid,
    reason,
    mutualCount: c.mutualCount,
  }))
}

export interface FriendsGoingInput {
  /** The viewer's ACCEPTED connections. Nobody else can ever be returned. */
  friendIds: readonly string[]
  /** Holders of a ticket to this event. */
  holderIds: ReadonlySet<string>
  privacy: ReadonlyMap<string, CandidatePrivacy>
  blocked: ReadonlySet<string>
  guestlist: GuestlistVisibility
  limit?: number
}

/** Count and the first few friends going to an event, privacy applied. */
export function selectFriendsGoing(input: FriendsGoingInput): { count: number; friendIds: string[] } {
  if (input.guestlist !== 'faces') return { count: 0, friendIds: [] }
  const eligible = Array.from(new Set(input.friendIds)).filter((id) => {
    if (!input.holderIds.has(id) || input.blocked.has(id)) return false
    const p = input.privacy.get(id)
    if (!p || !p.exists || !p.discoverable) return false
    return p.attendanceVisibility === 'friends' || p.attendanceVisibility === 'everyone'
  })
  return { count: eligible.length, friendIds: eligible.slice(0, input.limit ?? MAX_FRIENDS_GOING) }
}
