import { adminDb } from '@/lib/firebase/admin'
import {
  EVENT_BUCKET,
  availabilityOf,
  eventCapacityOf,
  eventHasInventoryShards,
} from '@/lib/tickets/inventoryShards'
import { isLiveTicketStatus } from '@/lib/tickets/status'

/**
 * Event waitlists: event_waitlist/{auto} = { event_id, user_id, email,
 * position, status, created_at, notified_burst?, notified_at? }.
 *
 * Before this module, people could join (web route, mobile button) and were
 * told "we email you right away", but nothing ever read event_waitlist. The
 * only "notify the waitlist" code read a `waitlist` collection nobody writes,
 * and had no caller.
 *
 * WHEN SEATS FREE UP. Tikèm has no single "a seat came back" moment: an
 * expired checkout hold returns its seats lazily, and capacity is raised by
 * the composers writing tiers straight to Firestore from the client (web and
 * mobile). Refunds do not return seats to sale. So instead of hooking every
 * path, the inventory sweep (every 2 minutes) asks each event that has people
 * waiting "can someone buy right now?" (sweepWaitlists). That catches every
 * release path, including ones added later.
 *
 * DEDUPE. A "release burst" opens when an event goes from sold out to
 * purchasable and closes when it is sold out again (waitlist_bursts/{eventId}).
 * Each waiting person gets ONE email per burst, claimed in a transaction
 * before sending, and never two emails about the same event within
 * RENOTIFY_GAP_MS even across bursts (a hold expiring and being re-taken
 * every few minutes must not become an email every few minutes).
 */

export const WAITLIST_COLLECTION = 'event_waitlist'
export const WAITLIST_BURSTS_COLLECTION = 'waitlist_bursts'
export const RENOTIFY_GAP_MS = 12 * 60 * 60 * 1000

export type WaitlistEntryStatus = 'waiting' | 'purchased' | 'closed'

/** The organizer turned the waitlist on (event-level flag = any tier has it). */
export function isWaitlistEnabled(event: Record<string, any> | null | undefined): boolean {
  return event?.enable_waitlist === true
}

/**
 * Seats a buyer could take right now: capacity minus sold and live-held seats
 * (from the shards when the event has them, else the `tickets_sold` counter).
 * null = unlimited capacity.
 */
export async function seatsLeftNow(eventId: string, event: Record<string, any>): Promise<number | null> {
  const cap = eventCapacityOf(event)
  if (cap == null) return null
  let used = Math.max(0, Number(event?.tickets_sold || 0) || 0)
  try {
    if (await eventHasInventoryShards(eventId)) {
      used = (await availabilityOf(eventId, EVENT_BUCKET)).used
    }
  } catch (error) {
    console.warn('[waitlist] shard availability unreadable; using tickets_sold', { eventId, error })
  }
  return Math.max(0, cap - used)
}

function eventStartMs(raw: unknown): number | null {
  if (!raw) return null
  const d =
    typeof (raw as any)?.toDate === 'function' ? (raw as any).toDate() : new Date(raw as any)
  const ms = d instanceof Date ? d.getTime() : NaN
  return Number.isFinite(ms) ? ms : null
}

/** Nobody should be emailed about this event any more. */
export function isEventClosedForWaitlist(event: Record<string, any> | null | undefined, now: number): boolean {
  if (!event) return true
  const status = String(event.status || '').toLowerCase()
  if (status === 'cancelled' || status === 'canceled') return true
  if (event.is_published === false || event.rejected === true) return true
  const start = eventStartMs(event.start_datetime)
  return start != null && start <= now
}

function toMs(raw: unknown): number {
  if (!raw) return 0
  if (typeof (raw as any)?.toDate === 'function') return (raw as any).toDate().getTime()
  const ms = new Date(raw as any).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Should this entry get an email for burst `burst`? Pure: unit-tested. */
export function shouldNotifyEntry(entry: Record<string, any>, burst: number, now: number): boolean {
  const status = String(entry?.status || 'waiting')
  if (status !== 'waiting') return false
  if (Number(entry?.notified_burst || 0) >= burst) return false
  const last = toMs(entry?.notified_at)
  if (last && now - last < RENOTIFY_GAP_MS) return false
  return true
}

/**
 * Open (or keep open) the release burst for an event and return its number,
 * or close it and return null.
 */
async function syncBurst(eventId: string, open: boolean, now: number): Promise<number | null> {
  const ref = adminDb.collection(WAITLIST_BURSTS_COLLECTION).doc(eventId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() || {} : {}
    const burst = Number(data.burst || 0)
    if (!open) {
      if (data.open) tx.set(ref, { open: false, closed_at: new Date(now).toISOString() }, { merge: true })
      return null
    }
    if (data.open) return burst
    const next = burst + 1
    tx.set(
      ref,
      { event_id: eventId, open: true, burst: next, opened_at: new Date(now).toISOString() },
      { merge: true }
    )
    return next
  })
}

/** Claim one entry for one burst. True only for the caller that wins. */
async function claimEntry(ref: any, burst: number, now: number): Promise<Record<string, any> | null> {
  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return null
      const data = snap.data() || {}
      if (!shouldNotifyEntry(data, burst, now)) return null
      tx.update(ref, {
        notified_burst: burst,
        notified_at: new Date(now).toISOString(),
        notify_count: Number(data.notify_count || 0) + 1,
      })
      return data
    })
  } catch (error) {
    // Unclaimable: skip. A missed email is a smaller harm than a duplicate.
    console.error('[waitlist] claim failed', { id: ref?.id, error })
    return null
  }
}

async function holdsLiveTicket(eventId: string, userId: string): Promise<boolean> {
  try {
    const snap = await adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .where('attendee_id', '==', userId)
      .get()
    return snap.docs.some((d: any) => isLiveTicketStatus(d.data()?.status))
  } catch {
    return false
  }
}

async function recipientEmail(entry: Record<string, any>): Promise<string | null> {
  const stored = typeof entry.email === 'string' ? entry.email.trim() : ''
  if (stored) return stored
  if (!entry.user_id) return null
  try {
    const snap = await adminDb.collection('users').doc(String(entry.user_id)).get()
    const email = snap.exists ? snap.data()?.email : null
    return typeof email === 'string' && email.trim() ? email.trim() : null
  } catch {
    return null
  }
}

async function sendAvailableEmail(eventId: string, event: Record<string, any>, entry: Record<string, any>, to: string) {
  const { sendEmail, getWaitlistNotificationEmail, emailSubjects } = await import('@/lib/email')
  const { resolveEmailLang } = await import('@/lib/email-kit/recipient')
  const { formatEventWhen } = await import('@/lib/email-kit/i18n')
  const { eventInstantIso } = await import('@/lib/email-templates/reminder')
  const lang = await resolveEmailLang({ userId: entry.user_id || null, email: to, event })
  const when = formatEventWhen(eventInstantIso(event.start_datetime), lang, event)
  const title = String(event.title || '').replace(/[\r\n]+/g, ' ').trim()
  return sendEmail({
    to,
    subject: emailSubjects.waitlist(lang, title),
    html: getWaitlistNotificationEmail({
      lang,
      eventTitle: title,
      eventDate: when ? when.line : '',
      quantity: 1,
      eventId,
      posterUrl: String(event.banner_image_url || '').trim() || null,
      venue: [event.venue_name, event.city].filter(Boolean).join(', ') || undefined,
    }),
  })
}

export interface WaitlistEventResult {
  eventId: string
  state: 'open' | 'sold_out' | 'closed' | 'missing'
  notified: number
}

/** Check one event and email its waiting list if seats are purchasable now. */
export async function notifyWaitlistForEvent(eventId: string, nowMs: number = Date.now()): Promise<WaitlistEventResult> {
  const eventSnap = await adminDb.collection('events').doc(eventId).get()
  const event = eventSnap.exists ? ({ id: eventId, ...(eventSnap.data() || {}) } as Record<string, any>) : null

  const entriesSnap = await adminDb
    .collection(WAITLIST_COLLECTION)
    .where('event_id', '==', eventId)
    .where('status', '==', 'waiting')
    .get()

  if (!event || isEventClosedForWaitlist(event, nowMs) || !isWaitlistEnabled(event)) {
    // Past, cancelled, unpublished or waitlist switched off: stop scanning it.
    for (const d of entriesSnap.docs) {
      await d.ref.update({ status: 'closed', closed_at: new Date(nowMs).toISOString() }).catch(() => undefined)
    }
    return { eventId, state: event ? 'closed' : 'missing', notified: 0 }
  }

  const left = await seatsLeftNow(eventId, event)
  const open = left == null || left > 0
  const burst = await syncBurst(eventId, open, nowMs)
  if (!open || burst == null) return { eventId, state: 'sold_out', notified: 0 }

  const ordered = [...entriesSnap.docs].sort(
    (a: any, b: any) => Number(a.data()?.position || 0) - Number(b.data()?.position || 0)
  )
  let notified = 0
  for (const doc of ordered) {
    const entry = doc.data() || {}
    if (!shouldNotifyEntry(entry, burst, nowMs)) continue
    if (entry.user_id && (await holdsLiveTicket(eventId, String(entry.user_id)))) {
      await doc.ref.update({ status: 'purchased' }).catch(() => undefined)
      continue
    }
    const claimed = await claimEntry(doc.ref, burst, nowMs)
    if (!claimed) continue
    const to = await recipientEmail(claimed)
    if (!to) continue
    try {
      const result = await sendAvailableEmail(eventId, event, claimed, to)
      if (result?.success) notified++
      else console.warn('[waitlist] email not sent', { eventId, entry: doc.id, code: (result as any)?.code })
    } catch (error) {
      console.error('[waitlist] email failed', { eventId, entry: doc.id, error })
    }
  }
  return { eventId, state: 'open', notified }
}

/**
 * Every event with someone waiting (called from the inventory-sweep cron).
 * Never throws.
 */
export async function sweepWaitlists(opts: { limit?: number; now?: number } = {}) {
  const limit = opts.limit ?? 1000
  const now = opts.now ?? Date.now()
  let eventIds: string[] = []
  try {
    const snap = await adminDb.collection(WAITLIST_COLLECTION).where('status', '==', 'waiting').limit(limit).get()
    eventIds = Array.from(
      new Set<string>(snap.docs.map((d: any) => String(d.data()?.event_id || '')).filter(Boolean))
    )
  } catch (error) {
    console.error('[waitlist] sweep query failed', error)
    return { events: 0, notified: 0 }
  }
  let notified = 0
  for (const eventId of eventIds) {
    try {
      notified += (await notifyWaitlistForEvent(eventId, now)).notified
    } catch (error) {
      console.error('[waitlist] event check failed', { eventId, error })
    }
  }
  return { events: eventIds.length, notified }
}
