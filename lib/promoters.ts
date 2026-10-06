/**
 * Event promoters: per-event referral codes with a commission ledger.
 *
 * A promoter is a record the ORGANIZER creates on their own event — a street-team
 * member, an anbasadè, an influencer — who shares a personal event link
 * (`/events/{id}?ref=CODE`). Sales made through that link are attributed to them
 * and a commission the organizer owes them is ledgered in `promoter_sales`.
 *
 * The architecture deliberately mirrors promo codes end to end:
 *  - untrusted client input is re-resolved server-side (resolvePromoterCode),
 *  - only the resolved doc id rides on the payment (PI metadata /
 *    pending_transactions),
 *  - bookkeeping happens exactly once, inside the fulfillment claim
 *    (recordPromoterSale), and never breaks a confirmed sale.
 *
 * The promoter's stats page is reached by an HMAC token derived from the record's
 * `stats_key` — the guest-ticket-link pattern: deterministic re-derivation, no
 * bearer credential stored, constant-time verification.
 */

import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { calculatePlatformFeeWithPercentage } from '@/lib/fees'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { getEventLocation } from '@/types/platform-settings'

export interface PromoterDoc {
  id: string
  event_id: string
  organizer_id: string
  code: string
  name: string
  contact?: string | null
  commission_type: 'percentage' | 'flat_per_ticket' | string
  commission_value: number
  is_active?: boolean
  stats_key: string
  claimed_by_uid?: string | null
  tickets_sold?: number
  orders_count?: number
  gross_cents?: number
  commission_cents?: number
  currency?: string
  [key: string]: any
}

/** Uppercased, short, link-safe. Same alphabet a promoter can read aloud. */
export const PROMOTER_CODE_PATTERN = /^[A-Z0-9_-]{2,24}$/

/**
 * Normalize a raw `?ref=` value. Returns the canonical code or null — never
 * throws, because an unusable ref must never block a purchase.
 */
export function normalizePromoterCode(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toUpperCase()
  if (!code || !PROMOTER_CODE_PATTERN.test(code)) return null
  return code
}

/**
 * Low-level lookup by Firestore doc id OR raw code, scoped to the event.
 * No validity checks beyond event ownership of the doc — mirrors findPromoDoc.
 */
export async function findPromoterDoc(
  eventId: string,
  codeOrId: string | null | undefined
): Promise<PromoterDoc | null> {
  if (!eventId || !codeOrId) return null
  const raw = String(codeOrId).trim()
  if (!raw) return null

  try {
    const byId = await adminDb.collection('event_promoters').doc(raw).get()
    if (byId.exists) {
      const data = { id: byId.id, ...(byId.data() as any) } as PromoterDoc
      if (String(data.event_id) === String(eventId)) return data
      // A doc id that belongs to a different event must NOT be honored.
      return null
    }
  } catch {
    // Fall through to code lookup (e.g. invalid id characters).
  }

  const normalized = normalizePromoterCode(raw)
  if (!normalized) return null

  const snap = await adminDb
    .collection('event_promoters')
    .where('event_id', '==', eventId)
    .where('code', '==', normalized)
    .limit(1)
    .get()

  if (!snap.empty) {
    const d = snap.docs[0]
    return { id: d.id, ...(d.data() as any) } as PromoterDoc
  }
  return null
}

/**
 * Resolve an ACTIVE promoter for the event. Anything else — unknown code,
 * deactivated, wrong event — resolves to null and the sale simply proceeds
 * unattributed. There is nothing to enumerate: the response never distinguishes
 * "no such code" from "inactive".
 */
export async function resolvePromoterCode(
  eventId: string,
  codeOrId: string | null | undefined
): Promise<PromoterDoc | null> {
  const promoter = await findPromoterDoc(eventId, codeOrId)
  if (!promoter) return null
  if (promoter.is_active === false) return null
  return promoter
}

// ── Commission ────────────────────────────────────────────────────────────────

/**
 * Commission for one fulfilled order, in event-currency cents.
 *
 * Free orders earn 0 under BOTH types: a flat fee on a zero-revenue ticket would
 * obligate money the organizer never received.
 *
 * Capped at the order's gross MINUS the platform fee: the commission is withheld
 * from the organizer's net, and the net is what is left after Tikèm's fee. A cap
 * at the gross alone let a large flat fee push the organizer's net negative, so
 * the promoter was paid out of money that was never the organizer's.
 */
export function calculateCommissionCents(
  promoter: Pick<PromoterDoc, 'commission_type' | 'commission_value'>,
  orderGrossCents: number,
  quantity: number,
  platformFeeCents: number = 0
): number {
  const gross = Math.max(0, Math.round(Number(orderGrossCents) || 0))
  const qty = Math.max(0, Math.round(Number(quantity) || 0))
  const value = Number(promoter?.commission_value)
  if (gross <= 0 || qty <= 0 || !Number.isFinite(value) || value <= 0) return 0

  const fee = Math.max(0, Math.round(Number(platformFeeCents) || 0))
  const ceiling = Math.max(0, gross - fee)
  if (ceiling <= 0) return 0

  if (promoter.commission_type === 'flat_per_ticket') {
    // value is event-currency cents per ticket.
    return Math.min(ceiling, Math.round(value) * qty)
  }
  // Default: percentage of the order's face value (after promo discounts).
  const pct = Math.min(100, value)
  return Math.min(ceiling, Math.round((gross * pct) / 100))
}

/**
 * The platform fee Tikèm takes on this order, in event-currency cents, computed
 * the way checkout and the earnings ledger compute it: exactly the rate for the
 * event's location, with no per-ticket cap (owner decision, 2026-10-05).
 *
 * The buyer-pays incidence (US/CA/FR) is deliberately NOT special-cased: the
 * ticket's incidence is not known here, and assuming the fee comes out of the
 * organizer's share only makes the commission ceiling stricter, never looser.
 * On any lookup failure this falls back to the default 10%.
 */
export async function platformFeeCentsForOrder(
  eventId: string,
  orderGrossCents: number,
  // Kept for callers; with no per-ticket cap the fee no longer depends on it.
  _quantity?: number
): Promise<number> {
  const gross = Math.max(0, Math.round(Number(orderGrossCents) || 0))
  if (gross <= 0) return 0
  try {
    const eventSnap = await adminDb.collection('events').doc(String(eventId)).get()
    const event: any = eventSnap?.exists ? eventSnap.data() || {} : {}
    const settings = await getPlatformSettings()
    const cfg: any = getEventLocation(String(event?.country || 'HT')) === 'haiti' ? settings?.haiti : settings?.usCanada
    const rateRaw = Number(cfg?.platformFeePercentage)
    const rate = Number.isFinite(rateRaw) && rateRaw >= 0 && rateRaw < 1 ? rateRaw : DEFAULT_PLATFORM_FEE_RATE
    return calculatePlatformFeeWithPercentage(gross, rate)
  } catch (err: any) {
    console.warn('[promoters] platform-fee lookup failed; assuming the default rate', {
      eventId,
      message: err?.message,
    })
    return calculatePlatformFeeWithPercentage(gross, DEFAULT_PLATFORM_FEE_RATE)
  }
}

const DEFAULT_PLATFORM_FEE_RATE = 0.1

/**
 * Highest paid tier price for an event, in event-currency CENTS, or null when no
 * tier price is known. A flat per-ticket commission above this cannot be earned
 * on any ticket the event sells, so create/update reject it.
 */
export async function maxTierPriceCentsForEvent(eventId: string, eventData?: any): Promise<number | null> {
  const prices: number[] = []
  const push = (raw: unknown) => {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) prices.push(Math.round(n * 100))
  }
  try {
    const snap = await adminDb.collection('ticket_tiers').where('event_id', '==', String(eventId)).get()
    snap.docs.forEach((d: any) => push(d.data()?.price))
  } catch (err: any) {
    console.warn('[promoters] tier lookup failed', { eventId, message: err?.message })
  }
  if (prices.length === 0 && Array.isArray(eventData?.ticket_tiers)) {
    for (const t of eventData.ticket_tiers) push(t?.price)
  }
  if (prices.length === 0) push(eventData?.ticket_price)
  return prices.length > 0 ? Math.max(...prices) : null
}

// ── Stats-page token (guest-link pattern) ─────────────────────────────────────

/**
 * HMAC key for promoter stats links. Prefers a dedicated secret, then the guest
 * link secrets, then a key derived from the Firebase credential — same fallback
 * discipline as lib/guest/identity.ts: a promoter is always handed a working
 * link rather than a deploy silently breaking stats delivery.
 */
function promoterLinkSecret(): Buffer {
  const explicit =
    process.env.PROMOTER_LINK_SECRET?.trim() ||
    process.env.GUEST_TICKET_LINK_SECRET?.trim() ||
    process.env.WALLET_PASS_LINK_SECRET?.trim()
  if (explicit) return Buffer.from(explicit, 'utf8')

  const derivedFrom = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()
  return crypto
    .createHash('sha256')
    .update(`tikem-promoter-link|${derivedFrom || 'unconfigured'}`)
    .digest()
}

function signStatsKey(statsKey: string): string {
  return crypto
    .createHmac('sha256', promoterLinkSecret())
    .update(statsKey)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 22)
}

/** A fresh, unguessable stats key for a new promoter record. */
export function mintPromoterStatsKey(): string {
  return crypto.randomBytes(24).toString('hex')
}

/** Build the stats token for a promoter's stats_key. Deterministic — re-derivable. */
export function promoterTokenFor(statsKey: string): string {
  return `${statsKey}.${signStatsKey(statsKey)}`
}

/**
 * Verify a stats token and return the stats_key it names, or null. Constant-time
 * comparison; forged and malformed tokens are indistinguishable to the caller.
 */
export function verifyPromoterToken(token: unknown): string | null {
  const raw = String(token ?? '').trim()
  if (!raw || raw.length > 200) return null

  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const [statsKey, providedSignature] = parts
  if (!/^[a-f0-9]{48}$/.test(statsKey) || !providedSignature) return null

  const expected = Buffer.from(signStatsKey(statsKey), 'utf8')
  const provided = Buffer.from(providedSignature, 'utf8')
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null
  }
  return statsKey
}

export async function getPromoterByStatsKey(statsKey: string): Promise<PromoterDoc | null> {
  if (!/^[a-f0-9]{48}$/.test(String(statsKey || ''))) return null
  const snap = await adminDb
    .collection('event_promoters')
    .where('stats_key', '==', statsKey)
    .limit(1)
    .get()
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...(d.data() as any) } as PromoterDoc
}

// ── Sale ledger ───────────────────────────────────────────────────────────────

export interface RecordPromoterSaleParams {
  promoterId: string
  eventId: string
  ticketIds: string[]
  quantity: number
  /** Order face value after promo discounts, event-currency cents. */
  orderGrossCents: number
  currency: string
  paymentMethod: string
  paymentId?: string | null
  /** Stable buyer identity for support/audit: a uid, else a normalized email. */
  buyerUserId?: string | null
  buyerEmail?: string | null
  /**
   * Platform fee on this order in event-currency cents, when the caller already
   * knows it. Omitted, it is computed from the event's fee rule.
   */
  platformFeeCents?: number | null
  /**
   * Default true. Pass false when Tikèm holds none of this order's money (a
   * Stripe Connect DESTINATION charge: the organizer's account already received
   * the full net). The row is then informational — the organizer settles with
   * the promoter directly — and is written unfunded in the same transaction, so
   * there is never a moment where the promoter could withdraw it from the pool.
   */
  funded?: boolean
  /** Why an unfunded row is unfunded, e.g. 'destination_charge'. */
  unfundedReason?: string | null
}

/**
 * Record one fulfilled order against its promoter: append a `promoter_sales`
 * row and bump the promoter's counters, atomically.
 *
 * Called INSIDE the caller's fulfillment claim, so it runs at most once per
 * order. Like promo redemption, a bookkeeping failure must never break a
 * confirmed sale: this function catches everything, logs loudly, and reports
 * `recorded: false` for reconciliation.
 */
export async function recordPromoterSale(
  params: RecordPromoterSaleParams
): Promise<{ recorded: boolean; commissionCents: number }> {
  try {
    const promoterRef = adminDb.collection('event_promoters').doc(String(params.promoterId))
    const saleRef = adminDb.collection('promoter_sales').doc()

    const feeQuantity = Math.max(1, Math.round(Number(params.quantity) || 1))
    const feeGross = Math.max(0, Math.round(Number(params.orderGrossCents) || 0))
    const platformFeeCents =
      params.platformFeeCents != null && Number.isFinite(Number(params.platformFeeCents))
        ? Math.max(0, Math.round(Number(params.platformFeeCents)))
        : await platformFeeCentsForOrder(params.eventId, feeGross, feeQuantity)

    let commissionCents = 0
    await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(promoterRef)
      if (!snap.exists) throw new Error(`promoter ${params.promoterId} not found`)
      const promoter = snap.data() as PromoterDoc
      if (String(promoter.event_id) !== String(params.eventId)) {
        throw new Error(`promoter ${params.promoterId} belongs to another event`)
      }

      const quantity = Math.max(1, Math.round(Number(params.quantity) || 1))
      const orderGrossCents = Math.max(0, Math.round(Number(params.orderGrossCents) || 0))
      commissionCents = calculateCommissionCents(promoter, orderGrossCents, quantity, platformFeeCents)

      const buyerUid = String(params.buyerUserId || '').trim()
      const buyerEmail = String(params.buyerEmail || '').trim().toLowerCase()
      const buyerKey = buyerUid && !buyerUid.startsWith('guest_')
        ? `uid:${buyerUid}`
        : buyerEmail
        ? `email:${buyerEmail}`
        : null

      tx.set(saleRef, {
        // Funded rows are REAL MONEY: the same amount is withheld from the
        // organizer's earnings accrual and becomes withdrawable from the
        // promoter's wallet once the event's funds release. Rows written before
        // the wallet shipped lack this flag and stay informational (organizer
        // settles those directly). Callers pass funded:false for destination
        // charges, where Tikèm holds none of the money.
        funded: params.funded !== false,
        ...(params.funded === false ? { unfunded_reason: params.unfundedReason || 'not_held_by_tikem' } : {}),
        promoter_id: promoterRef.id,
        event_id: String(params.eventId),
        organizer_id: String(promoter.organizer_id || ''),
        ref_code: String(promoter.code || ''),
        ticket_ids: (params.ticketIds || []).map(String),
        quantity,
        order_gross_cents: orderGrossCents,
        commission_type: promoter.commission_type === 'flat_per_ticket' ? 'flat_per_ticket' : 'percentage',
        commission_value: Number(promoter.commission_value) || 0,
        commission_cents: commissionCents,
        currency: String(params.currency || promoter.currency || 'HTG').toUpperCase(),
        payment_method: String(params.paymentMethod || 'unknown'),
        payment_id: params.paymentId ? String(params.paymentId) : null,
        buyer_key: buyerKey,
        status: 'accrued',
        created_at: new Date().toISOString(),
      })

      tx.update(promoterRef, {
        tickets_sold: (Number(promoter.tickets_sold) || 0) + quantity,
        orders_count: (Number(promoter.orders_count) || 0) + 1,
        gross_cents: (Number(promoter.gross_cents) || 0) + orderGrossCents,
        commission_cents: (Number(promoter.commission_cents) || 0) + commissionCents,
        updated_at: new Date().toISOString(),
      })
    })

    return { recorded: true, commissionCents }
  } catch (err: any) {
    console.error('[promoters] failed to record sale (sale is kept; reconcile manually)', {
      promoterId: params.promoterId,
      eventId: params.eventId,
      message: err?.message,
    })
    return { recorded: false, commissionCents: 0 }
  }
}

/**
 * Drop promoter_sales rows for Stripe Connect orders. Those funds settle in the
 * organizer's own Stripe account, so Tikèm can neither withhold the commission
 * from them nor pay it out of its own pool.
 *
 * Going forward Connect rows are written `funded: false`. Rows written earlier
 * say `funded: true`; they are recognised by `payment_method === 'stripe_connect'`
 * (the webhook path), or, for rows the client-confirm path recorded as plain
 * 'stripe', by the first sold ticket's payment_method, which both paths stamp
 * as 'stripe_connect' for a destination charge.
 *
 * Throws if a ticket lookup fails: guessing either way moves money wrongly.
 */
export async function excludeStripeConnectSales<T extends Record<string, any>>(sales: T[]): Promise<T[]> {
  const isConnect = (v: unknown) => String(v || '').toLowerCase() === 'stripe_connect'
  const verdicts = await Promise.all(
    sales.map(async (sale) => {
      if (sale?.funded === false) return false
      if (isConnect(sale?.payment_method) || isConnect(sale?.payout_provider)) return false
      if (String(sale?.payment_method || '').toLowerCase() !== 'stripe') return true
      const firstTicketId = Array.isArray(sale?.ticket_ids) && sale.ticket_ids.length > 0 ? String(sale.ticket_ids[0]) : ''
      if (!firstTicketId) return true
      const ticketSnap = await adminDb.collection('tickets').doc(firstTicketId).get()
      const ticket: any = ticketSnap?.exists ? ticketSnap.data() || {} : {}
      return !isConnect(ticket?.payment_method) && !isConnect(ticket?.payout_provider)
    })
  )
  return sales.filter((_, i) => verdicts[i])
}

/**
 * Total FUNDED, still-accrued promoter commission for an event, in
 * event-currency cents. The derived earnings view deducts this so an organizer's
 * net matches what the incremental withholding produced.
 *
 * THROWS when the ledger is unreachable. Returning 0 on a Firestore blip used to
 * report the promoter's money as the organizer's, and the withdrawal paths
 * (lib/payouts/availability-server.ts) would then let the organizer take it.
 * Callers must fail the figure, not default it.
 */
export async function getFundedCommissionForEvent(eventId: string): Promise<number> {
  try {
    const snap = await adminDb
      .collection('promoter_sales')
      .where('event_id', '==', String(eventId))
      .where('funded', '==', true)
      .get()
    const accrued = snap.docs
      .map((d: any) => d.data() || {})
      .filter((s: any) => s.funded === true && s.status === 'accrued')
    // Connect sales never reach Tikèm's balance (they settle in the organizer's
    // own Stripe account), so a commission on one cannot be withheld from the
    // Tikèm-held net. The promoter wallet excludes the same rows.
    const sales = await excludeStripeConnectSales(accrued)
    let total = 0
    for (const s of sales) total += Math.max(0, Number(s.commission_cents) || 0)
    return total
  } catch (err: any) {
    console.error('[promoters] funded-commission lookup failed', {
      eventId,
      message: err?.message,
    })
    throw err
  }
}

/**
 * The share of an order's figure that stays accrued after `reversedCount` of its
 * `ticketCount` tickets were reversed. Cumulative rounding (round(total·k/n)), so
 * every partial step is within a cent of exact and the LAST ticket takes the
 * exact remainder: the reversed shares always sum to the original, no drift.
 */
export function remainingAfterReversal(total: number, reversedCount: number, ticketCount: number): number {
  const t = Math.max(0, Math.round(Number(total) || 0))
  const n = Math.max(1, Math.round(Number(ticketCount) || 1))
  const k = Math.min(n, Math.max(0, Math.round(Number(reversedCount) || 0)))
  if (k >= n) return 0
  return t - Math.round((t * k) / n)
}

/**
 * Reverse ONE ticket's share of the promoter accrual on its order.
 *
 * Refunding 1 ticket of a 4-ticket order takes back a quarter of the order's
 * commission (and of its gross and quantity), not all of it. v1 reversed the
 * whole order on the first refunded ticket, so a single refund wiped the
 * promoter's commission on seats that were still sold.
 *
 * The sale doc keeps its ORIGINAL figures in `original_*` (stamped on the first
 * reversal) and its live `commission_cents` / `order_gross_cents` / `quantity`
 * are reduced to what is still accrued — every reader that sums accrued rows
 * (lib/promoter-wallet, getFundedCommissionForEvent, the stats page) stays
 * right without changes. `reversed_ticket_ids` makes repeat calls for the same
 * ticket no-ops. When the last ticket goes the row becomes `status: 'reversed'`
 * with its original figures restored (how fully reversed rows always looked) and
 * the promoter's orders_count drops by one.
 *
 * The denominator is the order's ticket_ids (one doc per seat); the promoter's
 * counters move by exactly the delta this call removed.
 */
export async function reversePromoterSaleForTicket(ticketId: string): Promise<boolean> {
  const id = String(ticketId)
  try {
    const snap = await adminDb
      .collection('promoter_sales')
      .where('ticket_ids', 'array-contains', id)
      .limit(1)
      .get()
    if (snap.empty) return false

    const saleDoc = snap.docs[0]
    const first = saleDoc.data() as any
    if (first.status !== 'accrued') return false

    const promoterRef = adminDb.collection('event_promoters').doc(String(first.promoter_id))
    return await adminDb.runTransaction(async (tx: any) => {
      const fresh = await tx.get(saleDoc.ref)
      if (!fresh.exists) return false
      const sale = (fresh.data() as any) || {}
      if (sale.status !== 'accrued') return false

      const ticketIds: string[] = Array.isArray(sale.ticket_ids) ? sale.ticket_ids.map(String) : []
      if (!ticketIds.includes(id)) return false
      const already: string[] = Array.isArray(sale.reversed_ticket_ids) ? sale.reversed_ticket_ids.map(String) : []
      if (already.includes(id)) return false

      const promoterSnap = await tx.get(promoterRef)

      const n = Math.max(1, ticketIds.length)
      const reversedIds = [...already, id]
      const k = Math.min(n, reversedIds.length)
      const full = k >= n

      const origCommission = Number(sale.original_commission_cents ?? sale.commission_cents) || 0
      const origGross = Number(sale.original_order_gross_cents ?? sale.order_gross_cents) || 0
      const origQuantity = Number(sale.original_quantity ?? sale.quantity) || 0

      const curCommission = Number(sale.commission_cents) || 0
      const curGross = Number(sale.order_gross_cents) || 0
      const curQuantity = Number(sale.quantity) || 0

      const nextCommission = remainingAfterReversal(origCommission, k, n)
      const nextGross = remainingAfterReversal(origGross, k, n)
      const nextQuantity = remainingAfterReversal(origQuantity, k, n)

      const deltaCommission = Math.max(0, curCommission - nextCommission)
      const deltaGross = Math.max(0, curGross - nextGross)
      const deltaQuantity = Math.max(0, curQuantity - nextQuantity)
      const nowIso = new Date().toISOString()

      tx.update(saleDoc.ref, {
        original_commission_cents: origCommission,
        original_order_gross_cents: origGross,
        original_quantity: origQuantity,
        reversed_ticket_ids: reversedIds,
        reversed_commission_cents: origCommission - nextCommission,
        ...(full
          ? {
              status: 'reversed',
              reversed_at: nowIso,
              // A fully reversed row reads as it always did: the original order.
              commission_cents: origCommission,
              order_gross_cents: origGross,
              quantity: origQuantity,
            }
          : {
              commission_cents: nextCommission,
              order_gross_cents: nextGross,
              quantity: nextQuantity,
              partially_reversed_at: nowIso,
            }),
      })
      if (promoterSnap.exists) {
        const p = promoterSnap.data() as PromoterDoc
        tx.update(promoterRef, {
          tickets_sold: Math.max(0, (Number(p.tickets_sold) || 0) - deltaQuantity),
          orders_count: Math.max(0, (Number(p.orders_count) || 0) - (full ? 1 : 0)),
          gross_cents: Math.max(0, (Number(p.gross_cents) || 0) - deltaGross),
          commission_cents: Math.max(0, (Number(p.commission_cents) || 0) - deltaCommission),
          updated_at: nowIso,
        })
      }
      return true
    })
  } catch (err: any) {
    console.error('[promoters] failed to reverse sale', { ticketId: id, message: err?.message })
    return false
  }
}
