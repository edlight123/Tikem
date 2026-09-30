/**
 * What may be sent, to whom, and at what hour.
 *
 * Pure logic on purpose: no Firestore, no network. The decision to send is the
 * part worth testing, so it lives apart from the code that does the sending.
 *
 * The distinction that runs through this file is TRANSACTIONAL vs DISCRETIONARY.
 * A ticket confirmation or an event starting in 30 minutes is something the user
 * asked for by buying a ticket — it goes out at 3am if that is when it is due.
 * "An event near you is filling fast" is something WE want to say, and it obeys
 * quiet hours, per-category opt-outs, and frequency caps. Blurring the two is how
 * an app teaches people to turn notifications off, after which the transactional
 * ones stop arriving too.
 */
export type NotificationCategory =
  | 'purchase' // your ticket is confirmed
  | 'reminder' // your event starts soon
  | 'event_change' // time/venue changed
  | 'payout' // your withdrawal was paid / failed / is being confirmed — your own money
  | 'filling_fast' // an event you follow is nearly sold out
  | 'discovery' // new events in your city
  | 'organizer_sale' // you sold a ticket
  | 'organizer_milestone' // 50% sold, sold out
  | 'organizer_nudge' // sales are slow, here is your promoter link

const TRANSACTIONAL: ReadonlySet<NotificationCategory> = new Set([
  'purchase',
  'reminder',
  'event_change',
  'payout',
])

export function isTransactional(category: NotificationCategory): boolean {
  return TRANSACTIONAL.has(category)
}

/**
 * The user field each category reads. Absent field means opted in — existing
 * users never chose these, and defaulting them to off would ship a feature
 * nobody receives.
 */
const PREFERENCE_FIELD: Record<NotificationCategory, string | null> = {
  purchase: 'notify_ticket_purchase',
  reminder: 'notify_reminders',
  event_change: 'notify_event_updates',
  // No opt-out: a payout outcome is about the recipient's own money.
  payout: null,
  filling_fast: 'notify_filling_fast',
  discovery: 'notify_discovery',
  organizer_sale: 'notify_ticket_purchase',
  organizer_milestone: 'notify_organizer_milestones',
  organizer_nudge: 'notify_organizer_nudges',
}

export function isCategoryEnabled(
  user: Record<string, any> | null | undefined,
  category: NotificationCategory
): boolean {
  const field = PREFERENCE_FIELD[category]
  if (!field) return true
  return user?.[field] ?? true
}

/** Quiet hours in the recipient's local time: nothing discretionary 21:00–08:59. */
export const QUIET_HOURS_START = 21
export const QUIET_HOURS_END = 9

/**
 * Default timezone per market. Deliberately coarse — this decides whether to
 * delay a marketing push by a few hours, not anything that must be exact. The US
 * and Canada span many zones; their largest audience city is the better guess
 * than UTC, which would put quiet hours in the middle of the afternoon.
 */
const COUNTRY_TIMEZONE: Record<string, string> = {
  HT: 'America/Port-au-Prince',
  US: 'America/New_York',
  CA: 'America/Toronto',
  FR: 'Europe/Paris',
}

export function localHour(now: Date, countryCode?: string | null): number {
  const tz = COUNTRY_TIMEZONE[String(countryCode || '').toUpperCase()]
  if (!tz) {
    // Unknown market: assume the Haiti/US-Eastern band both main audiences sit
    // in rather than UTC, which would silence the entire afternoon.
    return new Date(now.getTime() - 5 * 60 * 60 * 1000).getUTCHours()
  }
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).format(now)
    return Number(hour) % 24
  } catch {
    return new Date(now.getTime() - 5 * 60 * 60 * 1000).getUTCHours()
  }
}

export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END
}

export interface SendDecision {
  send: boolean
  reason: 'ok' | 'category_disabled' | 'quiet_hours' | 'capped'
}

/**
 * The single gate every discretionary notification passes through.
 *
 * `sentRecently` is the caller's answer to "have we already said this to this
 * person about this thing" — the frequency cap lives with whoever owns the
 * record, but the decision to honour it lives here.
 */
export function decideSend(params: {
  user: Record<string, any> | null | undefined
  category: NotificationCategory
  now?: Date
  sentRecently?: boolean
}): SendDecision {
  const { user, category, now = new Date(), sentRecently = false } = params

  if (!isCategoryEnabled(user, category)) {
    return { send: false, reason: 'category_disabled' }
  }

  // Transactional notifications ignore quiet hours and caps by design: the user
  // bought something, and a reminder that arrives the morning after the event is
  // worse than one that arrives late at night.
  if (isTransactional(category)) return { send: true, reason: 'ok' }

  if (sentRecently) return { send: false, reason: 'capped' }

  if (isQuietHour(localHour(now, user?.last_seen_country))) {
    return { send: false, reason: 'quiet_hours' }
  }

  return { send: true, reason: 'ok' }
}
