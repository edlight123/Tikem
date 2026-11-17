import { differenceInCalendarDays, isValid } from 'date-fns';
import { formatDateForLanguage } from './dates';
import type { Language } from '../contexts/I18nContext';

/**
 * Message timestamps the way a messaging app writes them, so an inbox reads at
 * a glance instead of as a column of full dates:
 *
 *   inboxTime  — today "9:41 PM" · yesterday "Yesterday" · this week "Tue" ·
 *                this year "Nov 3" · older "Nov 3, 2025"
 *   dayLabel   — the separator above a day's messages in a conversation:
 *                "Today" · "Yesterday" · "Tuesday, Nov 11" · "Nov 3, 2025"
 *   clockTime  — "9:41 PM" (under the last bubble of a run)
 */

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isValid(d) ? d : null;
}

const clockPattern = (language: Language) => (language === 'en' ? 'h:mm a' : 'HH:mm');

export function clockTime(iso: string | null | undefined, language: Language): string {
  const d = toDate(iso);
  return d ? formatDateForLanguage(d, clockPattern(language), language) : '';
}

export function inboxTime(
  iso: string | null | undefined,
  language: Language,
  labels: { yesterday: string },
  now: Date = new Date(),
): string {
  const d = toDate(iso);
  if (!d) return '';
  const days = differenceInCalendarDays(now, d);
  if (days <= 0) return formatDateForLanguage(d, clockPattern(language), language);
  if (days === 1) return labels.yesterday;
  if (days < 7) return formatDateForLanguage(d, 'EEE', language);
  if (d.getFullYear() === now.getFullYear()) return formatDateForLanguage(d, language === 'en' ? 'MMM d' : 'd MMM', language);
  return formatDateForLanguage(d, language === 'en' ? 'MMM d, yyyy' : 'd MMM yyyy', language);
}

export function dayLabel(
  iso: string | null | undefined,
  language: Language,
  labels: { today: string; yesterday: string },
  now: Date = new Date(),
): string {
  const d = toDate(iso);
  if (!d) return '';
  const days = differenceInCalendarDays(now, d);
  if (days <= 0) return labels.today;
  if (days === 1) return labels.yesterday;
  if (d.getFullYear() === now.getFullYear()) {
    return formatDateForLanguage(d, language === 'en' ? 'EEEE, MMM d' : 'EEEE d MMMM', language);
  }
  return formatDateForLanguage(d, language === 'en' ? 'MMM d, yyyy' : 'd MMMM yyyy', language);
}

/** Same calendar day (local time). */
export function sameDay(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = toDate(a);
  const y = toDate(b);
  return !!x && !!y && differenceInCalendarDays(x, y) === 0;
}
