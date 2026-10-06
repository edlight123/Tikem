import { adminDb } from '@/lib/firebase/admin'
import { getEventLocation } from '@/types/platform-settings'

/**
 * WHICH REFUNDS NEED A TIKÈM ADMIN BEFORE ANY MONEY MOVES.
 *
 * Owner decision (2026-10): refunds for Haiti events are never automatic. Every
 * refund of a ticket for an event in a listed country (an organizer's refund, a
 * buyer request the organizer approves, an event cancellation, by organizer or
 * admin) is held as `refund_status: 'admin_review'` with a
 * `refund_reviews/{ticketId}` doc whose `review_reason` is
 * 'haiti_manual_approval'. Only the admin approval of that review
 * (lib/tickets/refundReview.ts approveRefundReview) moves the money.
 *
 * The switch is a platform setting, not code, so it can be widened later:
 *
 *   config/payouts.refundsRequireAdminApproval: string[]   (ISO country codes)
 *
 *   absent / not an array  → ['HT']   (the default)
 *   []                     → no country needs approval
 *   ['*'] or ['ALL']       → every country
 *
 * The country is resolved exactly as the fee code resolves it
 * (types/platform-settings getEventLocation on `event.country`): 'HT' and
 * 'Haiti' are Haiti, anything else is its own code upper-cased.
 */

export const DEFAULT_REFUND_APPROVAL_COUNTRIES: readonly string[] = ['HT']

export const HAITI_MANUAL_APPROVAL = 'haiti_manual_approval'
export const SHORTFALL_REVIEW = 'shortfall'
export type RefundReviewReason = typeof HAITI_MANUAL_APPROVAL | typeof SHORTFALL_REVIEW

/** Normalize the stored setting. Anything malformed falls back to the default. */
export function parseRefundApprovalCountries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REFUND_APPROVAL_COUNTRIES]
  return raw.map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean)
}

/** The event's country code as the fee code reads it ('HT' for Haiti). */
export function eventCountryCode(country: unknown): string {
  const raw = String(country ?? '').trim()
  if (getEventLocation(raw) === 'haiti') return 'HT'
  return raw.toUpperCase()
}

export function countryRequiresAdminApproval(country: unknown, countries: readonly string[]): boolean {
  if (countries.includes('*') || countries.includes('ALL')) return true
  const code = eventCountryCode(country)
  return Boolean(code) && countries.includes(code)
}

/** Read the setting. A failed read fails CLOSED to the default list. */
export async function loadRefundApprovalCountries(): Promise<string[]> {
  try {
    const snap = await adminDb.collection('config').doc('payouts').get()
    const data = snap.exists ? ((snap.data() as any) ?? {}) : {}
    return parseRefundApprovalCountries(data.refundsRequireAdminApproval)
  } catch (e: any) {
    console.error('[refund-approval] could not read config/payouts; using the default', { message: e?.message })
    return [...DEFAULT_REFUND_APPROVAL_COUNTRIES]
  }
}

/**
 * Does a refund for this event need an admin's approval? `country` is the
 * event's stored country when the caller has the event doc; undefined makes
 * this read the event.
 */
export async function eventRefundsRequireAdminApproval(eventId: string, country?: unknown): Promise<boolean> {
  let resolved = country
  if (resolved === undefined) {
    if (!eventId) return false
    const snap = await adminDb.collection('events').doc(String(eventId)).get()
    resolved = snap.exists ? (snap.data() as any)?.country ?? null : null
  }
  const countries = await loadRefundApprovalCountries()
  return countryRequiresAdminApproval(resolved, countries)
}
