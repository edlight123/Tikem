/**
 * Event page views: how many people opened an event's page.
 *
 * One view = one viewer, one event, one day (in the event's own timezone).
 * The viewer is the signed-in uid when there is one, else an opaque random
 * device id (AsyncStorage in the app, an HttpOnly cookie on the web). Nothing
 * personal is stored: the dedupe marker's document id is a SHA-256 of
 * event|viewer|day, and it carries only an `expires_at` so a Firestore TTL
 * policy can sweep it. IPs are used only for an in-memory throttle.
 *
 * The organizer and their team never count, and only published, visible
 * events count.
 *
 * Storage (Admin SDK only; the default-deny rule covers all three):
 *   event_view_stats/{eventId}             { total, updated_at }
 *   event_view_stats/{eventId}/days/{day}  { count, day }
 *   event_view_seen/{sha256}               { expires_at }
 *
 * Counts live outside the event doc on purpose: events/{id} is world-readable
 * and listened to by the app, so a write per view there would leak the number
 * and wake every open event screen.
 *
 * TTL (one-time setup, by the owner): without a TTL policy the markers are
 * never deleted (counting still works, they just pile up). Either
 *   firebase deploy --only firestore:indexes --project event-haiti
 * (firestore.indexes.json carries the fieldOverride with "ttl": true), or
 *   gcloud firestore fields ttls update expires_at \
 *     --collection-group=event_view_seen --enable-ttl --project=event-haiti
 * or in the console: Firestore > Time-to-live > Create policy, collection
 * group `event_view_seen`, timestamp field `expires_at`. Firestore deletes
 * expired docs within about a day of expiry, which is why VIEW_SEEN_TTL_MS
 * keeps a day of margin.
 */
import { createHash } from 'node:crypto'

export const VIEW_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
export const VIEW_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
export const VIEWER_COOKIE = 'tk_vid'
/** Dedupe markers outlive their day by a margin so a TTL sweep never races "today". */
export const VIEW_SEEN_TTL_MS = 2 * 24 * 60 * 60 * 1000

const DEFAULT_TZ = 'America/New_York'

/** The event's timezone: its own field, else its market's, else Eastern. */
export function eventViewTimezone(
  event: Record<string, any> | null | undefined,
  marketTimezone: (country?: string | null) => string | null = () => null,
): string {
  const own = typeof event?.timezone === 'string' ? event.timezone.trim() : ''
  if (own && isValidTimeZone(own)) return own
  const market = marketTimezone(event?.country)
  if (market && isValidTimeZone(market)) return market
  return DEFAULT_TZ
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** 'YYYY-MM-DD' for `now` in `tz`. */
export function viewDayKey(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimeZone(tz) ? tz : DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function normalizeDeviceId(raw: unknown): string | null {
  const id = typeof raw === 'string' ? raw.trim() : ''
  return VIEW_DEVICE_ID_PATTERN.test(id) ? id : null
}

/** Who is viewing: uid first, then the app's device id, then the web cookie. */
export function viewerKey(input: { uid?: string | null; deviceId?: unknown; cookieId?: unknown }): string | null {
  const uid = typeof input.uid === 'string' ? input.uid.trim() : ''
  if (uid) return `u:${uid}`
  const device = normalizeDeviceId(input.deviceId)
  if (device) return `d:${device}`
  const cookie = normalizeDeviceId(input.cookieId)
  if (cookie) return `c:${cookie}`
  return null
}

/** Document id of the once-per-day marker. Hashed: no viewer id is stored in clear. */
export function viewDedupeId(eventId: string, viewer: string, day: string): string {
  return createHash('sha256').update(`${eventId}|${viewer}|${day}`).digest('hex').slice(0, 40)
}

/** Published, not rejected, not hidden for review. */
export function isViewableEvent(event: Record<string, any> | null | undefined): boolean {
  if (!event) return false
  if (!(event.is_published === true || event.status === 'published')) return false
  if (event.rejected === true || event.hidden_pending_review === true) return false
  return true
}

export function eventOwnerId(event: Record<string, any> | null | undefined): string {
  return String(event?.organizer_id || event?.organizerId || '')
}

export type ViewOutcome = 'counted' | 'deduped' | 'own' | 'not_public' | 'invalid' | 'no_viewer'

export interface RecordViewDeps {
  loadEvent(eventId: string): Promise<Record<string, any> | null>
  /** Active member of the event's org (owner is checked separately). */
  isTeamMember(orgId: string, uid: string): Promise<boolean>
  /** Create the marker; false when it already existed (already counted today). */
  claimDedupe(id: string, expiresAt: Date): Promise<boolean>
  increment(eventId: string, day: string): Promise<void>
  marketTimezone?: (country?: string | null) => string | null
  now?: () => Date
}

export async function recordEventView(
  input: { eventId: string; uid?: string | null; deviceId?: unknown; cookieId?: unknown },
  deps: RecordViewDeps,
): Promise<ViewOutcome> {
  const eventId = String(input.eventId || '').trim()
  if (!VIEW_EVENT_ID_PATTERN.test(eventId)) return 'invalid'
  const viewer = viewerKey(input)
  if (!viewer) return 'no_viewer'

  const event = await deps.loadEvent(eventId)
  if (!isViewableEvent(event)) return 'not_public'

  const uid = typeof input.uid === 'string' ? input.uid.trim() : ''
  if (uid) {
    const owner = eventOwnerId(event)
    if (owner && owner === uid) return 'own'
    if (owner && (await deps.isTeamMember(owner, uid))) return 'own'
  }

  const now = (deps.now || (() => new Date()))()
  const day = viewDayKey(now, eventViewTimezone(event, deps.marketTimezone))
  const fresh = await deps.claimDedupe(viewDedupeId(eventId, viewer, day), new Date(now.getTime() + VIEW_SEEN_TTL_MS))
  if (!fresh) return 'deduped'
  await deps.increment(eventId, day)
  return 'counted'
}

export interface EventViewStats {
  total: number
  today: number
}
