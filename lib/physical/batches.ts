/**
 * Printed (physical) tickets: the server side. Admin SDK only.
 *
 * Lifecycle of a batch (physical_batches/{batchId}):
 *   awaiting_payment  ordered; its seats are already reserved on the sharded
 *                     inventory (reservation phys_{batchId}, mode 'sold') so
 *                     online sales cannot sell them meanwhile
 *   paid              paid upfront (MonCash or card on the platform account);
 *                     the N tickets are created as `printed_unsold`
 *   printing          Tikèm prints them (admin downloads the PDF)
 *   ready             picked up / delivered
 *   active            selling (first activation flips it, or the admin does)
 *   cancelled         never paid (or expired after PAYMENT_WINDOW_MS, or
 *                     cancelled before printing); seats given back. A payment
 *                     that lands on a cancelled batch is recorded and the batch
 *                     is flagged needs_refund for the print room.
 *
 * Rules (pure) live in ./rules.ts; prices in ./config.ts.
 */

import crypto from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { releaseSeats, reserveSeats } from '@/lib/tickets/inventoryShards'
import {
  DEFAULT_PHYSICAL_CONFIG,
  PHYSICAL_CONFIG_COLLECTION,
  PHYSICAL_CONFIG_DOC,
  normalizeStoredConfig,
  quoteBatch,
  type PhysicalTicketsConfig,
} from './config'
import {
  PHYSICAL_BATCHES,
  PHYSICAL_KIND,
  activationPatch,
  activationRefusal,
  canMoveBatch,
  formatSerial,
  normalizeSerial,
  parsePhysicalQr,
  physicalQrPayload,
  physicalReservationId,
  physicalTicketId,
  PAYMENT_WINDOW_MS,
  serialPrefix,
  tallyPhysical,
  batchHeldSeats,
  tokenFromBytes,
  validRange,
  type ActivationActor,
  type ActivationInput,
  type ActivationRefusal,
  type BatchCounts,
  type BatchStatus,
  type SerialRange,
} from './rules'

export const PHYSICAL_BATCH_ORDERS = 'physical_batch_orders'
const WRITE_CHUNK = 400

export function newPhysicalToken(): string {
  return tokenFromBytes(crypto.randomBytes(16))
}

// ── config ───────────────────────────────────────────────────────────────────

export async function loadPhysicalConfig(): Promise<PhysicalTicketsConfig> {
  try {
    const snap = await adminDb.collection(PHYSICAL_CONFIG_COLLECTION).doc(PHYSICAL_CONFIG_DOC).get()
    return snap.exists ? normalizeStoredConfig(snap.data()) : { ...DEFAULT_PHYSICAL_CONFIG }
  } catch (err: any) {
    console.error('[physical] config read failed; using defaults', { message: err?.message })
    return { ...DEFAULT_PHYSICAL_CONFIG }
  }
}

export async function savePhysicalConfig(value: PhysicalTicketsConfig, admin: { uid: string; email: string | null }) {
  const nowIso = new Date().toISOString()
  const ref = adminDb.collection(PHYSICAL_CONFIG_COLLECTION).doc(PHYSICAL_CONFIG_DOC)
  const before = await ref.get()
  await ref.set({
    enabled: value.enabled,
    minBatch: value.minBatch,
    maxBatch: value.maxBatch,
    tiers: value.tiers,
    displayPrices: value.displayPrices ?? null,
    updated_at: nowIso,
    updated_by: admin.uid,
    updated_by_email: admin.email,
  })
  // A change history next to the config (the admin audit log gets one too).
  await ref.collection('history').add({
    before: before.exists ? before.data() : null,
    after: value,
    changed_by: admin.uid,
    changed_by_email: admin.email,
    changed_at: nowIso,
  })
  return { ...value, updated_at: nowIso, updated_by: admin.uid, updated_by_email: admin.email }
}

// ── batches ──────────────────────────────────────────────────────────────────

export type PayMethod = 'moncash' | 'card' | 'balance'
export type FundsRail = 'moncash' | 'stripe_platform' | 'balance_offset'
export const PHYSICAL_BATCH_SEQ = 'physical_batch_seq'

/**
 * Allocate this batch's sequence within the event (counter doc, transaction)
 * and make sure no other batch of the event already uses the prefix, so two
 * batches of the same tier never print the same serial (FETE-VIP-B1-0001 vs
 * FETE-VIP-B2-0001).
 */
async function allocateSerialPrefix(eventId: string, eventTitle: string, tierName: string): Promise<{ seq: number; prefix: string }> {
  const counterRef = adminDb.collection(PHYSICAL_BATCH_SEQ).doc(eventId)
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq: number = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(counterRef)
      const next = Math.max(1, Math.round(Number(snap.exists ? snap.data()?.next : 1) || 1))
      tx.set(counterRef, { next: next + 1, updated_at: new Date().toISOString() }, { merge: true })
      return next
    })
    const prefix = serialPrefix(eventTitle, tierName, seq)
    const clash = await adminDb
      .collection(PHYSICAL_BATCHES)
      .where('event_id', '==', eventId)
      .where('serial_prefix', '==', prefix)
      .limit(1)
      .get()
    if (clash.empty) return { seq, prefix }
  }
  throw new Error('Could not allocate a unique serial prefix')
}

export interface BatchDoc {
  id: string
  event_id: string
  organizer_id: string
  event_title: string
  tier_id: string
  tier_name: string
  quantity: number
  serial_prefix: string
  unit_price_htg: number
  total_htg: number
  status: BatchStatus
  reservation_id: string
  payment: Record<string, any>
  assignments: Array<{ uid: string; name: string; from: number; to: number; assigned_at: string }>
  seller_uids: string[]
  voided_ranges: Array<{ from: number; to: number; count: number; at: string; by: string; reason: string | null }>
  released_count: number
  reprint_count: number
  tickets_issued: number
  created_by: string
  created_at: string
  updated_at: string
  [k: string]: any
}

export type CreateBatchResult =
  | { ok: true; batch: BatchDoc }
  | { ok: false; status: number; code: string; error: string; remaining?: number | null }

/**
 * Order a batch: price it from the LIVE config, reserve its seats, write the
 * batch as awaiting payment. Nothing is printed or issued before payment.
 */
export async function createBatch(params: {
  eventId: string
  event: Record<string, any>
  orgId: string
  tierId: string
  quantity: number
  method: PayMethod
  createdBy: string
}): Promise<CreateBatchResult> {
  const config = await loadPhysicalConfig()
  const quote = quoteBatch(config, Math.round(Number(params.quantity)))
  if (!quote.ok) {
    const msg =
      quote.code === 'disabled'
        ? 'Printed tickets are not available right now.'
        : quote.code === 'below_minimum'
          ? `The minimum batch is ${quote.minBatch} tickets.`
          : quote.code === 'above_maximum'
            ? `The maximum batch is ${quote.maxBatch} tickets.`
            : 'Enter a whole number of tickets.'
    return { ok: false, status: 400, code: quote.code, error: msg }
  }

  const tierSnap = await adminDb.collection('ticket_tiers').doc(params.tierId).get()
  const tier = tierSnap.exists ? tierSnap.data() || {} : null
  if (!tier || String(tier.event_id || tier.eventId || '') !== params.eventId) {
    return { ok: false, status: 400, code: 'tier_not_found', error: 'Choose a ticket type of this event.' }
  }

  const ref = adminDb.collection(PHYSICAL_BATCHES).doc()
  const reservationId = physicalReservationId(ref.id)
  const reservation = await reserveSeats({
    eventId: params.eventId,
    quantity: quote.quantity,
    tierIncrements: [{ tierId: params.tierId, quantity: quote.quantity }],
    mode: 'sold',
    reservationId,
    source: 'physical_batch',
    owner: params.orgId,
    logPrefix: '[physical]',
  })
  if (!reservation.ok) {
    if (reservation.reason === 'busy') {
      return { ok: false, status: 503, code: 'busy', error: 'Ticket sales are busy right now. Try again in a moment.' }
    }
    return {
      ok: false,
      status: 409,
      code: reservation.reason || 'capacity',
      error: `Not enough seats left in this ticket type${reservation.remaining != null ? ` (${reservation.remaining} left)` : ''}.`,
      remaining: reservation.remaining ?? null,
    }
  }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const tierName = String(tier.name || 'Ticket')
  let serial: { seq: number; prefix: string }
  try {
    serial = await allocateSerialPrefix(params.eventId, String(params.event?.title || ''), tierName)
  } catch (err) {
    await releaseSeats({ reservationId, logPrefix: '[physical]' })
    throw err
  }
  const rail: FundsRail = params.method === 'moncash' ? 'moncash' : params.method === 'balance' ? 'balance_offset' : 'stripe_platform'
  const batch: BatchDoc = {
    id: ref.id,
    event_id: params.eventId,
    organizer_id: params.orgId,
    event_title: String(params.event?.title || ''),
    tier_id: params.tierId,
    tier_name: tierName,
    tier_price: Number(tier.price) || 0,
    currency: String(params.event?.currency || 'HTG').toUpperCase(),
    quantity: quote.quantity,
    serial_prefix: serial.prefix,
    batch_seq: serial.seq,
    unit_price_htg: quote.unitPriceHtg,
    total_htg: quote.totalHtg,
    status: 'awaiting_payment',
    reservation_id: reservationId,
    payment: { method: params.method, funds_rail: rail, status: 'pending' },
    // Unpaid, the seats come back after this (the inventory sweep cancels it).
    payment_expires_at: new Date(now + PAYMENT_WINDOW_MS).toISOString(),
    assignments: [],
    seller_uids: [],
    voided_ranges: [],
    released_count: 0,
    reprint_count: 0,
    tickets_issued: 0,
    created_by: params.createdBy,
    created_at: nowIso,
    updated_at: nowIso,
  }
  try {
    await ref.set(batch)
  } catch (err) {
    await releaseSeats({ reservationId, logPrefix: '[physical]' })
    throw err
  }
  return { ok: true, batch }
}

export async function getBatch(batchId: string): Promise<BatchDoc | null> {
  if (!batchId || batchId.includes('/')) return null
  const snap = await adminDb.collection(PHYSICAL_BATCHES).doc(batchId).get()
  return snap.exists ? ({ id: snap.id, ...(snap.data() as any) } as BatchDoc) : null
}

/**
 * Cancel an unpaid batch and give its seats back.
 *
 * Refused (code 'offset_debited') when the organizer's balance was already
 * debited for it (withdrawal_requests/physoffset_{batchId}, a crash between the
 * debit and marking the batch paid): cancelling then would keep their money.
 * The caller finishes that payment instead (balanceOffset.reconcileOffset).
 */
export async function cancelUnpaidBatch(batchId: string, by: string, reason: string | null = null): Promise<{ ok: boolean; code?: string }> {
  const ref = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  const offsetRef = adminDb.collection('withdrawal_requests').doc(`physoffset_${batchId}`)
  const cancelled = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const offset = await tx.get(offsetRef)
    if (!snap.exists) return 'not_found'
    const b = snap.data() || {}
    if (!canMoveBatch(b.status, 'cancelled')) return 'not_cancellable'
    const o = offset.exists ? offset.data() || {} : null
    if (o && o.status === 'completed' && !o.reversedAt) return 'offset_debited'
    tx.update(ref, {
      status: 'cancelled',
      cancelled_by: by,
      cancel_reason: reason,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return 'ok'
  })
  if (cancelled !== 'ok') return { ok: false, code: cancelled }
  await releaseSeats({ reservationId: physicalReservationId(batchId), logPrefix: '[physical]' })
  return { ok: true }
}

/**
 * The batch was paid: record the payment once and issue its tickets.
 *
 * Safe to call from the MonCash return, the Stripe webhook and the organizer's
 * "check payment" button at the same time:
 *   - only the call that performs awaiting_payment → paid issues, plus any later
 *     call that finds issuance incomplete (a crash mid-way); issuance itself
 *     takes a lease and writes deterministic ids with create(), so each of the N
 *     tickets is created at most once;
 *   - a payment that lands on a CANCELLED batch, or a second, different payment
 *     on an already-paid one, is recorded and the batch is flagged needs_refund
 *     (it is never silently kept).
 */
export async function markBatchPaid(
  batchId: string,
  proof: { funds_rail: FundsRail; reference: string; amount: number; currency: string; extra?: Record<string, any> }
): Promise<{ ok: boolean; alreadyPaid?: boolean; code?: string; needsRefund?: boolean }> {
  // A balance payment is never refunded by hand: the caller credits it straight
  // back to the balance (balanceOffset.creditBackOffset), so it is not flagged.
  const selfCrediting = proof.funds_rail === 'balance_offset'
  const ref = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  const outcome: { kind: string; issue: boolean } = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { kind: 'not_found', issue: false }
    const b = snap.data() || {}
    const nowIso = new Date().toISOString()
    const record = { ...proof, received_at: nowIso }
    const late = Array.isArray(b.late_payments) ? b.late_payments : []
    const flagLate = () => {
      if (!late.some((p: any) => p?.reference === proof.reference)) {
        tx.update(ref, { needs_refund: true, late_payments: [...late, record], updated_at: nowIso })
      }
    }
    if (b.status === 'cancelled') {
      if (!selfCrediting) flagLate()
      return { kind: 'cancelled', issue: false }
    }
    if (b.status !== 'awaiting_payment') {
      if (String(b.payment?.reference || '') !== String(proof.reference)) {
        // Paid twice (e.g. card AND MonCash): keep the first, flag the second for a refund.
        if (!selfCrediting) flagLate()
        return { kind: 'duplicate', issue: b.tickets_issued_complete !== true }
      }
      return { kind: 'already', issue: b.tickets_issued_complete !== true }
    }
    tx.update(ref, {
      status: 'paid',
      payment: {
        ...(b.payment || {}),
        status: 'paid',
        funds_rail: proof.funds_rail,
        reference: proof.reference,
        amount: proof.amount,
        currency: proof.currency,
        paid_at: nowIso,
        ...(proof.extra || {}),
      },
      paid_at: nowIso,
      updated_at: nowIso,
    })
    return { kind: 'ok', issue: true }
  })
  if (outcome.kind === 'not_found') return { ok: false, code: 'not_found' }
  if (outcome.kind === 'cancelled') {
    if (selfCrediting) return { ok: false, code: 'cancelled' }
    console.error('[physical] payment landed on a cancelled batch; flagged needs_refund', { batchId, reference: proof.reference })
    return { ok: false, code: 'cancelled', needsRefund: true }
  }
  if (outcome.issue) await issueBatchTickets(batchId)
  return {
    ok: outcome.kind !== 'duplicate' || !selfCrediting,
    alreadyPaid: outcome.kind !== 'ok',
    ...(outcome.kind === 'duplicate' ? (selfCrediting ? { code: 'duplicate_payment' } : { needsRefund: true, code: 'duplicate_payment' }) : {}),
  }
}

const ISSUE_LEASE_MS = 2 * 60 * 1000

function isAlreadyExists(err: any): boolean {
  const code = err?.code
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS' || /already exists/i.test(String(err?.message || ''))
}

/**
 * Create the batch's tickets as printed_unsold, at ids phys_{batchId}_{n}.
 *
 * One issuer at a time (a lease claimed in a transaction); every ticket is
 * written with create(), so even two issuers racing past the lease cannot make
 * a serial twice. A retry after a crash finds what exists and completes it.
 */
export async function issueBatchTickets(batchId: string): Promise<number> {
  const ref = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  const claimed: BatchDoc | null = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const b = snap.data() || {}
    if (['awaiting_payment', 'cancelled'].includes(b.status) || b.tickets_issued_complete === true) return null
    const now = Date.now()
    if (Number(b.issue_lease_until) > now) return null
    tx.update(ref, { issue_lease_until: now + ISSUE_LEASE_MS })
    return { id: snap.id, ...b } as BatchDoc
  })
  if (!claimed) return 0
  const batch = claimed
  const [existing, eventSnap] = await Promise.all([
    adminDb.collection('tickets').where('physical_batch_id', '==', batchId).select('physical_serial_no').get(),
    adminDb.collection('events').doc(batch.event_id).get(),
  ])
  const event = eventSnap.exists ? eventSnap.data() || {} : {}
  const have = new Set<number>(existing.docs.map((d: any) => Number(d.data()?.physical_serial_no)))
  const nowIso = new Date().toISOString()
  const docFor = (n: number) => {
    const id = physicalTicketId(batchId, n)
    const payload = physicalQrPayload(id, 1, newPhysicalToken())
    return {
      id,
      data: {
        kind: PHYSICAL_KIND,
        source: 'physical',
        status: 'printed_unsold',
        event_id: batch.event_id,
        event_title: event.title || batch.event_title || '',
        organizer_id: batch.organizer_id,
        tier_id: batch.tier_id,
        tier_name: batch.tier_name,
        ticket_type: batch.tier_name,
        quantity: 1,
        price_paid: 0,
        payment_method: 'physical',
        currency: batch.currency || event.currency || 'HTG',
        physical_batch_id: batchId,
        physical_serial: formatSerial(batch.serial_prefix, n, batch.quantity),
        physical_serial_no: n,
        physical_seller_uid: null,
        reservation_id: batch.reservation_id,
        qr_version: 1,
        qr_code: payload,
        qr_code_data: payload,
        checked_in: false,
        checked_in_at: null,
        start_datetime: event.start_datetime || null,
        end_datetime: event.end_datetime || null,
        venue_name: event.venue_name || null,
        city: event.city || null,
        created_at: nowIso,
        updated_at: nowIso,
      },
    }
  }
  const missing: number[] = []
  for (let n = 1; n <= batch.quantity; n++) if (!have.has(n)) missing.push(n)
  let created = 0
  for (let i = 0; i < missing.length; i += WRITE_CHUNK) {
    const chunk = missing.slice(i, i + WRITE_CHUNK).map(docFor)
    const writer = adminDb.batch()
    for (const d of chunk) writer.create(adminDb.collection('tickets').doc(d.id), d.data)
    try {
      await writer.commit()
      created += chunk.length
    } catch (err: any) {
      if (!isAlreadyExists(err)) throw err
      // Someone else wrote part of this chunk: one by one, skipping what exists.
      for (const d of chunk) {
        try {
          await adminDb.collection('tickets').doc(d.id).create(d.data)
          created++
        } catch (e: any) {
          if (!isAlreadyExists(e)) throw e
        }
      }
    }
  }
  await ref.update({
    tickets_issued: have.size + created,
    tickets_issued_complete: true,
    tickets_issued_at: nowIso,
    issue_lease_until: null,
    updated_at: nowIso,
  })
  return created
}

/** The batch's tickets, in serial order. */
export async function loadBatchTickets(batchId: string): Promise<Array<{ id: string } & Record<string, any>>> {
  const snap = await adminDb.collection('tickets').where('physical_batch_id', '==', batchId).get()
  return snap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .sort((a: any, b: any) => Number(a.physical_serial_no) - Number(b.physical_serial_no))
}

/**
 * The print room downloaded the sheet: from now on Tikèm has (or may have)
 * printed it, so the batch moves to 'printing' and gets printed_at, in one
 * transaction. Cancel-for-credit refuses once printed_at is set.
 */
export async function markBatchPrinted(batchId: string, by: string): Promise<{ ok: boolean; code?: string }> {
  const ref = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: false, code: 'not_found' }
    const b = snap.data() || {}
    if (['awaiting_payment', 'cancelled'].includes(b.status)) return { ok: false, code: 'not_paid' }
    const nowIso = new Date().toISOString()
    const patch: Record<string, any> = {}
    if (!b.printed_at) Object.assign(patch, { printed_at: nowIso, printed_by: by })
    if (b.status === 'paid') Object.assign(patch, { status: 'printing', printing_at: nowIso, printing_by: by })
    if (Object.keys(patch).length) tx.update(ref, { ...patch, updated_at: nowIso })
    return { ok: true }
  })
}

/** Admin: move a batch one step along the flow (paid → printing → ready → active). */
export async function moveBatch(batchId: string, to: BatchStatus, by: string): Promise<{ ok: boolean; code?: string; from?: string }> {
  const ref = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: false, code: 'not_found' }
    const from = String(snap.data()?.status || '') as BatchStatus
    if (!canMoveBatch(from, to)) return { ok: false, code: 'bad_transition', from }
    const nowIso = new Date().toISOString()
    tx.update(ref, {
      status: to,
      [`${to}_at`]: nowIso,
      [`${to}_by`]: by,
      ...(to === 'printing' && !snap.data()?.printed_at ? { printed_at: nowIso, printed_by: by } : {}),
      updated_at: nowIso,
    })
    return { ok: true, from }
  })
}

/**
 * Reprint: every still-unsold ticket gets a NEW random token at version+1, so
 * the old sheets stop scanning everywhere (online and on the offline door
 * list). Activated tickets keep their code (their holder already has the
 * paper), and each ticket is re-checked inside a transaction, so a sale that
 * lands mid-reprint is never rotated. The batch keeps its status: an active
 * batch stays active.
 */
export async function reprintBatch(batchId: string, by: string): Promise<{ ok: boolean; reissued: number; skipped?: number; code?: string }> {
  const batch = await getBatch(batchId)
  if (!batch) return { ok: false, reissued: 0, code: 'not_found' }
  if (['awaiting_payment', 'cancelled'].includes(batch.status)) return { ok: false, reissued: 0, code: 'not_paid' }
  const nowIso = new Date().toISOString()
  const r = await updateRange(
    batchId,
    { from: 1, to: batch.quantity },
    (t) => t.status === 'printed_unsold',
    (t) => {
      const current = parsePhysicalQr(t.qr_code_data)
      const next = (current?.v || Number(t.qr_version) || 1) + 1
      const payload = physicalQrPayload(t.id, next, newPhysicalToken())
      return { qr_version: next, qr_code: payload, qr_code_data: payload, qr_rotated_at: nowIso, updated_at: nowIso }
    }
  )
  await adminDb.collection(PHYSICAL_BATCHES).doc(batchId).update({
    reprint_count: (Number(batch.reprint_count) || 0) + 1,
    last_reprint_at: nowIso,
    last_reprint_by: by,
    updated_at: nowIso,
  })
  return { ok: true, reissued: r.touched.length, skipped: r.skipped }
}

const TX_CHUNK = 200

/**
 * Apply `patch` to the batch's tickets whose serial is in range and that
 * `match`. Each chunk runs in a transaction that RE-READS every ticket and
 * re-checks `match`, so a ticket sold (activated) between the listing and the
 * write is skipped, never overwritten. Returns what changed and how many were
 * skipped because they changed underneath.
 */
async function updateRange(
  batchId: string,
  range: SerialRange,
  match: (t: Record<string, any>) => boolean,
  patch: (t: { id: string } & Record<string, any>) => Record<string, any>
): Promise<{ touched: string[]; skipped: number }> {
  const candidates = (await loadBatchTickets(batchId))
    .filter((t) => {
      const n = Number(t.physical_serial_no)
      return n >= range.from && n <= range.to && match(t)
    })
    .map((t) => t.id)
  const touched: string[] = []
  let skipped = 0
  for (let i = 0; i < candidates.length; i += TX_CHUNK) {
    const ids = candidates.slice(i, i + TX_CHUNK)
    const res: { done: string[]; skipped: number } = await adminDb.runTransaction(async (tx: any) => {
      const refs = ids.map((id) => adminDb.collection('tickets').doc(id))
      const snaps = await Promise.all(refs.map((r) => tx.get(r)))
      const done: string[] = []
      let skip = 0
      snaps.forEach((snap: any, k: number) => {
        const data = snap.exists ? snap.data() || {} : null
        if (!data || !match(data)) {
          skip++
          return
        }
        tx.update(refs[k], patch({ id: ids[k], ...data }))
        done.push(ids[k])
      })
      return { done, skipped: skip }
    })
    touched.push(...res.done)
    skipped += res.skipped
  }
  return { touched, skipped }
}

/**
 * Assign a serial range to a seller (an active org team member). Tickets in
 * the range carry the seller's uid, which is what activation checks.
 */
export async function assignRange(params: {
  batch: BatchDoc
  range: SerialRange
  seller: { uid: string; name: string }
}): Promise<{ ok: boolean; code?: string; assigned?: number; skipped?: number }> {
  const { batch, range, seller } = params
  if (!validRange(range, batch.quantity)) return { ok: false, code: 'bad_range' }
  const nowIso = new Date().toISOString()
  const { touched, skipped } = await updateRange(
    batch.id,
    range,
    (t) => t.status === 'printed_unsold',
    () => ({ physical_seller_uid: seller.uid, updated_at: nowIso })
  )
  // Keep the batch's list readable: a new range trims any it overlaps.
  const kept = (batch.assignments || []).flatMap((a) => {
    if (a.to < range.from || a.from > range.to) return [a]
    const parts: typeof batch.assignments = []
    if (a.from < range.from) parts.push({ ...a, to: range.from - 1 })
    if (a.to > range.to) parts.push({ ...a, from: range.to + 1 })
    return parts
  })
  const assignments = [...kept, { uid: seller.uid, name: seller.name, from: range.from, to: range.to, assigned_at: nowIso }].sort(
    (a, b) => a.from - b.from
  )
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    assignments,
    seller_uids: Array.from(new Set(assignments.map((a) => a.uid))),
    updated_at: nowIso,
  })
  return { ok: true, assigned: touched.length, skipped }
}

/** Void a lost / stolen range: its unsold tickets stop admitting and can never be activated. */
export async function voidRange(params: { batch: BatchDoc; range: SerialRange; by: string; reason?: string | null }) {
  const { batch, range, by } = params
  if (!validRange(range, batch.quantity)) return { ok: false, code: 'bad_range', voided: 0 }
  const nowIso = new Date().toISOString()
  const { touched, skipped } = await updateRange(
    batch.id,
    range,
    (t) => t.status === 'printed_unsold',
    () => ({ status: 'voided', voided_at: nowIso, voided_by: by, updated_at: nowIso })
  )
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    voided_ranges: [
      ...(batch.voided_ranges || []),
      { from: range.from, to: range.to, count: touched.length, at: nowIso, by, reason: params.reason ? String(params.reason).slice(0, 200) : null },
    ],
    updated_at: nowIso,
  })
  return { ok: true, voided: touched.length, skipped }
}

/**
 * Give unsold printed seats (and voided ones) back to online sales. Each ticket
 * is stamped `seat_returned_at` BEFORE the seats are released, so a seat is
 * never returned twice (a crash in between undersells, it never oversells).
 * Unsold tickets become `released` and stop admitting.
 */
export async function releaseUnsold(params: { batch: BatchDoc; by: string; range?: SerialRange | null }) {
  const { batch, by } = params
  const range = params.range && validRange(params.range, batch.quantity) ? params.range : { from: 1, to: batch.quantity }
  const nowIso = new Date().toISOString()
  const { touched, skipped } = await updateRange(
    batch.id,
    range,
    (t) => (t.status === 'printed_unsold' || t.status === 'voided') && !t.seat_returned_at,
    (t) => ({
      ...(t.status === 'printed_unsold' ? { status: 'released', released_by: by } : {}),
      seat_returned_at: nowIso,
      seat_reservation_id: batch.reservation_id,
      updated_at: nowIso,
    })
  )
  if (touched.length > 0) {
    const res = await releaseSeats({
      reservationId: batch.reservation_id,
      quantity: touched.length,
      tierIncrements: [{ tierId: batch.tier_id, quantity: touched.length }],
      logPrefix: '[physical]',
    })
    if (!res.released) console.warn('[physical] seats not released', { batchId: batch.id, count: touched.length, error: res.error })
  }
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    released_count: (Number(batch.released_count) || 0) + touched.length,
    updated_at: nowIso,
  })
  return { ok: true, released: touched.length, skipped }
}

/**
 * A paid batch cancelled before printing (balance offset credited back): every
 * unsold ticket is released and the batch's whole reservation goes back to
 * online sales. Nothing was sold (sales need printing / ready).
 */
export async function retireBatchTickets(batch: BatchDoc, by: string): Promise<number> {
  const nowIso = new Date().toISOString()
  const { touched } = await updateRange(
    batch.id,
    { from: 1, to: batch.quantity },
    (t) => t.status === 'printed_unsold' && !t.seat_returned_at,
    () => ({ status: 'released', released_by: by, seat_returned_at: nowIso, seat_reservation_id: batch.reservation_id, updated_at: nowIso })
  )
  const res = await releaseSeats({ reservationId: batch.reservation_id, logPrefix: '[physical]' })
  if (!res.released && res.error) console.warn('[physical] seats not released on cancel', { batchId: batch.id, error: res.error })
  return touched.length
}

// ── activation ───────────────────────────────────────────────────────────────

export type ActivationResult =
  | { ok: true; ticketId: string; serial: string; holderName: string; tier: string; alreadyDone?: boolean }
  | { ok: false; code: ActivationRefusal; serial?: string | null; holderName?: string | null; activatedAt?: string | null }

/**
 * Find a printed ticket by its scanned code or its typed serial, within the
 * event. A serial that matches more than one ticket (batches from before
 * serials carried a batch number) is AMBIGUOUS: never guess which one to sell.
 */
export async function resolvePhysicalTicketId(
  eventId: string,
  opts: { code?: string | null; serial?: string | null }
): Promise<string | null | 'AMBIGUOUS'> {
  const parsed = parsePhysicalQr(opts.code)
  if (parsed) return parsed.ticketId
  const serial = normalizeSerial(opts.serial || opts.code)
  if (!serial) return null
  const snap = await adminDb
    .collection('tickets')
    .where('event_id', '==', eventId)
    .where('physical_serial', '==', serial)
    .limit(2)
    .get()
  if (snap.empty) return null
  if (snap.docs.length > 1) return 'AMBIGUOUS'
  return snap.docs[0].id
}

/**
 * Activate one printed ticket, in a transaction: the FIRST activation wins and
 * every later one (another seller, an offline phone syncing late) gets
 * ALREADY_ACTIVATED with who it was sold to. A retry of the same offline
 * activation (same clientRef) is answered as done, not as a conflict.
 */
export async function activatePhysicalTicket(params: {
  eventId: string
  code?: string | null
  serial?: string | null
  input: ActivationInput
  actor: ActivationActor
  clientRef?: string | null
  clientActivatedAt?: string | null
  offline?: boolean
}): Promise<ActivationResult> {
  const ticketId = await resolvePhysicalTicketId(params.eventId, { code: params.code, serial: params.serial })
  if (ticketId === 'AMBIGUOUS') return { ok: false, code: 'AMBIGUOUS_SERIAL', serial: normalizeSerial(params.serial || params.code) }
  if (!ticketId) return { ok: false, code: 'NOT_FOUND' }
  const ref = adminDb.collection('tickets').doc(ticketId)
  const clientRef = params.clientRef ? String(params.clientRef).slice(0, 80) : null

  const result: ActivationResult = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const ticket = snap.exists ? snap.data() || {} : null
    let batchStatus: string | null = null
    if (ticket?.physical_batch_id) {
      const b = await tx.get(adminDb.collection(PHYSICAL_BATCHES).doc(String(ticket.physical_batch_id)))
      batchStatus = b.exists ? String(b.data()?.status || '') : null
    }
    const refusal = activationRefusal({
      ticketId,
      ticket,
      eventId: params.eventId,
      actor: params.actor,
      input: params.input,
      code: parsePhysicalQr(params.code) ? params.code : null,
      batchStatus,
    })
    if (refusal) {
      if (refusal === 'ALREADY_ACTIVATED' && clientRef && ticket?.physical_sale?.client_ref === clientRef) {
        return {
          ok: true,
          ticketId,
          serial: String(ticket?.physical_serial || ''),
          holderName: String(ticket?.attendee_name || ''),
          tier: String(ticket?.tier_name || ''),
          alreadyDone: true,
        } as ActivationResult
      }
      return {
        ok: false,
        code: refusal,
        serial: ticket?.physical_serial || null,
        holderName: refusal === 'ALREADY_ACTIVATED' ? String(ticket?.attendee_name || '') || null : null,
        activatedAt: refusal === 'ALREADY_ACTIVATED' ? ticket?.physical_sale?.activated_at || null : null,
      } as ActivationResult
    }
    const patch = activationPatch({
      actor: params.actor,
      input: params.input,
      nowIso: new Date().toISOString(),
      clientActivatedAt: params.clientActivatedAt,
      offline: params.offline,
      currency: ticket?.currency || 'HTG',
    })
    if (clientRef) patch.physical_sale.client_ref = clientRef
    tx.update(ref, patch)
    if (batchStatus === 'ready') {
      tx.update(adminDb.collection(PHYSICAL_BATCHES).doc(String(ticket!.physical_batch_id)), {
        status: 'active',
        active_at: patch.updated_at,
        updated_at: patch.updated_at,
      })
    }
    return {
      ok: true,
      ticketId,
      serial: String(ticket?.physical_serial || ''),
      holderName: patch.attendee_name,
      tier: String(ticket?.tier_name || ''),
    } as ActivationResult
  })
  return result
}

// ── dashboard ────────────────────────────────────────────────────────────────

export interface BatchSummary {
  batch: BatchDoc
  counts: BatchCounts
  /** Seats reserved by this batch that nobody has bought yet (rules.batchHeldSeats). */
  heldSeats: number
  bySeller: Array<{ uid: string; name: string; counts: BatchCounts }>
}

export async function loadEventBatches(eventId: string): Promise<BatchSummary[]> {
  const snap = await adminDb.collection(PHYSICAL_BATCHES).where('event_id', '==', eventId).get()
  const batches = snap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) }) as BatchDoc)
    .sort((a: BatchDoc, b: BatchDoc) => String(b.created_at).localeCompare(String(a.created_at)))
  const out: BatchSummary[] = []
  for (const batch of batches) {
    const tickets = batch.status === 'awaiting_payment' || batch.status === 'cancelled' ? [] : await loadBatchTickets(batch.id)
    const { total, bySeller } = tallyPhysical(tickets)
    const names = new Map<string, string>((batch.assignments || []).map((a: BatchDoc['assignments'][number]) => [a.uid, String(a.name || '')]))
    out.push({
      batch,
      counts: total,
      heldSeats: batchHeldSeats(batch, total),
      bySeller: Object.entries(bySeller)
        .filter(([uid]) => uid)
        .map(([uid, counts]) => ({ uid, name: names.get(uid) || '', counts })),
    })
  }
  return out
}

/** Batches whose ranges are assigned to this seller (for the seller's own screen). */
export async function loadSellerAssignments(uid: string) {
  const snap = await adminDb.collection(PHYSICAL_BATCHES).where('seller_uids', 'array-contains', uid).get()
  return snap.docs.map((d: any) => {
    const b = d.data() || {}
    return {
      batchId: d.id,
      organizerId: String(b.organizer_id || ''),
      eventId: String(b.event_id || ''),
      eventTitle: String(b.event_title || ''),
      tierName: String(b.tier_name || ''),
      status: String(b.status || ''),
      ranges: (b.assignments || [])
        .filter((a: any) => a.uid === uid)
        .map((a: any) => ({ from: a.from, to: a.to, fromSerial: formatSerial(b.serial_prefix, a.from, b.quantity), toSerial: formatSerial(b.serial_prefix, a.to, b.quantity) })),
    }
  })
}
