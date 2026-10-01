/**
 * Tracking links: organizer-made campaign URLs with click + sale counters.
 *
 * Collections (both server-written only — firestore.rules denies clients):
 *  - `tracking_links/{id}` — one per link: label + utm parts + the counters
 *    `clicks`, `sales_count` (orders), `tickets_count` and
 *    `revenue_by_currency` ({ HTG: cents, USD: cents, … }, minor units, each
 *    currency kept apart — never summed across currencies).
 *  - `tracking_link_sales/{markerId}` — one marker per (link, order). The
 *    counter increment and the marker are written in ONE transaction, and the
 *    transaction no-ops when the marker exists, so a webhook redelivery, a
 *    client-confirm race or a released-and-retried fulfillment claim can never
 *    count an order twice. Same exactly-once idea as the webhook claim, but
 *    keyed on the order itself so it holds even across different claim paths.
 *
 * Like promoter bookkeeping, a failure here must never break a confirmed sale:
 * every write catches, logs and reports `recorded: false`.
 */

import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  type Attribution,
  normalizePromoterRef,
  normalizeTrackingLinkId,
  sanitizeAttribution,
  withResolvedPromoter,
} from '@/lib/attribution'

export const TRACKING_LINKS_COLLECTION = 'tracking_links'
export const TRACKING_LINK_SALES_COLLECTION = 'tracking_link_sales'

export interface TrackingLinkDoc {
  event_id: string
  organizer_id: string
  label: string
  source: string
  medium: string
  campaign: string
  url: string
  created_by: string
  created_at: string
  updated_at?: string
  clicks?: number
  sales_count?: number
  tickets_count?: number
  revenue_by_currency?: Record<string, number>
  last_click_at?: string | null
  last_sale_at?: string | null
  [key: string]: any
}

export interface SerializedTrackingLink {
  id: string
  label: string
  source: string
  medium: string
  campaign: string
  url: string
  createdAt: string | null
  clicks: number
  salesCount: number
  ticketsCount: number
  /** Minor units (cents) per ISO currency. */
  revenueByCurrency: Record<string, number>
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/

export function normalizeCurrency(raw: unknown): string | null {
  const c = String(raw ?? '').trim().toUpperCase()
  return CURRENCY_PATTERN.test(c) ? c : null
}

/** Only well-formed currency keys with finite, non-negative values survive. */
export function cleanRevenueMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cur = normalizeCurrency(k)
    const n = Math.round(Number(v))
    if (cur && Number.isFinite(n) && n > 0) out[cur] = n
  }
  return out
}

export function serializeTrackingLink(id: string, data: Partial<TrackingLinkDoc>): SerializedTrackingLink {
  return {
    id,
    label: String(data.label || ''),
    source: String(data.source || ''),
    medium: String(data.medium || ''),
    campaign: String(data.campaign || ''),
    url: String(data.url || ''),
    createdAt: data.created_at ? String(data.created_at) : null,
    clicks: Math.max(0, Number(data.clicks) || 0),
    salesCount: Math.max(0, Number(data.sales_count) || 0),
    ticketsCount: Math.max(0, Number(data.tickets_count) || 0),
    revenueByCurrency: cleanRevenueMap(data.revenue_by_currency),
  }
}

/** Ownership gate for the organizer CRUD routes — same rule as promoters. */
export async function assertEventOwnedByUser(
  eventId: string,
  userId: string
): Promise<{ ok: true; event: any } | { ok: false; status: number; error: string }> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  const organizerId = eventData?.organizer_id ?? eventData?.organizerId
  if (organizerId !== userId) return { ok: false, status: 403, error: 'Unauthorized' }
  return { ok: true, event: eventData }
}

/** The link doc, only if it exists AND belongs to this event. */
export async function resolveTrackingLink(
  eventId: string,
  rawId: unknown
): Promise<({ id: string } & TrackingLinkDoc) | null> {
  const id = normalizeTrackingLinkId(rawId)
  if (!id || !eventId) return null
  try {
    const snap = await adminDb.collection(TRACKING_LINKS_COLLECTION).doc(id).get()
    if (!snap.exists) return null
    const data = snap.data() as TrackingLinkDoc
    if (String(data?.event_id) !== String(eventId)) return null
    return { id: snap.id, ...data }
  } catch {
    return null
  }
}

/**
 * Turn the client-supplied attribution on a checkout request into what gets
 * stored on the order. The tracking link id is kept only when it names a real
 * link on THIS event (a forged id from another event is dropped, not honored);
 * the promoter ref is the server-resolved code when there is one.
 */
export async function resolveOrderAttribution(
  eventId: string,
  raw: unknown,
  resolvedPromoterCode?: string | null
): Promise<Attribution | null> {
  const attribution = sanitizeAttribution(raw)
  if (attribution?.tracking_link_id) {
    const link = await resolveTrackingLink(eventId, attribution.tracking_link_id)
    if (!link) attribution.tracking_link_id = null
  }
  return withResolvedPromoter(attribution, resolvedPromoterCode)
}

/** Deterministic marker id — order keys can contain characters Firestore ids can't. */
export function trackingSaleMarkerId(trackingLinkId: string, orderKey: string): string {
  const digest = crypto.createHash('sha256').update(String(orderKey)).digest('hex').slice(0, 32)
  return `${trackingLinkId}_${digest}`
}

export interface RecordTrackingLinkSaleParams {
  trackingLinkId: string
  eventId: string
  /** Stable per-order key: PaymentIntent id, gateway order id, free-claim id… */
  orderKey: string
  quantity: number
  /** Order face value in `currency`, minor units. */
  revenueCents: number
  /** The order's own (event) currency. */
  currency: string
  paymentMethod?: string
}

export type RecordTrackingLinkSaleResult =
  | { recorded: true }
  | { recorded: false; reason: 'duplicate' | 'not_found' | 'invalid' | 'error' }

/**
 * Count one fulfilled order against its tracking link — exactly once per
 * (link, order), atomically with the marker that proves it was counted.
 */
export async function recordTrackingLinkSale(
  params: RecordTrackingLinkSaleParams
): Promise<RecordTrackingLinkSaleResult> {
  const linkId = normalizeTrackingLinkId(params.trackingLinkId)
  const orderKey = String(params.orderKey || '').trim()
  const currency = normalizeCurrency(params.currency)
  if (!linkId || !orderKey || !currency || !params.eventId) {
    return { recorded: false, reason: 'invalid' }
  }

  const quantity = Math.max(1, Math.round(Number(params.quantity) || 1))
  const revenueCents = Math.max(0, Math.round(Number(params.revenueCents) || 0))

  try {
    const linkRef = adminDb.collection(TRACKING_LINKS_COLLECTION).doc(linkId)
    const markerRef = adminDb
      .collection(TRACKING_LINK_SALES_COLLECTION)
      .doc(trackingSaleMarkerId(linkId, orderKey))

    let outcome: RecordTrackingLinkSaleResult = { recorded: true }
    await adminDb.runTransaction(async (tx: any) => {
      // Firestore transactions: all reads before any write.
      const markerSnap = await tx.get(markerRef)
      const linkSnap = await tx.get(linkRef)
      if (markerSnap.exists) {
        outcome = { recorded: false, reason: 'duplicate' }
        return
      }
      if (!linkSnap.exists || String((linkSnap.data() as any)?.event_id) !== String(params.eventId)) {
        outcome = { recorded: false, reason: 'not_found' }
        return
      }

      const now = new Date().toISOString()
      tx.set(markerRef, {
        tracking_link_id: linkId,
        event_id: String(params.eventId),
        order_key: orderKey,
        quantity,
        revenue_cents: revenueCents,
        currency,
        payment_method: String(params.paymentMethod || 'unknown'),
        created_at: now,
      })
      tx.update(linkRef, {
        sales_count: FieldValue.increment(1),
        tickets_count: FieldValue.increment(quantity),
        // Dotted path → a nested per-currency counter; currencies never mix.
        // Free orders add no revenue key at all.
        ...(revenueCents > 0
          ? { [`revenue_by_currency.${currency}`]: FieldValue.increment(revenueCents) }
          : {}),
        last_sale_at: now,
      })
    })

    return outcome
  } catch (err: any) {
    console.error('[tracking-links] failed to record sale (sale is kept)', {
      trackingLinkId: linkId,
      eventId: params.eventId,
      message: err?.message,
    })
    return { recorded: false, reason: 'error' }
  }
}

/**
 * Fulfillment-site convenience: count the order against its tracking link when
 * the stored attribution names one. Never throws.
 */
export async function recordAttributedSale(
  attribution: Attribution | null | undefined,
  params: Omit<RecordTrackingLinkSaleParams, 'trackingLinkId'>
): Promise<RecordTrackingLinkSaleResult | null> {
  const linkId = attribution?.tracking_link_id
  if (!linkId) return null
  return recordTrackingLinkSale({ ...params, trackingLinkId: linkId })
}

// ── Clicks ───────────────────────────────────────────────────────────────────

/** +1 click on a tracking link of this event. Returns whether it counted. */
export async function incrementTrackingLinkClick(eventId: string, rawId: unknown): Promise<boolean> {
  const link = await resolveTrackingLink(eventId, rawId)
  if (!link) return false
  try {
    await adminDb.collection(TRACKING_LINKS_COLLECTION).doc(link.id).update({
      clicks: FieldValue.increment(1),
      last_click_at: new Date().toISOString(),
    })
    return true
  } catch (err: any) {
    console.warn('[tracking-links] click increment failed', { id: link.id, message: err?.message })
    return false
  }
}

/** +1 click on an ACTIVE promoter of this event, looked up by code. */
export async function incrementPromoterClick(eventId: string, rawRef: unknown): Promise<boolean> {
  const code = normalizePromoterRef(rawRef)
  if (!code || !eventId) return false
  try {
    const snap = await adminDb
      .collection('event_promoters')
      .where('event_id', '==', String(eventId))
      .where('code', '==', code)
      .limit(1)
      .get()
    if (snap.empty) return false
    const doc = snap.docs[0]
    if ((doc.data() as any)?.is_active === false) return false
    await doc.ref.update({ clicks: FieldValue.increment(1), last_click_at: new Date().toISOString() })
    return true
  } catch (err: any) {
    console.warn('[tracking-links] promoter click increment failed', { eventId, message: err?.message })
    return false
  }
}
