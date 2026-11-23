/**
 * Per-event automatic reminders, as pure data (unit-tested).
 *
 * An event may carry `reminders: EventReminder[]` (written only by
 * PUT /api/organizer/events/[id]/reminders). When the field is absent the event
 * gets DEFAULT_EVENT_REMINDERS, exactly the three reminders Tikèm has always
 * sent (24 hours, 3 hours, 30 minutes before), so existing events are
 * unchanged. An EMPTY array means the organizer removed every one of them.
 *
 * `minutes_before` is how long before the start the reminder goes out. Each
 * reminder's window comes from lib/notifications/reminder-windows, so the
 * invariant tested there (no window narrower than the cron period) covers
 * custom times too.
 *
 * Send-once: the cron claims reminderClaims/{eventId}__{claimKey} before
 * notifying (lib/notifications/reminder-claim). A stock reminder at its stock
 * time keeps its historic key (`event_reminder_24h`, ...), so claims written
 * before reminders were editable still count. A moved or added reminder gets a
 * key that includes its time, so moving a reminder that already went out sends
 * it again at the new time, while editing only its words never does.
 */
import {
  CRON_PERIOD_MINUTES,
  MIN_REMINDER_OFFSET_MINUTES,
  reminderWindowForOffset,
  type ReminderType,
} from './reminder-windows'

export interface EventReminder {
  id: string
  minutes_before: number
  enabled: boolean
  /** The organizer's own words, replacing the stock body. */
  message?: string
}

export const DEFAULT_EVENT_REMINDERS: readonly EventReminder[] = Object.freeze([
  { id: 'event_reminder_24h', minutes_before: 24 * 60, enabled: true },
  { id: 'event_reminder_3h', minutes_before: 3 * 60, enabled: true },
  { id: 'event_reminder_30min', minutes_before: 30, enabled: true },
])

const STOCK_MINUTES: Record<string, number> = {
  event_reminder_24h: 24 * 60,
  event_reminder_3h: 3 * 60,
  event_reminder_30min: 30,
}

export const MAX_REMINDERS = 6
export const REMINDER_MESSAGE_MAX = 140
/** Earliest reminder: one week ahead. */
export const MAX_MINUTES_BEFORE = 7 * 24 * 60
/** Nothing closer to the start than this (see MIN_REMINDER_OFFSET_MINUTES). */
export const MIN_MINUTES_BEFORE = MIN_REMINDER_OFFSET_MINUTES
/** The reminder that also goes out by email and WhatsApp. */
export const DAY_BEFORE_MINUTES = 24 * 60

const ID_RE = /^[a-z0-9_]{1,40}$/

/**
 * Organizer words go out under the Tikèm name, so they are a phishing vector.
 * Only push and the in-app bell ever carry them (attributed to the organizer,
 * see event-reminder-send); WhatsApp and email always use the stock template.
 * Links, email addresses and phone numbers are stripped here, both when the
 * organizer saves and again when the cron sends.
 */
const URL_RE = /\b(?:https?:\/\/|hxxps?:\/\/|www\.)\S+/gi
const EMAIL_RE = /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[A-Z]{2,}/gi
/** A bare domain ("tikem-pay.co", "bit.ly/x"), with or without a path. */
const DOMAIN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,24})(?:\/\S*)?\b/gi
/** Seven or more digits, allowing spaces, dots, dashes, parentheses and a leading +. */
const PHONE_RE = /\+?\(?\d(?:[\s().-]*\d){6,}/g

export function stripContactDetails(text: string): string {
  return text
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(DOMAIN_RE, (m) => (/^\d+(?:\.\d+)*$/.test(m) ? m : ' '))
    .replace(PHONE_RE, ' ')
}

/**
 * Plain text only: no tags, no control characters, no links / emails / phone
 * numbers, one line of spaces, clipped to REMINDER_MESSAGE_MAX.
 */
export function cleanReminderMessage(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const plain = input
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, ' ')
  const text = stripContactDetails(plain).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return Array.from(text).slice(0, REMINDER_MESSAGE_MAX).join('').trim()
}

export type ValidationResult = { ok: true; reminders: EventReminder[] } | { ok: false; error: string }

/** Strict validation for the organizer API. */
export function validateReminders(input: unknown): ValidationResult {
  if (!Array.isArray(input)) return { ok: false, error: 'reminders must be a list' }
  if (input.length > MAX_REMINDERS) return { ok: false, error: `At most ${MAX_REMINDERS} reminders` }
  const out: EventReminder[] = []
  const ids = new Set<string>()
  const times = new Set<number>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid reminder' }
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!ID_RE.test(id)) return { ok: false, error: 'Invalid reminder id' }
    if (ids.has(id)) return { ok: false, error: 'Duplicate reminder id' }
    ids.add(id)

    const minutes = r.minutes_before
    if (typeof minutes !== 'number' || !Number.isInteger(minutes)) {
      return { ok: false, error: 'Each reminder needs a time' }
    }
    if (minutes < MIN_MINUTES_BEFORE) return { ok: false, error: 'Reminder is too close to the event' }
    if (minutes > MAX_MINUTES_BEFORE) return { ok: false, error: 'At most one week before' }
    if (times.has(minutes)) return { ok: false, error: 'Two reminders at the same time' }
    times.add(minutes)

    if (r.message !== undefined && r.message !== null && typeof r.message !== 'string') {
      return { ok: false, error: 'Invalid message' }
    }
    if (typeof r.message === 'string' && r.message.length > REMINDER_MESSAGE_MAX * 4) {
      return { ok: false, error: 'Message is too long' }
    }
    const message = cleanReminderMessage(r.message)
    const reminder: EventReminder = { id, minutes_before: minutes, enabled: r.enabled !== false }
    if (message) reminder.message = message
    out.push(reminder)
  }
  return { ok: true, reminders: out }
}

/**
 * The reminders that apply to an event: its own list when it has one (entries
 * that would not pass validation are dropped one by one), else the defaults.
 */
export function resolveEventReminders(event: Record<string, any> | null | undefined): EventReminder[] {
  const list = event?.reminders
  if (!Array.isArray(list)) return DEFAULT_EVENT_REMINDERS.map((r) => ({ ...r }))
  const out: EventReminder[] = []
  for (const item of list.slice(0, MAX_REMINDERS)) {
    const v = validateReminders([...out, item])
    if (v.ok) out.splice(0, out.length, ...v.reminders)
  }
  return out
}

/** A stock reminder at its stock time (the message may differ). */
export function isStockTime(r: EventReminder): boolean {
  return STOCK_MINUTES[r.id] === r.minutes_before
}

/** A stock reminder at its stock time with no custom message: sent with the original copy. */
export function isStockReminder(r: EventReminder): r is EventReminder & { id: ReminderType } {
  return isStockTime(r) && !r.message
}

/** The send-once claim key (reminderClaims/{eventId}__{key}). See the file header. */
export function reminderClaimKey(r: EventReminder): string {
  return isStockTime(r) ? r.id : `${r.id}_at_${r.minutes_before}`
}

/** A Firestore Timestamp, ISO string, Date or millis, as a Date (or null). */
export function startDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v?.toDate === 'function') {
    const d = v.toDate()
    return d instanceof Date && !isNaN(d.getTime()) ? d : null
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v?._seconds === 'number') return new Date(v._seconds * 1000)
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000)
  return null
}

/** When a reminder goes out, or null when the event has no usable start. */
export function reminderFireAt(r: EventReminder, event: Record<string, any>): Date | null {
  const start = startDate(event?.start_datetime)
  return start ? new Date(start.getTime() - r.minutes_before * 60_000) : null
}

/**
 * The reminders the run at `now` should send for this event: enabled ones
 * whose window (reminder-windows.reminderWindowForOffset, the same windows the
 * stock tiers have always used, inclusive at both ends like the old Firestore
 * range) contains the event's start. Never once the event has started.
 */
export function dueReminders(event: Record<string, any>, now: Date): EventReminder[] {
  const start = startDate(event?.start_datetime)
  if (!start || start.getTime() < now.getTime()) return []
  return resolveEventReminders(event).filter((r) => {
    if (!r.enabled) return false
    const w = reminderWindowForOffset(r.minutes_before, now)
    return start.getTime() >= w.windowStart.getTime() && start.getTime() <= w.windowEnd.getTime()
  })
}

/**
 * How far ahead the cron must look for events: the earliest reminder's window
 * end. One range query replaces the three per-tier queries.
 */
export function reminderQueryRange(now: Date): { from: Date; to: Date } {
  return {
    from: now,
    to: reminderWindowForOffset(MAX_MINUTES_BEFORE, now).windowEnd,
  }
}

/** "1 week", "3 days", "1 day", "3 hours", "30 minutes" for a span in minutes. */
export function spanLabel(minutes: number): string {
  const m = Math.abs(minutes)
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  if (m % (7 * 1440) === 0) return plural(m / (7 * 1440), 'week')
  if (m % 1440 === 0) return plural(m / 1440, 'day')
  if (m % 60 === 0) return plural(m / 60, 'hour')
  return plural(m, 'minute')
}

export { CRON_PERIOD_MINUTES }
