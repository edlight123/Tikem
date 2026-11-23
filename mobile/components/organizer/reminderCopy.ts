/**
 * Presets and labels for editing an event's automatic reminders
 * (EventAnnouncements). Labels live in the `organizerReminders` locale
 * namespace; the limits mirror the server rules in
 * lib/notifications/event-reminder-settings.ts (the server re-validates).
 */

export const FOLLOWUP_ID = 'post_event_followup';
export const MAX_REMINDERS = 6;
export const MESSAGE_MAX = 240;

/** The stock reminders and their stock times, in minutes before the start. */
export const STOCK_MINUTES: Record<string, number> = {
  event_reminder_24h: 1440,
  event_reminder_3h: 180,
  event_reminder_30min: 30,
};

/** Timing choices, in minutes before the start (1 week ... 30 minutes). */
export const BEFORE_PRESETS = [10080, 4320, 2880, 1440, 180, 60, 30];

type T = (key: string, params?: Record<string, string | number>) => string;

/** "1 week", "3 days", "3 hours", "30 min", in the app's language. */
export function span(minutes: number, t: T): string {
  const m = Math.abs(minutes);
  const fmt = (count: number, unit: string) =>
    t(`organizerReminders.${unit}${count === 1 ? 'One' : 'Other'}`, { count });
  if (m % 10080 === 0) return fmt(m / 10080, 'week');
  if (m % 1440 === 0) return fmt(m / 1440, 'day');
  if (m % 60 === 0) return fmt(m / 60, 'hour');
  return fmt(m, 'min');
}

/** A preset chip: "1 day before". */
export function whenLabel(minutes: number, t: T): string {
  return t('organizerReminders.before', { span: span(minutes, t) });
}

/**
 * The span as the server writes it into the push (lib/notifications/
 * event-reminder-settings spanLabel). Reminder pushes go out in English, so
 * the preview shows the words attendees will actually see.
 */
export function serverSpan(minutes: number): string {
  const m = Math.abs(minutes);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (m % 10080 === 0) return plural(m / 10080, 'week');
  if (m % 1440 === 0) return plural(m / 1440, 'day');
  if (m % 60 === 0) return plural(m / 60, 'hour');
  return plural(m, 'minute');
}

/** Collapse whitespace the way the server does, so "unchanged" compares fairly. */
export function normalizeMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX);
}

export function newReminderId(): string {
  return `r_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
