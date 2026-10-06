/**
 * Fee Calculation Utilities
 * 
 * Handles all fee calculations for the Tikèm payment system
 */

import { FEE_CONFIG, type FeeCalculation } from '@/types/earnings'

/**
 * Calculate platform fee (Tikèm's commission)
 * 
 * @param grossAmount - Total ticket sales in cents
 * @returns Platform fee in cents
 */
export function calculatePlatformFee(grossAmount: number): number {
  const feeAmount = Math.round(grossAmount * FEE_CONFIG.PLATFORM_FEE_PERCENTAGE)
  return Math.max(feeAmount, FEE_CONFIG.PLATFORM_FEE_MIN)
}

/**
 * Calculate platform fee with dynamic percentage based on location
 * 
 * @param grossAmount - Total ticket sales in cents
 * @param feePercentage - Dynamic fee percentage (e.g., 0.10 for 10%)
 * @returns Platform fee in cents
 */
export function calculatePlatformFeeWithPercentage(
  grossAmount: number,
  feePercentage: number
): number {
  const feeAmount = Math.round(grossAmount * feePercentage)
  return Math.max(feeAmount, FEE_CONFIG.PLATFORM_FEE_MIN)
}

// ─────────────────────────────────────────────────────────────────────────────
// NO PER-TICKET CAP (owner decision, 2026-10-05)
//
// The platform fee is exactly the configured rate (platform settings, 10% today)
// of the ticket price, in every currency and country, whoever pays it. There is
// no per-ticket ceiling any more: checkout, mobile, the earnings ledger, promoter
// commissions and payouts all take the plain percentage.
//
// From 2026-08-13 until this change the fee WAS capped per ticket (750 HTG,
// $5.00, C$7.00, EUR 4.50). Tickets do not store the fee an organizer absorbed,
// so the payout engine recomputes it; recomputing a sale made under the cap
// without it would quietly take more from an organizer than they were promised
// when they sold. `platformFeeForSale` therefore keeps the old ceiling for sales
// made before PLATFORM_FEE_CAP_RETIRED_AT, and only for those. Nothing that
// prices a NEW sale may call it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When the per-ticket cap stopped applying to new sales. Set this to the moment
 * the change is deployed: sales before it keep their capped fee in payouts.
 */
export const PLATFORM_FEE_CAP_RETIRED_AT = new Date('2026-10-06T00:00:00.000Z')

/**
 * The retired ceilings, per ticket, in the event currency's minor units, by
 * location. These are the compiled-in defaults that were live while the cap
 * existed (no stored platform_settings doc ever overrode them). A currency with
 * no entry was uncapped then too.
 */
const LEGACY_PLATFORM_FEE_CAP_MINOR: Record<'haiti' | 'us-canada', Record<string, number>> = {
  haiti: { HTG: 75_000, USD: 500 },
  'us-canada': { USD: 500, CAD: 700, EUR: 450 },
}

/** The retired per-ticket ceiling for a location + currency, or null when none applied. */
export function legacyPlatformFeeCapMinor(
  location: 'haiti' | 'us-canada',
  currency: unknown
): number | null {
  const table = LEGACY_PLATFORM_FEE_CAP_MINOR[location] || {}
  const code = String(currency || '').toUpperCase().trim()
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : null
}

/**
 * The platform fee on a sale ALREADY MADE, recomputed for payouts and reports.
 *
 * Exactly the rate, except for a sale made while the per-ticket cap was in force
 * (purchased before PLATFORM_FEE_CAP_RETIRED_AT, or with no purchase date, which
 * only old tickets lack): that keeps the capped fee it was sold under, scaled by
 * the order's ticket count as it was then.
 */
export function platformFeeForSale(
  grossAmount: number,
  feePercentage: number,
  sale: {
    /** legacyPlatformFeeCapMinor() for the event; null = no historical cap. */
    legacyCapMinorPerTicket: number | null
    /** Tickets in the order. */
    quantity: number
    /** When the order was paid; null = unknown, treated as before the change. */
    purchasedAt: Date | null
  }
): number {
  const fee = calculatePlatformFeeWithPercentage(grossAmount, feePercentage)
  const cap = sale.legacyCapMinorPerTicket
  if (cap == null || !Number.isFinite(cap) || cap < 0) return fee
  if (sale.purchasedAt && sale.purchasedAt.getTime() >= PLATFORM_FEE_CAP_RETIRED_AT.getTime()) return fee
  const quantity = Math.max(1, Math.floor(Number(sale.quantity) || 1))
  return Math.min(fee, Math.round(cap) * quantity)
}

/**
 * Calculate Stripe processing fee
 * Formula: 2.9% + $0.30 per transaction
 * 
 * @param grossAmount - Total amount charged in cents
 * @returns Processing fee in cents
 */
export function calculateStripeFee(grossAmount: number): number {
  const percentageFee = Math.round(grossAmount * FEE_CONFIG.STRIPE_FEE_PERCENTAGE)
  return percentageFee + FEE_CONFIG.STRIPE_FEE_FIXED
}

/**
 * Calculate all fees and net amount
 * 
 * @param grossAmount - Total ticket sales in cents
 * @returns Complete fee breakdown
 */
export function calculateFees(grossAmount: number): FeeCalculation {
  const platformFee = calculatePlatformFee(grossAmount)
  // Tikèm's cost, reported for the books — the platform fee already covers it,
  // so it never comes out of the organizer's net.
  const processingFee = calculateStripeFee(grossAmount)
  const netAmount = grossAmount - platformFee

  return {
    grossAmount,
    platformFee,
    processingFee,
    netAmount,
  }
}

/**
 * Calculate all fees and net amount with custom fee percentage
 * 
 * @param grossAmount - Total ticket sales in cents
 * @param feePercentage - Dynamic platform fee percentage
 * @returns Complete fee breakdown
 */
export function calculateFeesWithPercentage(
  grossAmount: number,
  feePercentage: number
): FeeCalculation {
  const platformFee = calculatePlatformFeeWithPercentage(grossAmount, feePercentage)
  const processingFee = calculateStripeFee(grossAmount) // Tikèm's cost, not the organizer's
  const netAmount = grossAmount - platformFee

  return {
    grossAmount,
    platformFee,
    processingFee,
    netAmount,
  }
}

/**
 * Calculate what the organizer receives after all fees
 * 
 * @param ticketPrice - Price per ticket in cents
 * @param quantity - Number of tickets sold
 * @returns Net amount organizer receives
 */
export function calculateOrganizerEarnings(
  ticketPrice: number,
  quantity: number
): FeeCalculation {
  const grossAmount = ticketPrice * quantity
  return calculateFees(grossAmount)
}

/**
 * Format fee as percentage string
 * 
 * @param percentage - Fee percentage (e.g., 0.10 for 10%)
 * @returns Formatted string (e.g., "10%")
 */
export function formatFeePercentage(percentage: number): string {
  return `${(percentage * 100).toFixed(1)}%`
}

/**
 * Check if amount meets minimum payout threshold
 * 
 * @param amount - Amount in cents
 * @returns Whether amount is above minimum
 */
export function meetsMinimumPayout(amount: number): boolean {
  return amount >= FEE_CONFIG.MINIMUM_PAYOUT_AMOUNT
}

/**
 * Calculate settlement ready date
 * (Event end + configured hold period)
 * 
 * @param eventEndDate - Event end date/time
 * @returns Settlement ready date
 */
export function calculateSettlementDate(eventEndDate: Date): Date {
  const settlementDate = new Date(eventEndDate)
  settlementDate.setDate(settlementDate.getDate() + FEE_CONFIG.SETTLEMENT_HOLD_DAYS)
  return settlementDate
}

/**
 * Calculate settlement ready date with custom hold days
 * 
 * @param eventEndDate - Event end date/time
 * @param holdDays - Number of days to hold
 * @returns Settlement ready date
 */
export function calculateSettlementDateWithHoldDays(
  eventEndDate: Date,
  holdDays: number
): Date {
  const settlementDate = new Date(eventEndDate)
  settlementDate.setDate(settlementDate.getDate() + holdDays)
  return settlementDate
}

/**
 * Check if settlement period has passed
 * 
 * @param settlementReadyDate - ISO date string
 * @returns Whether funds are ready for withdrawal
 */
export function isSettlementReady(settlementReadyDate: string): boolean {
  return new Date() >= new Date(settlementReadyDate)
}

/**
 * Format currency amount
 * 
 * @param cents - Amount in cents
 * @param currency - Currency code
 * @returns Formatted string
 */
export function formatCurrency(cents: number, currency: 'HTG' | 'USD' | 'CAD' | 'EUR' = 'HTG'): string {
  const amount = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  if (currency === 'HTG') return `HTG ${amount}`
  if (currency === 'CAD') return `CAD ${amount}`
  if (currency === 'EUR') return `€${amount}`
  return `$${amount}`
}

/**
 * Calculate fee breakdown for display
 * 
 * @param grossAmount - Gross sales in cents
 * @param currency - Currency code
 * @returns Human-readable fee breakdown
 */
export function getFeeBreakdown(
  grossAmount: number,
  currency: 'HTG' | 'USD' | 'CAD' | 'EUR' = 'HTG'
): {
  gross: string
  platformFee: string
  platformFeePercentage: string
  processingFee: string
  processingFeeDetails: string
  net: string
} {
  const fees = calculateFees(grossAmount)

  return {
    gross: formatCurrency(fees.grossAmount, currency),
    platformFee: formatCurrency(fees.platformFee, currency),
    platformFeePercentage: formatFeePercentage(FEE_CONFIG.PLATFORM_FEE_PERCENTAGE),
    processingFee: formatCurrency(fees.processingFee, currency),
    processingFeeDetails: `${formatFeePercentage(FEE_CONFIG.STRIPE_FEE_PERCENTAGE)} + ${formatCurrency(FEE_CONFIG.STRIPE_FEE_FIXED, currency)}`,
    net: formatCurrency(fees.netAmount, currency),
  }
}

/**
 * Calculate how much to charge customer including fees
 * (If we want to pass fees to customer instead of deducting from organizer)
 * 
 * @param ticketPrice - Base ticket price in cents
 * @param quantity - Number of tickets
 * @returns Total amount to charge customer
 */
export function calculateCustomerTotal(ticketPrice: number, quantity: number): number {
  const subtotal = ticketPrice * quantity
  // For now, we absorb fees. If we want to pass to customer:
  // const processingFee = calculateStripeFee(subtotal)
  // return subtotal + processingFee
  return subtotal
}

/**
 * Estimate net earnings for ticket price (for event creation)
 * 
 * @param ticketPrice - Proposed ticket price in cents
 * @returns Estimated net amount organizer will receive per ticket
 */
export function estimateNetPerTicket(ticketPrice: number): {
  ticketPrice: number
  platformFee: number
  processingFee: number
  netPerTicket: number
  netPercentage: number
} {
  const fees = calculateFees(ticketPrice)
  
  return {
    ticketPrice,
    platformFee: fees.platformFee,
    processingFee: fees.processingFee,
    netPerTicket: fees.netAmount,
    netPercentage: fees.netAmount / ticketPrice,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WHO PAYS THE FEE
//
// Two models, chosen per country by `feeIncidence` in lib/country-support.ts:
//
//   organizer (Haiti) — the buyer is charged exactly the face value and the
//     platform fee comes out of the organizer's proceeds. This is what every market did
//     before this existed.
//   buyer (US/CA/FR) — the fee is added on top, so the organizer keeps the full
//     face value and the buyer sees a total above the ticket price.
//
// In BOTH models the platform fee (the plain rate, no cap) is the only fee: Tikèm pays card and
// MonCash processing out of it (owner's rule, 2026-09-30). So the buyer model
// is a plain addition, charge = face + platformFee, and the organizer model
// nets face − platformFee. Nobody pays processing on top. It was once a gross-up that passed
// Stripe's cut to the buyer too, which read as "more than 10%" at checkout.
// ─────────────────────────────────────────────────────────────────────────────

export type FeeIncidence = 'organizer' | 'buyer'

export type BuyerPricing = {
  /** What the buyer is actually charged, in cents. */
  chargeAmount: number
  /** Ticket face value, in cents — what the organizer advertised. */
  faceValue: number
  /** Fee visible to the buyer as a line item. Zero in organizer-pays markets. */
  buyerFee: number
  platformFee: number
  processingFee: number
  /** What the organizer receives. Equals faceValue in buyer-pays markets. */
  organizerNet: number
  incidence: FeeIncidence
}

export function calculateBuyerPricing(
  faceValue: number,
  incidence: FeeIncidence,
  feePercentage: number = FEE_CONFIG.PLATFORM_FEE_PERCENTAGE
): BuyerPricing {
  if (faceValue <= 0) {
    return {
      chargeAmount: 0,
      faceValue: 0,
      buyerFee: 0,
      platformFee: 0,
      processingFee: 0,
      organizerNet: 0,
      incidence,
    }
  }

  if (incidence === 'organizer') {
    const platformFee = calculatePlatformFeeWithPercentage(faceValue, feePercentage)
    const processingFee = calculateStripeFee(faceValue)
    return {
      chargeAmount: faceValue,
      faceValue,
      buyerFee: 0,
      platformFee,
      processingFee,
      organizerNet: Math.max(0, faceValue - platformFee),
      incidence,
    }
  }

  // The buyer pays the platform fee and nothing else; Stripe's cut comes out of
  // it. Destination charges debit processing from the platform balance, so the
  // organizer still nets exactly the face value.
  const platformFee = calculatePlatformFeeWithPercentage(faceValue, feePercentage)
  const chargeAmount = faceValue + platformFee
  const processingFee = calculateStripeFee(chargeAmount)

  return {
    chargeAmount,
    faceValue,
    buyerFee: chargeAmount - faceValue,
    platformFee,
    processingFee,
    organizerNet: faceValue,
    incidence,
  }
}
