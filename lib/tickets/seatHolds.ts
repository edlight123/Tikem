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
 * the PaymentIntent, the reconcile cron finds a stale order unpaid, or the same
 * buyer starts another checkout for the event.
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
 *  - one live hold per buyer per event: a new checkout replaces the buyer's
 *    previous hold (account uid, or a guest's email), so a buyer's held seats
 *    never exceed their current order, which the routes already check against
 *    the order cap (MAX_TICKETS_PER_ORDER, re-checked here) and the per-account
 *    ticket limit (max tickets per user);
 *  - at most SEAT_HOLD_MAX_PER_IP (default 20, generous for carrier-grade NAT)
 *    live holds per network per event;
 *  - the routes' purchase-attempt rate limits (lib/security shouldRateLimit) run
 *    before any hold is placed, and every hold counts as an attempt.
 * Residual risk: an attacker rotating many IPs AND many guest emails can still
 * hold up to 20 orders per IP for 8 minutes at a time, bounded by the per-IP
 * attempt rate limit. A captcha (or a payment method before the hold) is the
 * next step if that is ever seen.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets/purchasable'
import { releaseSeats, reserveSeats, type ReserveOutcome, type TierSoldIncrement } from '@/lib/tickets/inventoryShards'

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

export const DEFAULT_MAX_HOLDS_PER_IP = 20

/** Live holds one network may have per event: SEAT_HOLD_MAX_PER_IP (1–1000), else 20. */
export function maxHoldsPerIp(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SEAT_HOLD_MAX_PER_IP)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : DEFAULT_MAX_HOLDS_PER_IP
}

/** The client IP from a forwarded-for chain (first hop), or null when unknown. */
export function clientIpOf(raw: string | null | undefined): string | null {
  const ip = String(raw || '').split(',')[0].trim()
  return ip && ip !== 'unknown' ? ip : null
}

/** One live hold per buyer per event: account uid, or a guest's email. */
export function seatHoldOwnerKey(identity: { isGuest?: boolean; id?: string | null; email?: string | null }): string | null {
  if (identity?.isGuest) {
    const email = String(identity.email || '').trim().toLowerCase()
    return email ? `guest:${email}` : null
  }
  return identity?.id ? `user:${identity.id}` : null
}

const OWNERS_COLLECTION = 'inventory_hold_owners'
const IPS_COLLECTION = 'inventory_hold_ips'
const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32)
const safeEventId = (eventId: string) => String(eventId).replace(/[^A-Za-z0-9_-]/g, '_')
const ownerRef = (eventId: string, ownerKey: string) =>
  adminDb.collection(OWNERS_COLLECTION).doc(`${safeEventId(eventId)}__${sha(ownerKey)}`)
const ipRef = (eventId: string, ip: string) => adminDb.collection(IPS_COLLECTION).doc(`${safeEventId(eventId)}__${sha(ip)}`)

/**
 * Take one of this network's live-hold slots for the event (expired entries and
 * the hold this one replaces do not count). False when the network is at its
 * cap. An infra error lets the hold through: this is an abuse brake, not the
 * capacity gate, and failing closed would lock out a whole carrier NAT.
 */
async function takeIpSlot(
  eventId: string,
  ip: string,
  holdId: string,
  expiresAt: number,
  replaces: string | null,
  logPrefix: string
): Promise<boolean> {
  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const ref = ipRef(eventId, ip)
      const snap = await tx.get(ref)
      const now = Date.now()
      const live: Record<string, number> = {}
      for (const [id, exp] of Object.entries((snap.exists ? snap.data()?.h : null) || {})) {
        if (Number(exp) > now && id !== replaces) live[id] = Number(exp)
      }
      if (Object.keys(live).length >= maxHoldsPerIp()) return false
      live[holdId] = expiresAt
      tx.set(ref, { h: live, event_id: String(eventId), updated_at: new Date().toISOString() })
      return true
    })
  } catch (err: any) {
    console.warn(`${logPrefix} per-network hold cap unavailable; allowing`, { message: err?.message })
    return true
  }
}

async function dropIpSlot(eventId: string, ip: string, holdId: string): Promise<void> {
  await adminDb
    .runTransaction(async (tx: any) => {
      const ref = ipRef(eventId, ip)
      const snap = await tx.get(ref)
      const h = { ...((snap.exists ? snap.data()?.h : null) || {}) }
      if (!(holdId in h)) return
      delete h[holdId]
      tx.set(ref, { ...(snap.data() || {}), h, updated_at: new Date().toISOString() })
    })
    .catch(() => undefined)
}

export interface SeatHoldResult extends ReserveOutcome {
  holdId: string
}

/**
 * Hold seats for a checkout that is about to start. The buyer's previous hold
 * for this event (a reopened payment sheet, a second tab) is released first, so
 * their own hold can never be what makes the event look sold out to them, and
 * one buyer never holds more than one order's worth of seats.
 */
export async function createSeatHold(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  holdId?: string
  ownerKey?: string | null
  /** The buyer's IP (x-forwarded-for), for the per-network live-hold cap. */
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

  let previous: string | null = null
  if (params.ownerKey) {
    try {
      const snap = await ownerRef(params.eventId, params.ownerKey).get()
      const prev = snap.exists ? snap.data()?.hold_id : null
      if (isSeatHoldId(prev) && prev !== holdId) {
        previous = prev
        await releaseSeats({ reservationId: prev, onlyHeld: true, logPrefix })
      }
    } catch (err: any) {
      console.warn(`${logPrefix} could not release the buyer's previous hold`, { message: err?.message })
    }
  }

  const ip = clientIpOf(params.ipAddress)
  if (ip && !(await takeIpSlot(params.eventId, ip, holdId, expiresAt, previous, logPrefix))) {
    console.warn(`${logPrefix} live-hold cap reached for a network`, { eventId: params.eventId })
    return { ok: false, reason: 'too_many_holds', holdId }
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
    logPrefix,
  })

  if (!outcome.ok && ip) await dropIpSlot(params.eventId, ip, holdId)
  if (outcome.ok && outcome.reservationId && params.ownerKey) {
    await ownerRef(params.eventId, params.ownerKey)
      .set({ hold_id: holdId, event_id: String(params.eventId), updated_at: new Date().toISOString() })
      .catch((err: any) => console.warn(`${logPrefix} could not record the hold owner`, { message: err?.message }))
  }
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
    en: 'Too many checkouts are in progress from your network. Please try again in a few minutes.',
    fr: 'Trop de paiements sont en cours depuis votre réseau. Veuillez réessayer dans quelques minutes.',
    ht: 'Gen twòp peman k ap fèt sou rezo ou a. Tanpri eseye ankò nan kèk minit.',
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
 *  - 429 too_many_holds this network has too many checkouts in progress
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
