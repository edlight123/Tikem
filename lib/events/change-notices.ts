/**
 * Telling ticket holders that a live event moved (date, time, venue, online
 * link). The decisions are in ./change-detect.ts; this is storage and sending.
 *
 * WHERE CHANGES ARE SEEN. Both composers (web EventComposer, app
 * mobile/lib/api/events updateEvent) write the event straight to Firestore
 * from the client, so there is no server save to hook. Instead:
 *   - the /api/cron/event-change-notices cron (every 5 minutes) reads events
 *     whose `updated_at` moved since its last run (the web writes it as an ISO
 *     string, the app as a Timestamp: both are queried) and observes each;
 *   - publishing observes the event, which stores its first baseline;
 *   - older upcoming events get a baseline from a paged backfill.
 * Each observation is compared with the baseline in
 * event_change_state/{eventId} (server-only: firestore.rules default-deny).
 *
 * SENDING, bounded and idempotent. A due change is CLAIMED in a transaction
 * (baseline moved on, pending cleared, an event_change_notices doc created)
 * before anything is sent, so two overlapping runs can't both send it. The
 * notice is then delivered to holders at most MAX_DELIVERIES_PER_RUN per cron
 * run: each person gets a delivery doc (event_change_notices/{id}/deliveries/
 * {person}) created BEFORE their email/push, so a retry or the next run never
 * reaches the same person twice for the same change. A notice with people
 * left stays `sending` and the next run continues it.
 *
 * WHO. Every live ticket holder once (lib/events/ticket-holders). Email to
 * everyone with an address (transactional, `event_change` in
 * lib/notifications/policy.ts); in-app to account holders; push unless the
 * person turned event updates off. Haiti events: French unless the person
 * chose Kreyòl, 12-hour clock (lib/email-kit/i18n formatEventWhen).
 */
import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { appUrl } from '@/lib/email-kit/layout'
import { loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { decideSend } from '@/lib/notifications/policy'
import { getEventChangeEmail, EVENT_CHANGE_TEXT } from '@/lib/email-templates/eventChange'
import { holdersFromRows, noticeLangFor, type TicketHolder } from './ticket-holders'
import {
  changeNoticeStamp,
  eventIsNotifiable,
  materialChanges,
  materialSnapshot,
  noticeDue,
  observe,
  type ChangeState,
  type MaterialSnapshot,
  changeContentAllowed,
} from './change-detect'

export const CHANGE_STATE_COLLECTION = 'event_change_state'
export const CHANGE_NOTICES_COLLECTION = 'event_change_notices'
/** People reached per cron run across all notices (the run's time budget). */
export const MAX_DELIVERIES_PER_RUN = 250
/** Due changes claimed per run. */
const MAX_CLAIMS_PER_RUN = 25

const stateRef = (eventId: string) => adminDb.collection(CHANGE_STATE_COLLECTION).doc(eventId)
const SCAN_STATE = () => adminDb.collection('system_state').doc('event_change_scan')

/** A delivery doc id: a hash, so no address ends up in a document path. */
export function deliveryId(personKey: string): string {
  return createHash('sha256').update(personKey).digest('hex').slice(0, 40)
}

/**
 * Record one look at an event. Creates the baseline the first time; afterwards
 * marks a notice pending when a material field differs from the baseline.
 * Never sends: the cron sends once the debounce has passed.
 */
export async function observeEventChange(
  eventId: string,
  event: Record<string, any>,
  now = Date.now()
): Promise<'baseline' | 'pending' | 'cleared' | 'unchanged'> {
  const current = materialSnapshot(event)
  const ref = stateRef(eventId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const state: ChangeState | null = snap.exists ? (snap.data() as ChangeState) : null
    const next = observe(state, current, now)
    if (!next) return 'unchanged'
    tx.set(ref, { ...next, event_id: eventId, updated_at: new Date(now).toISOString() })
    if (!state) return 'baseline'
    return next.pending ? 'pending' : 'cleared'
  })
}

/**
 * Claim every change whose debounce has passed: the baseline moves to what
 * the event says now and a notice doc is created, in one transaction. The
 * event also gets `change_notice` (what moved and what it was), which the
 * ticket screens show.
 */
/** At most this many change notices per event per UTC day. */
export const MAX_NOTICES_PER_EVENT_PER_DAY = 3

export async function claimDueChanges(now = Date.now()): Promise<Array<{ eventId: string; outcome: string; noticeId?: string }>> {
  const snap = await adminDb.collection(CHANGE_STATE_COLLECTION).where('pending', '==', true).limit(MAX_CLAIMS_PER_RUN).get()
  const out: Array<{ eventId: string; outcome: string; noticeId?: string }> = []
  for (const doc of snap.docs as any[]) {
    const eventId = doc.id
    if (!noticeDue(doc.data() as ChangeState, now)) continue
    try {
      const eventRef = adminDb.collection('events').doc(eventId)
      const noticeId = `${eventId}_${now}`
      const noticeRef = adminDb.collection(CHANGE_NOTICES_COLLECTION).doc(noticeId)
      const outcome: string = await adminDb.runTransaction(async (tx: any) => {
        const [fresh, eventSnap] = await Promise.all([tx.get(stateRef(eventId)), tx.get(eventRef)])
        const s = fresh.exists ? (fresh.data() as ChangeState) : null
        if (!s || !noticeDue(s, now)) return 'not_due'
        const event = eventSnap.exists ? (eventSnap.data() as Record<string, any>) : null
        const current = materialSnapshot(event)
        const stamp = event && eventIsNotifiable(event, now) ? changeNoticeStamp(s.baseline, current, now) : null
        // A per-event daily cap: past it the change stays pending and goes out
        // tomorrow as one notice (old → newest), so an organizer can't spam holders.
        const day = new Date(now).toISOString().slice(0, 10)
        const sentToday = (s as any).notice_day === day ? Number((s as any).notice_count) || 0 : 0
        if (stamp && sentToday >= MAX_NOTICES_PER_EVENT_PER_DAY) return 'capped'
        tx.set(
          stateRef(eventId),
          {
            baseline: current,
            latest: current,
            pending: false,
            pending_since: null,
            last_notice_at: now,
            updated_at: new Date(now).toISOString(),
            ...(stamp ? { notice_day: day, notice_count: sentToday + 1 } : {}),
          },
          { merge: true }
        )
        if (!event || !eventIsNotifiable(event, now)) return 'skipped_not_live'
        if (!stamp) return 'reverted'
        // The organizer typed the venue and the link: the same phishing and
        // link rules as an organizer message (lib/moderation/broadcast) before
        // they go out in our name. A refused change is kept for an admin.
        // Both sides are rendered (old → new), so both must pass: a refused
        // value that became the baseline can never reappear as "before".
        if (!changeContentAllowed(current, event.title) || !changeContentAllowed(s.baseline, event.title)) {
          tx.set(noticeRef, {
            event_id: eventId,
            before: s.baseline,
            after: current,
            kinds: stamp.kinds,
            status: 'blocked',
            delivered: 0,
            created_at: new Date(now).toISOString(),
          })
          return 'blocked'
        }
        tx.set(noticeRef, {
          event_id: eventId,
          before: s.baseline,
          after: current,
          // The title as checked above; delivery sends this, never a later edit.
          title: String(event.title || ''),
          kinds: stamp.kinds,
          status: 'sending',
          delivered: 0,
          created_at: new Date(now).toISOString(),
        })
        // Not updated_at: this is not an edit, and the scan must not see it as one.
        tx.update(eventRef, { change_notice: stamp })
        return 'claimed'
      })
      out.push({ eventId, outcome, ...(outcome === 'claimed' ? { noticeId } : {}) })
    } catch (e) {
      console.error('[event-change] claim failed', eventId, (e as any)?.message)
      out.push({ eventId, outcome: 'error' })
    }
  }
  return out
}

/** One holder: in-app + push for an account, email for everyone with an address. */
async function notifyHolder(
  person: TicketHolder,
  event: Record<string, any> & { id: string },
  before: MaterialSnapshot,
  after: MaterialSnapshot
): Promise<{ emailed: boolean; pushed: boolean }> {
  const base = appUrl()
  let profile: Record<string, any> | null = null
  if (person.uid) {
    const snap = await adminDb.collection('users').doc(person.uid).get().catch(() => null)
    profile = snap?.exists ? (snap.data() as Record<string, any>) : null
  }
  const lang = noticeLangFor(
    await resolveEmailLang({ explicit: profile?.language, userId: profile ? null : person.uid, email: person.email, event: event as any }),
    event
  )
  const ticketPath = `/tickets/event/${encodeURIComponent(event.id)}`
  const mail = getEventChangeEmail({
    lang,
    event,
    before,
    after,
    hasAccount: Boolean(person.uid),
    ticketUrl: person.uid ? `${base}${ticketPath}` : `${base}/tickets/find`,
  })

  let pushed = false
  if (person.uid) {
    const t = EVENT_CHANGE_TEXT[lang]
    const eventTitle = String(event.title || '').replace(/[\r\n]+/g, ' ').trim() || t.fallbackTitle
    const title = t.pushTitle(eventTitle)
    const body = mail.rows.map((r) => `${r.label}: ${r.after}`).join(' · ') || t.intro
    await createNotification(person.uid, 'event_updated', title, body, ticketPath, {
      eventId: event.id,
      kind: 'event_change',
    })
    if (decideSend({ user: profile, category: 'event_change' }).send) {
      await sendPushNotification(person.uid, title, body, ticketPath, { type: 'event_changed', eventId: event.id })
      pushed = true
    }
  }
  let emailed = false
  if (person.email) {
    const sent = await sendEmail({ to: person.email, subject: mail.subject, html: mail.html })
    emailed = Boolean(sent?.success)
  }
  return { emailed, pushed }
}

export type DeliveryResult = { noticeId: string; eventId: string; reached: number; remaining: number; outcome: string }

/**
 * Deliver open notices, at most `budget` people this run. Each person is
 * claimed (delivery doc `create`, which fails if it exists) before being sent
 * to, so nobody hears the same change twice.
 */
export async function deliverOpenNotices(budget = MAX_DELIVERIES_PER_RUN): Promise<DeliveryResult[]> {
  const open = await adminDb.collection(CHANGE_NOTICES_COLLECTION).where('status', '==', 'sending').limit(10).get()
  const results: DeliveryResult[] = []
  for (const noticeDoc of open.docs as any[]) {
    if (budget <= 0) break
    const notice = noticeDoc.data() || {}
    const eventId = String(notice.event_id || '')
    const noticeRef = noticeDoc.ref
    try {
      const eventSnap = await adminDb.collection('events').doc(eventId).get()
      // The title checked at claim time (stored on the notice), not whatever the
      // event is called now: an edit after the check never reaches holders.
      const event = eventSnap.exists
        ? ({ ...(eventSnap.data() as any), id: eventId, title: String(notice.title ?? '') } as Record<string, any> & { id: string })
        : null
      // Cancelled or unpublished since: the cancel flow tells holders itself.
      if (!event || !eventIsNotifiable(event)) {
        await noticeRef.update({ status: 'skipped', finished_at: new Date().toISOString() })
        results.push({ noticeId: noticeDoc.id, eventId, reached: 0, remaining: 0, outcome: 'skipped_not_live' })
        continue
      }
      const before = notice.before as MaterialSnapshot
      const after = notice.after as MaterialSnapshot
      if (!materialChanges(before, after).length) {
        await noticeRef.update({ status: 'done', finished_at: new Date().toISOString() })
        continue
      }
      const people = holdersFromRows(await loadEventTicketRows(event))
      // Who has already been reached for this notice.
      const refs = people.map((p) => noticeRef.collection('deliveries').doc(deliveryId(p.key)))
      const done = new Set<string>()
      for (let i = 0; i < refs.length; i += 300) {
        const chunk = refs.slice(i, i + 300)
        if (!chunk.length) continue
        const snaps = await adminDb.getAll(...chunk)
        ;(snaps as any[]).forEach((s) => s.exists && done.add(s.id))
      }
      const todo = people.filter((p) => !done.has(deliveryId(p.key)))
      let reached = 0
      for (const person of todo) {
        if (budget <= 0) break
        const ref = noticeRef.collection('deliveries').doc(deliveryId(person.key))
        try {
          await ref.create({ at: new Date().toISOString(), account: Boolean(person.uid) })
        } catch {
          continue // another run claimed this person
        }
        budget--
        reached++
        try {
          const r = await notifyHolder(person, event, before, after)
          await ref.update({ emailed: r.emailed, pushed: r.pushed }).catch(() => {})
        } catch (e) {
          console.error('[event-change] one holder failed', eventId, (e as any)?.message)
          await ref.update({ failed: true }).catch(() => {})
        }
      }
      const remaining = todo.length - reached
      await noticeRef.update({
        delivered: Number(notice.delivered || 0) + reached,
        recipients: people.length,
        ...(remaining <= 0 ? { status: 'done', finished_at: new Date().toISOString() } : {}),
      })
      results.push({ noticeId: noticeDoc.id, eventId, reached, remaining, outcome: remaining <= 0 ? 'done' : 'continuing' })
    } catch (e) {
      console.error('[event-change] deliver failed', noticeDoc.id, (e as any)?.message)
      results.push({ noticeId: noticeDoc.id, eventId, reached: 0, remaining: -1, outcome: 'error' })
    }
  }
  return results
}

/**
 * Observe every event edited since the last scan (with a 2-minute overlap).
 * The first run has no cursor: it only looks back 30 minutes, and
 * baselineUpcomingEvents() gives every other upcoming event its baseline.
 */
const SCAN_PAGE = 500

function instantMs(v: any): number | null {
  if (!v) return null
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}

export async function scanEditedEvents(now = Date.now()) {
  const stateSnap = await SCAN_STATE().get()
  const state = stateSnap.exists ? (stateSnap.data() as any) : {}
  const since = Number(state.last_scan_at) ? Number(state.last_scan_at) - 2 * 60 * 1000 : now - 30 * 60 * 1000
  const sinceDate = new Date(since)
  const nowDate = new Date(now)
  // Bounded above by now and ordered, so an event stamped in the future can't
  // hold the window, and a full page moves the cursor only as far as it read.
  const [asString, asTimestamp] = await Promise.all([
    adminDb
      .collection('events')
      .where('updated_at', '>=', sinceDate.toISOString())
      .where('updated_at', '<=', nowDate.toISOString())
      .orderBy('updated_at')
      .limit(SCAN_PAGE)
      .get()
      .catch(() => null),
    adminDb
      .collection('events')
      .where('updated_at', '>=', sinceDate)
      .where('updated_at', '<=', nowDate)
      .orderBy('updated_at')
      .limit(SCAN_PAGE)
      .get()
      .catch(() => null),
  ])
  // Where to start next time: now, unless a page was full; then the oldest
  // last-read edit across the two (the 2-minute overlap re-reads it, harmlessly).
  let nextScan = now
  for (const snap of [asString, asTimestamp] as any[]) {
    const docs = (snap?.docs || []) as any[]
    if (docs.length < SCAN_PAGE) continue
    const lastAt = instantMs(docs[docs.length - 1].data()?.updated_at)
    const firstAt = instantMs(docs[0].data()?.updated_at)
    if (lastAt == null) continue
    // A full page all at one instant would re-read itself forever: step past it.
    const resumeAt = firstAt === lastAt ? lastAt + 1 : lastAt
    if (firstAt === lastAt) console.warn('[event-change] a full scan page shares one updated_at; skipping past', lastAt)
    nextScan = Math.min(nextScan, resumeAt + 2 * 60 * 1000)
  }
  const seen = new Map<string, any>()
  for (const s of [asString, asTimestamp]) for (const d of ((s as any)?.docs || []) as any[]) seen.set(d.id, d.data())
  let observed = 0
  let pending = 0
  for (const [id, data] of seen) {
    if (!eventIsNotifiable(data, now)) continue
    try {
      const r = await observeEventChange(id, data, now)
      observed++
      if (r === 'pending') pending++
    } catch (e) {
      console.error('[event-change] observe failed', id, (e as any)?.message)
    }
  }
  await SCAN_STATE().set({ last_scan_at: nextScan }, { merge: true })
  return { scanned: seen.size, observed, pending, caughtUp: nextScan === now }
}

/**
 * Give published events that predate this feature a baseline, a page per run
 * until done, so their first edit is noticed too.
 */
export async function baselineUpcomingEvents(now = Date.now(), pageSize = 300) {
  const stateSnap = await SCAN_STATE().get()
  const state = stateSnap.exists ? (stateSnap.data() as any) : {}
  if (state.backfill_done === true) return { done: true, baselined: 0 }
  let q = adminDb.collection('events').where('is_published', '==', true).orderBy('__name__').limit(pageSize)
  if (state.backfill_cursor) q = q.startAfter(String(state.backfill_cursor))
  const page = await q.get()
  const docs = (page.docs || []) as any[]
  const live = docs.filter((d) => eventIsNotifiable(d.data(), now))
  const refs = live.map((d) => stateRef(d.id))
  const existing = refs.length ? ((await adminDb.getAll(...refs)) as any[]) : []
  let baselined = 0
  for (let i = 0; i < live.length; i++) {
    if (existing[i]?.exists) continue
    const current = materialSnapshot(live[i].data())
    await stateRef(live[i].id).set({
      baseline: current,
      latest: current,
      pending: false,
      pending_since: null,
      last_change_at: null,
      last_notice_at: null,
      event_id: live[i].id,
      updated_at: new Date(now).toISOString(),
    })
    baselined++
  }
  const done = docs.length < pageSize
  await SCAN_STATE().set(
    { backfill_cursor: docs.length ? docs[docs.length - 1].id : state.backfill_cursor || null, backfill_done: done },
    { merge: true }
  )
  return { done, baselined }
}
