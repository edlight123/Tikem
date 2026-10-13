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
 *   events.inventory_shards_n                the event's shard count, fixed when
 *                                             its shards are first created
 *
 * N is per event: ceil(capacity / 25), at least 20 and at most 100, so a big
 * event spreads its rush over more documents.
 *
 * WHY IT CANNOT OVERSELL: PER-SHARD CAPACITY ALLOCATION
 * -----------------------------------------------------
 * A capped bucket's capacity is SPLIT across the shards: shard k may hold or
 * sell at most `alloc_k`, and the allocations always add up to the capacity
 * they were made for (`cap`, snapshotted on every shard). Every transaction
 * that changes a shard keeps `sold_k + live holds_k <= alloc_k` and never
 * changes the sum of the allocations, so the total can never pass the capacity.
 *
 * Three transactions, from cheapest to rarest:
 *  1. HOT PATH — one shard doc + the reservation doc. Checks the shard's own
 *     room and places the hold / sale. Nothing else is read or written: no
 *     event or tier doc, no rollup, no abuse-cap bookkeeping.
 *  2. STEAL — the chosen shard is full: the same plus ONE donor shard. Moves
 *     part of the donor's spare allocation to the full shard (the sum is
 *     unchanged) and places the reservation there.
 *  3. GLOBAL — only when several donors had no spare (the last seats), the
 *     capacity on the event / tier doc changed since the shards were allocated
 *     (a shard whose `cap` snapshot differs is never used until then), or the
 *     event has no shards yet. Reads every shard IN INDEX ORDER (so concurrent
 *     global transactions take their locks in the same order and cannot
 *     deadlock), checks the true total, places the reservation and re-levels
 *     the allocations (`alloc_k = used_k + an even share of what is left`).
 * Firestore serializes every transaction on the documents it touches, so the
 * invariant holds across all three paths.
 *
 * Trade-off: the global path re-creates contention, but only for the last few
 * seats and on a capacity change. A request that is clearly sold out is
 * refused from a lock-free read of the shards before any global transaction.
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
 * conversion (throttled, outside any transaction) and by the sweep, never
 * written per sale. Eventually consistent, by seconds.
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

/** Default shard count (an event below 500 seats, or unlimited). */
export const INVENTORY_SHARD_COUNT = 20
export const MAX_INVENTORY_SHARDS = 100
/** Seats per shard the shard count aims for on a big event. */
const SEATS_PER_SHARD = 25
export const INVENTORY_SHARDS_SUBCOLLECTION = 'inventory_shards'
export const INVENTORY_RESERVATIONS_COLLECTION = 'inventory_reservations'
/** Per-buyer / per-network live-hold slots (lib/tickets/seatHolds.ts), freed with the hold. */
export const HOLD_LIMITS_COLLECTION = 'inventory_hold_limits'
/** The bucket every ticket of the event counts in. */
export const EVENT_BUCKET = '_event'
export const tierBucket = (tierId: string) => `t_${tierId}`

/** Hot-path shards tried before stealing. */
const FAST_SHARD_TRIES = 2
/** Donor shards tried before the global transaction. */
const STEAL_TRIES = 4
/** Attempts of the global / conversion / release transactions (each also retried by Firestore). */
const TX_ATTEMPTS = 4
/**
 * Attempts of a paid order's in-place hold conversion. More than a hold gets:
 * the buyer has paid, the transaction touches one shard, and giving up only
 * defers the order to a retry (webhook / reconcile cron).
 */
const CONVERT_ATTEMPTS = 8
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
  /** Abuse cap (seatHolds.ts): this buyer / network already holds too much for this event. */
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

/** Shards for a new event: ceil(capacity / 25), clamped to [20, 100]. */
export function shardCountForCapacity(capacity: number | null | undefined): number {
  const cap = Number(capacity)
  if (!Number.isFinite(cap) || cap <= 0) return INVENTORY_SHARD_COUNT
  return Math.min(MAX_INVENTORY_SHARDS, Math.max(INVENTORY_SHARD_COUNT, Math.ceil(cap / SEATS_PER_SHARD)))
}

/** The shard count stored on the event, if it has one. */
function storedShardCount(event: Record<string, any> | null | undefined): number | null {
  const n = Number(event?.inventory_shards_n)
  return Number.isInteger(n) && n >= 1 && n <= MAX_INVENTORY_SHARDS ? n : null
}

const shardsCol = (eventId: string) =>
  adminDb.collection('events').doc(eventId).collection(INVENTORY_SHARDS_SUBCOLLECTION)
const shardRef = (eventId: string, index: number) => shardsCol(eventId).doc(String(index))
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

/** Every existing shard of an event, lock-free (outside any transaction). */
async function listShards(eventId: string): Promise<Shard[]> {
  const snap = await shardsCol(eventId).get()
  return (snap.docs || []).map(readShard)
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

/** True when the shard's buckets for this request were allocated for the current capacities. */
function allocatedFor(s: Shard, q: Qty, caps: Record<string, number | null>): boolean {
  return Object.keys(q).every((key) => {
    const b = s.b[key]
    const cap = caps[key] ?? null
    return Boolean(b) && (b.cap ?? null) === cap && (cap == null || b.alloc != null)
  })
}

/** Seats of `key` this shard may still place (Infinity when unlimited). */
function spareOf(s: Shard, key: string, now: number): number {
  const alloc = s.b[key]?.alloc
  if (alloc == null) return Infinity
  return alloc - shardUsed(s, key, now)
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

function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
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
  /** The event's shard count. */
  n: number
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

/**
 * Validate the request and read the CURRENT capacities. These are plain reads
 * outside any transaction (they take no locks); a capacity edit that lands
 * between this read and the shard transaction is caught by the next request's
 * snapshot comparison.
 */
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
  const event = eventSnap?.exists ? eventSnap.data() || {} : null
  const q: Qty = { [EVENT_BUCKET]: qty }
  const caps: Record<string, number | null> = { [EVENT_BUCKET]: eventCapacityOf(event) }
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
  const sizing = caps[EVENT_BUCKET] ?? Math.max(0, ...Object.values(caps).map((c) => Number(c) || 0))
  const n = storedShardCount(event) ?? shardCountForCapacity(sizing)
  return { kind: 'request', req: { eventId: String(eventId), q, caps, n } }
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
  /** Abuse-cap slots this hold occupies (freed when it stops being a hold). */
  limitSlots: string[] | null
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
    limit_slots: p.limitSlots ?? prior?.limit_slots ?? [],
    created_at: prior?.created_at || now,
    ...(p.mode === 'sold' ? { sold_at: now, rollup_pending: true, rollup_pending_at: Date.now() } : {}),
    updated_at: now,
  }
}

const targetState = (mode: 'hold' | 'sold'): ReservationState => (mode === 'hold' ? 'held' : 'sold')

type ShardTxResult =
  | { kind: 'ok'; shard: number }
  | { kind: 'done'; prior: Record<string, any> }
  /** No room in this shard (fast) / not enough spare in the donor (steal). */
  | { kind: 'full' }
  | { kind: 'resync' }

/** HOT PATH: one shard, one transaction. */
async function fastPathTx(p: Placement, index: number): Promise<ShardTxResult> {
  const { req, reservationId } = p
  const sRef = shardRef(req.eventId, index)
  const rRef = reservationRef(reservationId)
  return adminDb.runTransaction(
    async (tx: any) => {
      const rSnap = await tx.get(rRef)
      const sSnap = await tx.get(sRef)
      const prior = rSnap.exists ? rSnap.data() || {} : null
      if (prior && prior.state === targetState(p.mode)) return { kind: 'done', prior } as ShardTxResult
      if (!sSnap.exists) return { kind: 'resync' } as ShardTxResult
      const s = readShard(sSnap)
      if (!allocatedFor(s, req.q, req.caps)) return { kind: 'resync' } as ShardTxResult
      const now = Date.now()
      pruneExpired(s, now)
      delete s.h[reservationId]
      for (const [key, n] of Object.entries(req.q)) {
        if (spareOf(s, key, now) < n) return { kind: 'full' } as ShardTxResult
      }
      applyReservation(s, reservationId, req.q, p.mode, p.expiresAt)
      tx.set(sRef, shardDoc(s))
      tx.set(rRef, reservationDoc(p, index, prior))
      return { kind: 'ok', shard: index } as ShardTxResult
    },
    { maxAttempts: 2 }
  )
}

/**
 * STEAL: the target shard is full, so move part of ONE donor shard's spare
 * allocation to it and place the reservation there. Two shards, one
 * transaction; the sum of the allocations is unchanged and both shards stay
 * within theirs. The donor gives what is missing plus half of the rest of its
 * spare, so the target does not run dry again on the very next buyer.
 */
async function stealTx(p: Placement, target: number, donor: number): Promise<ShardTxResult> {
  const { req, reservationId } = p
  const rRef = reservationRef(reservationId)
  const tRef = shardRef(req.eventId, target)
  const dRef = shardRef(req.eventId, donor)
  return adminDb.runTransaction(
    async (tx: any) => {
      const rSnap = await tx.get(rRef)
      // Lower index first: the same lock order as the global transaction.
      const [firstRef, secondRef] = target < donor ? [tRef, dRef] : [dRef, tRef]
      const firstSnap = await tx.get(firstRef)
      const secondSnap = await tx.get(secondRef)
      const [tSnap, dSnap] = target < donor ? [firstSnap, secondSnap] : [secondSnap, firstSnap]
      const prior = rSnap.exists ? rSnap.data() || {} : null
      if (prior && prior.state === targetState(p.mode)) return { kind: 'done', prior } as ShardTxResult
      if (!tSnap.exists || !dSnap.exists) return { kind: 'resync' } as ShardTxResult
      const t = readShard(tSnap)
      const d = readShard(dSnap)
      if (!allocatedFor(t, req.q, req.caps) || !allocatedFor(d, req.q, req.caps)) return { kind: 'resync' } as ShardTxResult
      const now = Date.now()
      pruneExpired(t, now)
      pruneExpired(d, now)
      delete t.h[reservationId]
      delete d.h[reservationId]
      const moves: Array<[string, number]> = []
      for (const [key, n] of Object.entries(req.q)) {
        const need = Math.max(0, n - spareOf(t, key, now))
        if (need === 0) continue
        const spare = spareOf(d, key, now)
        if (spare < need) return { kind: 'full' } as ShardTxResult
        moves.push([key, need + Math.floor((spare - need) / 2)])
      }
      for (const [key, m] of moves) {
        t.b[key] = { ...t.b[key], alloc: Number(t.b[key].alloc) + m }
        d.b[key] = { ...d.b[key], alloc: Number(d.b[key].alloc) - m }
      }
      applyReservation(t, reservationId, req.q, p.mode, p.expiresAt)
      tx.set(tRef, shardDoc(t))
      if (moves.length > 0) tx.set(dRef, shardDoc(d))
      tx.set(rRef, reservationDoc(p, target, prior))
      return { kind: 'ok', shard: target } as ShardTxResult
    },
    { maxAttempts: 2 }
  )
}

type GlobalResult =
  | { kind: 'ok'; shard: number }
  | { kind: 'done'; prior: Record<string, any> }
  | { kind: 'refused'; outcome: ReserveOutcome }

/** GLOBAL: all shards, one transaction: initialize, resync, last seats, or refuse exactly. */
async function globalPathTx(p: Placement): Promise<GlobalResult> {
  const { req, reservationId } = p
  const sRefs = Array.from({ length: req.n }, (_, i) => shardRef(req.eventId, i))
  const rRef = reservationRef(reservationId)
  return adminDb.runTransaction(async (tx: any) => {
    const rSnap = await tx.get(rRef)
    // Sequential, in index order: every global transaction locks the shards in
    // the same order, so two of them can never deadlock each other.
    const sSnaps: any[] = []
    for (const ref of sRefs) sSnaps.push(await tx.get(ref))
    const prior = rSnap.exists ? rSnap.data() || {} : null
    if (prior && prior.state === targetState(p.mode)) return { kind: 'done', prior } as GlobalResult
    const shards = sSnaps.map(readShard)
    const keys = Object.keys(req.q)
    const creating = sSnaps.some((s) => !s.exists)

    // Buckets no shard has seen yet start from the legacy counters, read IN this
    // transaction so an increment landing concurrently is never lost.
    const missing = keys.filter((key) => !shards.some((s) => s.b[key]))
    const eventRef = adminDb.collection('events').doc(req.eventId)
    let eventExists = false
    if (missing.length > 0 || creating) {
      const legacyKeys = missing.includes(EVENT_BUCKET) ? missing : [EVENT_BUCKET, ...missing]
      const legacySnaps: any[] = []
      for (const key of legacyKeys) {
        legacySnaps.push(
          await tx.get(key === EVENT_BUCKET ? eventRef : adminDb.collection('ticket_tiers').doc(key.slice(2)))
        )
      }
      eventExists = Boolean(legacySnaps[0]?.exists)
      legacyKeys.forEach((key, i) => {
        if (!missing.includes(key)) return
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
    // Fix the event's shard count the first time its shards are created.
    if (creating && eventExists) tx.set(eventRef, { inventory_shards_n: req.n }, { merge: true })
    return { kind: 'ok', shard: target } as GlobalResult
  })
}

/**
 * A lock-free look at all shards: refuse a request that clearly cannot fit
 * without taking the global transaction. Only decides when every shard exists
 * and is allocated for the current capacity; otherwise returns null.
 */
async function snapshotRefusal(req: ResolvedRequest): Promise<ReserveOutcome | null> {
  const shards = await listShards(req.eventId)
  if (shards.length < req.n) return null
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

/**
 * One global transaction per event at a time IN THIS PROCESS. Without it a cold
 * start (no shards yet) or a sell-out tail sends every concurrent buyer into
 * the all-shard transaction at once, and they queue on the same locks until
 * they time out. Queued buyers re-try the hot path first: the holder ahead of
 * them usually just created or refilled the shards. Correctness never depends
 * on this (other instances still serialize in Firestore); it only spares the
 * database a lock pile-up.
 */
const globalQueues = new Map<string, Promise<void>>()
async function withEventQueue<T>(eventId: string, fn: (waited: boolean) => Promise<T>): Promise<T> {
  const ahead = globalQueues.get(eventId)
  let release!: () => void
  const mine = new Promise<void>((resolve) => (release = resolve))
  const tail = (ahead || Promise.resolve()).then(() => mine)
  globalQueues.set(eventId, tail)
  if (ahead) await ahead
  try {
    return await fn(Boolean(ahead))
  } finally {
    release()
    if (globalQueues.get(eventId) === tail) globalQueues.delete(eventId)
  }
}

async function place(p: Placement, logPrefix: string): Promise<ReserveOutcome> {
  const n = p.req.n
  let needGlobal = false
  let lastError: any = null
  const order = shuffled(n)
  let fullShard: number | null = null

  for (let i = 0; i < Math.min(FAST_SHARD_TRIES, n) && !needGlobal; i++) {
    try {
      const r = await fastPathTx(p, order[i])
      if (r.kind === 'ok') return okOutcome(p, null, false)
      if (r.kind === 'done') return okOutcome(p, r.prior, true)
      if (r.kind === 'resync') needGlobal = true
      if (r.kind === 'full' && fullShard == null) fullShard = order[i]
    } catch (err) {
      lastError = err
      await sleep(backoffMs(i))
    }
  }

  if (!needGlobal && fullShard != null) {
    const donors = order.filter((i) => i !== fullShard).slice(FAST_SHARD_TRIES - 1, FAST_SHARD_TRIES - 1 + STEAL_TRIES)
    for (let i = 0; i < donors.length && !needGlobal; i++) {
      try {
        const r = await stealTx(p, fullShard, donors[i])
        if (r.kind === 'ok') return okOutcome(p, null, false)
        if (r.kind === 'done') return okOutcome(p, r.prior, true)
        if (r.kind === 'resync') needGlobal = true
        // 'full': that donor has no spare either — try another.
      } catch (err) {
        lastError = err
        await sleep(backoffMs(i))
      }
    }
  }

  // Lock-free and in parallel, BEFORE queueing: a sold-out rush is refused here
  // without waiting behind the buyers ahead.
  if (!needGlobal) {
    try {
      const refusal = await snapshotRefusal(p.req)
      if (refusal) return refusal
    } catch (err) {
      lastError = err
    }
  }

  const settled = await withEventQueue(p.req.eventId, async (waited): Promise<ReserveOutcome | null> => {
    if (waited) {
      // The buyer ahead may have just created / refilled the shards.
      try {
        const r = await fastPathTx(p, order[Math.floor(Math.random() * n)])
        if (r.kind === 'ok') return okOutcome(p, null, false)
        if (r.kind === 'done') return okOutcome(p, r.prior, true)
      } catch (err) {
        lastError = err
      }
      // …or just sold the last seats.
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
    return null
  })
  if (settled) return settled
  console.error(`${logPrefix} inventory reservation could not be confirmed (contention); refusing`, {
    eventId: p.req.eventId,
    reservationId: p.reservationId,
    message: lastError?.message,
  })
  return { ok: false, reason: 'busy' }
}

/** Free the abuse-cap slots a hold occupied. Best-effort; a stale slot only lives until its expiry. */
async function freeLimitSlots(reservationId: string, slots: unknown) {
  if (!Array.isArray(slots) || slots.length === 0) return
  await Promise.all(slots.map((parent) => releaseHoldLimit(String(parent), reservationId)))
}

/**
 * Take one slot of an abuse cap (seatHolds.ts) ATOMICALLY: a transaction on the
 * cap's own small doc `inventory_hold_limits/{limitId}` (never on a shard)
 * prunes expired entries, checks the live hold count and held seats, and only
 * then records this hold. Parallel requests from one buyer serialize on that
 * doc, so the cap holds under concurrency. 'busy' when contention outlasted
 * the retries (the caller refuses: nothing was held).
 */
export async function claimHoldLimit(params: {
  limitId: string
  reservationId: string
  seats: number
  expiresAt: number
  maxHolds: number
  maxSeats: number | null
}): Promise<'ok' | 'capped' | 'busy'> {
  const ref = adminDb.collection(HOLD_LIMITS_COLLECTION).doc(params.limitId)
  for (let attempt = 0; attempt < TX_ATTEMPTS; attempt++) {
    try {
      return await adminDb.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref)
        const now = Date.now()
        const live: Record<string, { exp: number; q: number }> = {}
        let seats = 0
        for (const [id, e] of Object.entries((snap.exists ? snap.data()?.h : null) || {})) {
          const entry = e as any
          if (Number(entry?.exp) > now && id !== params.reservationId) {
            live[id] = { exp: Number(entry.exp), q: nonNegInt(entry.q) }
            seats += nonNegInt(entry.q)
          }
        }
        if (Object.keys(live).length >= params.maxHolds) return 'capped' as const
        if (params.maxSeats != null && seats + params.seats > params.maxSeats) return 'capped' as const
        live[params.reservationId] = { exp: params.expiresAt, q: params.seats }
        tx.set(ref, { h: live, updated_at: new Date().toISOString() })
        return 'ok' as const
      })
    } catch {
      if (attempt < TX_ATTEMPTS - 1) await sleep(backoffMs(attempt))
    }
  }
  return 'busy'
}

/** Give a cap slot back (hold released / converted / expired, or the hold was refused). Never throws. */
export async function releaseHoldLimit(limitId: string, reservationId: string): Promise<void> {
  const ref = adminDb.collection(HOLD_LIMITS_COLLECTION).doc(limitId)
  for (let attempt = 0; attempt < TX_ATTEMPTS; attempt++) {
    try {
      await adminDb.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref)
        const h = { ...((snap.exists ? snap.data()?.h : null) || {}) }
        if (!(reservationId in h)) return
        delete h[reservationId]
        tx.set(ref, { h, updated_at: new Date().toISOString() })
      })
      return
    } catch {
      if (attempt < TX_ATTEMPTS - 1) await sleep(backoffMs(attempt))
    }
  }
  // A slot left behind stops counting at its expiry.
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
  /** Abuse-cap slots (seatHolds.ts) to free when the hold ends. */
  limitSlots?: string[] | null
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
      limitSlots: params.limitSlots ?? null,
    },
    logPrefix
  )
  if (outcome.ok && params.mode === 'sold' && !outcome.alreadyDone) await scheduleRollup(resolved.req.eventId, logPrefix)
  return outcome
}

const covers = (held: Qty | undefined, want: Qty) =>
  Object.entries(want).every(([key, n]) => nonNegInt(held?.[key]) >= n)

type InPlaceResult =
  | { kind: 'ok'; slots: unknown }
  | { kind: 'done' }
  | { kind: 'fresh' }
  | { kind: 'release_first' }

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
  for (let attempt = 0; attempt < CONVERT_ATTEMPTS && !inPlace; attempt++) {
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
        tx.set(rRef, {
          ...prior,
          q: req.q,
          state: 'sold',
          hold_expires_at: null,
          sold_at: new Date().toISOString(),
          rollup_pending: true,
          rollup_pending_at: Date.now(),
          updated_at: new Date().toISOString(),
        })
        return { kind: 'ok', slots: prior.limit_slots } as InPlaceResult
      })
    } catch (err: any) {
      if (attempt === CONVERT_ATTEMPTS - 1) {
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
    if (inPlace.kind === 'ok') {
      await freeLimitSlots(reservationId, inPlace.slots)
      await scheduleRollup(req.eventId, logPrefix)
    }
    return { ok: true, reservationId, ...(inPlace.kind === 'done' ? { alreadyDone: true } : {}) }
  }
  if (inPlace?.kind === 'release_first') {
    // An expired (or smaller) hold: drop it, then reserve the order's seats fresh.
    const released = await releaseSeats({ reservationId, onlyHeld: true, logPrefix })
    if (released.error) return { ok: false, reason: 'busy' }
    console.warn(`${logPrefix} seat hold expired before payment completed; reserving fresh`, { reservationId })
  }
  const outcome = await place(
    { req, reservationId, mode: 'sold', expiresAt: null, source: params.source ?? null, owner: null, limitSlots: null },
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
      const result: any = await adminDb.runTransaction(async (tx: any) => {
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
        return {
          released: true,
          state: next.state as ReservationState,
          eventId: String(prior.event_id),
          sold: state === 'sold',
          slots: state === 'held' ? prior.limit_slots : null,
        }
      })
      if (result.slots) await freeLimitSlots(reservationId, result.slots)
      if (result.sold) await scheduleRollup(result.eventId, logPrefix)
      return { released: result.released, state: result.state }
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
 * reads, never inside a reservation transaction; a rollup racing another can
 * briefly write an older total, which the next one (or the sweep) corrects.
 * Returns true when it wrote.
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

  const shards = await listShards(String(eventId))
  if (shards.length === 0) return false
  const totals: Record<string, number> = {}
  for (const s of shards) {
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
  // In-process throttle first: in a rush every conversion would otherwise read
  // the event doc and many would roll up at once (each reading every shard and
  // writing the event doc). One rollup per event per interval per instance.
  const last = lastRollupAt.get(eventId) || 0
  if (Date.now() - last < ROLLUP_MIN_INTERVAL_MS) return
  lastRollupAt.set(eventId, Date.now())
  try {
    await rollupInventoryCounters(eventId, { minIntervalMs: ROLLUP_MIN_INTERVAL_MS, logPrefix })
  } catch (err: any) {
    console.warn(`${logPrefix} display counter rollup failed (the sweep retries)`, { eventId, message: err?.message })
  }
}
const lastRollupAt = new Map<string, number>()

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

/** True once the event's seat inventory lives in shards (then `tickets_sold` is a rollup, not a source). */
export async function eventHasInventoryShards(eventId: string): Promise<boolean> {
  const snap = await shardsCol(String(eventId)).limit(1).get()
  return (snap.docs || []).length > 0
}

/**
 * Admin repair (scripts/reseed-inventory-shards.ts): make the shards' SOLD
 * counts equal the given totals — normally recounted from the live tickets, e.g.
 * after a rollback ran old code that moved `tickets_sold` behind the shards'
 * back. Live holds are kept. Every bucket's allocation is then re-levelled for
 * the current capacities in the same transaction, so the invariant holds.
 * `dryRun` (default) computes and returns the change without writing.
 */
export async function reseedInventoryShards(
  eventId: string,
  soldTotals: { event: number; tiers: Record<string, number> },
  opts: { dryRun?: boolean } = {}
): Promise<{ before: Record<string, number>; after: Record<string, number>; shards: number; written: boolean }> {
  const dryRun = opts.dryRun !== false
  const eventRef = adminDb.collection('events').doc(String(eventId))
  return adminDb.runTransaction(async (tx: any) => {
    const eventSnap = await tx.get(eventRef)
    const event = eventSnap.exists ? eventSnap.data() || {} : null
    const tierIds = Object.keys(soldTotals.tiers || {})
    const tierSnaps: any[] = []
    for (const id of tierIds) tierSnaps.push(await tx.get(adminDb.collection('ticket_tiers').doc(id)))
    const caps: Record<string, number | null> = { [EVENT_BUCKET]: eventCapacityOf(event) }
    const target: Record<string, number> = { [EVENT_BUCKET]: nonNegInt(soldTotals.event) }
    tierIds.forEach((id, i) => {
      if (!tierSnaps[i]?.exists) return
      caps[tierBucket(id)] = tierCapacityOf(tierSnaps[i].data())
      target[tierBucket(id)] = nonNegInt(soldTotals.tiers[id])
    })
    const sizing = caps[EVENT_BUCKET] ?? Math.max(0, ...Object.values(caps).map((c) => Number(c) || 0))
    const n = storedShardCount(event) ?? shardCountForCapacity(sizing)
    const refs = Array.from({ length: n }, (_, i) => shardRef(String(eventId), i))
    const shards: Shard[] = []
    for (const ref of refs) shards.push(readShard(await tx.get(ref)))

    const before: Record<string, number> = {}
    for (const s of shards) for (const [k, b] of Object.entries(s.b)) before[k] = (before[k] || 0) + nonNegInt(b.sold)
    const now = Date.now()
    for (const [key, sold] of Object.entries(target)) {
      shards.forEach((s, i) => {
        const b = s.b[key] || { cap: null, alloc: null, sold: 0 }
        s.b[key] = { ...b, sold: i === 0 ? sold : 0 }
      })
    }
    for (const s of shards) pruneExpired(s, now)
    rebalanceShards(shards, caps, Object.keys(target), now)
    // A total already above the capacity is recorded as is. Its allocations
    // cannot add up to the capacity, so they are marked stale (cap -1): no
    // shard sells from them, and only the global transaction (which checks the
    // true total) places anything until the total is back under the capacity.
    for (const key of Object.keys(target)) {
      const cap = caps[key] ?? null
      if (cap == null) continue
      const used = shards.reduce((sum, s) => sum + shardUsed(s, key, now), 0)
      if (used > cap) for (const s of shards) s.b[key] = { ...s.b[key], cap: -1 }
    }
    if (!dryRun) {
      shards.forEach((s, i) => tx.set(refs[i], shardDoc(s)))
      if (event) tx.set(eventRef, { inventory_shards_n: n }, { merge: true })
    }
    return { before, after: target, shards: n, written: !dryRun }
  })
}

/** Sold, live-held and allocated seats of one bucket across all shards (diagnostics, tests, audits). */
export async function availabilityOf(
  eventId: string,
  key: string
): Promise<{ used: number; sold: number; held: number; shards: number; alloc: number | null }> {
  const shards = await listShards(eventId)
  const now = Date.now()
  let sold = 0
  let held = 0
  let alloc: number | null = 0
  for (const s of shards) {
    sold += nonNegInt(s.b[key]?.sold)
    held += liveHeld(s, key, now)
    const a = s.b[key]?.alloc
    alloc = a == null || alloc == null ? null : alloc + a
  }
  return { used: sold + held, sold, held, shards: shards.length, alloc }
}
