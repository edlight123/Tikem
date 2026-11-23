/**
 * Family registration: on a free event, one person registers their family
 * (named members, each optionally marked as a child) and every member gets
 * their own ticket under the registrant's account, scanned at the door like
 * any other.
 *
 * Off by default. When the organizer turns it on (`family_registration` plus
 * `family_max`, 2..8 people including the registrant) it lifts the usual free
 * limit of 2 tickets per person for that event to the family size. Pure: used
 * by the claim route, issuing, approvals and both composers; mirrored in
 * mobile/lib/family.ts (parity test).
 */
import { MAX_FREE_TICKETS_PER_PERSON } from '@/lib/ticketPricing'

/** The largest family one person can register, themselves included. */
export const FAMILY_MAX_LIMIT = 8
export const FAMILY_MAX_DEFAULT = 6

/** People one registration may cover on this event (registrant included), or 0 when off. */
export function familyMax(event: { family_registration?: unknown; family_max?: unknown } | null | undefined): number {
  if (event?.family_registration !== true) return 0
  const n = Math.floor(Number(event?.family_max ?? FAMILY_MAX_DEFAULT))
  if (!Number.isFinite(n)) return FAMILY_MAX_DEFAULT
  return Math.max(2, Math.min(n, FAMILY_MAX_LIMIT))
}

/** Free tickets one person may claim on this event: the family size, else the usual limit. */
export function freeClaimCapFor(event: { family_registration?: unknown; family_max?: unknown } | null | undefined): number {
  return familyMax(event) || MAX_FREE_TICKETS_PER_PERSON
}
