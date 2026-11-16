import { adminDb } from '@/lib/firebase/admin'
import { sendDiscretionary } from '@/lib/notifications/campaigns'
import { claimReminder } from '@/lib/notifications/reminder-claim'
import { marketTimezone } from '@/lib/notifications/policy'
import { resolveOrgRecipients } from '@/lib/notifications/orgRecipients'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { eventOrgId, teamSeatIn } from '@/lib/organizer/context'
import { sendEmail } from '@/lib/email'
import { appUrl } from '@/lib/email-kit/layout'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { getEventRecapEmail } from '@/lib/email-templates/eventRecap'
import { arrivalBuckets, eventEnd, followupDue, toDate } from './timing'

/**
 * The morning after an event (see ./timing for when):
 *  - every CHECKED-IN attendee with an account gets "How was {event}?", which
 *    opens a three-face rating with an optional comment and a Follow button;
 *  - the organizer side (owner, admins, managers) gets the recap.
 * Both are discretionary sends (opt-outs, quiet hours, once per person per
 * event). Ratings are private to the organizer.
 */

export type Lang = 'en' | 'fr' | 'ht'
export const FEEDBACK_RATINGS = [1, 2, 3] as const // 😕 🙂 🤩
export const FEEDBACK_COMMENT_MAX = 280

const COPY: Record<
  Lang,
  { askTitle: (e: string) => string; askBody: (o: string) => string; recapTitle: (e: string) => string; recapBody: (came: number, sold: number) => string }
> = {
  en: {
    askTitle: (e) => `How was ${e}?`,
    askBody: (o) => `Tell ${o} in one tap.`,
    recapTitle: (e) => `Your recap for ${e}`,
    recapBody: (c, s) => (s > 0 ? `${c} of ${s} came (${Math.round((c / s) * 100)}%).` : `${c} came.`),
  },
  fr: {
    askTitle: (e) => `Comment était ${e} ?`,
    askBody: (o) => `Dites-le à ${o} en un geste.`,
    recapTitle: (e) => `Votre bilan : ${e}`,
    recapBody: (c, s) => (s > 0 ? `${c} sur ${s} sont venus (${Math.round((c / s) * 100)} %).` : `${c} sont venus.`),
  },
  ht: {
    askTitle: (e) => `Kijan ${e} te ye?`,
    askBody: (o) => `Di ${o} sa w panse.`,
    recapTitle: (e) => `Rezime ${e}`,
    recapBody: (c, s) => (s > 0 ? `${c} sou ${s} te vini (${Math.round((c / s) * 100)}%).` : `${c} te vini.`),
  },
}

function langOf(user: Record<string, any> | null | undefined): Lang {
  const l = String(user?.language || user?.preferred_language || '').toLowerCase().slice(0, 2)
  return l === 'fr' || l === 'ht' ? (l as Lang) : 'en'
}

const isAccountId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && !id.startsWith('guest_')

async function loadUsers(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>()
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => adminDb.collection('users').doc(id))
    if (!refs.length) continue
    const snaps = await adminDb.getAll(...refs)
    for (const s of snaps as any[]) if (s.exists) out.set(s.id, s.data() || {})
  }
  return out
}

// ---------------------------------------------------------------------------
// Recap
// ---------------------------------------------------------------------------

export interface EventRecap {
  eventId: string
  title: string
  posterUrl: string | null
  startsAt: string | null
  endedAt: string | null
  ended: boolean
  currency: string
  sold: number
  checkedIn: number
  /** Gross ticket sales. null when the caller may not see finances (route strips it). */
  revenue: number | null
  arrivals: Array<{ at: string; count: number }>
  peakArrival: string | null
  newFollowers: number
  /** Tickets held by people who never came in. */
  noShows: number
  /** The shortest run of half-hours that holds ~60% of arrivals. */
  arrivalWindow: { from: string; to: string } | null
  /** This organizer's earlier past events, for comparison (up to 8). */
  previous: { events: number; avgTurnout: number | null }
  feedback: {
    total: number
    counts: { 1: number; 2: number; 3: number }
    comments: Array<{ name: string; rating: number; text: string; at: string | null }>
  }
}

export async function loadEventRecap(eventId: string, event: Record<string, any>): Promise<EventRecap> {
  const [ticketSnap, feedbackSnap, followSnap] = await Promise.all([
    adminDb.collection('tickets').where('event_id', '==', eventId).get(),
    adminDb.collection('events').doc(eventId).collection('feedback').limit(500).get(),
    event.organizer_id
      ? adminDb.collection('organizer_follows').where('organizer_id', '==', String(event.organizer_id)).limit(5000).get()
      : Promise.resolve(null as any),
  ])

  let sold = 0
  let checkedIn = 0
  let revenue = 0
  const times: Date[] = []
  for (const d of ticketSnap.docs as any[]) {
    const t = d.data() || {}
    const status = String(t.status || '').toLowerCase()
    if (!isLiveTicketStatus(t.status) && status !== 'checked_in') continue
    sold += 1
    revenue += Number(t.price_paid) || 0
    if (t.checked_in === true || t.checked_in_at) {
      checkedIn += 1
      const at = toDate(t.checked_in_at)
      if (at) times.push(at)
    }
  }
  const arrivals = arrivalBuckets(times)
  const peak = arrivals.reduce<{ at: string; count: number } | null>((m, b) => (!m || b.count > m.count ? b : m), null)

  const start = toDate(event.start_datetime)
  const end = eventEnd(event)
  const newFollowers = followSnap
    ? (followSnap.docs as any[]).filter((d) => {
        const at = toDate(d.data()?.created_at)
        return !!(at && start && at >= start)
      }).length
    : 0

  const counts = { 1: 0, 2: 0, 3: 0 } as { 1: number; 2: number; 3: number }
  const comments: EventRecap['feedback']['comments'] = []
  for (const d of feedbackSnap.docs as any[]) {
    const f = d.data() || {}
    const r = Number(f.rating)
    if (r === 1 || r === 2 || r === 3) counts[r] += 1
    if (typeof f.comment === 'string' && f.comment.trim()) {
      comments.push({
        name: String(f.user_name || ''),
        rating: r,
        text: f.comment.trim(),
        at: toDate(f.updated_at || f.created_at)?.toISOString() ?? null,
      })
    }
  }
  comments.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))

  // ~60% of arrivals in the shortest contiguous window of half-hour slots.
  let arrivalWindow: EventRecap['arrivalWindow'] = null
  const totalIn = arrivals.reduce((n, b) => n + b.count, 0)
  if (totalIn >= 3) {
    const goal = Math.ceil(totalIn * 0.6)
    let best: [number, number] | null = null
    for (let i = 0; i < arrivals.length; i++) {
      let sum = 0
      for (let j = i; j < arrivals.length; j++) {
        sum += arrivals[j].count
        if (sum >= goal) {
          if (!best || j - i < best[1] - best[0]) best = [i, j]
          break
        }
      }
    }
    if (best) {
      const end = new Date(new Date(arrivals[best[1]].at).getTime() + 30 * 60_000)
      arrivalWindow = { from: arrivals[best[0]].at, to: end.toISOString() }
    }
  }

  const previous = await previousTurnout(eventId, event, start)

  return {
    eventId,
    title: String(event.title || ''),
    posterUrl: (event.banner_image_url || event.cover_image_url || null) as string | null,
    startsAt: start?.toISOString() ?? null,
    endedAt: end?.toISOString() ?? null,
    ended: !!(end && end.getTime() < Date.now()),
    currency: String(event.currency || 'HTG'),
    sold,
    checkedIn,
    revenue: Math.round(revenue * 100) / 100,
    arrivals,
    peakArrival: peak && peak.count > 0 ? peak.at : null,
    newFollowers,
    noShows: Math.max(0, sold - checkedIn),
    arrivalWindow,
    previous,
    feedback: {
      total: counts[1] + counts[2] + counts[3],
      counts,
      comments: comments.slice(0, 100),
    },
  }
}

/** Average turnout of this organizer's earlier, past events (up to 8). */
async function previousTurnout(
  eventId: string,
  event: Record<string, any>,
  start: Date | null
): Promise<EventRecap['previous']> {
  const orgId = String(event.organizer_id || '')
  if (!orgId || !start) return { events: 0, avgTurnout: null }
  try {
    const snap = await adminDb.collection('events').where('organizer_id', '==', orgId).limit(200).get()
    const earlier = (snap.docs as any[])
      .map((d) => ({ id: d.id, data: d.data() || {} }))
      .filter((e) => e.id !== eventId && !e.data.seed_batch && String(e.data.status || '') !== 'cancelled')
      .map((e) => ({ ...e, at: toDate(e.data.start_datetime) }))
      .filter((e) => e.at && e.at < start)
      .sort((a, b) => b.at!.getTime() - a.at!.getTime())
      .slice(0, 8)
    const rates: number[] = []
    for (const e of earlier) {
      const t = await adminDb.collection('tickets').where('event_id', '==', e.id).get()
      let sold = 0
      let came = 0
      for (const d of t.docs as any[]) {
        const x = d.data() || {}
        const st = String(x.status || '').toLowerCase()
        if (!isLiveTicketStatus(x.status) && st !== 'checked_in') continue
        sold += 1
        if (x.checked_in === true || x.checked_in_at) came += 1
      }
      if (sold >= 3) rates.push(came / sold)
    }
    if (rates.length === 0) return { events: 0, avgTurnout: null }
    return { events: rates.length, avgTurnout: rates.reduce((a, b) => a + b, 0) / rates.length }
  } catch (error) {
    console.error('[recap] previous turnout failed', error)
    return { events: 0, avgTurnout: null }
  }
}

// ---------------------------------------------------------------------------
// The morning-after sends
// ---------------------------------------------------------------------------

export interface FollowupRunResult {
  eventsChecked: number
  eventsSent: number
  attendeeAsks: number
  organizerRecaps: number
}

/** Recently started, published events (both start_datetime encodings). */
async function recentEvents(now: Date): Promise<Array<{ id: string } & Record<string, any>>> {
  const from = new Date(now.getTime() - 4 * 24 * 3_600_000)
  const base = adminDb.collection('events').where('is_published', '==', true)
  const [asString, asTimestamp] = await Promise.all([
    base.where('start_datetime', '>=', from.toISOString()).where('start_datetime', '<=', now.toISOString()).get(),
    base.where('start_datetime', '>=', from).where('start_datetime', '<=', now).get(),
  ])
  const byId = new Map<string, any>()
  for (const d of [...asString.docs, ...asTimestamp.docs] as any[]) byId.set(d.id, { id: d.id, ...(d.data() || {}) })
  return Array.from(byId.values())
}

/**
 * Email one organizer-side recipient their recap. Ticket sales only for the org
 * owner or an admin with the finance grant (managers get it without). Never
 * throws: a failed email must not stop the run.
 */
async function emailRecap(
  uid: string,
  user: Record<string, any> | undefined,
  event: { id: string } & Record<string, any>,
  recap: EventRecap
): Promise<void> {
  try {
    const to = typeof user?.email === 'string' ? user.email.trim() : ''
    if (!to) return
    const orgId = eventOrgId(event)
    const includeRevenue =
      !!orgId && (uid === orgId || (await teamSeatIn(orgId, uid).catch(() => null))?.financeView === true)
    const lang = await resolveEmailLang({
      explicit: user?.language || user?.preferred_language,
      event: { country: event.country, city: event.city, timezone: event.timezone },
    })
    const { subject, html } = getEventRecapEmail({
      lang,
      event,
      recap,
      includeRevenue,
      recapUrl: `${appUrl()}/organizer/events/${encodeURIComponent(event.id)}/recap`,
    })
    const res = await sendEmail({ to, subject, html })
    if (!res?.success) console.error('[post-event] recap email not sent', event.id, uid, res?.error)
  } catch (error) {
    console.error('[post-event] recap email failed', event.id, uid, error)
  }
}

export async function runPostEventFollowups(now = new Date()): Promise<FollowupRunResult> {
  const result: FollowupRunResult = { eventsChecked: 0, eventsSent: 0, attendeeAsks: 0, organizerRecaps: 0 }
  const events = await recentEvents(now)

  for (const event of events) {
    result.eventsChecked += 1
    // Demo / showcase events never reach real people's phones.
    if (event.seed_batch || event.post_event_followup_at) continue
    if (String(event.status || '').toLowerCase() === 'cancelled' || event.rejected === true) continue
    const end = eventEnd(event)
    const tz = (typeof event.timezone === 'string' && event.timezone) || marketTimezone(event.country)
    if (!end || !followupDue(end, now, tz)) continue
    // Once per event, whatever happens to the run.
    if (!(await claimReminder(event.id, 'post_event_followup'))) continue

    const title = String(event.title || 'your event')
    const orgName = String(event.organizer_name || event.organization_name || '').trim()

    // Attendees who actually came, with an account.
    const ticketSnap = await adminDb
      .collection('tickets')
      .where('event_id', '==', event.id)
      .where('checked_in', '==', true)
      .get()
    const attendeeIds = Array.from(
      new Set((ticketSnap.docs as any[]).map((d) => d.data()?.attendee_id).filter(isAccountId))
    ) as string[]

    // The organizer side doesn't get asked how their own event was.
    const recipients = await resolveOrgRecipients({ orgId: event.organizer_id, kind: 'event_ops', eventId: event.id })
    const team = new Set(recipients)
    const askIds = attendeeIds.filter((id) => !team.has(id) && id !== event.organizer_id)

    const users = await loadUsers([...askIds, ...recipients])
    for (const uid of askIds) {
      const c = COPY[langOf(users.get(uid))]
      const ok = await sendDiscretionary({
        userId: uid,
        category: 'event_feedback',
        capKey: `event_feedback:${event.id}`,
        type: 'event_feedback',
        title: c.askTitle(title),
        body: c.askBody(orgName || (langOf(users.get(uid)) === 'fr' ? "l'organisateur" : langOf(users.get(uid)) === 'ht' ? 'òganizatè a' : 'the organizer')),
        url: `/events/${event.id}/feedback`,
        data: { eventId: event.id },
      })
      if (ok) result.attendeeAsks += 1
    }

    const recap = await loadEventRecap(event.id, event)
    for (const uid of recipients) {
      const c = COPY[langOf(users.get(uid))]
      const ok = await sendDiscretionary({
        userId: uid,
        category: 'organizer_recap',
        capKey: `organizer_recap:${event.id}`,
        type: 'organizer_recap',
        title: c.recapTitle(title),
        body: c.recapBody(recap.checkedIn, recap.sold),
        url: `/organizer/events/${event.id}/recap`,
        data: { eventId: event.id },
      })
      if (ok) {
        result.organizerRecaps += 1
        // The same recap by email, behind the same opt-out/cap the push just passed.
        await emailRecap(uid, users.get(uid), event, recap)
      }
    }

    try {
      await adminDb.collection('events').doc(event.id).update({ post_event_followup_at: now.toISOString() })
    } catch (error) {
      console.error('[post-event] could not mark event', event.id, error)
    }
    result.eventsSent += 1
  }
  return result
}

// ---------------------------------------------------------------------------
// Attendee feedback
// ---------------------------------------------------------------------------

export async function hasCheckedInTicket(eventId: string, uid: string): Promise<boolean> {
  const snap = await adminDb
    .collection('tickets')
    .where('event_id', '==', eventId)
    .where('attendee_id', '==', uid)
    .where('checked_in', '==', true)
    .limit(1)
    .get()
  return !snap.empty
}
