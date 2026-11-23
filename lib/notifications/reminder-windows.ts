/**
 * When each event reminder fires, as pure data.
 *
 * Extracted from the cron route so the one property that actually matters can be
 * asserted in a test: NO WINDOW MAY BE NARROWER THAN THE CRON PERIOD. The
 * 30-minute reminder shipped with a 10-minute window against an hourly cron, so
 * an event only got that reminder if its start time happened to land in the
 * right ten minutes — about one event in six, silently.
 *
 * Organizers can now move, add and remove reminders per event
 * (lib/notifications/event-reminder-settings). Every reminder, stock or custom,
 * gets its window from `reminderWindowForOffset`, so the invariant holds for all
 * of them, not just the three stock tiers.
 */
export type ReminderType =
  | 'event_reminder_24h'
  | 'event_reminder_3h'
  | 'event_reminder_30min'

export interface ReminderWindow {
  type: ReminderType
  hoursAhead: number
  windowStart: Date
  windowEnd: Date
  label: string
}

/** How often the cron runs, in minutes. Must match vercel.json. */
export const CRON_PERIOD_MINUTES = 60

/**
 * The closest a reminder may sit to the start. With the window below, a reminder
 * this far out (or more) always lands on a run that is still before the event
 * starts; anything closer could fall on the first run after the doors open and
 * be skipped. Guarded by a test.
 */
export const MIN_REMINDER_OFFSET_MINUTES = CRON_PERIOD_MINUTES / 2

const MINUTE = 60 * 1000

/**
 * The window of event START times that the run at `now` sends a reminder for,
 * when that reminder goes out `minutesBefore` minutes before the start.
 *
 * One full cron period wide, centred on the send time, so consecutive runs tile
 * the timeline with no gap: every upcoming event lands in exactly one window per
 * reminder, on exactly one run. Near the start (`minutesBefore` under half a
 * period) the window is pinned to begin at `now`, so an event starting in five
 * minutes still gets its last call on this run rather than after it has begun.
 * Sending once is guaranteed by the claim in `reminder-claim.ts`, not by this
 * arithmetic.
 */
export function reminderWindowForOffset(
  minutesBefore: number,
  now: Date = new Date()
): { windowStart: Date; windowEnd: Date } {
  const startMinutes = Math.max(0, minutesBefore - CRON_PERIOD_MINUTES / 2)
  const windowStart = new Date(now.getTime() + startMinutes * MINUTE)
  return { windowStart, windowEnd: new Date(windowStart.getTime() + CRON_PERIOD_MINUTES * MINUTE) }
}

/**
 * The three stock tiers. Each window is one full cron period wide and they do
 * not overlap, so every upcoming event lands in exactly one window per reminder
 * tier, on exactly one run.
 */
export function reminderWindows(now: Date = new Date()): ReminderWindow[] {
  return [
    {
      type: 'event_reminder_24h',
      hoursAhead: 24,
      ...reminderWindowForOffset(24 * 60, now),
      label: '24 hours',
    },
    {
      type: 'event_reminder_3h',
      hoursAhead: 3,
      ...reminderWindowForOffset(3 * 60, now),
      label: '3 hours',
    },
    {
      // Runs from "now" to one period out (the window is pinned to `now`).
      type: 'event_reminder_30min',
      hoursAhead: 0.5,
      ...reminderWindowForOffset(30, now),
      label: '30 minutes',
    },
  ]
}
