/**
 * After an event: the people who went add their photos to its gallery
 * (moderated by the organizer side before anyone else sees them), and the page
 * points to the organizer's next event. Pure; the route is
 * app/api/events/[id]/photos.
 *
 * Stored at events/{eventId}/photos/{photoId} (server-only: the Firestore
 * catch-all denies clients):
 *   { url, storage_path, caption, user_id, user_name,
 *     status: 'pending' | 'approved' | 'rejected', created_at, reviewed_by? }
 * The file is uploaded by that route with the Admin SDK under
 * event-photos/{eventId}/attendees/{uid}/, after its bytes are sniffed, so a
 * photo can only ever be something the route itself wrote.
 *
 * The older organizer-only `event_photos` collection (app/api/event-photos) is
 * left as it is; nothing in the app reads it.
 */
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { eventEnd, toDate } from '@/lib/postEvent/timing'
import { isPubliclyListed } from '@/lib/home/new-on-tikem'

export const MAX_EVENT_PHOTOS_PER_PERSON = 6
export const MAX_EVENT_PHOTO_CAPTION = 140
export const MAX_EVENT_PHOTO_BYTES = 4 * 1024 * 1024
/** Photos can be added from the start until this long after the end. */
export const PHOTO_WINDOW_DAYS = 30

export type PhotoStatus = 'pending' | 'approved' | 'rejected'

export interface EventPhoto {
  id: string
  url: string
  caption: string | null
  user_id: string
  user_name: string
  status: PhotoStatus
  created_at: string
}

/** Between the event's start and PHOTO_WINDOW_DAYS after its end. */
export function photoWindowOpen(event: Record<string, any> | null | undefined, now: number): boolean {
  const start = toDate(event?.start_datetime)?.getTime()
  const end = eventEnd(event)?.getTime() ?? start
  if (!start || !end) return false
  return now >= start && now <= end + PHOTO_WINDOW_DAYS * 86_400_000
}

/** One short line, or null. */
export function cleanCaption(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_PHOTO_CAPTION)
  return s || null
}

/**
 * Did this ticket get its holder in (or entitle them to)? A live ticket in any
 * of the three spellings (lib/tickets/status.ts), or one already scanned. A
 * printed ticket nobody bought, a refunded or a cancelled one does not count.
 */
export function ticketShowsAttendance(ticket: Record<string, any> | null | undefined): boolean {
  if (!ticket) return false
  const status = String(ticket.status ?? '').toLowerCase().trim()
  if (status === 'printed_unsold' || status === 'voided' || status === 'released') return false
  if (status === 'refunded' || String(ticket.refund_status ?? '').toLowerCase() === 'approved') return false
  if (ticket.checked_in === true || status === 'used' || status === 'checked_in') return true
  return isLiveTicketStatus(status)
}

export function parseReview(input: unknown): { photoId: string; status: 'approved' | 'rejected' } | null {
  const b = (input || {}) as Record<string, unknown>
  const photoId = String(b.photoId || '')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(photoId)) return null
  return b.status === 'approved' || b.status === 'rejected' ? { photoId, status: b.status } : null
}

/** The organizer's soonest upcoming, publicly listed event other than this one (same rule as /discover). */
export function nextEventByOrganizer<T extends Record<string, any>>(events: readonly T[], currentId: string, now: number): T | null {
  let best: T | null = null
  let bestAt = Infinity
  for (const e of events) {
    if (e.id === currentId || !isPubliclyListed(e) || e.is_password_protected === true) continue
    const at = toDate(e.start_datetime)?.getTime()
    if (!at || at <= now || at >= bestAt) continue
    best = e
    bestAt = at
  }
  return best
}
