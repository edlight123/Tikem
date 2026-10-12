/**
 * The per-tier breakdown of a multi-tier CARD order, as it rides on the Stripe
 * PaymentIntent's metadata.
 *
 * create-payment-intent prices every line from the tier's STORED price and
 * writes the result here; fulfillment (lib/tickets/stripe-fulfillment) reads it
 * back and issues N tickets of each tier. Nothing in it comes from the client.
 *
 * Shape: metadata `t` = compact JSON `[[tierId, quantity, unitPrice, unitOriginal], …]`
 *  - unitPrice     face price of one ticket AFTER the promo, event currency
 *  - unitOriginal  the same BEFORE the promo (what the promo redemption records)
 *
 * Stripe caps a metadata value at 500 characters. A cart that does not fit is
 * refused at create time rather than truncated — a truncated breakdown would
 * issue the wrong tickets. With Firestore's 20-character ids that is roughly
 * ten distinct tiers in one order.
 *
 * A single-line order never uses `t`: it keeps the original `tierId` /
 * `quantity` / `finalPrice` fields, so PaymentIntents created before this
 * existed (and by older mobile builds) fulfil exactly as they always did.
 */

import { MAX_TICKETS_PER_ORDER, parseTicketQuantity } from '@/lib/tickets/purchasable'

export const CARD_ORDER_LINES_KEY = 't'
export const STRIPE_METADATA_VALUE_MAX = 500

export interface CardOrderLine {
  tierId: string
  quantity: number
  /** Post-promo face price of one ticket (major units, event currency). */
  unitPrice: number
  /** Pre-promo face price of one ticket. */
  unitOriginal: number
}

/** Prices are major units with at most 2 decimals; keep the JSON short. */
function compactMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Encode lines for metadata, or null when they will not fit in one value. */
export function encodeCardOrderLines(lines: CardOrderLine[]): string | null {
  const json = JSON.stringify(
    lines.map((l) => [String(l.tierId), l.quantity, compactMoney(l.unitPrice), compactMoney(l.unitOriginal)])
  )
  return json.length <= STRIPE_METADATA_VALUE_MAX ? json : null
}

export type DecodedCardOrderLines =
  | { present: false }
  | { present: true; ok: true; lines: CardOrderLine[]; quantity: number }
  | { present: true; ok: false }

/**
 * Read the breakdown back. `present: false` means a single-line (or legacy)
 * order. `ok: false` means metadata that cannot be honoured — the caller must
 * not issue anything for it.
 */
export function decodeCardOrderLines(metadata: Record<string, any> | null | undefined): DecodedCardOrderLines {
  const raw = metadata?.[CARD_ORDER_LINES_KEY]
  if (raw === undefined || raw === null || raw === '') return { present: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw))
  } catch {
    return { present: true, ok: false }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { present: true, ok: false }
  const lines: CardOrderLine[] = []
  for (const entry of parsed) {
    if (!Array.isArray(entry)) return { present: true, ok: false }
    const [tierId, qty, unitPrice, unitOriginal] = entry
    const quantity = parseTicketQuantity(qty)
    const price = Number(unitPrice)
    const original = Number(unitOriginal ?? unitPrice)
    if (typeof tierId !== 'string' || !tierId.trim() || quantity === null) return { present: true, ok: false }
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(original) || original < 0) {
      return { present: true, ok: false }
    }
    lines.push({ tierId: tierId.trim(), quantity, unitPrice: price, unitOriginal: original })
  }
  const quantity = lines.reduce((sum, l) => sum + l.quantity, 0)
  if (quantity > MAX_TICKETS_PER_ORDER) return { present: true, ok: false }
  return { present: true, ok: true, lines, quantity }
}
