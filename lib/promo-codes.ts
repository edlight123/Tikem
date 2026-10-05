/**
 * Promo code utilities.
 *
 * The server-side promo system is unified on **Firestore** (the store the mobile
 * app already writes to). Promo codes live in `promo_codes` and redemptions in
 * `promo_code_usage`. All writes to `uses_count` / redemptions go through the
 * Admin SDK here (never from clients — see firestore.rules), and the usage cap
 * (`max_uses`) is enforced atomically in a Firestore transaction at the moment a
 * purchase is CONFIRMED (Stripe webhook, MonCash return, Sogepay callback).
 */

import { createHash } from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { getPromoExpiresAt, getPromoUsesCount, isPromoActive } from '@/lib/promo-code-shared'

// ─────────────────────────────────────────────────────────────────────────────
// WHO REDEEMED IT
//
// A promo's caps have to survive guest checkout. An account is a stable identity
// across visits; a guest's `guest_…` id is minted per order, so counting
// redemptions against it would count every guest as a brand-new buyer and a
// single-use-per-buyer code would be unlimited for anyone who simply doesn't sign
// in. The buyer KEY below is therefore the identity that actually persists:
//
//   account → `uid:<firebase uid>`
//   guest   → `email:<normalized email>` (their phone as a fallback)
//
// It is recorded on every redemption so caps and audits work the same either way.
// ─────────────────────────────────────────────────────────────────────────────

/** The stable per-buyer identity a promo redemption is counted against. */
export function promoBuyerKey(buyer: {
  isGuest?: boolean
  id?: string | null
  email?: string | null
  phone?: string | null
}): string | null {
  if (!buyer) return null
  if (!buyer.isGuest) {
    const uid = String(buyer.id || '').trim()
    return uid ? `uid:${uid}` : null
  }
  const email = String(buyer.email || '').trim().toLowerCase()
  if (email) return `email:${email}`
  const phone = String(buyer.phone || '').trim()
  return phone ? `phone:${phone}` : null
}

/**
 * A per-buyer cap declared on the promo doc, or null when it declares none.
 *
 * No promo currently carries this field, so every existing code behaves exactly as
 * before (and costs no extra reads). It is read here so that the moment an
 * organizer can set one, guests are held to it by email rather than escaping it
 * with a fresh id per order.
 */
export function promoMaxUsesPerBuyer(promo: Record<string, any> | null | undefined): number | null {
  const raw = promo?.max_uses_per_user ?? promo?.max_uses_per_buyer
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

// ── Validation throttle ──────────────────────────────────────────────────────

/** Guest promo validation is IP-throttled: this many tries per window. */
const VALIDATION_ATTEMPT_LIMIT = 25
const VALIDATION_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

function throttleDocId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 40)
}

/**
 * Count one promo-code validation attempt and say whether the caller has had
 * enough.
 *
 * `/api/promo-codes/validate` used to require a session, which by itself made
 * code guessing an account-only activity. Guests can validate now, so the
 * enumeration control an account got for free has to be made explicit: without
 * it, an unauthenticated caller could sweep an event's codespace. Signed-in
 * callers are not throttled here — nothing about their path changed.
 *
 * Fails OPEN: a bookkeeping error must not stop a real buyer entering a real code.
 */
export async function recordPromoValidationAttempt(
  key: string | null | undefined
): Promise<{ limited: boolean }> {
  const raw = String(key || '').trim()
  if (!raw || raw === 'unknown') return { limited: false }

  const ref = adminDb.collection('promo_validation_attempts').doc(throttleDocId(raw))
  const now = Date.now()

  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const data = snap.exists ? snap.data() || {} : {}
      const windowStart = Number(data.window_start || 0)
      const withinWindow = Boolean(windowStart && now - windowStart < VALIDATION_WINDOW_MS)
      const count = withinWindow ? Number(data.count || 0) : 0

      if (count >= VALIDATION_ATTEMPT_LIMIT) {
        return { limited: true }
      }

      tx.set(
        ref,
        {
          count: count + 1,
          window_start: withinWindow ? windowStart : now,
          updated_at: new Date(now).toISOString(),
        },
        { merge: true }
      )
      return { limited: false }
    })
  } catch (e) {
    console.error('[promo] validation throttle failed', (e as any)?.message)
    return { limited: false }
  }
}

export interface PromoDoc {
  id: string
  event_id: string
  code: string
  // Mobile writes 'fixed_amount'; some legacy docs use 'fixed'. Anything that is
  // not 'percentage' is treated as a fixed-amount discount by calculateDiscount.
  discount_type: 'percentage' | 'fixed_amount' | 'fixed' | string
  discount_value: number
  max_uses: number | null
  uses_count: number
  is_active?: boolean
  expires_at?: string | null
  [key: string]: any
}

interface DiscountInput {
  discount_type: 'percentage' | 'fixed_amount' | 'fixed' | string
  discount_value: number
}

export function calculateDiscount(
  originalPrice: number,
  promoCode: DiscountInput
): { discountedPrice: number; discountAmount: number } {
  let discountAmount = 0

  if (promoCode.discount_type === 'percentage') {
    discountAmount = (originalPrice * promoCode.discount_value) / 100
  } else {
    // 'fixed_amount' | 'fixed' | anything else → flat amount off
    discountAmount = promoCode.discount_value
  }

  // Guard rail: discount can never exceed the price (integer-cents-safe callers
  // compute cents downstream; here we keep the same rounding the app already used).
  discountAmount = Math.min(Math.max(0, discountAmount), originalPrice)

  const discountedPrice = Math.max(0, originalPrice - discountAmount)

  return {
    discountedPrice: Math.round(discountedPrice * 100) / 100, // Round to 2 decimals
    discountAmount: Math.round(discountAmount * 100) / 100,
  }
}

export function formatDiscount(promoCode: DiscountInput): string {
  if (promoCode.discount_type === 'percentage') {
    return `${promoCode.discount_value}% off`
  }
  return `$${promoCode.discount_value} off`
}

/**
 * Low-level lookup: find a promo doc for an event by EITHER its Firestore doc id
 * OR its raw code string (the mobile client may pass either). Returns the doc
 * (with id) or null. Performs NO validity checks beyond confirming the doc
 * belongs to `eventId` — callers layer active/expiry/cap checks on top.
 */
export async function findPromoDoc(
  eventId: string,
  codeOrId: string | null | undefined
): Promise<PromoDoc | null> {
  if (!eventId || !codeOrId) return null
  const raw = String(codeOrId).trim()
  if (!raw) return null

  // 1) Try treating the value as a Firestore document id.
  try {
    const byId = await adminDb.collection('promo_codes').doc(raw).get()
    if (byId.exists) {
      const data = { id: byId.id, ...(byId.data() as any) } as PromoDoc
      if (String(data.event_id) === String(eventId)) return data
      // A doc id that belongs to a different event must NOT be honored.
      return null
    }
  } catch {
    // Fall through to code lookup (e.g. invalid id characters).
  }

  // 2) Fall back to a code lookup for this event (normalized upper-case).
  const normalized = raw.toUpperCase()
  const snap = await adminDb
    .collection('promo_codes')
    .where('event_id', '==', eventId)
    .where('code', '==', normalized)
    .limit(1)
    .get()

  if (!snap.empty) {
    const d = snap.docs[0]
    return { id: d.id, ...(d.data() as any) } as PromoDoc
  }

  return null
}

/**
 * Resolve an ACTIVE, non-expired promo for `eventId`, accepting either the
 * Firestore doc id or the raw code. Returns the promo doc or null.
 *
 * NOTE: this intentionally does NOT reject on cap-reached — the cap is enforced
 * atomically at redemption time (redeemPromoInTransaction). Callers that price a
 * charge should additionally consult promoCapacityRemaining() so an
 * already-exhausted promo charges full price instead of a discount that can't be
 * redeemed.
 */
export async function resolvePromoCode(
  eventId: string,
  codeOrId: string | null | undefined
): Promise<PromoDoc | null> {
  const promo = await findPromoDoc(eventId, codeOrId)
  if (!promo) return null

  if (!isPromoActive(promo)) return null

  const expiresAt = getPromoExpiresAt(promo)
  if (expiresAt && expiresAt.getTime() < Date.now()) return null

  return promo
}

/**
 * Remaining redemptions for a promo: null means unlimited (no max_uses), else the
 * non-negative number of uses still available. Soft/non-atomic — use only to
 * decide whether to APPLY a discount when pricing a charge. The authoritative cap
 * lives in redeemPromoInTransaction.
 */
export function promoCapacityRemaining(promo: {
  max_uses?: number | null
  uses_count?: number
  [key: string]: any
}): number | null {
  const max = promo?.max_uses
  if (max === null || max === undefined) return null
  const maxN = Number(max)
  if (!Number.isFinite(maxN)) return null
  return Math.max(0, maxN - getPromoUsesCount(promo))
}

/**
 * True when a discount should be applied to an order of `qty` tickets: the promo
 * is unlimited, or at least `qty` uses remain. Redemption (below) is all-or-nothing
 * for the order's full quantity, so pricing a 3-ticket order at a discount when only
 * one use is left charges the buyer a discount the redemption then refuses. `qty`
 * defaults to 1 so existing single-ticket callers behave exactly as before.
 *
 * Global cap only — see promoCanCoverOrder for the per-buyer cap as well.
 */
export function promoHasCapacity(
  promo: {
    max_uses?: number | null
    uses_count?: number
    [key: string]: any
  },
  qty: number = 1
): boolean {
  const remaining = promoCapacityRemaining(promo)
  const need = Math.max(1, Math.floor(Number(qty) || 1))
  return remaining === null || remaining >= need
}

/** Doc id of the per-(promo, buyer) running counter in `promo_buyer_usage`. */
function promoBuyerCounterId(promoId: string, buyerKey: string): string {
  return `${promoId}__${createHash('sha256').update(buyerKey).digest('hex').slice(0, 32)}`
}

/**
 * The pricing-time mirror of redeemPromoInTransaction's two caps, so a charge is
 * only discounted when the redemption at confirm can actually honour it:
 *
 *  - global: at least `qty` uses remain (not just one)
 *  - per buyer: when the promo declares a per-buyer cap, the buyer is
 *    identifiable and their prior redemptions + `qty` fit under it
 *
 * Soft/non-atomic (a concurrent order can still take the last slot between
 * pricing and confirm); redeemPromoInTransaction stays the authoritative gate.
 * Fails OPEN on a lookup error for the per-buyer count, like the rest of pricing.
 */
export async function promoCanCoverOrder(
  promo: (PromoDoc | Record<string, any>) & { id?: string },
  params: { qty: number; buyerKey?: string | null }
): Promise<{ ok: boolean; reason?: 'cap' | 'buyer_cap' | 'buyer_unknown' }> {
  const qty = Math.max(1, Math.floor(Number(params.qty) || 1))
  if (!promoHasCapacity(promo, qty)) return { ok: false, reason: 'cap' }

  const perBuyerCap = promoMaxUsesPerBuyer(promo)
  if (perBuyerCap === null) return { ok: true }
  if (qty > perBuyerCap) return { ok: false, reason: 'buyer_cap' }

  const buyerKey = String(params.buyerKey || '').trim()
  if (!buyerKey) return { ok: false, reason: 'buyer_unknown' }
  if (!promo?.id) return { ok: true }

  try {
    const snap = await adminDb
      .collection('promo_buyer_usage')
      .doc(promoBuyerCounterId(String(promo.id), buyerKey))
      .get()
    const prior = snap.exists ? Math.max(0, Number(snap.data()?.qty || 0)) : 0
    return prior + qty > perBuyerCap ? { ok: false, reason: 'buyer_cap' } : { ok: true }
  } catch (e) {
    console.error('[promo] per-buyer usage lookup failed; allowing at pricing', (e as any)?.message)
    return { ok: true }
  }
}

export interface RedeemResult {
  /** True only when uses_count was atomically incremented for this call. */
  redeemed: boolean
  /** True when the increment was refused because the cap would be exceeded. */
  capReached: boolean
  /** True when it was the PER-BUYER cap (not the global one) that refused it. */
  buyerCapReached?: boolean
  usesCountAfter?: number
}

/**
 * Atomically redeem a promo: in a Firestore transaction, re-read
 * uses_count/max_uses and only if `max_uses == null || uses_count + qty <=
 * max_uses` increment uses_count by qty and record a redemption doc in
 * `promo_code_usage`. Otherwise no-op and report capReached so the caller can
 * charge full price (at pricing time) or simply log (at confirm time, where the
 * discounted amount was already charged).
 *
 * This is the single authoritative enforcement point for the usage cap. It MUST
 * be called only when a purchase is CONFIRMED (payment succeeded + tickets
 * issued), so an abandoned checkout never consumes a slot.
 */
export async function redeemPromoInTransaction(params: {
  promoId: string
  qty: number
  userId?: string | null
  eventId?: string | null
  discountApplied?: number | null
  /**
   * The stable per-buyer identity (see `promoBuyerKey`). Recorded on the
   * redemption, and — when the promo declares a per-buyer cap — counted against it
   * inside the same transaction. For a guest this is their email, NOT the
   * per-order `guest_…` id, so a single-use-per-buyer code cannot be farmed by
   * checking out repeatedly without an account.
   */
  buyerKey?: string | null
}): Promise<RedeemResult> {
  const { promoId } = params
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  if (!promoId || qty <= 0) return { redeemed: false, capReached: false }

  const promoRef = adminDb.collection('promo_codes').doc(promoId)
  // Pre-generate the redemption ref so it can be written inside the transaction.
  const usageRef = adminDb.collection('promo_code_usage').doc()
  const buyerKey = String(params.buyerKey || '').trim() || null

  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(promoRef)
      if (!snap.exists) {
        return { redeemed: false, capReached: false } as RedeemResult
      }

      const data = snap.data() || {}
      const max = data.max_uses
      const unlimited = max === null || max === undefined || !Number.isFinite(Number(max))
      const used = getPromoUsesCount(data)

      if (!unlimited && used + qty > Number(max)) {
        return { redeemed: false, capReached: true } as RedeemResult
      }

      // Per-buyer cap, when the promo declares one. The running count lives in a
      // single doc whose id is derived from (promo, buyer), so it is a plain get by
      // id inside the transaction — no query, and therefore no composite index to
      // keep in step. Two concurrent orders from the same buyer contend on that one
      // doc, so neither can slip past. No cap declared ⇒ no extra read at all, and
      // the behaviour is exactly what it was.
      const perBuyerCap = promoMaxUsesPerBuyer(data)
      let buyerCounterRef: any = null
      let buyerQtyAfter = 0
      if (perBuyerCap !== null) {
        if (!buyerKey) {
          // A capped code with no identifiable buyer cannot be enforced, so it is
          // refused rather than handed out uncounted.
          return { redeemed: false, capReached: true, buyerCapReached: true } as RedeemResult
        }
        buyerCounterRef = adminDb.collection('promo_buyer_usage').doc(promoBuyerCounterId(promoId, buyerKey))
        const priorSnap = await tx.get(buyerCounterRef)
        const priorQty = priorSnap.exists ? Math.max(0, Number(priorSnap.data()?.qty || 0)) : 0
        if (priorQty + qty > perBuyerCap) {
          return { redeemed: false, capReached: true, buyerCapReached: true } as RedeemResult
        }
        buyerQtyAfter = priorQty + qty
      }

      const now = new Date().toISOString()
      tx.update(promoRef, { uses_count: used + qty, updated_at: now })
      if (buyerCounterRef) {
        tx.set(
          buyerCounterRef,
          {
            promo_code_id: promoId,
            buyer_key: buyerKey,
            qty: buyerQtyAfter,
            updated_at: now,
          },
          { merge: true }
        )
      }
      tx.set(usageRef, {
        promo_code_id: promoId,
        user_id: params.userId ?? null,
        // Additive: the identity that survives across a guest's session-less visits.
        buyer_key: buyerKey,
        event_id: params.eventId ?? null,
        discount_applied:
          typeof params.discountApplied === 'number' && Number.isFinite(params.discountApplied)
            ? params.discountApplied
            : null,
        qty,
        created_at: now,
      })

      return { redeemed: true, capReached: false, usesCountAfter: used + qty } as RedeemResult
    })
  } catch (e) {
    // Never let a redemption bookkeeping failure break an already-confirmed sale.
    console.error('[promo] redeemPromoInTransaction failed', {
      promoId,
      message: (e as any)?.message,
    })
    return { redeemed: false, capReached: false }
  }
}
