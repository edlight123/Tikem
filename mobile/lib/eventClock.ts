/**
 * The ONE rule for how an event's clock time is printed in the app.
 *
 * Owner, 2026-11-25: "the time should not be military — in Haiti we use am,
 * pm — also ticket for Haiti should be in French". So:
 *
 *  - every time shown for a Haiti event (country HT, or zone
 *    America/Port-au-Prince) is a 12-hour clock with AM/PM — "8:00 PM", no
 *    leading zero, minutes always shown — in every UI language. A bare
 *    `toLocaleTimeString('fr-FR')` prints "20:00", which is why Haiti paths
 *    come through here;
 *  - the TICKET itself (QR card, pass) for a Haiti event is in French
 *    whatever the phone's language (`ticketLanguage`).
 *
 * Other markets keep their convention. The date-fns 'h:mm a' patterns the app
 * already uses are 12-hour in every locale, so they need no change.
 *
 * Mirror of the web's lib/datetime/eventClock.ts (separate bundle).
 */

import type { Language } from '../contexts/I18nContext';

export const HAITI_ZONE = 'America/Port-au-Prince';

export type ClockEvent = { country?: unknown; timezone?: unknown } | null | undefined;

/** "HT", "Haiti", "Haïti", "Ayiti" (any case). */
export function isHaitiCountry(country: unknown): boolean {
  const c = String(country ?? '').trim().toUpperCase();
  return c === 'HT' || c === 'HTI' || c === 'HAITI' || c === 'HAÏTI' || c === 'AYITI';
}

/** Country HT, or (no country stored) the event's zone is Port-au-Prince. */
export function isHaitiEvent(event: ClockEvent): boolean {
  if (!event) return false;
  if (isHaitiCountry(event.country)) return true;
  if (String(event.country ?? '').trim()) return false;
  return typeof event.timezone === 'string' && event.timezone.trim() === HAITI_ZONE;
}

/** The language a TICKET is printed in: French for a Haiti event, else the app's. */
export function ticketLanguage(event: ClockEvent, language: Language): Language {
  return isHaitiEvent(event) ? 'fr' : language;
}

/** "8:00 PM" from a 0-23 hour and a minute. */
export function clock12FromParts(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

/** "8:00 PM": an instant's 12-hour clock in `zone` (the phone's when absent or unusable). */
export function clock12(at: any, zone?: string | null): string {
  const d = toDate(at);
  if (!d) return '';
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(d);
      const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      return clock12FromParts(get('hour') % 24, get('minute'));
    } catch {
      // Fall through to the phone's clock.
    }
  }
  return clock12FromParts(d.getHours(), d.getMinutes());
}

/** "20:00" / "20h00" → "8:00 PM"; anything else unchanged. For stored wall-clock strings. */
export function hhmmTo12(hhmm: string): string {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return hhmm;
  return clock12FromParts(Number(m[1]), Number(m[2]));
}

/**
 * A clock time for an event: "8:00 PM" for a Haiti event in any language
 * (on the event's own clock when it stores a zone), else the locale's own
 * convention via toLocaleTimeString — what the call sites printed before.
 */
export function formatEventClock(at: any, event: ClockEvent, locale?: string): string {
  const d = toDate(at);
  if (!d) return '';
  if (isHaitiEvent(event)) {
    const zone = typeof event?.timezone === 'string' ? event.timezone : null;
    return clock12(d, zone);
  }
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Date + time for an event-related instant (scanner validity windows, check-in
 * stamps, sale windows). A Haiti event gets "<date> 8:00 PM", the date in the
 * locale's words (`dateOptions`); any other event exactly what the call site
 * printed before: `toLocaleString(locale, otherOptions)`.
 */
export function formatEventDateTime(
  at: any,
  event: ClockEvent,
  locale?: string,
  otherOptions?: Intl.DateTimeFormatOptions,
  dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  const d = toDate(at);
  if (!d) return '';
  if (isHaitiEvent(event)) {
    const zone = typeof event?.timezone === 'string' ? event.timezone : undefined;
    let day: string;
    try {
      day = d.toLocaleDateString(locale, { ...dateOptions, ...(zone ? { timeZone: zone } : {}) });
    } catch {
      day = d.toLocaleDateString(locale, dateOptions);
    }
    return `${day} ${clock12(d, zone)}`;
  }
  return d.toLocaleString(locale, otherOptions);
}
