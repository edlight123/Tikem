/**
 * WHO PAYS THE SERVICE FEE, and what the buyer therefore sees.
 *
 * ⚠️ MIRRORS THE WEB. This is the Expo-side twin of `lib/checkout/buyer-pricing.ts`
 * and `lib/fees.ts` in the web app — mobile is a separate bundle and cannot import
 * from it (the same reason `lib/ticketPricing.ts` and `lib/countrySupport.ts` are
 * duplicated here). THE RATES AND THE ARITHMETIC MUST STAY IN STEP
 * with `types/platform-settings.ts` and `lib/fees.ts`; if you change one, change
 * both. The server is always authoritative — everything here is display.
 *
 * Why display has to compute it at all: in a buyer-pays market the card is charged
 * the ticket price PLUS the fee, so showing the bare face value would advertise a
 * price nobody is charged. US rules on live-event ticket pricing require the
 * all-in total up front rather than at the last step, and that applies to what a
 * listing advertises, not only to the checkout screen.
 *
 * Haiti is organizer-pays by default: `total` equals the face value and `buyerFee`
 * is 0, so calling this on a Haitian event changes nothing on screen.
 *
 * MONEY CONVENTION: MAJOR units on the surface (1500 = 1,500 HTG), matching
 * `lib/ticketPricing.ts`. Cents only inside, to keep the arithmetic exact.
 */

export type FeeIncidence = 'organizer' | 'buyer';

/** Floor on the platform fee, in minor units. */
const PLATFORM_FEE_MIN_MINOR = 50;

interface LocationFees {
  percentage: number;
}

/**
 * Per-location rate. Mirrors DEFAULT_PLATFORM_SETTINGS: the values the bundle
 * shipped with, used until the live config arrives. There is no per-ticket cap
 * (owner decision, 2026-10-05): the fee is exactly the rate, in every currency.
 */
const DEFAULT_FEE_CONFIG: { haiti: LocationFees; usCanada: LocationFees } = {
  haiti: { percentage: 0.1 },
  usCanada: { percentage: 0.1 },
};

let FEE_CONFIG = DEFAULT_FEE_CONFIG;

/**
 * One location's fee terms, as `/api/platform/fee-config` returns them. A
 * `platformFeeCapMinorByCurrency` field, if a server still sends one, is ignored.
 */
export interface RemoteLocationFees {
  platformFeePercentage?: number;
}

function merge(remote: RemoteLocationFees | undefined, fallback: LocationFees): LocationFees {
  const percentage = Number(remote?.platformFeePercentage);
  return {
    // A rate outside 0-100% is a corrupt payload, not an aggressive one: keep the
    // shipped default rather than pricing every ticket off a bad number.
    percentage:
      Number.isFinite(percentage) && percentage >= 0 && percentage < 1
        ? percentage
        : fallback.percentage,
  };
}

/**
 * Adopt the fee terms currently in force, so a rate an admin changed reaches the
 * prices this app draws. Display only — the server recomputes what is charged.
 * Called by `refreshFeeConfig`; safe to call repeatedly.
 */
export function setFeeConfig(
  remote: { haiti?: RemoteLocationFees; usCanada?: RemoteLocationFees } | null | undefined
): void {
  if (!remote) {
    FEE_CONFIG = DEFAULT_FEE_CONFIG;
    return;
  }
  FEE_CONFIG = {
    haiti: merge(remote.haiti, DEFAULT_FEE_CONFIG.haiti),
    usCanada: merge(remote.usCanada, DEFAULT_FEE_CONFIG.usCanada),
  };
}

/** The terms in force — for tests and diagnostics. */
export function getFeeConfig() {
  return FEE_CONFIG;
}

/** Restore the values the bundle shipped with. For tests. */
export function resetFeeConfig(): void {
  FEE_CONFIG = DEFAULT_FEE_CONFIG;
}

/** Countries where the fee is ADDED to the ticket price rather than deducted. */
const BUYER_PAYS_COUNTRIES = new Set(['US', 'CA', 'FR']);

function isHaiti(country: unknown): boolean {
  const code = String(country || '').toUpperCase().trim();
  return code === 'HT' || code === 'HAITI';
}

export function feeIncidenceForCountry(country: unknown): FeeIncidence {
  const code = String(country || '').toUpperCase().trim();
  // An unrecognised market is organizer-pays: it can never silently start
  // charging buyers more than the advertised price.
  return BUYER_PAYS_COUNTRIES.has(code) ? 'buyer' : 'organizer';
}

/** What the pricing functions need to know about an event. */
export interface PricingEventLike {
  country?: string | null;
  currency?: string | null;
  /** The organizer's own absorb/pass-on choice, when they made one. */
  fee_incidence?: string | null;
  /** Camel-case alias some docs carry. The server reads both, so display does too. */
  feeIncidence?: string | null;
}

/**
 * Who pays the fee for THIS event: the organizer's choice first, the country
 * default when they have not made one.
 */
export function incidenceForEvent(event: PricingEventLike | null | undefined): FeeIncidence {
  // Same precedence as the server's `incidenceForEvent` (lib/checkout/buyer-pricing.ts).
  const chosen = String(event?.fee_incidence ?? event?.feeIncidence ?? '').toLowerCase();
  if (chosen === 'buyer' || chosen === 'organizer') return chosen;
  return feeIncidenceForCountry(event?.country);
}

function toMinor(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

function fromMinor(minor: number): number {
  return Math.round(minor) / 100;
}

/**
 * The platform's cut of one order, in minor units: exactly the location's rate,
 * floored by the minimum. No per-ticket cap, in any currency.
 */
function platformFeeMinor(faceMinor: number, event: PricingEventLike | null | undefined): number {
  const config = isHaiti(event?.country) ? FEE_CONFIG.haiti : FEE_CONFIG.usCanada;
  return Math.max(Math.round(faceMinor * config.percentage), PLATFORM_FEE_MIN_MINOR);
}

export interface OrderPricing {
  incidence: FeeIncidence;
  /** True when the fee is ADDED on top (the buyer sees a bigger number). */
  feeOnTop: boolean;
  /** What the organizer priced. */
  faceValue: number;
  /** What the buyer pays on top. 0 under organizer incidence. */
  buyerFee: number;
  /** What the buyer is actually charged. Never less than `faceValue`. */
  total: number;
}

/**
 * Price a whole order.
 *
 * `faceTotal` is the post-discount total for every ticket in the order. The fee's
 * fixed component is per TRANSACTION, so pass the whole order rather than grossing
 * up each ticket separately. `quantity` is accepted for call-site compatibility;
 * with no per-ticket cap the fee no longer depends on it.
 */
export function priceOrder(
  faceTotal: number,
  event: PricingEventLike | null | undefined,
  _options?: { quantity?: number }
): OrderPricing {
  const incidence = incidenceForEvent(event);
  const faceMinor = Math.max(0, toMinor(faceTotal));
  if (faceMinor <= 0 || incidence === 'organizer') {
    return {
      incidence,
      // Describes the MARKET, not this order: a free order in a buyer-pays market
      // is still buyer-pays, it just has no fee to add. Matches the web, which
      // callers pair with `buyerFee > 0` before showing a fee line.
      feeOnTop: incidence === 'buyer',
      faceValue: fromMinor(faceMinor),
      buyerFee: 0,
      total: fromMinor(faceMinor),
    };
  }

  // The buyer pays the platform fee only; the platform absorbs Stripe's cut.
  const platformFee = platformFeeMinor(faceMinor, event);
  const chargeMinor = faceMinor + platformFee;

  return {
    incidence,
    feeOnTop: true,
    faceValue: fromMinor(faceMinor),
    buyerFee: fromMinor(chargeMinor - faceMinor),
    total: fromMinor(chargeMinor),
  };
}

/**
 * What the ORGANIZER receives for an order. Display only, for the composer's
 * pass-the-fee switch.
 *
 * The platform fee covers payment processing in both models, so the
 * organizer never pays a separate processing cut:
 *  - buyer pays the fee   → the organizer nets the face value;
 *  - organizer absorbs it → the organizer nets face − the platform fee.
 */
export function organizerNet(
  faceTotal: number,
  event: PricingEventLike | null | undefined,
  _options?: { quantity?: number }
): number {
  const faceMinor = Math.max(0, toMinor(faceTotal));
  if (faceMinor <= 0) return 0;
  if (incidenceForEvent(event) === 'buyer') return fromMinor(faceMinor);
  return fromMinor(Math.max(0, faceMinor - platformFeeMinor(faceMinor, event)));
}

/** The all-in price of a single ticket — what a listing or a headline advertises. */
export function advertisedPrice(
  faceValue: number,
  event: PricingEventLike | null | undefined
): number {
  return priceOrder(faceValue, event, { quantity: 1 }).total;
}
