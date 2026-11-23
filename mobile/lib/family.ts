// Family registration: a mirror of the web's lib/events/family (the app cannot
// import web code). Parity: __tests__/mobile-family-parity.test.ts.
import { MAX_FREE_TICKETS_PER_PERSON } from './ticketPricing';

export const FAMILY_MAX_LIMIT = 8;
export const FAMILY_MAX_DEFAULT = 6;

/** People one registration may cover on this event (registrant included), or 0 when off. */
export function familyMax(event: { family_registration?: unknown; family_max?: unknown } | null | undefined): number {
  if (event?.family_registration !== true) return 0;
  const n = Math.floor(Number(event?.family_max ?? FAMILY_MAX_DEFAULT));
  if (!Number.isFinite(n)) return FAMILY_MAX_DEFAULT;
  return Math.max(2, Math.min(n, FAMILY_MAX_LIMIT));
}

/** Free tickets one person may claim on this event: the family size, else the usual limit. */
export function freeClaimCapFor(event: { family_registration?: unknown; family_max?: unknown } | null | undefined): number {
  return familyMax(event) || MAX_FREE_TICKETS_PER_PERSON;
}
