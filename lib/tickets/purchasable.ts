/**
 * Shared server-side gates for every route that sells or issues tickets.
 *
 * Each checkout entry point (Stripe PaymentIntent, MonCash/NatCash, Sogepay, free
 * claims) used to re-implement these checks, and each one had drifted:
 *
 *  - QUANTITY was never required to be an integer. `quantity: 0.01` charged 1% of a
 *    ticket while fulfillment's `for (i = 0; i < qty; i++)` still issued a whole one;
 *    `1.01` paid for one and got two.
 *  - A TIER was fetched by id alone. Nothing checked it belonged to the event being
 *    bought, so a cheap tier from any other event could price this one; and a
 *    missing tier quietly fell back to the event's lowest price.
 *  - EVENT STATE was never checked, so cancelled, unpublished, rejected and finished
 *    events kept taking money.
 *
 * Everything here is pure (no Firestore), so the rules are unit tested directly in
 * __tests__/purchasable.test.ts and every route calls the same code.
 */

/**
 * Most tickets one order may carry, across all of its tiers.
 *
 * Generous on purpose: the web tier selector caps a line only by what is left in
 * the tier, so a group buy of 20 is legitimate. The per-account limit
 * (`max_tickets_per_user`, lib/security.ts) is still enforced separately where it
 * applies; this is the absolute sanity bound that no client can exceed.
 */
export const MAX_TICKETS_PER_ORDER = 50

export type GateRefusal = {
  ok: false
  /** Human-readable English (logs, legacy clients). */
  error: string
  /** Stable machine code clients can localize off. */
  code: string
  status: number
}

function refuse(error: string, code: string, status = 400): GateRefusal {
  return { ok: false, error, code, status }
}

/**
 * A ticket quantity as a strict whole number in [1, max], or null.
 *
 * Accepts a number or a plain digit string (some clients serialize form state as
 * strings). Anything fractional, negative, zero, NaN, Infinity, exponent-notation or
 * otherwise odd is refused rather than rounded: rounding is how 0.01 became 1.
 */
export function parseTicketQuantity(raw: unknown, max: number = MAX_TICKETS_PER_ORDER): number | null {
  let n: number
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string' && /^\s*\d{1,6}\s*$/.test(raw)) {
    n = Number(raw.trim())
  } else {
    return null
  }
  if (!Number.isInteger(n) || n < 1 || n > max) return null
  return n
}

/** True when `raw` is a whole-number quantity in [1, max]. */
export function isValidTicketQuantity(raw: unknown, max: number = MAX_TICKETS_PER_ORDER): raw is number {
  return parseTicketQuantity(raw, max) !== null
}

export function invalidQuantityRefusal(max: number = MAX_TICKETS_PER_ORDER): GateRefusal {
  return refuse(
    `Quantity must be a whole number between 1 and ${max}.`,
    'invalid_quantity',
    400
  )
}

export type TierLine = { tierId: string; quantity: number }

/**
 * Validate a multi-tier cart `[{ tierId, quantity }]`.
 *
 *  - A line with quantity exactly 0 (or absent) is dropped — selectors send the
 *    whole tier list with untouched tiers at 0.
 *  - A line with ANY other non-whole quantity (fractional, negative, NaN, string
 *    junk) refuses the whole order. Silently dropping it would sell a cart the buyer
 *    did not ask for; rounding it is the original bug.
 *  - Duplicate tier ids are merged.
 *  - The order total is capped at `max`.
 */
export function normalizeTierLines(
  raw: unknown,
  max: number = MAX_TICKETS_PER_ORDER
): { ok: true; lines: TierLine[] } | GateRefusal {
  if (!Array.isArray(raw)) return { ok: true, lines: [] }
  const merged = new Map<string, number>()
  for (const entry of raw) {
    const tierId = typeof (entry as any)?.tierId === 'string' ? (entry as any).tierId.trim() : ''
    const rawQty = (entry as any)?.quantity
    if (rawQty === 0 || rawQty === '0' || rawQty == null) continue
    const qty = parseTicketQuantity(rawQty, max)
    if (qty === null) return invalidQuantityRefusal(max)
    if (!tierId) return refuse('Ticket tier not found for this event', 'tier_not_found', 404)
    merged.set(tierId, (merged.get(tierId) || 0) + qty)
  }
  const lines = Array.from(merged.entries()).map(([tierId, quantity]) => ({ tierId, quantity }))
  const total = lines.reduce((sum, l) => sum + l.quantity, 0)
  if (total > max) return invalidQuantityRefusal(max)
  return { ok: true, lines }
}

/**
 * The tier a buyer named must exist, belong to THIS event, and be active.
 *
 * A missing tier and another event's tier get the same answer on purpose, so the
 * response does not confirm which tier ids exist elsewhere.
 */
export function checkTierForEvent(tier: any, eventId: string): { ok: true } | GateRefusal {
  if (!tier || String(tier.event_id ?? tier.eventId ?? '') !== String(eventId)) {
    return refuse('Ticket tier not found for this event', 'tier_not_found', 404)
  }
  if (tier.is_active === false) {
    return refuse('This ticket tier is not available.', 'tier_inactive', 400)
  }
  return { ok: true }
}

/**
 * Which tier an order with NO tierId is buying.
 *
 *  - Event has no tier docs (legacy single-price event) → `tier: null`, priced from
 *    `event.ticket_price` exactly as before.
 *  - Exactly one active tier → that tier, so an older client that never sent a
 *    tierId still has its sale counted against the right inventory.
 *  - Several active tiers → refused. `event.ticket_price` is the LOWEST tier price,
 *    so falling back to it let a buyer pay the cheapest price and skip the
 *    per-tier capacity.
 *  - Tiers exist but none is active → refused.
 */
export function pickTierWhenUnspecified(
  eventTiers: any[] | null | undefined,
  eventId: string
): { ok: true; tier: any | null } | GateRefusal {
  const own = (eventTiers || []).filter(
    (t) => t && String(t.event_id ?? t.eventId ?? '') === String(eventId)
  )
  if (own.length === 0) return { ok: true, tier: null }
  const active = own.filter((t) => t.is_active !== false)
  if (active.length === 1) return { ok: true, tier: active[0] }
  if (active.length === 0) return refuse('This ticket tier is not available.', 'tier_inactive', 400)
  return refuse('Please choose a ticket type.', 'tier_required', 400)
}

/** Best-effort conversion of the date shapes events carry (ISO, Date, Timestamp, ms). */
export function toDateOrNull(value: unknown): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof (value as any)?.toDate === 'function') {
    try {
      const d = (value as any).toDate()
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
    } catch {
      return null
    }
  }
  const seconds = (value as any)?.seconds ?? (value as any)?._seconds
  if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000)
  return null
}

/**
 * How long after its START an event with no end time keeps selling. Door sales on
 * the night are real, so this is generous; an event that runs longer should carry
 * an `end_datetime`.
 */
export const NO_END_TIME_SALES_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * May this event take money / issue tickets right now?
 *
 * Field names are the ones the codebase actually writes:
 *  - `status === 'cancelled'`          lib/events/cancel.ts
 *  - `rejected === true`                admin moderation (also flips is_published off)
 *  - `payouts_frozen === true`          a dispute / admin / cancellation freeze
 *  - `is_published === true`            the ONLY publish signal. The old
 *                                       `status === 'published'` fallback kept
 *                                       selling events moderation or a ban had
 *                                       unpublished (they keep that status); the
 *                                       publish route always writes both.
 *  - `end_datetime` (else `start_datetime` + grace)
 *
 * Password protection is NOT decided here; the existing access-grant check stays in
 * each route.
 */
export function checkEventPurchasable(event: any, now: Date = new Date()): { ok: true } | GateRefusal {
  if (!event) return refuse('Event not found', 'event_not_found', 404)

  const status = String(event.status ?? '').toLowerCase()
  if (status === 'cancelled' || status === 'canceled') {
    return refuse('This event has been cancelled.', 'event_cancelled', 400)
  }
  if (event.rejected === true || event.payouts_frozen === true) {
    return refuse('This event is not available for purchase.', 'event_unavailable', 400)
  }
  if (event.is_published !== true) {
    return refuse('This event is not available for purchase.', 'event_unavailable', 400)
  }

  const end = toDateOrNull(event.end_datetime ?? event.endDatetime)
  const start = toDateOrNull(event.start_datetime ?? event.startDatetime)
  const cutoff = end ?? (start ? new Date(start.getTime() + NO_END_TIME_SALES_GRACE_MS) : null)
  if (cutoff && cutoff.getTime() < now.getTime()) {
    return refuse('This event has already ended.', 'event_ended', 400)
  }

  return { ok: true }
}

/**
 * Validate a paid order's stored tier lines at FULFILLMENT time — after money moved
 * but before tickets are issued. Every line must carry a whole quantity and the
 * lines must add up to the order's own quantity, otherwise the order is not
 * fulfilled (it is flagged for refund/review by the caller).
 */
export function validateStoredOrderLines(
  lines: Array<{ quantity?: unknown }> | null | undefined,
  orderQuantity: unknown
): { ok: true; total: number } | GateRefusal {
  const qty = parseTicketQuantity(orderQuantity)
  if (qty === null) return invalidQuantityRefusal()
  if (!Array.isArray(lines) || lines.length === 0) return { ok: true, total: qty }
  let total = 0
  for (const line of lines) {
    const n = parseTicketQuantity(line?.quantity)
    if (n === null) return invalidQuantityRefusal()
    total += n
  }
  if (total !== qty) {
    return refuse('Order lines do not match the order quantity.', 'invalid_quantity', 400)
  }
  return { ok: true, total }
}
