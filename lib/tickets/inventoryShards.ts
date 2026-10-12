/**
 * Sharded seat inventory: the ONE authoritative capacity gate for every sale.
 *
 * WHY
 * ---
 * Inventory used to be reserved only after payment, in a transaction on the
 * single event doc. Every sale contended on that doc (Firestore sustains about
 * one write per second per document), and when the transaction failed it fell
 * back to an unchecked increment, so a rush could oversell. MonCash has no
 * refund API, so charge-then-refund is the outcome to avoid. Now seats are
 * HELD before the buyer pays (lib/tickets/seatHolds.ts) and the paid order
 * converts its hold into a sale.
 *
 * DATA
 * ----
 *   events/{eventId}/inventory_shards/{0..N-1}
 *     b: { [bucket]: { cap, alloc, sold } }   one bucket per counter: `_event`
 *                                             (every ticket) and `t_{tierId}`
 *     h: { [reservationId]: { q, exp } }      live holds: seats per bucket + expiry (ms)
 *   inventory_reservations/{reservationId}   one per hold / order: which shard,
 *                                             how many seats, and its state
 *                                             (held | sold | released | expired)
 *
 * WHY IT CANNOT OVERSELL: PER-SHARD CAPACITY ALLOCATION
 * -----------------------------------------------------
 * A capped bucket's capacity is SPLIT across the shards: shard k may hold or
 * sell at most `alloc_k`, and the allocations always add up to the capacity
 * they were made for (`cap`, snapshotted on every shard). A reservation is one
 * transaction on ONE shard that checks `sold_k + live holds_k + request <=
 * alloc_k` for every bucket it touches. Every shard individually stays within
 * its allocation, so the sum stays within the capacity, and no transaction ever
 * has to read the other shards. Concurrent buyers land on different shards
 * instead of queueing on one document.
 *
 * When the shard tried has no room (or the capacity changed since the shards
 * were allocated, or the shards do not exist yet), the reservation falls back
 * to a GLOBAL transaction that reads all N shards, checks the true total
 * against the capacity, places the reservation, and re-levels the allocations
 * (`alloc_k = used_k + an even share of what is left`). That re-levelling is
 * also how a shard that ran dry gets refilled from the others, and how an
 * organizer's capacity edit takes effect: a shard whose `cap` snapshot differs
 * from the capacity on the event / tier doc is never used until a global
 * transaction has re-allocated it. Firestore serializes the global transaction
 * against every shard transaction, so the invariant holds across both paths.
 *
 * Trade-off: the global path re-creates contention, but only near sell-out
 * (when the remaining seats are spread thinner than one request per shard) and
 * on a capacity change. A request that is clearly sold out is refused from a
 * lock-free read of the shards before any global transaction is attempted.
 * A capacity cut below what is already sold or held is honoured for the seats
 * already promised; nothing more sells until the total is under the new cap.
 *
 * Expired holds are ignored by every check (lazy expiry) and pruned from the
 * shard whenever it is next written; /api/cron/inventory-sweep tidies the
 * reservation docs and refreshes the display counters.
 *
 * DISPLAY COUNTERS
 * ----------------
 * `events.tickets_sold` and `ticket_tiers.sold_quantity` are still what every
 * page, the payout code and the organizer apps read. They are now a ROLLUP of
 * the shards' sold counts (rollupInventoryCounters), refreshed right after a
 * sale (throttled) and by the sweep, never written per sale. Eventually
 * consistent, by seconds.
 *
 * MIGRATION: an event without shards is initialized from its current
 * `tickets_sold` / `sold_quantity` inside the first global transaction, which
 * reads those counters in the same transaction, so no sale is lost.
 *
 * NEVER FAILS OPEN: contention is retried a bounded number of times with
 * jitter; after that the caller gets `reason: 'busy'` and must refuse (before
 * payment) or retry later (after payment). Nothing is ever issued unchecked.
 */

import { adminDb } from '@/lib/firebase/admin'

export interface TierSoldIncrement {
  tierId: string
  quantity: number
}

/** Shards per event. Fixed: an event's shards are created once with this count. */
export const INVENTORY_SHARD_COUNT = 10
export const INVENTORY_SHARDS_SUBCOLLECTION = 'inventory_shards'
export const INVENTORY_RESERVATIONS_COLLECTION = 'inventory_reservations'
/** The bucket every ticket of the event counts in. */
export const EVENT_BUCKET = '_event'
export const tierBucket = (tierId: string) => `t_${tierId}`

/** Shards tried on the fast path before falling back to the global transaction. */
const FAST_SHARD_TRIES = 3
/** Attempts of the global / conversion / release transactions (each also retried by Firestore). */
const TX_ATTEMPTS = 4
/** A display rollup right after a sale runs at most this often per event. */
export const ROLLUP_MIN_INTERVAL_MS = 5_000

type Qty = Record<string, number>
interface Bucket {
  /** The capacity this shard's allocation was made for; null = unlimited. */
  cap: number | null
  /** This shard's share of `cap`; null = unlimited. */
  alloc: number | null
  sold: number
}
interface ShardHold {
  q: Qty
  exp: number
}
interface Shard {
  b: Record<string, Bucket>
  h: Record<string, ShardHold>
}

export type ReservationState = 'held' | 'sold' | 'released' | 'expired'

export type ReserveRefusalReason =
  | 'event_capacity'
  | 'tier_capacity'
  /** A fractional / non-integer seat count: never reserved, never issued. */
  | 'invalid_quantity'
  /** A tier that belongs to a DIFFERENT event than the order. */
  | 'tier_mismatch'
  /** Contention outlasted the bounded retries. Retryable; nothing was reserved. */
  | 'busy'
  /** Abuse cap (seatHolds.ts): too many live holds from one network for this event. */
  | 'too_many_holds'

export interface ReserveOutcome {
  ok: boolean
  /** The reservation doc id (set when ok and something was reserved). */
  reservationId?: string
  /** Hold expiry, ms since epoch (holds only). */
  expiresAt?: number | null
  /** The reservation was already in the requested state (an idempotent retry). */
  alreadyDone?: boolean
  reason?: ReserveRefusalReason
  /** The tier that was sold out (only for reason === 'tier_capacity'). */
  tierId?: string | null
  /** How many were still available for the blocking bucket (capacity refusals). */
  remaining?: number
  requested?: number
}

// ── small helpers ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function retryBaseMs(): number {
  const v = Number(process.env.INVENTORY_RETRY_BASE_MS)
  return Number.isFinite(v) && v >= 0 ? v : 20
}

/** Exponential backoff with full jitter, so retrying buyers do not collide again in lockstep. */
function backoffMs(attempt: number): number {
  return Math.round(retryBaseMs() * 2 ** attempt * (0.5 + Math.random()))
}

const shardRef = (eventId: string, index: number) =>
  adminDb.collection('events').doc(eventId).collection(INVENTORY_SHARDS_SUBCOLLECTION).doc(String(index))
const reservationRef = (reservationId: string) =>
  adminDb.collection(INVENTORY_RESERVATIONS_COLLECTION).doc(reservationId)

const nonNegInt = (v: unknown) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Event capacity: max_tickets ?? capacity ?? total_tickets; 0 / missing ⇒ unlimited (null). */
export function eventCapacityOf(event: Record<string, any> | null | undefined): number | null {
  if (!event) return null
  const cap = Number(event.max_tickets ?? event.capacity ?? event.total_tickets ?? 0)
  return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null
}

/** Tier capacity: total_quantity ?? quantity; 0 / missing ⇒ unlimited (null). */
export function tierCapacityOf(tier: Record<string, any> | null | undefined): number | null {
  if (!tier) return null
  const cap = Number(tier.total_quantity ?? tier.quantity ?? 0)
  return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null
}

function readShard(snap: any): Shard {
  const data = snap?.exists ? snap.data() || {} : {}
  return {
    b: JSON.parse(JSON.stringify(data.b || {})),
    h: JSON.parse(JSON.stringify(data.h || {})),
  }
}

function shardDoc(s: Shard) {
  return { b: s.b, h: s.h, updated_at: new Date().toISOString() }
}

/** Seats of `key` held by live (unexpired) holds in this shard. */
function liveHeld(s: Shard, key: string, now: number): number {
  let total = 0
  for (const hold of Object.values(s.h)) {
    if (hold && Number(hold.exp) > now) total += nonNegInt(hold.q?.[key])
  }
  return total
}

/** Sold + live holds: what counts against this shard's allocation. */
export function shardUsed(s: Shard, key: string, now: number): number {
  return nonNegInt(s.b[key]?.sold) + liveHeld(s, key, now)
}

function pruneExpired(s: Shard, now: number) {
  for (const [id, hold] of Object.entries(s.h)) {
    if (!hold || !(Number(hold.exp) > now)) delete s.h[id]
  }
}

function applyReservation(s: Shard, reservationId: string, q: Qty, mode: 'hold' | 'sold', exp: number | null) {
  if (mode === 'hold') {
    s.h[reservationId] = { q: { ...q }, exp: Number(exp) }
    return
  }
  for (const [key, n] of Object.entries(q)) {
    const b = s.b[key] || { cap: null, alloc: null, sold: 0 }
    s.b[key] = { ...b, sold: nonNegInt(b.sold) + n }
  }
}

/**
 * Re-level the allocations of `keys` across all shards: each shard keeps what it
 * already uses (sold + live holds) plus an even share of what is left, so the
 * allocations add up to exactly the capacity. Callers guarantee the total used
 * is within the capacity. Pure; exported for tests.
 */
export function rebalanceShards(shards: Shard[], caps: Record<string, number | null>, keys: string[], now: number) {
  const n = shards.length
  for (const key of keys) {
    const cap = caps[key] ?? null
    if (cap == null) {
      for (const s of shards) s.b[key] = { cap: null, alloc: null, sold: nonNegInt(s.b[key]?.sold) }
      continue
    }
    const used = shards.map((s) => shardUsed(s, key, now))
    const free = Math.max(0, cap - used.reduce((a, b) => a + b, 0))
    const base = Math.floor(free / n)
    const extra = free - base * n
    // The remainder lands on a random run of shards so no shard is always favoured.
    const start = Math.floor(Math.random() * n)
    shards.forEach((s, i) => {
      const bonus = (i - start + n) % n < extra ? 1 : 0
      s.b[key] = { cap, alloc: used[i] + base + bonus, sold: nonNegInt(s.b[key]?.sold) }
    })
  }
}

function shuffledShardOrder(): number[] {
  const order = Array.from({ length: INVENTORY_SHARD_COUNT }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// ── request resolution ───────────────────────────────────────────────────────

interface ResolvedRequest {
  eventId: string
  /** Seats per bucket. */
  q: Qty
  /** Current capacity per bucket, from the event / tier docs. */
  caps: Record<string, number | null>
}

type Resolution =
  | { kind: 'request'; req: ResolvedRequest }
  /** Nothing sensible to reserve (no event id / no seats): never blocks an order. */
  | { kind: 'nothing' }
  | { kind: 'refused'; outcome: ReserveOutcome }

/** Merge raw selections into one increment per tier (duplicates summed, junk dropped). */
function mergeTierIncrements(tierIncrements: TierSoldIncrement[] | null | undefined): TierSoldIncrement[] {
  const merged = new Map<string, number>()
  for (const t of tierIncrements || []) {
    if (!t?.tierId || !(Number(t.quantity) > 0)) continue
    merged.set(String(t.tierId), (merged.get(String(t.tierId)) || 0) + Number(t.quantity))
  }
  return Array.from(merged.entries()).map(([tierId, quantity]) => ({ tierId, quantity }))
}

async function resolveRequest(
  eventId: string,
  quantity: number,
  tierIncrements: TierSoldIncrement[],
  logPrefix: string
): Promise<Resolution> {
  const qty = Number(quantity)
  if (!eventId || !Number.isFinite(qty) || qty <= 0) return { kind: 'nothing' }
  const tiers = mergeTierIncrements(tierIncrements)
  // Seats are whole. A fractional count is how a 0.01-ticket order got a full ticket.
  if (!Number.isInteger(qty) || tiers.some((t) => !Number.isInteger(Number(t.quantity)))) {
    console.error(`${logPrefix} refusing to reserve a non-integer quantity`, { eventId, quantity: qty })
    return { kind: 'refused', outcome: { ok: false, reason: 'invalid_quantity', requested: qty } }
  }

  const [eventSnap, ...tierSnaps] = await Promise.all([
    adminDb.collection('events').doc(String(eventId)).get(),
    ...tiers.map((t) => adminDb.collection('ticket_tiers').doc(String(t.tierId)).get()),
  ])
  const q: Qty = { [EVENT_BUCKET]: qty }
  const caps: Record<string, number | null> = {
    [EVENT_BUCKET]: eventCapacityOf(eventSnap?.exists ? eventSnap.data() : null),
  }
  for (let i = 0; i < tiers.length; i++) {
    const snap = tierSnaps[i]
    // A tier with no doc has nothing to count against (and must never be conjured).
    if (!snap?.exists) continue
    const tier = snap.data() || {}
    const tierEventId = tier.event_id ?? tier.eventId
    if (tierEventId != null && String(tierEventId) !== String(eventId)) {
      return {
        kind: 'refused',
        outcome: { ok: false, reason: 'tier_mismatch', tierId: tiers[i].tierId, requested: tiers[i].quantity },
      }
    }
    const key = tierBucket(tiers[i].tierId)
    q[key] = tiers[i].quantity
    caps[key] = tierCapacityOf(tier)
  }
  return { kind: 'request', req: { eventId: String(eventId), q, caps } }
}

function refusalFor(key: string, remaining: number, requested: number): ReserveOutcome {
  return key === EVENT_BUCKET
    ? { ok: false, reason: 'event_capacity', remaining: Math.max(0, remaining), requested }
    : {
        ok: false,
        reason: 'tier_capacity',
        tierId: key.slice(2),
        remaining: Math.max(0, remaining),
        requested,
      }
}

// ── placement ────────────────────────────────────────────────────────────────

interface Placement {
  req: ResolvedRequest
  reservationId: string
  mode: 'hold' | 'sold'
  expiresAt: number | null
  source: string | null
  owner: string | null
}

function reservationDoc(p: Placement, shard: number, prior: Record<string, any> | null) {
  const now = new Date().toISOString()
  return {
    event_id: p.req.eventId,
    shard,
    q: p.req.q,
    state: (p.mode === 'hold' ? 'held' : 'sold') as ReservationState,
    // Range-queried by the sweep; null once the reservation is no longer a hold.
    hold_expires_at: p.mode === 'hold' ? p.expiresAt : null,
    expires_at: p.mode === 'hold' ? p.expiresAt : null,
    source: p.source ?? prior?.source ?? null,
    owner: p.owner ?? prior?.owner ?? null,
    created_at: prior?.created_at || now,
    ...(p.mode === 'sold' ? { sold_at: now, rollup_pending: true, rollup_pending_at: Date.now() } : {}),
    updated_at: now,
  }
}

const targetState = (mode: 'hold' | 'sold'): ReservationState => (mode === 'hold' ? 'held' : 'sold')

type FastResult =
  | { kind: 'ok'; shard: number }
  | { kind: 'done'; prior: Record<string, any> }
  | { kind: 'full' }
  | { kind: 'resync' }

/** One shard, one transaction: the common case. */
async function fastPathTx(p: Placement, index: number): Promise<FastResult> {
  const { req, reservationId } = p
  const sRef = shardRef(req.eventId, index)
  const rRef = reservationRef(reservationId)
  return adminDb.runTransaction(
    async (tx: any) => {
      const [rSnap, sSnap] = await Promise.all([tx.get(rRef), tx.get(sRef)])
      const prior = rSnap.exists ? rSnap.data() || {} : null
      if (prior && prior.state === targetState(p.mode)) return { kind: 'done', prior } as FastResult
      if (!sSnap.exists) return { kind: 'resync' } as FastResult
      const s = readShard(sSnap)
      for (const key of Object.keys(req.q)) {
        const b = s.b[key]
        const cap = req.caps[key] ?? null
        // Never sell from an allocation made for a different capacity (or none).
        if (!b || (b.cap ?? null) !== cap || (cap != null && b.alloc == null)) return { kind: 'resync' } as FastResult
      }
      const now = Date.now()
      pruneExpired(s, now)
      delete s.h[reservationId]
      for (const [key, n] of Object.entries(req.q)) {
        const b = s.b[key]
        if (b.alloc != null && shardUsed(s, key, now) + n > b.alloc) return { kind: 'full' } as FastResult
      }
      applyReservation(s, reservationId, req.q, p.mode, p.expiresAt)
      tx.set(sRef, shardDoc(s))
      tx.set(rRef, reservationDoc(p, index, prior))
      return { kind: 'ok', shard: index } as FastResult
    },
    { maxAttempts: 2 }
  )
}

type GlobalResult =
  | { kind: 'ok'; shard: number }
  | { kind: 'done'; prior: Record<string, any> }
  | { kind: 'refused'; outcome: ReserveOutcome }

/** All shards, one transaction: initialize, resync, refill a dry shard, or refuse exactly. */
async function globalPathTx(p: Placement): Promise<GlobalResult> {
  const { req, reservationId } = p
  const sRefs = Array.from({ length: INVENTORY_SHARD_COUNT }, (_, i) => shardRef(req.eventId, i))
  const rRef = reservationRef(reservationId)
  return adminDb.runTransaction(async (tx: any) => {
    const [rSnap, ...sSnaps] = await Promise.all([tx.get(rRef), ...sRefs.map((r) => tx.get(r))])
    const prior = rSnap.exists ? rSnap.data() || {} : null
    if (prior && prior.state === targetState(p.mode)) return { kind: 'done', prior } as GlobalResult
    const shards = sSnaps.map(readShard)
    const keys = Object.keys(req.q)

    // Buckets no shard has seen yet start from the legacy counters, read IN this
    // transaction so an increment landing concurrently is never lost.
    const missing = keys.filter((key) => !shards.some((s) => s.b[key]))
    if (missing.length > 0) {
      const legacyRefs = missing.map((key) =>
        key === EVENT_BUCKET
          ? adminDb.collection('events').doc(req.eventId)
          : adminDb.collection('ticket_tiers').doc(key.slice(2))
      )
      const legacySnaps = await Promise.all(legacyRefs.map((r) => tx.get(r)))
      missing.forEach((key, i) => {
        const data = legacySnaps[i]?.exists ? legacySnaps[i].data() || {} : {}
        const sold = nonNegInt(key === EVENT_BUCKET ? data.tickets_sold : data.sold_quantity)
        shards.forEach((s, k) => {
          s.b[key] = { cap: null, alloc: null, sold: k === 0 ? sold : 0 }
        })
      })
    }

    const now = Date.now()
    for (const s of shards) {
      pruneExpired(s, now)
      delete s.h[reservationId]
    }
    for (const key of keys) {
      const cap = req.caps[key] ?? null
      if (cap == null) continue
      const total = shards.reduce((sum, s) => sum + shardUsed(s, key, now), 0)
      if (total + req.q[key] > cap) {
        return { kind: 'refused', outcome: refusalFor(key, cap - total, req.q[key]) } as GlobalResult
      }
    }
    const target = Math.floor(Math.random() * shards.length)
    applyReservation(shards[target], reservationId, req.q, p.mode, p.expiresAt)
    rebalanceShards(shards, req.caps, keys, now)
    shards.forEach((s, i) => tx.set(sRefs[i], shardDoc(s)))
    tx.set(rRef, reservationDoc(p, target, prior))
    return { kind: 'ok', shard: target } as GlobalResult
  })
}

/**
 * A lock-free look at all shards: refuse a request that clearly cannot fit
 * without taking the global transaction. Only decides when every shard exists
 * and is allocated for the current capacity; otherwise returns null.
 */
async function snapshotRefusal(req: ResolvedRequest): Promise<ReserveOutcome | null> {
  const snaps = await Promise.all(
    Array.from({ length: INVENTORY_SHARD_COUNT }, (_, i) => shardRef(req.eventId, i).get())
  )
  if (snaps.some((s: any) => !s?.exists)) return null
  const shards = snaps.map(readShard)
  const now = Date.now()
  for (const [key, n] of Object.entries(req.q)) {
    const cap = req.caps[key] ?? null
    if (cap == null) continue
    if (shards.some((s) => (s.b[key]?.cap ?? null) !== cap)) return null
    const total = shards.reduce((sum, s) => sum + shardUsed(s, key, now), 0)
    if (total + n > cap) return refusalFor(key, cap - total, n)
  }
  return null
}

function okOutcome(p: Placement, prior: Record<string, any> | null, alreadyDone: boolean): ReserveOutcome {
  return {
    ok: true,
    reservationId: p.reservationId,
    expiresAt: p.mode === 'hold' ? (alreadyDone ? Number(prior?.expires_at) || null : p.expiresAt) : null,
    ...(alreadyDone ? { alreadyDone: true } : {}),
  }
}

async function place(p: Placement, logPrefix: string): Promise<ReserveOutcome> {
  let needGlobal = false
  let lastError: any = null
  const order = shuffledShardOrder()
  for (let i = 0; i < FAST_SHARD_TRIES && !needGlobal; i++) {
    try {
      const r = await fastPathTx(p, order[i])
      if (r.kind === 'ok') return okOutcome(p, null, false)
      if (r.kind === 'done') return okOutcome(p, r.prior, true)
      if (r.kind === 'resync') needGlobal = true
      // 'full': this shard's share is used up — try another.
    } catch (err) {
      lastError = err
      await sleep(backoffMs(i))
    }
  }

  if (!needGlobal) {
    try {
      const refusal = await snapshotRefusal(p.req)
      if (refusal) return refusal
    } catch (err) {
      lastError = err
    }
  }

  for (let attempt = 0; attempt < TX_ATTEMPTS; attempt++) {
    try {
      const r = await globalPathTx(p)
      if (r.kind === 'ok') return okOutcome(p, null, false)
      if (r.kind === 'done') return okOutcome(p, r.prior, true)
      return r.outcome
    } catch (err) {
      lastError = err
      if (attempt < TX_ATTEMPTS - 1) await sleep(backoffMs(attempt + 1))
    }
  }
  console.error(`${logPrefix} inventory reservation could not be confirmed (contention); refusing`, {
    eventId: p.req.eventId,
    reservationId: p.reservationId,
    message: lastError?.message,
  })
  return { ok: false, reason: 'busy' }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Reserve seats atomically: a HOLD (counts against availability until
 * `expiresAt`) or an immediate SALE. Idempotent per reservation id: retrying a
 * reservation that already reached the requested state returns ok with
 * `alreadyDone`.
 */
export async function reserveSeats(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  mode: 'hold' | 'sold'
  reservationId: string
  /** Required for mode 'hold': hold expiry, ms since epoch. */
  expiresAt?: number | null
  source?: string | null
  /** Who the hold is for (audit only). */
  owner?: string | null
  logPrefix?: string
}): Promise<ReserveOutcome> {
  const logPrefix = params.logPrefix || '[inventory]'
  const resolved = await resolveRequest(params.eventId, params.quantity, params.tierIncrements, logPrefix)
  if (resolved.kind === 'nothing') return { ok: true }
  if (resolved.kind === 'refused') return resolved.outcome
  const outcome = await place(
    {
      req: resolved.req,
      reservationId: params.reservationId,
      mode: params.mode,
      expiresAt: params.mode === 'hold' ? Number(params.expiresAt) : null,
      source: params.source ?? null,
      owner: params.owner ?? null,
    },
    logPrefix
  )
  if (outcome.ok && params.mode === 'sold' && !outcome.alreadyDone) await scheduleRollup(resolved.req.eventId, logPrefix)
  return outcome
}

const covers = (held: Qty | undefined, want: Qty) =>
  Object.entries(want).every(([key, n]) => nonNegInt(held?.[key]) >= n)

type InPlaceResult = { kind: 'ok' } | { kind: 'done' } | { kind: 'fresh' } | { kind: 'release_first' }

/**
 * Turn a paid order's seats into sold seats. The order's live hold converts in
 * place (one shard transaction, no capacity re-check needed: the seats were
 * already counted). When there is no usable hold — it expired, or the order
 * predates seat holds — the seats are reserved fresh, atomically, against the
 * capacity; a truly sold-out event refuses and the caller refunds.
 *
 * Idempotent per reservation id, so a webhook redelivery or a callback retry
 * never counts the order twice. `reason: 'busy'` means nothing changed and the
 * caller must retry later — never issue tickets on it.
 */
export async function convertHeldSeats(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  reservationId: string
  source?: string | null
  logPrefix?: string
}): Promise<ReserveOutcome> {
  const logPrefix = params.logPrefix || '[inventory]'
  const { reservationId } = params
  const resolved = await resolveRequest(params.eventId, params.quantity, params.tierIncrements, logPrefix)
  if (resolved.kind === 'nothing') return { ok: true }
  if (resolved.kind === 'refused') return resolved.outcome
  const req = resolved.req

  let inPlace: InPlaceResult | null = null
  for (let attempt = 0; attempt < TX_ATTEMPTS && !inPlace; attempt++) {
    try {
      inPlace = await adminDb.runTransaction(async (tx: any) => {
        const rRef = reservationRef(reservationId)
        const rSnap = await tx.get(rRef)
        if (!rSnap.exists) return { kind: 'fresh' } as InPlaceResult
        const prior = rSnap.data() || {}
        if (prior.state === 'sold') return { kind: 'done' } as InPlaceResult
        if (prior.state !== 'held' || String(prior.event_id) !== req.eventId) return { kind: 'fresh' } as InPlaceResult
        const index = Number(prior.shard)
        const sRef = shardRef(req.eventId, index)
        const s = readShard(await tx.get(sRef))
        const hold = s.h[reservationId]
        const now = Date.now()
        if (!hold) return { kind: 'fresh' } as InPlaceResult
        if (!(Number(hold.exp) > now) || !covers(hold.q, req.q)) return { kind: 'release_first' } as InPlaceResult
        delete s.h[reservationId]
        applyReservation(s, reservationId, req.q, 'sold', null)
        pruneExpired(s, now)
        tx.set(sRef, shardDoc(s))
        tx.set(
          rRef,
          {
            ...prior,
            q: req.q,
            state: 'sold',
            hold_expires_at: null,
            sold_at: new Date().toISOString(),
            rollup_pending: true,
            rollup_pending_at: Date.now(),
            updated_at: new Date().toISOString(),
          }
        )
        return { kind: 'ok' } as InPlaceResult
      })
    } catch (err: any) {
      if (attempt === TX_ATTEMPTS - 1) {
        console.error(`${logPrefix} hold conversion could not be confirmed (contention)`, {
          reservationId,
          message: err?.message,
        })
        return { ok: false, reason: 'busy' }
      }
      await sleep(backoffMs(attempt))
    }
  }

  if (inPlace?.kind === 'ok' || inPlace?.kind === 'done') {
    if (inPlace.kind === 'ok') await scheduleRollup(req.eventId, logPrefix)
    return { ok: true, reservationId, ...(inPlace.kind === 'done' ? { alreadyDone: true } : {}) }
  }
  if (inPlace?.kind === 'release_first') {
    // An expired (or smaller) hold: drop it, then reserve the order's seats fresh.
    const released = await releaseSeats({ reservationId, onlyHeld: true, logPrefix })
    if (released.error) return { ok: false, reason: 'busy' }
    console.warn(`${logPrefix} seat hold expired before payment completed; reserving fresh`, { reservationId })
  }
  const outcome = await place(
    { req, reservationId, mode: 'sold', expiresAt: null, source: params.source ?? null, owner: null },
    logPrefix
  )
  if (outcome.ok && !outcome.alreadyDone) await scheduleRollup(req.eventId, logPrefix)
  return outcome
}

/**
 * Give seats back. A hold is dropped; a sale is decremented (all of it, or the
 * given partial quantity — e.g. tickets that were reserved but never issued).
 * Idempotent: releasing an already released / expired reservation is a no-op.
 */
export async function releaseSeats(params: {
  reservationId: string
  /** Partial release of a sale: seats for the event bucket … */
  quantity?: number
  /** … and per tier. Omit both to release everything. */
  tierIncrements?: TierSoldIncrement[]
  /** Only release a HOLD (never a sale): checkout cancel / abandon paths. */
  onlyHeld?: boolean
  /** Sweep: mark a hold expired, and only if it really has expired. */
  markExpired?: boolean
  logPrefix?: string
}): Promise<{ released: boolean; state?: ReservationState; error?: string }> {
  const logPrefix = params.logPrefix || '[inventory]'
  const { reservationId } = params
  if (!reservationId) return { released: false }
  const partial = params.quantity != null || (params.tierIncrements && params.tierIncrements.length > 0)
  const dec: Qty | null = partial
    ? {
        [EVENT_BUCKET]: nonNegInt(params.quantity),
        ...Object.fromEntries(mergeTierIncrements(params.tierIncrements).map((t) => [tierBucket(t.tierId), t.quantity])),
      }
    : null

  let lastError: any = null
  for (let attempt = 0; attempt < TX_ATTEMPTS; attempt++) {
    try {
      const result = await adminDb.runTransaction(async (tx: any) => {
        const rRef = reservationRef(reservationId)
        const rSnap = await tx.get(rRef)
        if (!rSnap.exists) return { released: false }
        const prior = rSnap.data() || {}
        const state = String(prior.state) as ReservationState
        const now = Date.now()
        if (state !== 'held' && state !== 'sold') return { released: false, state }
        if (params.onlyHeld && state !== 'held') return { released: false, state }
        if (params.markExpired && (state !== 'held' || Number(prior.expires_at) > now)) return { released: false, state }
        const sRef = shardRef(String(prior.event_id), Number(prior.shard))
        const s = readShard(await tx.get(sRef))
        const nowIso = new Date().toISOString()
        let next: Record<string, any>
        if (state === 'held') {
          delete s.h[reservationId]
          next = { state: params.markExpired ? 'expired' : 'released', hold_expires_at: null, released_at: nowIso }
        } else {
          const held: Qty = prior.q || {}
          const remaining: Qty = {}
          for (const [key, n] of Object.entries(held)) {
            const take = Math.min(nonNegInt(n), dec ? nonNegInt(dec[key]) : nonNegInt(n))
            const b = s.b[key]
            if (b) s.b[key] = { ...b, sold: Math.max(0, nonNegInt(b.sold) - take) }
            if (nonNegInt(n) - take > 0) remaining[key] = nonNegInt(n) - take
          }
          const fully = Object.keys(remaining).length === 0
          next = {
            state: fully ? 'released' : 'sold',
            q: remaining,
            ...(fully ? { released_at: nowIso } : {}),
            rollup_pending: true,
            rollup_pending_at: Date.now(),
          }
        }
        pruneExpired(s, now)
        tx.set(sRef, shardDoc(s))
        tx.set(rRef, { ...prior, ...next, updated_at: nowIso })
        return { released: true, state: next.state as ReservationState, eventId: String(prior.event_id), sold: state === 'sold' }
      })
      if ((result as any).sold) await scheduleRollup((result as any).eventId, logPrefix)
      return { released: result.released, state: (result as any).state }
    } catch (err) {
      lastError = err
      if (attempt < TX_ATTEMPTS - 1) await sleep(backoffMs(attempt))
    }
  }
  console.error(`${logPrefix} could not release seats`, { reservationId, message: lastError?.message })
  return { released: false, error: String(lastError?.message || 'release_failed') }
}

/**
 * Write the shards' sold totals back to `events.tickets_sold` and each tier's
 * `sold_quantity`, the fields every page and the payout code read. Lock-free
 * reads; a rollup racing another can briefly write an older total, which the
 * next one (or the sweep) corrects. Returns true when it wrote.
 */
export async function rollupInventoryCounters(
  eventId: string,
  opts: { minIntervalMs?: number; logPrefix?: string } = {}
): Promise<boolean> {
  const eventRef = adminDb.collection('events').doc(String(eventId))
  const eventSnap = await eventRef.get()
  if (!eventSnap?.exists) return false
  const last = Number(eventSnap.data()?.inventory_rollup_at_ms || 0)
  if (opts.minIntervalMs && Date.now() - last < opts.minIntervalMs) return false

  const snaps = await Promise.all(
    Array.from({ length: INVENTORY_SHARD_COUNT }, (_, i) => shardRef(String(eventId), i).get())
  )
  if (!snaps.some((s: any) => s?.exists)) return false
  const totals: Record<string, number> = {}
  for (const snap of snaps) {
    const s = readShard(snap)
    for (const [key, b] of Object.entries(s.b)) totals[key] = (totals[key] || 0) + nonNegInt(b?.sold)
  }

  const writes: Promise<unknown>[] = []
  writes.push(
    eventRef.update({
      ...(EVENT_BUCKET in totals ? { tickets_sold: totals[EVENT_BUCKET] } : {}),
      inventory_rollup_at_ms: Date.now(),
    })
  )
  for (const [key, sold] of Object.entries(totals)) {
    if (!key.startsWith('t_')) continue
    // update(), not set(): a tier deleted since must not be conjured back.
    writes.push(
      adminDb
        .collection('ticket_tiers')
        .doc(key.slice(2))
        .update({ sold_quantity: sold, updated_at: new Date().toISOString() })
        .catch(() => undefined)
    )
  }
  const results = await Promise.allSettled(writes)
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    console.warn(`${opts.logPrefix || '[inventory]'} display counter rollup partly failed`, {
      eventId,
      message: (failed[0] as PromiseRejectedResult).reason?.message,
    })
  }
  return true
}

/**
 * Best-effort, throttled rollup after a sale or release. Awaited (a serverless
 * function may be frozen once it responds) but never throws: the sale stands
 * either way and the sweep catches up.
 */
async function scheduleRollup(eventId: string, logPrefix: string): Promise<void> {
  try {
    await rollupInventoryCounters(eventId, { minIntervalMs: ROLLUP_MIN_INTERVAL_MS, logPrefix })
  } catch (err: any) {
    console.warn(`${logPrefix} display counter rollup failed (the sweep retries)`, { eventId, message: err?.message })
  }
}

/**
 * Cron sweep: mark expired holds expired (their seats were already free — this
 * just tidies the shard and the reservation doc), then roll up the display
 * counters of every event with a sale or release not yet rolled up.
 */
export async function sweepInventory(opts: { limit?: number; logPrefix?: string } = {}) {
  const limit = opts.limit ?? 300
  const logPrefix = opts.logPrefix || '[inventory_sweep]'
  const now = Date.now()
  const col = adminDb.collection(INVENTORY_RESERVATIONS_COLLECTION)

  let expired = 0
  const expiredSnap = await col.where('hold_expires_at', '<=', now).limit(limit).get()
  for (const doc of expiredSnap.docs) {
    const r = await releaseSeats({ reservationId: doc.id, markExpired: true, logPrefix })
    if (r.released) expired += 1
  }

  const pendingSnap = await col.where('rollup_pending', '==', true).limit(limit).get()
  const byEvent = new Map<string, Array<{ ref: any; at: number }>>()
  for (const doc of pendingSnap.docs) {
    const data = doc.data() || {}
    const eventId = String(data.event_id || '')
    if (!eventId) continue
    if (!byEvent.has(eventId)) byEvent.set(eventId, [])
    byEvent.get(eventId)!.push({ ref: doc.ref, at: Number(data.rollup_pending_at || 0) })
  }
  let rolledUp = 0
  for (const [eventId, docs] of byEvent) {
    try {
      await rollupInventoryCounters(eventId, { logPrefix })
      rolledUp += 1
    } catch (err: any) {
      console.warn(`${logPrefix} rollup failed`, { eventId, message: err?.message })
      continue
    }
    // Clear only flags that did not move since we read them: a change after
    // that read keeps its flag for the next sweep.
    for (const d of docs) {
      await adminDb
        .runTransaction(async (tx: any) => {
          const snap = await tx.get(d.ref)
          if (snap.exists && Number(snap.data()?.rollup_pending_at || 0) === d.at) {
            tx.update(d.ref, { rollup_pending: false })
          }
        })
        .catch(() => undefined)
    }
  }
  return { expired, rolledUp }
}

/** Live availability of one bucket (capacity minus sold and live holds), for diagnostics and tests. */
export async function availabilityOf(eventId: string, key: string): Promise<{ used: number; sold: number; held: number }> {
  const snaps = await Promise.all(
    Array.from({ length: INVENTORY_SHARD_COUNT }, (_, i) => shardRef(eventId, i).get())
  )
  const now = Date.now()
  let sold = 0
  let held = 0
  for (const snap of snaps) {
    const s = readShard(snap)
    sold += nonNegInt(s.b[key]?.sold)
    held += liveHeld(s, key, now)
  }
  return { used: sold + held, sold, held }
}
