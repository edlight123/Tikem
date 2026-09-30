/**
 * MonCash payout constants + the instant-payout quote, mirrored from the server
 * (app/api/organizer/withdraw-moncash/route.ts and
 * lib/payouts/moncash-prefunded.ts `computePrefundedPayout`). Keep in step with
 * those: the preview here must match what the withdrawal actually charges.
 */

/** Server minimum, in MINOR units of the event's currency (50.00 HTG or $50). */
export const MONCASH_MIN_WITHDRAWAL_MINOR = 5000

/** Instant (prefunded) MonCash fee — PREFUNDING_FEE_PERCENT on the server. */
export const INSTANT_MONCASH_FEE_PERCENT = 0.03

export type PrefundingStatus = { enabled: boolean; available: boolean }

/** Accepts both `{prefunding:{...}}` and the back-compat top-level shape. */
export function parsePrefundingStatus(raw: any): PrefundingStatus {
  const p = raw?.prefunding ?? raw
  return { enabled: Boolean(p?.enabled), available: Boolean(p?.available) }
}

export type InstantMoncashQuote = {
  /** Fee in the event's currency, minor units. */
  feeCents: number
  /** What is sent, in the event's currency, minor units. */
  payoutAmountCents: number
  /** What lands in MonCash, in HTG minor units (converted for USD events). */
  payoutAmountHtgCents: number
}

/**
 * Organizer pays round(3% × gross); the transfer is gross − fee, converted to
 * HTG at `usdToHtgRate` for a USD event (1 for HTG).
 */
export function computeInstantMoncashQuote(amountCents: number, usdToHtgRate = 1): InstantMoncashQuote {
  const gross = Math.max(0, Math.round(Number(amountCents) || 0))
  const feeCents = Math.max(0, Math.round(gross * INSTANT_MONCASH_FEE_PERCENT))
  const payoutAmountCents = Math.max(0, gross - feeCents)
  const rate = Number.isFinite(usdToHtgRate) && usdToHtgRate > 0 ? usdToHtgRate : 1
  return { feeCents, payoutAmountCents, payoutAmountHtgCents: Math.max(0, Math.round(payoutAmountCents * rate)) }
}
