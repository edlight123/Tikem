/**
 * The minimum an ORGANIZER may withdraw via MonCash (instant or manual).
 *
 * The floor is set in HTG because that is what MonCash actually moves: a USD
 * event's earnings are converted at withdrawal time, so the floor is measured on
 * the converted HTG gross, with the same rate the quote and the withdrawal use.
 *
 * Scope, deliberately narrow:
 *  - Haiti BANK withdrawals keep their own 5,000-minor floor (withdraw-bank).
 *  - The Stripe / Engine B payout keeps FEE_CONFIG.MINIMUM_PAYOUT_AMOUNT.
 *  - Promoter wallet withdrawals keep PROMOTER_MIN_WITHDRAWAL_HTG_CENTS.
 *
 * Pure and dependency-free so the client (web earnings view) can import it.
 * Mobile mirrors the constant in mobile/screens/organizer/OrganizerEventEarningsScreen.tsx
 * but prefers the server-computed `moncashMinimum` from the earnings API.
 */

/** 1,000.00 HTG, in HTG minor units. */
export const MONCASH_MIN_WITHDRAWAL_HTG_CENTS = 100_000

/** Error code the withdraw + quote routes return for a sub-minimum amount. */
export const MONCASH_BELOW_MINIMUM_CODE = 'moncash_below_minimum'

type Currency = 'HTG' | 'USD' | 'CAD' | 'EUR' | string

function effectiveRate(currency: Currency, usdToHtgRate: number | null | undefined): number {
  // Mirrors the withdraw route: only USD is converted; everything else is taken
  // as HTG-denominated (CAD/EUR events withdraw via Stripe, never here).
  if (String(currency || '').toUpperCase() !== 'USD') return 1
  const rate = Number(usdToHtgRate)
  return Number.isFinite(rate) && rate > 0 ? rate : NaN
}

/** HTG gross (minor units, unrounded) that `amountMinor` of `currency` converts to. */
export function moncashWithdrawalHtgValue(
  amountMinor: number,
  currency: Currency,
  usdToHtgRate?: number | null
): number {
  return Math.max(0, Number(amountMinor) || 0) * effectiveRate(currency, usdToHtgRate)
}

/**
 * Whether `amountMinor` (event currency) meets the 1,000 HTG floor.
 * An unusable FX rate for a USD amount fails closed.
 */
export function meetsMoncashWithdrawalMinimum(
  amountMinor: number,
  currency: Currency,
  usdToHtgRate?: number | null
): boolean {
  const htg = moncashWithdrawalHtgValue(amountMinor, currency, usdToHtgRate)
  return Number.isFinite(htg) && htg >= MONCASH_MIN_WITHDRAWAL_HTG_CENTS
}

/**
 * The floor expressed in the event currency's minor units — the smallest whole
 * amount that passes meetsMoncashWithdrawalMinimum. For USD at 130 HTG/USD this
 * is 770 cents ($7.70 ≈ 1,001 HTG).
 */
export function moncashWithdrawalMinimumMinor(currency: Currency, usdToHtgRate?: number | null): number {
  const rate = effectiveRate(currency, usdToHtgRate)
  if (!Number.isFinite(rate)) return Number.POSITIVE_INFINITY
  return Math.ceil(MONCASH_MIN_WITHDRAWAL_HTG_CENTS / rate - 1e-9)
}

/** The shape the earnings API and the quote hand to clients. */
export type MoncashMinimumInfo = {
  /** Always 100_000 (1,000 HTG). */
  minimumHtgCents: number
  /** The same floor in the event currency's minor units. */
  minimumMinor: number
  currency: string
  /** USD→HTG rate used for the conversion, null for HTG. */
  usdToHtgRate: number | null
}

export function moncashMinimumInfo(currency: Currency, usdToHtgRate?: number | null): MoncashMinimumInfo {
  const isUsd = String(currency || '').toUpperCase() === 'USD'
  return {
    minimumHtgCents: MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
    minimumMinor: moncashWithdrawalMinimumMinor(currency, usdToHtgRate),
    currency: String(currency || 'HTG').toUpperCase(),
    usdToHtgRate: isUsd ? Number(usdToHtgRate) || null : null,
  }
}
