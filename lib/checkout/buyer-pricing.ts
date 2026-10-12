/**
 * WHO PAYS THE FEE, applied to a whole order.
 *
 * `lib/fees.ts` owns the arithmetic (`calculateBuyerPricing`) and `lib/country-support.ts` owns the
 * policy (`feeIncidenceForCountry`). Neither knows about orders, currencies in
 * major units, or React. This module is the thin seam between them and the
 * checkout surfaces: it converts an order's FACE TOTAL into "what the buyer is
 * charged", once, in one place, so the server and every price the buyer reads
 * agree to the cent.
 *
 * Two rules it exists to enforce:
 *
 *  1. PRICE THE WHOLE ORDER, WITH ITS PAID-TICKET COUNT. The rate applies to the
 *     order's face total and the platform-fee floor once per order; the market's
 *     fixed amount (US/CA/FR) once per PAID ticket. Pass the whole order's face
 *     total and `quantity` = paid tickets, never one ticket at a time.
 *  2. THE TOTAL IS SHOWN UP FRONT. US rules on live-event ticket pricing require
 *     the all-in total to be displayed prominently rather than revealed at the
 *     last step, so every pre-payment surface in a buyer-pays market prices the
 *     order through here and shows `total` with `buyerFee` as a line item.
 *
 * Haiti (and any unrecognised country) is `organizer` incidence: `total` equals
 * the face value and `buyerFee` is 0, so calling this on a Haiti order is a
 * no-op by construction — the display code needs no country branches.
 *
 * MONEY CONVENTION: this module speaks MAJOR units on its surface (1500 = 1,500
 * HTG), matching `lib/ticketPricing.ts` and everything the buyer sees. The cents
 * breakdown the payment rail needs is exposed as `cents`.
 */

import {
  calculateBuyerPricing,
  fixedFeeTotalFor,
  type BuyerPricing,
  type FeeIncidence,
} from '@/lib/fees'
import { defaultCurrencyForCountry, feeIncidenceForCountry } from '@/lib/country-support'
import { fromCents, toCents } from '@/lib/ticketPricing'
import { fixedFeeMinorFor, locationFeesForCountry, type LocationFeeConfig } from '@/types/platform-settings'
import { getPlatformFeeConfig } from '@/lib/checkout/fee-config-store'
import { calculateDiscount, type DiscountInput } from '@/lib/promo-code-shared'

export type { BuyerPricing, FeeIncidence }

/**
 * The fee terms that apply to an event, by country: its market's rate and fixed
 * per-ticket amount (US/CA/FR), else Haiti's or the catch-all rate. There is no
 * per-ticket cap (owner decision, 2026-10-05).
 *
 * Reads the DEFAULTS, which is what every client surface can see — the stored
 * platform settings live in Firestore and only the server can await them. Server
 * routes recompute with the stored config and are authoritative; pass `override`
 * there. If an admin ever edits the rate, thread the stored config through to the
 * display surfaces too, or a buyer could read a stale total.
 */
export function feeConfigForCountry(
  country: unknown,
  override?: Partial<LocationFeeConfig> | null
): LocationFeeConfig {
  const base = locationFeesForCountry(getPlatformFeeConfig(), country)
  return { ...base, ...(override || {}) }
}

/**
 * Who pays the fee for THIS event.
 *
 * The organizer's own choice wins; the country default applies when they have not
 * chosen. That is what lets a Haitian organizer selling to the diaspora pass the
 * fee on, and a US organizer running a community night absorb it, without either
 * having to accept whatever their country's default happens to be.
 */
export function incidenceForEvent(event: {
  country?: string | null
  fee_incidence?: string | null
  feeIncidence?: string | null
} | null | undefined): FeeIncidence {
  const chosen = String(event?.fee_incidence ?? event?.feeIncidence ?? '').toLowerCase()
  if (chosen === 'buyer' || chosen === 'organizer') return chosen
  return feeIncidenceForCountry(event?.country)
}

export interface OrderPricing {
  incidence: FeeIncidence
  /** True when the fee is ADDED to the face value (US/CA/FR). */
  feeOnTop: boolean
  /** The advertised ticket total — what the organizer priced, in major units. */
  faceValue: number
  /** The fee the buyer pays on top. 0 under organizer incidence. */
  buyerFee: number
  /** What the buyer is actually charged. Never less than `faceValue`. */
  total: number
  /** The same order in integer cents, for the payment rail and the ledger. */
  cents: BuyerPricing
}

/**
 * What the pricing functions need to know about an event. A bare country string
 * is accepted too, for the surfaces that only have that — it just means the
 * organizer's own absorb/pass-on choice cannot be honoured, so pass the event
 * wherever you have it.
 */
export type PricingEvent =
  | string
  | null
  | undefined
  | {
      country?: string | null
      currency?: string | null
      fee_incidence?: string | null
      feeIncidence?: string | null
    }

export interface OrderPricingOptions {
  /**
   * PAID tickets in this order. Each carries the market's fixed fee (US/CA/FR),
   * so a display that under-counts under-quotes. Defaults to 1. Free tickets in
   * a mixed cart must not be counted.
   */
  quantity?: number
  /**
   * Currency the face total is in (wins over the event's own). Selects the fixed
   * fee: a market's amount is defined per currency and none applies otherwise.
   */
  currency?: string | null
  /**
   * Stored platform settings for this location. SERVER ONLY — the client cannot
   * await Firestore, so display surfaces fall back to the defaults.
   */
  config?: Partial<LocationFeeConfig> | null
}

function asPricingEvent(event: PricingEvent): {
  country?: string | null
  currency?: string | null
  fee_incidence?: string | null
  feeIncidence?: string | null
} {
  if (typeof event === 'string') return { country: event }
  return event || {}
}

/** Who pays the fee for events in this country. */
export function feeIncidenceFor(country: unknown): FeeIncidence {
  return feeIncidenceForCountry(country)
}

/** True when this market adds the fee on top of the ticket price at checkout. */
export function feeOnTopFor(country: unknown): boolean {
  return feeIncidenceForCountry(country) === 'buyer'
}

/**
 * Price a whole order in integer cents.
 *
 * `faceTotalCents` is the post-discount face total for every ticket in the
 * order — the amount the organizer advertised and expects to receive.
 */
export function priceOrderCents(
  faceTotalCents: number,
  event: PricingEvent,
  options?: OrderPricingOptions
): BuyerPricing {
  const face = Math.max(0, Math.round(Number(faceTotalCents) || 0))
  const subject = asPricingEvent(event)
  const config = feeConfigForCountry(subject.country, options?.config)
  // The configured rate of the face total, plus the market's fixed amount per
  // paid ticket. A stored cap table, if one is still on the settings doc, is
  // never applied.
  // A surface that only knows the country prices in that country's currency.
  const currency = options?.currency || subject.currency || defaultCurrencyForCountry(subject.country)
  const fixedPerTicket = fixedFeeMinorFor(config, currency)
  const fixedTotal = fixedFeeTotalFor(face, fixedPerTicket, options?.quantity)
  return calculateBuyerPricing(face, incidenceForEvent(subject), config.platformFeePercentage, fixedTotal)
}

/**
 * Price a whole order given its face total in MAJOR units.
 *
 * Use this for anything the buyer reads. The result's `total` is the number that
 * must appear as the headline; `buyerFee` is the line item that explains it.
 */
export function priceOrder(
  faceTotal: number,
  event: PricingEvent,
  options?: OrderPricingOptions
): OrderPricing {
  const cents = priceOrderCents(toCents(faceTotal), event, options)
  return {
    incidence: cents.incidence,
    feeOnTop: cents.incidence === 'buyer',
    faceValue: fromCents(cents.faceValue),
    buyerFee: fromCents(cents.buyerFee),
    total: fromCents(cents.chargeAmount),
    cents,
  }
}

/**
 * The Connect application fee that leaves the organizer with exactly
 * `pricing.organizerNet`.
 *
 * Under organizer incidence this is platformFee + processingFee — bit for bit
 * what the Stripe path collected before fee incidence existed. Under buyer
 * incidence it is the platform fee the buyer paid on top, so the organizer nets
 * exactly the face value and Stripe's processing comes out of the platform's share.
 */
export function applicationFeeFor(pricing: BuyerPricing): number {
  return Math.max(0, Math.min(pricing.chargeAmount, pricing.chargeAmount - pricing.organizerNet))
}

// ── Multi-tier carts ─────────────────────────────────────────────────────────
//
// A cart can mix tiers (VIP ×1 + GA ×2) and free tiers with paid ones. Every
// surface — the card route, the web summary, the payment sheet — prices it
// through the functions below, so they agree to the cent:
//
//  - the promo is applied PER TICKET with the same calculateDiscount the
//    payment routes use (a fixed-amount code comes off each ticket, never once
//    off the order);
//  - the fee is priced ONCE on the whole post-promo face total;
//  - the market's fixed per-ticket fee counts only tickets that still cost
//    something after the promo. A free tier in a mixed cart carries no fee.

export interface CartLineInput {
  /** Face price of ONE ticket of this tier, before any promo (major units). */
  price: number
  quantity: number
}

export interface PricedCartLine {
  /** Face price of one ticket before the promo (major units, event currency). */
  unitOriginal: number
  /** Face price of one ticket after the promo — what the line is charged at. */
  unitPrice: number
  quantity: number
}

/** Apply a promo to each line, per ticket. No promo leaves prices unchanged. */
export function applyPromoToLines<T extends CartLineInput>(
  lines: T[],
  promo: DiscountInput | null | undefined
): Array<T & PricedCartLine> {
  return lines.map((line) => {
    const unitOriginal = Math.max(0, Number(line.price) || 0)
    const unitPrice = promo ? calculateDiscount(unitOriginal, promo).discountedPrice : unitOriginal
    return { ...line, unitOriginal, unitPrice, quantity: Math.max(0, Math.trunc(Number(line.quantity) || 0)) }
  })
}

export interface PricedLinesCents {
  /** Post-promo face total in the CHARGE currency's minor units. */
  faceValueCents: number
  /** Tickets that still cost something after the promo — the fixed-fee count. */
  paidQuantity: number
  /** Every ticket in the cart, free ones included. */
  totalQuantity: number
  pricing: BuyerPricing
}

/**
 * Price post-promo lines in integer cents.
 *
 * `exchangeRate` converts the event currency into the charge currency (an HTG
 * event charged in USD); omit it when they are the same. Each line is rounded
 * once, as `round(unitPrice × rate × quantity × 100)`, which is exactly the
 * figure the single-tier card route has always charged for one line.
 */
export function priceTierLinesCents(
  lines: PricedCartLine[],
  event: PricingEvent,
  options?: OrderPricingOptions & { exchangeRate?: number | null }
): PricedLinesCents {
  const rate = Number(options?.exchangeRate) > 0 ? Number(options!.exchangeRate) : 1
  let faceValueCents = 0
  let paidQuantity = 0
  let totalQuantity = 0
  for (const line of lines) {
    const qty = Math.max(0, Math.trunc(Number(line.quantity) || 0))
    const unit = Math.max(0, Number(line.unitPrice) || 0)
    totalQuantity += qty
    if (qty === 0 || unit === 0) continue
    faceValueCents += Math.round(unit * rate * qty * 100)
    paidQuantity += qty
  }
  const pricing = priceOrderCents(faceValueCents, event, {
    currency: options?.currency,
    config: options?.config,
    quantity: paidQuantity,
  })
  return { faceValueCents, paidQuantity, totalQuantity, pricing }
}

export interface CartPricing extends OrderPricing {
  /** Face total before the promo (major units). */
  subtotalBeforePromo: number
  /** What the promo took off the face total (major units, >= 0). */
  discount: number
  /** Tickets that still cost something after the promo. */
  paidQuantity: number
}

/**
 * The buyer-facing price of a whole cart: promo per ticket, then the fee once.
 * Display surfaces call this with the EVENT (country, currency, fee_incidence)
 * so the organizer's absorb/pass-on choice is honoured.
 */
export function priceCart(
  lines: CartLineInput[],
  event: PricingEvent,
  options?: { promo?: DiscountInput | null; currency?: string | null; config?: Partial<LocationFeeConfig> | null }
): CartPricing {
  const priced = applyPromoToLines(lines, options?.promo)
  const { pricing, paidQuantity } = priceTierLinesCents(priced, event, {
    currency: options?.currency,
    config: options?.config,
  })
  const beforeCents = priced.reduce((sum, l) => sum + toCents(l.unitOriginal) * l.quantity, 0)
  return {
    incidence: pricing.incidence,
    feeOnTop: pricing.incidence === 'buyer',
    faceValue: fromCents(pricing.faceValue),
    buyerFee: fromCents(pricing.buyerFee),
    total: fromCents(pricing.chargeAmount),
    cents: pricing,
    subtotalBeforePromo: fromCents(beforeCents),
    discount: fromCents(Math.max(0, beforeCents - pricing.faceValue)),
    paidQuantity,
  }
}
