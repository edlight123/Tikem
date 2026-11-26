/**
 * Which edits to a live event its ticket holders must be told about, and when.
 *
 * Pure (no Firestore) so the decisions are testable. The server side that
 * stores baselines and sends the notices is lib/events/change-notices.ts.
 *
 * MATERIAL: the start or end time, the venue (name, address, commune, city),
 * switching between in person and online, and the online link. Everything else
 * (the description, the poster, tiers, the title...) never triggers a notice.
 *
 * DEBOUNCE: an organizer fixing the time often saves two or three times in a
 * minute. A notice goes out once the event has been quiet for
 * CHANGE_DEBOUNCE_MS after its last material edit (so the holder hears the
 * final value once), at most once per CHANGE_DEBOUNCE_MS, and never later than
 * CHANGE_MAX_WAIT_MS after the first edit of the batch (so continuous editing
 * cannot hold a notice back forever). Old -> new is measured from the last
 * notified baseline, so an edit reverted before the notice goes sends nothing.
 */
import { checkBroadcast } from '@/lib/moderation/broadcast'
import { eventInstantIso } from '@/lib/email-templates/reminder'

export const CHANGE_DEBOUNCE_MS = 10 * 60 * 1000
export const CHANGE_MAX_WAIT_MS = 30 * 60 * 1000

export type MaterialSnapshot = {
  start: string | null
  end: string | null
  venue: string
  address: string
  commune: string
  city: string
  online: boolean
  link: string
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** An instant as a canonical ISO string (string and Timestamp writes compare equal). */
function instant(v: unknown): string | null {
  const iso = eventInstantIso(v)
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function materialSnapshot(event: Record<string, any> | null | undefined): MaterialSnapshot {
  const e = event || {}
  return {
    start: instant(e.start_datetime),
    end: instant(e.end_datetime),
    venue: clean(e.venue_name),
    address: clean(e.venue_address ?? e.address),
    commune: clean(e.commune),
    city: clean(e.city),
    online: e.is_online === true,
    link: clean(e.meeting_url),
  }
}

export type ChangeKind = 'when' | 'where' | 'link'

/** What changed between two snapshots (empty = nothing holders need to hear). */
export function materialChanges(before: MaterialSnapshot, after: MaterialSnapshot): ChangeKind[] {
  const kinds: ChangeKind[] = []
  if (before.start !== after.start || before.end !== after.end) kinds.push('when')
  const ci = (s: string | undefined) => String(s || '').toLowerCase()
  if (
    before.online !== after.online ||
    ci(before.venue) !== ci(after.venue) ||
    ci(before.address) !== ci(after.address) ||
    ci(before.commune) !== ci(after.commune) ||
    ci(before.city) !== ci(after.city)
  ) {
    kinds.push('where')
  }
  if ((before.link || '') !== (after.link || '')) kinds.push('link')
  return kinds
}

export function sameSnapshot(a: MaterialSnapshot | null | undefined, b: MaterialSnapshot | null | undefined): boolean {
  if (!a || !b) return false
  return materialChanges(a, b).length === 0
}

/** The stored state per event (event_change_state/{eventId}). */
export type ChangeState = {
  baseline: MaterialSnapshot
  /** The snapshot as last observed (to tell a new edit from a re-observation). */
  latest?: MaterialSnapshot | null
  pending?: boolean
  pending_since?: number | null
  last_change_at?: number | null
  last_notice_at?: number | null
}

/**
 * Fold one observation of the event into its state. Returns the new state, or
 * null when nothing needs writing.
 */
export function observe(state: ChangeState | null, current: MaterialSnapshot, now: number): ChangeState | null {
  if (!state) {
    return { baseline: current, latest: current, pending: false, pending_since: null, last_change_at: null, last_notice_at: null }
  }
  const changedSinceBaseline = !sameSnapshot(state.baseline, current)
  const newEdit = !sameSnapshot(state.latest ?? state.baseline, current)
  if (!changedSinceBaseline) {
    // Reverted (or never changed): nothing pending.
    if (!state.pending && !newEdit) return null
    return { ...state, latest: current, pending: false, pending_since: null }
  }
  if (!newEdit && state.pending) return null
  return {
    ...state,
    latest: current,
    pending: true,
    pending_since: state.pending && state.pending_since ? state.pending_since : now,
    last_change_at: now,
  }
}

/** Is a pending notice due now? */
export function noticeDue(state: ChangeState, now: number): boolean {
  if (!state.pending) return false
  if (state.last_notice_at && now - state.last_notice_at < CHANGE_DEBOUNCE_MS) return false
  const quiet = state.last_change_at ? now - state.last_change_at >= CHANGE_DEBOUNCE_MS : true
  const waitedLong = state.pending_since ? now - state.pending_since >= CHANGE_MAX_WAIT_MS : false
  return quiet || waitedLong
}

/** Does this event's change matter to anyone? Published, not cancelled, not over. */
export function eventIsNotifiable(event: Record<string, any> | null | undefined, now = Date.now()): boolean {
  if (!event) return false
  if (event.is_published !== true) return false
  if (String(event.status || '').toLowerCase() === 'cancelled') return false
  const snap = materialSnapshot(event)
  const endsAt = Date.parse(snap.end || snap.start || '')
  // An event that ended an hour ago can't usefully move.
  return !Number.isFinite(endsAt) || endsAt > now - 60 * 60 * 1000
}

/**
 * The short record written on the event (events/{id}.change_notice) once its
 * holders have been told, so ticket screens can say "Time changed, was ...".
 * Only the fields a ticket screen shows; no link (it may be private).
 */
export type ChangeNoticeStamp = {
  at: string
  kinds: ChangeKind[]
  before: { start: string | null; end: string | null; venue: string; city: string; online: boolean }
}

export function changeNoticeStamp(before: MaterialSnapshot, after: MaterialSnapshot, now: number): ChangeNoticeStamp | null {
  const kinds = materialChanges(before, after)
  if (!kinds.length) return null
  return {
    at: new Date(now).toISOString(),
    kinds,
    before: { start: before.start, end: before.end, venue: before.venue, city: before.city, online: before.online },
  }
}

/** The venue and link text an organizer typed, through the organizer-message rules. */
export function changeContentAllowed(after: MaterialSnapshot): boolean {
  const place = [after.venue, after.address, after.commune, after.city].filter(Boolean).join(', ')
  const message = `The event details were updated. ${place}${after.link ? ` Online: ${after.link}` : ''}`
  return checkBroadcast({ message }).ok
}
