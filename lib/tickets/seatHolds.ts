/**
 * Seat holds: seats are reserved when checkout STARTS, before the buyer pays.
 *
 * create-payment-intent, moncash-button/initiate and sogepay/initiate place a
 * hold for the order's seats (lib/tickets/inventoryShards.ts) and refuse with a
 * clear 409 when holds + sales already fill the event or tier, so nobody is
 * charged for a seat that does not exist (MonCash cannot even refund
 * automatically). The hold expires after SEAT_HOLD_MS; until then it counts
 * against availability for everyone else. Fulfillment converts it into a sale
 * (convertSeatHold in lib/tickets/inventory.ts). It is released early when the
 * buyer closes the payment sheet (/api/checkout/release-hold), Stripe cancels
 * the PaymentIntent, or a verified gateway answer / the reconcile cron finds
 * the order unpaid. A buyer starting a SECOND checkout never drops the first
 * hold: that earlier payment may still be in flight (a MonCash OTP screen, a
 * PaymentIntent processing), and dropping it would let the seat sell twice.
 *
 * WHO MAY RELEASE / CONVERT
 * -------------------------
 *  - Converting a hold into a sale happens only inside server fulfillment, after
 *    the payment was verified with the gateway (webhook / verified callback).
 *  - A client releases a hold with the hold id AND its release token (an HMAC
 *    of the id, seatHoldReleaseToken), both returned only to the client that
 *    started that checkout. Hold ids are 128-bit random, never derived from an
 *    order id, and the inventory docs are server-only (firestore.rules default
 *    deny), so a hold cannot be guessed or enumerated. A release only ever
 *    drops a HOLD; seats already sold are never touched.
 *
 * ABUSE LIMITS (holding seats costs nothing, so a bot could try to lock an event)
 * ------------
 * Keyed only on what the caller controls, so nobody can lock out someone else:
 *  - a signed-in buyer, per event: at most SEAT_HOLD_MAX_PER_BUYER live holds
 *    (default 3) and one order's worth of held seats (MAX_TICKETS_PER_ORDER).
 *    The key is the uid, which needs that account's session. The routes also
 *    check each order against the per-account ticket limit;
 *  - a guest, per network per event: at most SEAT_HOLD_MAX_PER_IP live holds
 *    (default 100, sized for Haitian carrier-grade NAT) adding up to at most
 *    SEAT_HOLD_MAX_SEATS_PER_IP seats (default 200), so one IP cannot lock
 *    100 x 50 seats. Never keyed on a guest email: anyone can type someone else's;
 *  - the routes' purchase-attempt rate limits (lib/security shouldRateLimit) run
 *    before any hold is placed, and every hold counts as an attempt.
 * Each cap is claimed ATOMICALLY in a transaction on its own small doc
 * (inventory_hold_limits/{event+key}, claimHoldLimit), separate from the shard
 * transaction, so 50 parallel checkouts from one account cannot all pass. A
 * hold that is refused gives its slots back; a released, converted or expired
 * hold frees them; an orphaned slot stops counting at its expiry.
 * Residual risk: an attacker with many accounts or many IPs can still hold
 * seats 8 minutes at a time, bounded by the attempt rate limits; guests behind
 * the same NAT as an attacker share that NAT's 100 slots. A captcha, or a
 * payment method before the hold, is the next step if that is ever seen.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets/purchasable'
import {
  claimHoldLimit,
  releaseHoldLimit,
  releaseSeats,
  reserveSeats,
  type ReserveOutcome,
  type TierSoldIncrement,
} from '@/lib/tickets/inventoryShards'

export const DEFAULT_SEAT_HOLD_MINUTES = 8

/** How long a hold lasts: SEAT_HOLD_MINUTES (1–60) when set, else 8 minutes. */
export function seatHoldMs(env: Record<string, string | undefined> = process.env): number {
  const minutes = Number(env.SEAT_HOLD_MINUTES)
  const valid = Number.isFinite(minutes) && minutes >= 1 && minutes <= 60
  return Math.round((valid ? minutes : DEFAULT_SEAT_HOLD_MINUTES) * 60_000)
}

export const SEAT_HOLD_MS = seatHoldMs()

/** 128 random bits: a hold id is never derived from anything guessable. */
export function newSeatHoldId(): string {
  return `hold_${randomUUID().replace(/-/g, '')}`
}

export function isSeatHoldId(value: unknown): value is string {
  return typeof value === 'string' && /^hold_[a-f0-9]{32}$/.test(value)
}

function releaseSecret(): string {
  return (
    process.env.SEAT_HOLD_SECRET ||
    process.env.TICKET_ID_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.STRIPE_SECRET_KEY ||
    'tikem-seat-hold'
  )
}

/** The token that authorizes a client to release one hold. */
export function seatHoldReleaseToken(holdId: string): string {
  return createHmac('sha256', releaseSecret()).update(`release:${holdId}`).digest('hex').slice(0, 40)
}

export function isValidSeatHoldReleaseToken(holdId: unknown, token: unknown): holdId is string {
  if (!isSeatHoldId(holdId) || typeof token !== 'string' || token.length !== 40) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(seatHoldReleaseToken(holdId)))
}

/** How long an order-status token (orderStatusToken) stays valid. */
export const ORDER_STATUS_TOKEN_MS = 2 * 60 * 60 * 1000

/**
 * A short-lived token that lets a page poll ONE order's status without the
 * order cookie or a session, e.g. the app's WebView, whose cookie jar never saw
 * the native initiate call. `{expiryMs}.{hmac(orderId, expiry)}`.
 */
export function orderStatusToken(orderId: string, expiresAt: number = Date.now() + ORDER_STATUS_TOKEN_MS): string {
  const exp = Math.floor(expiresAt)
  const mac = createHmac('sha256', releaseSecret()).update(`order-status:${orderId}:${exp}`).digest('hex').slice(0, 40)
  return `${exp}.${mac}`
}

export function isValidOrderStatusToken(orderId: string, token: unknown, now: number = Date.now()): boolean {
  if (!orderId || typeof token !== 'string') return false
  const [expRaw, mac] = token.split('.')
  const exp = Number(expRaw)
  if (!Number.isInteger(exp) || exp < now || typeof mac !== 'string' || mac.length !== 40) return false
  const expected = orderStatusToken(orderId, exp).split('.')[1]
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
}

export const DEFAULT_MAX_HOLDS_PER_IP = 100
export const DEFAULT_MAX_SEATS_PER_IP = 200

/** Live guest holds one network may have per event: SEAT_HOLD_MAX_PER_IP (1–1000), else 100. */
export function maxHoldsPerIp(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SEAT_HOLD_MAX_PER_IP)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : DEFAULT_MAX_HOLDS_PER_IP
}

/** Seats one network's live guest holds may add up to per event: SEAT_HOLD_MAX_SEATS_PER_IP (1–5000), else 200. */
export function maxSeatsPerIp(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SEAT_HOLD_MAX_SEATS_PER_IP)
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : DEFAULT_MAX_SEATS_PER_IP
}

/** The client IP from a forwarded-for chain (first hop), or null when unknown. */
export function clientIpOf(raw: string | null | undefined): string | null {
  const ip = String(raw || '').split(',')[0].trim()
  return ip && ip !== 'unknown' ? ip : null
}

/** The key a buyer's hold caps count under: account uid, or a guest's email. */
export function seatHoldOwnerKey(identity: { isGuest?: boolean; id?: string | null; email?: string | null }): string | null {
  if (identity?.isGuest) {
    const email = String(identity.email || '').trim().toLowerCase()
    return email ? `guest:${email}` : null
  }
  return identity?.id ? `user:${identity.id}` : null
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32)
const safeEventId = (eventId: string) => String(eventId).replace(/[^A-Za-z0-9_-]/g, '_')
const limitParentId = (eventId: string, key: string) => `${safeEventId(eventId)}__${sha(key)}`

export const DEFAULT_MAX_HOLDS_PER_BUYER = 3

/** Live holds one account may have per event: SEAT_HOLD_MAX_PER_BUYER (1–20), else 3. */
export function maxHoldsPerBuyer(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SEAT_HOLD_MAX_PER_BUYER)
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_MAX_HOLDS_PER_BUYER
}

interface LimitCheck {
  limitId: string
  scope: 'account' | 'network'
  maxHolds: number
  /** Cap on the seats held under this key (null = only the hold count is capped). */
  maxSeats: number | null
}

export interface SeatHoldResult extends ReserveOutcome {
  holdId: string
}

/**
 * Hold seats for a checkout that is about to start. The buyer's other live
 * holds for this event are left alone (one may belong to a payment in flight);
 * the per-buyer and per-network caps bound how much one party can hold.
 */
export async function createSeatHold(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  holdId?: string
  /** seatHoldOwnerKey(identity): `user:{uid}` or `guest:{email}`. */
  ownerKey?: string | null
  /** The buyer's IP (x-forwarded-for), for the guests' per-network cap. */
  ipAddress?: string | null
  source: string
  holdMs?: number
  logPrefix?: string
}): Promise<SeatHoldResult> {
  const holdId = params.holdId || newSeatHoldId()
  const logPrefix = params.logPrefix || '[seat_hold]'
  const expiresAt = Date.now() + (params.holdMs ?? SEAT_HOLD_MS)

  // Never hold more than one order may buy (the routes already refuse it).
  const qty = Number(params.quantity)
  if (!Number.isInteger(qty) || qty > MAX_TICKETS_PER_ORDER) {
    return { ok: false, reason: 'invalid_quantity', requested: qty, holdId }
  }

  // Caps are keyed only on what the CALLER controls: their own signed-in
  // account (a uid needs that account's session) or, for a guest, the network
  // they are calling from. Never on a guest email: anyone can type someone
  // else's, and an email-keyed cap would let them lock that person out.
  const checks: LimitCheck[] = []
  const owner = String(params.ownerKey || '')
  if (owner.startsWith('user:')) {
    checks.push({ limitId: limitParentId(params.eventId, owner), scope: 'account', maxHolds: maxHoldsPerBuyer(), maxSeats: MAX_TICKETS_PER_ORDER })
  } else {
    const ip = clientIpOf(params.ipAddress)
    if (ip) checks.push({ limitId: limitParentId(params.eventId, `ip:${ip}`), scope: 'network', maxHolds: maxHoldsPerIp(), maxSeats: maxSeatsPerIp() })
  }

  // Each cap is claimed atomically on its own small doc (claimHoldLimit), never
  // inside the shard transaction; a hold that is then refused gives its slots back.
  const claimed: LimitCheck[] = []
  const giveBack = () => Promise.all(claimed.map((c) => releaseHoldLimit(c.limitId, holdId)))
  for (const check of checks) {
    const verdict = await claimHoldLimit({
      limitId: check.limitId,
      reservationId: holdId,
      seats: qty,
      expiresAt,
      maxHolds: check.maxHolds,
      maxSeats: check.maxSeats,
    })
    if (verdict !== 'ok') {
      await giveBack()
      if (verdict === 'capped') console.warn(`${logPrefix} live-hold cap reached`, { eventId: params.eventId, scope: check.scope })
      return { ok: false, reason: verdict === 'capped' ? 'too_many_holds' : 'busy', holdId }
    }
    claimed.push(check)
  }

  const outcome = await reserveSeats({
    eventId: params.eventId,
    quantity: params.quantity,
    tierIncrements: params.tierIncrements,
    mode: 'hold',
    reservationId: holdId,
    expiresAt,
    source: params.source,
    owner: params.ownerKey || null,
    limitSlots: claimed.map((c) => c.limitId),
    logPrefix,
  })
  if (!outcome.ok || !outcome.reservationId) await giveBack()
  return { ...outcome, holdId }
}

/**
 * Release a hold that never became a sale. For SERVER callers only (verified
 * gateway answers, Stripe webhooks, refusals); a client goes through
 * /api/checkout/release-hold, which checks the release token first.
 * Never releases sold seats; never throws.
 */
export async function releaseSeatHold(holdId: unknown, opts: { logPrefix?: string } = {}): Promise<boolean> {
  if (!isSeatHoldId(holdId)) return false
  try {
    const r = await releaseSeats({ reservationId: holdId, onlyHeld: true, logPrefix: opts.logPrefix || '[seat_hold]' })
    return r.released
  } catch (err: any) {
    console.warn(`${opts.logPrefix || '[seat_hold]'} could not release seat hold`, { holdId, message: err?.message })
    return false
  }
}

// ── refusals at checkout start ──────────────────────────────────────────────

type Lang = 'en' | 'fr' | 'ht'

export const SEAT_HOLD_MESSAGES = {
  sold_out: {
    en: 'Sorry, these tickets are sold out.',
    fr: 'Désolé, ces billets sont épuisés.',
    ht: 'Padon, tikè sa yo fini.',
  },
  only_n_left: {
    en: (n: number) => `Only ${n} ticket${n === 1 ? '' : 's'} left. Lower the quantity and try again.`,
    fr: (n: number) => `Il ne reste que ${n} billet${n === 1 ? '' : 's'}. Réduisez la quantité et réessayez.`,
    ht: (n: number) => `Se ${n} tikè sèlman ki rete. Diminye kantite a epi eseye ankò.`,
  },
  busy_try_again: {
    en: 'So many people are buying right now that we could not hold your seats. Please try again in a moment.',
    fr: "Il y a tellement d'acheteurs en ce moment que nous n'avons pas pu réserver vos places. Veuillez réessayer dans un instant.",
    ht: 'Gen twòp moun k ap achte kounye a, nou pa t ka kenbe plas ou yo. Tanpri eseye ankò nan yon ti moman.',
  },
  too_many_holds: {
    en: 'Too many checkouts are already in progress for this event. Finish or close one, or try again in a few minutes.',
    fr: 'Trop de paiements sont déjà en cours pour cet événement. Terminez-en ou fermez-en un, ou réessayez dans quelques minutes.',
    ht: 'Gen twòp peman ki deja ap fèt pou evènman sa a. Fini oswa fèmen youn, oswa eseye ankò nan kèk minit.',
  },
} as const

export interface SeatHoldRefusal {
  status: number
  body: { error: string; code: string; remaining?: number }
}

/**
 * The response for a hold that could not be placed, or null when it was.
 *  - 409 sold_out       holds + sales fill the event or the tier
 *  - 409 only_n_left    fewer seats left than requested (`remaining` carries how many)
 *  - 503 busy_try_again contention outlasted the retries; nothing was reserved
 *  - 429 too_many_holds this buyer (or a guest's network) already holds its cap
 */
export function seatHoldRefusal(outcome: ReserveOutcome, lang: Lang = 'en'): SeatHoldRefusal | null {
  if (outcome.ok) return null
  switch (outcome.reason) {
    case 'busy':
      return { status: 503, body: { error: SEAT_HOLD_MESSAGES.busy_try_again[lang], code: 'busy_try_again' } }
    case 'too_many_holds':
      return { status: 429, body: { error: SEAT_HOLD_MESSAGES.too_many_holds[lang], code: 'too_many_holds' } }
    case 'event_capacity':
    case 'tier_capacity': {
      const remaining = Math.max(0, Number(outcome.remaining || 0))
      return remaining > 0
        ? { status: 409, body: { error: SEAT_HOLD_MESSAGES.only_n_left[lang](remaining), code: 'only_n_left', remaining } }
        : { status: 409, body: { error: SEAT_HOLD_MESSAGES.sold_out[lang], code: 'sold_out', remaining: 0 } }
    }
    case 'tier_mismatch':
      return { status: 400, body: { error: 'This ticket tier is not available for this event.', code: 'tier_not_for_event' } }
    case 'invalid_quantity':
    default:
      return { status: 400, body: { error: 'Invalid ticket quantity.', code: 'invalid_quantity' } }
  }
}

/** The same refusal for the lock-free pre-check (capacityFromEvent) the routes run first. */
export function capacityPrecheckRefusal(
  capacity: { available: boolean; remaining: number; isSoldOut: boolean },
  lang: Lang = 'en'
): SeatHoldRefusal | null {
  if (capacity.available) return null
  return seatHoldRefusal(
    { ok: false, reason: 'event_capacity', remaining: capacity.isSoldOut ? 0 : capacity.remaining },
    lang
  )
}

/** What a client needs to show the countdown and release the hold on close. */
export function seatHoldForClient(
  hold: SeatHoldResult
): { id: string; expiresAt: string; releaseToken: string } | null {
  if (!hold.ok || !hold.reservationId || !hold.expiresAt) return null
  return {
    id: hold.holdId,
    expiresAt: new Date(hold.expiresAt).toISOString(),
    releaseToken: seatHoldReleaseToken(hold.holdId),
  }
}
