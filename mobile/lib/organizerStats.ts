/**
 * Organizer dashboard helpers (revenue per currency, event location), kept
 * free of Firebase so they can be unit tested.
 *
 * Revenue is summed PER CURRENCY and never added across currencies. The
 * dashboard used to sum every `price_paid` into one number and print a `$` in
 * front, so a 25 HTG sale showed up as "$25.00" (TestFlight, 2026-09-24).
 *
 * `price_paid` is in the ticket's own currency (major units). The ticket
 * carries it as `currency` / `original_currency`; older tickets may have
 * neither, in which case the event's currency applies.
 */
import { normalizeCurrency } from './currency';

export interface CurrencyAmount {
  currency: string;
  /** Major units (e.g. 25 for 25 HTG). */
  amount: number;
}

/**
 * Statuses that still represent a sale. A live ticket is written as `valid`,
 * `confirmed` or `active` depending on the payment rail (see
 * lib/tickets/status.ts on the web side). A ticket that has been scanned is
 * still a sale, so the check-in states count too. An absent status counts as
 * live because some older docs were written without one. Everything else
 * (refunded, cancelled, pending, failed) is not revenue.
 */
const COUNTED_STATUSES = new Set([
  'valid',
  'confirmed',
  'active',
  'used',
  'checked_in',
  'scanned',
]);

export function isCountedSale(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase().trim();
  if (!s) return true;
  return COUNTED_STATUSES.has(s);
}

/** The currency a ticket's `price_paid` is denominated in. */
export function ticketCurrency(ticket: any, eventCurrency?: string | null): string {
  const raw = ticket?.currency || ticket?.original_currency || eventCurrency;
  return normalizeCurrency(raw);
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * When a ticket was bought. No single field name exists across writers, so
 * fall back from `purchased_at` to `created_at`.
 */
export function ticketPurchaseDate(ticket: any): Date | null {
  return toDate(ticket?.purchased_at) || toDate(ticket?.created_at);
}

/**
 * Sum `price_paid` per currency. Sums in cents so repeated decimals don't
 * drift. Currencies with no revenue are left out; the result is sorted
 * largest first, so `[0]` is the primary currency.
 */
export function sumRevenueByCurrency(
  tickets: any[],
  eventCurrencyById: Record<string, string | null | undefined> = {},
): CurrencyAmount[] {
  const cents = new Map<string, number>();
  for (const t of tickets) {
    if (!isCountedSale(t?.status)) continue;
    const paid = Number(t?.price_paid);
    if (!Number.isFinite(paid) || paid <= 0) continue;
    const code = ticketCurrency(t, eventCurrencyById[t?.event_id]);
    cents.set(code, (cents.get(code) || 0) + Math.round(paid * 100));
  }
  return Array.from(cents.entries())
    .map(([currency, c]) => ({ currency, amount: c / 100 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

/**
 * The currency to show a zero revenue in: whichever currency most of the
 * organizer's events use, so an HTG organizer with no sales sees "0 HTG"
 * rather than "$0".
 */
export function dominantEventCurrency(events: Array<{ currency?: string | null }>): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (!e?.currency) continue;
    const code = normalizeCurrency(e.currency);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  let best = normalizeCurrency(null);
  let bestCount = 0;
  for (const [code, n] of counts) {
    if (n > bestCount) {
      best = code;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Pick the event's display location. `location` is often empty, so fall back
 * to the venue / city fields the attendee card composes.
 */
export function eventLocationLabel(event: any): string {
  const loc = typeof event?.location === 'string' ? event.location.trim() : '';
  if (loc) return loc;
  return [event?.venue_name, event?.city, event?.commune, event?.address]
    .map((s) => (s == null ? '' : String(s).trim()))
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .join(', ');
}
