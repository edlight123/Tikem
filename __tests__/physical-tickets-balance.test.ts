/**
 * @jest-environment node
 *
 * Paying a printed batch from the organizer's Tikèm balance
 * (lib/physical/balanceOffset): shown only when one event's RELEASED HTG
 * balance covers the whole price, refused server-side otherwise, debited once
 * through the withdrawal debit (withdrawFromEarnings, emulated here with its
 * real contract: in-transaction ceiling check, request filed in the same
 * transaction, "already exists" on a retry), and credited back on cancel.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

jest.mock('@/lib/tickets/inventoryShards', () => ({
  reserveSeats: jest.fn(async () => ({ ok: true })),
  releaseSeats: jest.fn(async () => ({ released: true })),
}))
import { releaseSeats } from '@/lib/tickets/inventoryShards'

jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => null), requireAdmin: jest.fn() }))

// Released (available-now) HTG per event, as the availability engine would say.
const released: Record<string, number> = {}
const ceiling: Record<string, number> = {}
jest.mock('@/lib/payouts/availability-server', () => ({
  loadOrganizerAvailability: jest.fn(async () => ({
    events: Object.keys(released).map((id) => ({ eventId: id, title: `Event ${id}`, currency: 'HTG', availableNowMinor: released[id], reason: null })),
    totals: [],
    context: {},
  })),
  loadEventAvailability: jest.fn(async ({ eventId }: any) => ({
    eventId,
    currency: 'HTG',
    availableNowMinor: released[eventId] || 0,
    balanceMinor: released[eventId] || 0,
    ceilingMinor: ceiling[eventId] || 0,
    reason: null,
    gateInputs: { grossMinor: 0, refundedMinor: 0, availableMinor: 0 },
    effectiveEndsAt: null,
  })),
}))
jest.mock('@/lib/payouts/availability', () => ({
  gateEventData: (e: any) => e,
  integrityRefusal: () => null,
}))
const gate = jest.fn(async () => ({ allowed: true }))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({ gateHaitiWithdrawal: (...a: any[]) => (gate as any)(...a) }))
jest.mock('@/lib/payouts/organizer-debt', () => ({ syncOrganizerDebt: jest.fn(async () => ({ failed: [] })) }))

// The withdrawal debit's contract (lib/earnings.ts), on the fake DB.
jest.mock('@/lib/earnings', () => {
  const ledger = (eventId: string) => (db as any).collection('event_earnings').doc(eventId)
  return {
    readRefundClaimVersion: jest.fn(async () => 0),
    findEventEarningsDocInTransaction: async (tx: any, eventId: string) => {
      const snap = await tx.get(ledger(eventId))
      return snap.exists ? { ref: ledger(eventId), data: snap.data() } : null
    },
    withdrawFromEarnings: jest.fn(async (eventId: string, amount: number, _id: string, opts: any) =>
      (db as any).runTransaction(async (tx: any) => {
        const snap = await tx.get(ledger(eventId))
        const req = await tx.get(opts.fileRequest.ref)
        const withdrawn = Number(snap.data()?.withdrawnAmount || 0)
        if (req.exists) return { success: false, error: 'Withdrawal request already exists' }
        if (opts.ceilingMinor - withdrawn < amount) return { success: false, error: 'Insufficient funds' }
        tx.update(ledger(eventId), { withdrawnAmount: withdrawn + amount })
        tx.set(opts.fileRequest.ref, { ...opts.fileRequest.data, reservedCents: amount })
        return { success: true }
      })
    ),
  }
})
import { withdrawFromEarnings } from '@/lib/earnings'

import { cancelUnpaidBatch, createBatch, getBatch, markBatchPaid, markBatchPrinted } from '@/lib/physical/batches'
import {
  cancelPaidFromBalance,
  creditBackOffset,
  mayPayFromBalance,
  offsetWithdrawalId,
  payBatchFromBalance,
  pickOffsetSource,
  reconcileOffset,
} from '@/lib/physical/balanceOffset'
import { expireUnpaidBatches } from '@/lib/physical/payments'
import { showBalanceOption } from '@/lib/physical/rules'

const EVENT = 'ev1'
const OWNER = { id: 'org1', role: 'organizer' } as any

beforeEach(() => {
  db.store.clear()
  for (const k of Object.keys(released)) delete released[k]
  for (const k of Object.keys(ceiling)) delete ceiling[k]
  ;(withdrawFromEarnings as jest.Mock).mockClear()
  ;(releaseSeats as jest.Mock).mockClear()
  gate.mockClear()
  db.store.set(`events/${EVENT}`, { title: 'Fête', organizer_id: 'org1', currency: 'HTG' })
  db.store.set('events/ev2', { title: 'Konpa', organizer_id: 'org1', currency: 'HTG' })
  db.store.set('ticket_tiers/vip', { event_id: EVENT, name: 'VIP' })
})

function fund(eventId: string, htg: number) {
  released[eventId] = htg * 100
  ceiling[eventId] = htg * 100
  db.store.set(`event_earnings/${eventId}`, { eventId, withdrawnAmount: 0 })
}

async function newBatch() {
  const r = await createBatch({ eventId: EVENT, event: db.store.get(`events/${EVENT}`)!, orgId: 'org1', tierId: 'vip', quantity: 100, method: 'balance', createdBy: 'org1' })
  if (!r.ok) throw new Error(r.error)
  return r.batch // 100 × 40 = 4,000 HTG
}

describe('shown only when the released balance covers the full price', () => {
  it('display rule', () => {
    expect(showBalanceOption({ canUse: true, availableHtg: 4000 }, 4000)).toBe(true)
    expect(showBalanceOption({ canUse: true, availableHtg: 3999 }, 4000)).toBe(false)
    expect(showBalanceOption({ canUse: false, availableHtg: 99999 }, 4000)).toBe(false)
    expect(showBalanceOption(null, 4000)).toBe(false)
  })
  it('one event must cover it all (no partial, no split across events)', () => {
    const events = [
      { eventId: 'a', title: 'A', currency: 'HTG', availableNowMinor: 300000 },
      { eventId: 'b', title: 'B', currency: 'HTG', availableNowMinor: 300000 },
      { eventId: 'u', title: 'U', currency: 'USD', availableNowMinor: 9_000_000 },
    ]
    expect(pickOffsetSource(events, 400000, 'a')).toBeNull()
    expect(pickOffsetSource(events, 300000, 'b')).toMatchObject({ eventId: 'b' })
    expect(pickOffsetSource([...events, { eventId: 'c', title: 'C', currency: 'HTG', availableNowMinor: 500000, blocked: true }], 400000)).toBeNull()
  })
  it('who may spend it: owner, or an admin with the finance grant', () => {
    expect(mayPayFromBalance({ isOwner: true, role: 'owner', financeView: true })).toBe(true)
    expect(mayPayFromBalance({ isOwner: false, role: 'admin', financeView: true })).toBe(true)
    expect(mayPayFromBalance({ isOwner: false, role: 'admin', financeView: false })).toBe(false)
    expect(mayPayFromBalance({ isOwner: false, role: 'manager', financeView: true })).toBe(false)
    expect(mayPayFromBalance({ isOwner: false, role: 'seller', financeView: false })).toBe(false)
  })
})

describe('paying from the balance', () => {
  it('insufficient released balance → refused server-side, nothing debited', async () => {
    fund(EVENT, 3999)
    const batch = await newBatch()
    const r = await payBatchFromBalance({ batch, user: OWNER })
    expect(r).toMatchObject({ ok: false, code: 'insufficient_balance' })
    expect(withdrawFromEarnings).not.toHaveBeenCalled()
    expect((await getBatch(batch.id))!.status).toBe('awaiting_payment')
  })

  it('a manager (or anyone without the finance grant) is refused even if the client sends it', async () => {
    fund(EVENT, 10000)
    db.store.set('organizers/org1/team/m1', { status: 'active', role: 'manager' })
    const batch = await newBatch()
    const r = await payBatchFromBalance({ batch, user: { id: 'm1', role: 'attendee' } as any })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(withdrawFromEarnings).not.toHaveBeenCalled()
  })

  it('the release gate is honoured at pay time', async () => {
    fund(EVENT, 10000)
    gate.mockResolvedValueOnce({ allowed: false, body: { error: 'Held until 48h after the event' } } as any)
    const batch = await newBatch()
    expect(await payBatchFromBalance({ batch, user: OWNER })).toMatchObject({ ok: false, code: 'balance_not_released' })
  })

  it('debits once, atomically, files a balance_offset row and marks the batch paid; a retry never debits again', async () => {
    fund('ev2', 10000)
    const batch = await newBatch()
    const r = await payBatchFromBalance({ batch, user: OWNER })
    expect(r).toMatchObject({ ok: true, eventId: 'ev2' })
    expect(db.store.get('event_earnings/ev2')!.withdrawnAmount).toBe(400000)
    const row = db.store.get(`withdrawal_requests/${offsetWithdrawalId(batch.id)}`)!
    expect(row).toMatchObject({ method: 'balance_offset', status: 'completed', amount: 400000, currency: 'HTG', organizerId: 'org1', eventId: 'ev2', physicalBatchId: batch.id })
    const paid = (await getBatch(batch.id))!
    expect(paid.status).toBe('paid')
    expect(paid.payment).toMatchObject({ funds_rail: 'balance_offset', reference: offsetWithdrawalId(batch.id) })

    // Retry (double tap / network retry): no second debit.
    const again = await payBatchFromBalance({ batch: (await getBatch(batch.id))!, user: OWNER })
    expect(again).toMatchObject({ ok: true, alreadyDone: true })
    expect(db.store.get('event_earnings/ev2')!.withdrawnAmount).toBe(400000)
    // Two racing calls: the deterministic row lets only one debit through.
    const other = await newBatch()
    await Promise.all([payBatchFromBalance({ batch: other, user: OWNER }), payBatchFromBalance({ batch: other, user: OWNER })])
    expect(db.store.get('event_earnings/ev2')!.withdrawnAmount).toBe(800000)
  })

  it('cancelling before printing credits it back (once), retires the tickets and frees the seats', async () => {
    fund(EVENT, 10000)
    const batch = await newBatch()
    await payBatchFromBalance({ batch, user: OWNER })
    expect(db.docsIn('tickets')).toHaveLength(100)
    const r = await cancelPaidFromBalance(batch.id, 'org1')
    expect(r).toMatchObject({ ok: true, creditedMinor: 400000 })
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(0)
    expect(db.store.get(`withdrawal_requests/${offsetWithdrawalId(batch.id)}`)).toMatchObject({ status: 'cancelled' })
    const b = (await getBatch(batch.id))!
    expect(b.status).toBe('cancelled')
    expect(b.payment.refunded_to_balance_at).toBeTruthy()
    expect(db.docsIn('tickets').every(([, t]) => t.status === 'released')).toBe(true)
    expect(releaseSeats).toHaveBeenCalledWith(expect.objectContaining({ reservationId: `phys_${batch.id}` }))
    // No double credit.
    expect(await cancelPaidFromBalance(batch.id, 'org1')).toMatchObject({ ok: false })
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(0)
  })

  it('once printing has started it can no longer be cancelled for a credit', async () => {
    fund(EVENT, 10000)
    const batch = await newBatch()
    await payBatchFromBalance({ batch, user: OWNER })
    db.store.set(`physical_batches/${batch.id}`, { ...db.store.get(`physical_batches/${batch.id}`)!, status: 'printing' })
    expect(await cancelPaidFromBalance(batch.id, 'org1')).toMatchObject({ ok: false, code: 'already_printing' })
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(400000)
  })
})

describe('a crash between the debit and "mark paid" never loses money', () => {
  // The state a crash leaves: the balance row is filed and the ledger debited,
  // but the batch is still awaiting payment.
  async function crashedBatch() {
    fund(EVENT, 10000)
    const batch = await newBatch()
    db.store.set(`withdrawal_requests/${offsetWithdrawalId(batch.id)}`, {
      method: 'balance_offset', status: 'completed', amount: 400000, reservedCents: 400000, currency: 'HTG',
      organizerId: 'org1', eventId: EVENT, physicalBatchId: batch.id,
    })
    db.store.set(`event_earnings/${EVENT}`, { eventId: EVENT, withdrawnAmount: 400000 })
    return batch
  }

  it('cancelUnpaidBatch refuses (offset_debited) instead of keeping the money', async () => {
    const batch = await crashedBatch()
    expect(await cancelUnpaidBatch(batch.id, 'system', 'payment_window_expired')).toEqual({ ok: false, code: 'offset_debited' })
    expect((await getBatch(batch.id))!.status).toBe('awaiting_payment')
  })

  it('the expiry sweep finishes the payment rather than cancelling', async () => {
    const batch = await crashedBatch()
    db.store.set(`physical_batches/${batch.id}`, { ...db.store.get(`physical_batches/${batch.id}`)!, payment_expires_at: new Date(0).toISOString() })
    expect(await expireUnpaidBatches()).toEqual({ checked: 1, cancelled: 0, paid: 1 })
    expect((await getBatch(batch.id))!).toMatchObject({ status: 'paid', payment: { funds_rail: 'balance_offset' } })
    expect(db.docsIn('tickets')).toHaveLength(100)
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(400000)
  })

  it('"Pay" again resumes through the existing debit (no second debit)', async () => {
    const batch = await crashedBatch()
    const r = await payBatchFromBalance({ batch, user: OWNER })
    expect(r).toMatchObject({ ok: true, alreadyDone: true })
    expect(withdrawFromEarnings).not.toHaveBeenCalled()
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(400000)
    expect((await getBatch(batch.id))!.status).toBe('paid')
  })

  it('a debit found on a batch that got cancelled anyway is credited back (and not flagged for a manual refund)', async () => {
    const batch = await crashedBatch()
    db.store.set(`physical_batches/${batch.id}`, { ...db.store.get(`physical_batches/${batch.id}`)!, status: 'cancelled' })
    expect(await reconcileOffset(batch.id)).toBe('credited')
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(0)
    expect(db.store.get(`withdrawal_requests/${offsetWithdrawalId(batch.id)}`)).toMatchObject({ status: 'cancelled' })
    const b = (await getBatch(batch.id))!
    expect(b.needs_refund).toBeUndefined()
    expect(b.payment.refunded_to_balance_at).toBeTruthy()
    expect(await reconcileOffset(batch.id)).toBe('none')
  })

  it('a balance payment landing on a cancelled batch is not flagged needs_refund', async () => {
    const batch = await newBatch()
    await cancelUnpaidBatch(batch.id, 'org1')
    const r = await markBatchPaid(batch.id, { funds_rail: 'balance_offset', reference: offsetWithdrawalId(batch.id), amount: 4000, currency: 'HTG' })
    expect(r).toEqual({ ok: false, code: 'cancelled' })
    expect((await getBatch(batch.id))!.needs_refund).toBeUndefined()
  })
})

describe('cancel-for-credit is one transaction, retryable, and ends at printing', () => {
  it('a cancel that never got credited (old crash) is credited on retry, once', async () => {
    fund(EVENT, 10000)
    const batch = await newBatch()
    await payBatchFromBalance({ batch, user: OWNER })
    // Old two-step crash: cancelled, credit never happened.
    db.store.set(`physical_batches/${batch.id}`, { ...db.store.get(`physical_batches/${batch.id}`)!, status: 'cancelled', cancel_reason: 'cancelled_before_printing' })
    expect(await cancelPaidFromBalance(batch.id, 'org1')).toMatchObject({ ok: true, creditedMinor: 400000 })
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(0)
    expect(await cancelPaidFromBalance(batch.id, 'org1')).toMatchObject({ ok: false, code: 'already_credited' })
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(0)
  })

  it('once the print room downloaded the sheet, no cancel and no credit', async () => {
    fund(EVENT, 10000)
    const batch = await newBatch()
    await payBatchFromBalance({ batch, user: OWNER })
    expect(await markBatchPrinted(batch.id, 'admin')).toEqual({ ok: true })
    const printed = (await getBatch(batch.id))!
    expect(printed.status).toBe('printing')
    expect(printed.printed_at).toBeTruthy()
    expect(await cancelPaidFromBalance(batch.id, 'org1')).toMatchObject({ ok: false, code: 'already_printed' })
    expect(await creditBackOffset(batch.id, 'org1')).toMatchObject({ ok: false, code: 'already_printed' })
    expect(db.store.get(`event_earnings/${EVENT}`)!.withdrawnAmount).toBe(400000)
  })
})
