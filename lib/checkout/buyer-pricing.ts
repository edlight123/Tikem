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
 *  1. THE FEE IS PER ORDER, NOT PER TICKET. Stripe's fixed component (and the
 *     platform-fee floor) are charged once per transaction, so grossing up each
 *     ticket separately would over-charge a multi-ticket order. Always pass the
 *     whole order's face total.
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
  type BuyerPricing,
  type FeeIncidence,
} from '@/lib/fees'
import { feeIncidenceForCountry } from '@/lib/country-support'
import { fromCents, toCents } from '@/lib/ticketPricing'
import { getEventLocation, type LocationFeeConfig } from '@/types/platform-settings'
import { getPlatformFeeConfig } from '@/lib/checkout/fee-config-store'

export type { BuyerPricing, FeeIncidence }

/**
 * The rate that applies to an event, by country. There is no per-ticket cap
 * (owner decision, 2026-10-05): the fee is exactly this rate of the face value.
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
  const location = getEventLocation(String(country || ''))
  const inForce = getPlatformFeeConfig()
  const base = location === 'haiti' ? inForce.haiti : inForce.usCanada
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
   * Tickets in this order. Accepted for call-site compatibility; with no
   * per-ticket cap the fee does not depend on it.
   */
  quantity?: number
  /** Event currency, when it is not on the event object. Does not change the fee. */
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
  // Exactly the configured rate of the face total. A stored cap table, if one
  // is still on the settings doc, is never applied.
  return calculateBuyerPricing(face, incidenceForEvent(subject), config.platformFeePercentage)
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
