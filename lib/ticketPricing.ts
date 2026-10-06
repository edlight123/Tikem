/**
 * One place decides "is this free or paid" and "what does this order cost".
 *
 * ⚠️ MIRROR OF `mobile/lib/ticketPricing.ts` — the two files must stay
 * semantically identical. They are duplicated rather than shared because the
 * Next.js app and the Expo app are separate TypeScript projects with separate
 * module graphs (the web `tsconfig.json` explicitly excludes `mobile/`), and
 * making the web build reach into the mobile workspace would couple the
 * deployed site to an app folder that ships on a different release cadence.
 * If you change the precedence or the money math here, change it there too.
 *
 * Why this exists: an event may offer a FREE tier and a PAID tier side by side
 * (e.g. "Free RSVP — 0 HTG" next to "General Admission — 1,500 HTG"). The old
 * test for freeness was `event.ticket_price === 0`, and `ticket_price` is
 * persisted as the LOWEST tier price — so a single free tier flipped the whole
 * event to "free": the web showed RSVP/claim and hid tier selection entirely,
 * making the paid tiers unsellable. Freeness is therefore a property of the
 * TIER SET, not of one denormalized number.
 *
 * MONEY CONVENTION (matches the rest of the app): amounts are stored and passed
 * around in MAJOR units (1500 = 1,500 HTG), NOT cents. Only `lib/earnings.ts`
 * works in cents, and it converts at its own boundary. To keep totals free of
 * floating-point drift, every multiply/discount here happens on integer cents
 * internally and converts back to major units exactly once at the end.
 */

/** A tier as seen by any reader — collection doc, embedded array entry, or form row. */
export interface TierPriceLike {
  price?: number | string | null
}

/** The subset of an event doc needed to classify its pricing. */
export interface EventPricingLike {
  /** Free-RSVP event: one free tier sized by an attendance cap. */
  is_rsvp?: boolean
  /**
   * Explicit "at least one tier costs money" flag, stamped at save time. This is
   * the authoritative signal; the fallbacks below only cover legacy docs written
   * before it shipped.
   */
  has_paid_tiers?: boolean
  /** Lowest tier price, denormalized for "from" display. NOT a freeness test. */
  ticket_price?: number | null
  /** Embedded copy of the tier set (mobile-written events carry this). */
  ticket_tiers?: TierPriceLike[] | null
  /**
   * ISO country of the event, which decides whether the platform fee is added on
   * top of the ticket price (US/CA/FR) or comes out of the organizer's share
   * (Haiti). An advertised price has to include the fee in the markets that add
   * it, so any projection feeding a price label should carry this.
   */
  country?: string | null
  /**
   * Event currency. Carried for the pricing seam; the fee is a flat rate with
   * no per-ticket cap, so it does not change the advertised total.
   */
  currency?: string | null
  /**
   * The organizer's own absorb/pass-on choice for this event, when they made one.
   * Overrides the country default.
   */
  fee_incidence?: string | null
}

export type EventPricingKind =
  /** Every way in is free. */
  | 'free'
  /** Every way in costs money. */
  | 'paid'
  /** Free AND paid tiers coexist — the buyer must choose. */
  | 'mixed'

export interface EventPricing {
  kind: EventPricingKind
  /** True when NO tier costs money — the only kind that may skip tier selection. */
  isFreeOnly: boolean
  /** True when at least one tier costs money (kind is 'paid' or 'mixed'). */
  hasPaidTier: boolean
  /** True when at least one tier is free (kind is 'free' or 'mixed'). */
  hasFreeTier: boolean
  /**
   * Cheapest PAID tier price, or null when unknown (legacy docs with no embedded
   * tier set) or when nothing is paid. Callers must render no price rather than
   * guess when this is null.
   */
  lowestPaidPrice: number | null
}

/** Coerce any tier price representation to a finite non-negative number. */
export function tierPrice(tier: TierPriceLike | null | undefined): number {
  const n = Number(tier?.price ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A tier is free when its price is exactly zero. */
export function isFreeTier(tier: TierPriceLike | null | undefined): boolean {
  return tierPrice(tier) === 0
}

/** True when at least one tier in the set costs money. */
export function hasPaidTier(tiers: TierPriceLike[] | null | undefined): boolean {
  return Array.isArray(tiers) && tiers.some((t) => tierPrice(t) > 0)
}

/**
 * Parse an organizer's price INPUT, distinguishing "free" from "not set".
 * Returns 0 for an explicit zero, a positive number for a price, and `null` when
 * the field is blank or unparseable — so a blank field can never be silently
 * saved as a free tier.
 */
export function parseTierPriceInput(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/**
 * Classify an event's pricing. Precedence, most to least trustworthy:
 *   1. `is_rsvp` — an explicit free-RSVP event.
 *   2. `has_paid_tiers` — the explicit flag stamped at save time.
 *   3. the embedded `ticket_tiers` array.
 *   4. `ticket_price` — legacy last resort.
 *
 * When the embedded tier set is present it also refines 'paid' vs 'mixed' and
 * supplies `lowestPaidPrice`.
 */
export function resolveEventPricing(
  event: EventPricingLike | null | undefined
): EventPricing {
  const tiers = Array.isArray(event?.ticket_tiers) ? event!.ticket_tiers! : []
  const knowsTiers = tiers.length > 0

  const paidTierPrices = tiers.map(tierPrice).filter((p) => p > 0)
  const lowestPaidPrice = paidTierPrices.length > 0 ? Math.min(...paidTierPrices) : null

  // 1 & 2 — explicit signals.
  const flag = event?.has_paid_tiers
  const paid =
    event?.is_rsvp === true
      ? false
      : typeof flag === 'boolean'
        ? flag
        : // 3 — derive from the embedded set when we have one.
          knowsTiers
          ? paidTierPrices.length > 0
          : // 4 — legacy docs: the denormalized price is all we have.
            Number(event?.ticket_price ?? 0) > 0

  if (!paid) {
    return {
      kind: 'free',
      isFreeOnly: true,
      hasPaidTier: false,
      hasFreeTier: true,
      lowestPaidPrice: null,
    }
  }

  // Paid: 'mixed' only when we can actually SEE a free tier alongside. Without an
  // embedded set we stay 'paid' — claiming "mixed" on a guess would advertise a
  // free option that may not exist.
  const hasFreeTier = knowsTiers && tiers.some((t) => tierPrice(t) === 0)
  return {
    kind: hasFreeTier ? 'mixed' : 'paid',
    isFreeOnly: false,
    hasPaidTier: true,
    hasFreeTier,
    lowestPaidPrice,
  }
}

/** Convenience: may this event skip tier selection and go straight to free claim? */
export function isFreeOnlyEvent(event: EventPricingLike | null | undefined): boolean {
  return resolveEventPricing(event).isFreeOnly
}

/** Major units → integer cents. */
export function toCents(amount: number): number {
  const n = Number(amount)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Integer cents → major units. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

export interface TotalSelection {
  /** Unit price in MAJOR units. */
  price: number
  quantity: number
}

export interface TotalDiscount {
  /** Percentage off the subtotal, e.g. 10 for 10%. */
  percentage?: number | null
  /** Flat amount off the subtotal, in MAJOR units. Applied only when no percentage. */
  amount?: number | null
}

/**
 * Total for a set of selections, in MAJOR units, computed on integer cents so
 * repeated adds and a percentage discount can't accumulate binary-float error.
 * Never returns a negative total.
 */
export function computeSelectionTotal(
  selections: TotalSelection[],
  discount?: TotalDiscount | null
): number {
  let cents = 0
  for (const s of selections) {
    const qty = Math.max(0, Math.trunc(Number(s.quantity) || 0))
    if (qty === 0) continue
    cents += toCents(s.price) * qty
  }

  const pct = Number(discount?.percentage ?? 0)
  const flat = Number(discount?.amount ?? 0)
  if (Number.isFinite(pct) && pct > 0) {
    cents = Math.round(cents * (1 - pct / 100))
  } else if (Number.isFinite(flat) && flat > 0) {
    cents = cents - toCents(flat)
  }

  return fromCents(Math.max(0, cents))
}

/**
 * Web-only addition (mobile has no equivalent because its selector enforces a
 * single tier): is every tier in this cart free on its OWN price?
 *
 * A cart whose total is 0 can get there two ways, and they must NOT be treated
 * alike:
 *   • every selected tier is genuinely a 0-price tier → free issuance is legitimate
 *   • paid tiers were discounted to 0 by a promo code → free issuance is NOT
 *     legitimate here; the free-claim endpoint requires each tier's own price to
 *     be 0 and would (correctly) refuse it.
 */
export function allSelectionsFree(
  selections: Array<{ price?: number | string | null; quantity?: number | null }>
): boolean {
  const active = selections.filter((s) => Math.trunc(Number(s?.quantity) || 0) > 0)
  return active.length > 0 && active.every((s) => tierPrice(s) === 0)
}
