/**
 * One run of the hourly event-reminder cron, with its I/O injected so the
 * decisions (what is due, claim before send, give the claim back on failure,
 * email + WhatsApp only for the day-before reminder) are tested end to end
 * against fakes. The route (app/api/cron/event-reminders) wires the real
 * Firestore queries, claim and senders.
 */
import {
  DAY_BEFORE_MINUTES,
  dueReminders,
  isStockReminder,
  reminderClaimKey,
  reminderQueryRange,
  type EventReminder,
} from './event-reminder-settings'

export interface ReminderTicket {
  id: string
  attendee_id?: string
  attendee?: Record<string, any> | null
}

export interface ReminderRunDeps {
  /** Published events starting in [from, to], ISO-string and Timestamp starts merged by id. */
  loadEvents(from: Date, to: Date): Promise<Record<string, any>[]>
  /** Live tickets (liveTicketStatusesForQuery) with the attendee joined. */
  loadTickets(eventId: string): Promise<ReminderTicket[]>
  claim(eventId: string, key: string): Promise<boolean>
  release(eventId: string, key: string): Promise<void>
  /** The original copy (lib/notification-triggers sendEventReminder). */
  sendStock(event: Record<string, any>, attendeeIds: string[], reminder: EventReminder): Promise<void>
  /** A moved, added or reworded reminder (lib/notifications/event-reminder-send). */
  sendCustom(event: Record<string, any>, attendeeIds: string[], reminder: EventReminder): Promise<void>
  /** Email + WhatsApp to every ticket holder; returns what went out. */
  sendDayBefore(
    event: Record<string, any>,
    tickets: ReminderTicket[],
    reminder: EventReminder
  ): Promise<{ emailsSent: number; whatsappSent: number }>
}

export interface ReminderRunRow {
  type: string
  events: number
  emailsSent: number
  whatsappSent: number
  notificationsSent: number
}

export interface ReminderRunResult {
  totalEmailsSent: number
  totalWhatsAppSent: number
  totalNotificationsSent: number
  results: ReminderRunRow[]
}

/** Stock tiers always appear in the result, as they did before reminders were editable. */
const STOCK_ROWS = ['event_reminder_24h', 'event_reminder_3h', 'event_reminder_30min']

export async function runEventReminders(now: Date, deps: ReminderRunDeps): Promise<ReminderRunResult> {
  const { from, to } = reminderQueryRange(now)
  const events = await deps.loadEvents(from, to)

  const tally = new Map<string, ReminderRunRow>()
  const row = (type: string) => {
    if (!tally.has(type)) tally.set(type, { type, events: 0, emailsSent: 0, whatsappSent: 0, notificationsSent: 0 })
    return tally.get(type)!
  }
  STOCK_ROWS.forEach(row)

  for (const event of events) {
    if (!event?.id) continue
    const due = dueReminders(event, now)
    if (due.length === 0) continue
    for (const reminder of due) row(isStockReminder(reminder) ? reminder.id : 'custom').events += 1

    const tickets = await deps.loadTickets(event.id).catch(() => [] as ReminderTicket[])
    if (!tickets || tickets.length === 0) continue

    const attendeeIds = Array.from(
      new Set(tickets.map((t) => t.attendee_id).filter((x): x is string => typeof x === 'string' && x.length > 0))
    )

    for (const reminder of due) {
      const r = row(isStockReminder(reminder) ? reminder.id : 'custom')
      const key = reminderClaimKey(reminder)

      // Take the send-once claim BEFORE notifying. Windows are a full cron
      // period wide, so the same event legitimately appears in consecutive
      // runs; this is what stops every attendee being reminded twice.
      if (!(await deps.claim(event.id, key))) continue

      try {
        if (isStockReminder(reminder)) await deps.sendStock(event, attendeeIds, reminder)
        else await deps.sendCustom(event, attendeeIds, reminder)
        r.notificationsSent += attendeeIds.length
      } catch (error) {
        console.error(`Failed to send ${key} notifications for event ${event.id}:`, error)
        // Hand the claim back so the next run retries rather than losing the
        // reminder permanently to a transient failure, and skip the email and
        // WhatsApp block below, since that retry will send those too.
        await deps.release(event.id, key)
        continue
      }

      // Email and WhatsApp only for the reminder one day before (to avoid spam).
      if (reminder.minutes_before === DAY_BEFORE_MINUTES) {
        const extra = await deps.sendDayBefore(event, tickets, reminder)
        r.emailsSent += extra.emailsSent
        r.whatsappSent += extra.whatsappSent
      }
    }
  }

  const results = Array.from(tally.values())
  return {
    totalEmailsSent: results.reduce((s, r) => s + r.emailsSent, 0),
    totalWhatsAppSent: results.reduce((s, r) => s + r.whatsappSent, 0),
    totalNotificationsSent: results.reduce((s, r) => s + r.notificationsSent, 0),
    results,
  }
}
