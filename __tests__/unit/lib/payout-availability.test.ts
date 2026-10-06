/**
 * lib/payouts/availability.ts — the ONE definition of what an organizer may
 * withdraw per event, per currency. Pure, so every rule is pinned here without
 * Firestore.
 */
import {
  computeEventAvailability,
  summarizeAvailability,
  toDateOrNull,
  toEarningsRow,
  type EventAvailabilityInput,
} from '@/lib/payouts/availability'
import { DEFAULT_PAYOUT_RELEASE_CONFIG } from '@/types/platform-settings'
import type { OrganizerHistory } from '@/lib/payouts/release-rules'

const NOW = new Date('2026-10-05T12:00:00.000Z')
const HOUR = 3_600_000
const endedHoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString()

const HTG_RULE = { platformFeePercentage: 0.1, legacyCapMinorPerTicket: 75_000 } // retired 750 HTG cap, capped-era sales only
const USD_RULE = { platformFeePercentage: 0.1, legacyCapMinorPerTicket: 500 } // retired $5.00 cap, capped-era sales only

const ESTABLISHED: OrganizerHistory = { completedEvents: 5, lifetimeGrossMinor: 0, currency: 'HTG' }
const NEW_ORG: OrganizerHistory = { completedEvents: 0, lifetimeGrossMinor: 0, currency: 'HTG' }

let seq = 0
/** A paid ticket, checked in by scan (so attendance never routes to review). */
function ticket(priceMajor: number, over: Record<string, any> = {}) {
  seq += 1
  return {
    id: over.id ?? `t${seq}`,
    event_id: 'evt1',
    status: 'valid',
    price_paid: priceMajor,
    currency: 'HTG',
    payment_method: 'moncash',
    payment_id: over.payment_id ?? `pay${seq}`,
    checked_in: true,
    check_in_method: 'scan',
    purchased_at: '2026-09-20T10:00:00.000Z',
    ...over,
  }
}

function run(over: Partial<EventAvailabilityInput> & { history?: OrganizerHistory; reviewStatus?: string | null } = {}) {
  const { history, reviewStatus, ...rest } = over
  return computeEventAvailability({
    event: { id: 'evt1', organizer_id: 'org1', currency: 'HTG', country: 'HT', status: 'published', end_datetime: endedHoursAgo(200) },
    tickets: [],
    fee: HTG_RULE,
    release: {
      history: history ?? ESTABLISHED,
      config: DEFAULT_PAYOUT_RELEASE_CONFIG,
      reviewStatus: reviewStatus ?? null,
    },
    now: NOW,
    ...rest,
  })
}

beforeEach(() => {
  seq = 0
})

describe('fee actually charged: flat rate, absorb vs pass-on', () => {
  it('absorb (organizer incidence) below the cap: 10% comes off', () => {
    const a = run({ tickets: [ticket(1_000)] }) // 1,000 HTG
    expect(a.platformFeeMinor).toBe(10_000)
    expect(a.netMinor).toBe(90_000)
    expect(a.availableNowMinor).toBe(90_000)
  })

  it('absorb on an older sale: still exactly 10% (the cap is retired for every sale)', () => {
    const a = run({ tickets: [ticket(10_000)] }) // 10,000 HTG
    expect(a.platformFeeMinor).toBe(100_000)
    expect(a.netMinor).toBe(900_000)
  })

  it('a multi-ticket order: 10% of the order', () => {
    const a = run({ tickets: [ticket(10_000, { payment_id: 'p' }), ticket(10_000, { payment_id: 'p' })] })
    expect(a.platformFeeMinor).toBe(200_000)
    expect(a.netMinor).toBe(1_800_000)
  })

  it('USD event, older sale: $100 pays $10', () => {
    const a = run({
      event: { id: 'evt1', organizer_id: 'org1', currency: 'USD', country: 'HT', status: 'published', end_datetime: endedHoursAgo(200) },
      fee: USD_RULE,
      tickets: [ticket(100, { payment_method: 'stripe', currency: 'USD' })], // $100
    })
    expect(a.currency).toBe('USD')
    expect(a.platformFeeMinor).toBe(1_000)
    expect(a.netMinor).toBe(9_000)
  })

  it('absorb, sold AFTER the cap was retired: exactly 10%, however expensive', () => {
    const after = new Date(Date.parse('2026-10-06T00:00:00.000Z') + 60_000).toISOString()
    const a = run({ tickets: [ticket(50_000, { purchased_at: after })] }) // 50,000 HTG
    expect(a.platformFeeMinor).toBe(500_000) // 5,000 HTG, not 750
    expect(a.netMinor).toBe(4_500_000)
  })

  it('an order mixing older and newer tickets still pays 10%', () => {
    const after = new Date(Date.parse('2026-10-06T00:00:00.000Z') + 60_000).toISOString()
    const a = run({
      tickets: [
        ticket(10_000, { payment_id: 'p', purchased_at: after }),
        ticket(10_000, { payment_id: 'p' }), // 2026-09-20
      ],
    })
    expect(a.platformFeeMinor).toBe(200_000)
  })

  it('USD event sold after the cap was retired: $100 pays $10', () => {
    const a = run({
      event: { id: 'evt1', organizer_id: 'org1', currency: 'USD', country: 'HT', status: 'published', end_datetime: endedHoursAgo(200) },
      fee: USD_RULE,
      tickets: [
        ticket(100, {
          payment_method: 'stripe',
          currency: 'USD',
          purchased_at: new Date(Date.parse('2026-10-06T00:00:00.000Z') + 60_000).toISOString(),
        }),
      ],
    })
    expect(a.platformFeeMinor).toBe(1_000)
    expect(a.netMinor).toBe(9_000)
  })

  it('pass-on (buyer incidence, stamped on the ticket): the organizer nets face value', () => {
    const a = run({ tickets: [ticket(10_000, { fee_incidence: 'buyer', payment_method: 'stripe' })] })
    expect(a.platformFeeMinor).toBe(0)
    expect(a.netMinor).toBe(1_000_000)
  })

  it('incidence is read from the TICKET, never the event (changing the event does not rewrite past sales)', () => {
    const a = run({
      event: { id: 'evt1', organizer_id: 'org1', currency: 'HTG', country: 'HT', fee_incidence: 'buyer', end_datetime: endedHoursAgo(200) },
      tickets: [ticket(1_000)],
    })
    expect(a.platformFeeMinor).toBe(10_000)
  })

  it('an order whose tickets disagree takes the fee-bearing reading', () => {
    const a = run({ tickets: [ticket(1_000, { payment_id: 'p', fee_incidence: 'buyer', payment_method: 'stripe' }), ticket(1_000, { payment_id: 'p', payment_method: 'stripe' })] })
    expect(a.platformFeeMinor).toBe(20_000)
  })

  it('the PLATFORM_FEE_MIN floor applies once per order, like checkout', () => {
    const a = run({ tickets: [ticket(1, { payment_id: 'p' }), ticket(1, { payment_id: 'p' })] }) // 2 × 1 HTG
    expect(a.platformFeeMinor).toBe(50)
    expect(a.netMinor).toBe(150)
  })

  it('funded promoter commission is the promoter’s money and is deducted', () => {
    const a = run({ tickets: [ticket(1_000)], promoterCommissionMinor: 5_000 })
    expect(a.netMinor).toBe(85_000)
  })
})

describe('live statuses and refunds', () => {
  it('valid, confirmed, active and an empty status are all live; cancelled is not', () => {
    const a = run({
      tickets: [
        ticket(100, { status: 'valid' }),
        ticket(100, { status: 'confirmed' }), // MonCash / SogePay
        ticket(100, { status: 'active' }),
        ticket(100, { status: undefined }),
        ticket(100, { status: 'cancelled' }),
        ticket(100, { status: 'transferred' }),
      ],
    })
    expect(a.ticketsSold).toBe(4)
    expect(a.netMinor).toBe(4 * 9_000)
  })

  it('a refunded ticket earns nothing and is reported as refunded', () => {
    const a = run({
      tickets: [ticket(1_000), ticket(1_000, { status: 'refunded', refund_status: 'approved', refund_amount: 1_000 })],
    })
    expect(a.netMinor).toBe(90_000)
    expect(a.refundedMinor).toBe(100_000)
    expect(a.grossMinor).toBe(200_000) // refund-inclusive, the gate's convention
    expect(a.gateInputs).toEqual({ grossMinor: 200_000, refundedMinor: 100_000, availableMinor: 90_000 })
  })

  it('refunds come out of gross at FACE value in the event currency, never the charged amount', () => {
    // USD event sold over MonCash in HTG with a pass-on fee: the buyer got 14,850 HTG back.
    const usdEvent = { id: 'evt1', organizer_id: 'org1', currency: 'USD', country: 'HT', status: 'published', end_datetime: endedHoursAgo(200) }
    const usd = (over: Record<string, any> = {}) => ticket(100, { currency: 'USD', original_currency: 'USD', ...over })
    const refundedFields = { status: 'refunded', refund_status: 'approved', refund_amount: 14_850, refund_currency: 'HTG' }
    const stamped = run({ event: usdEvent, fee: USD_RULE, tickets: [usd(), usd({ ...refundedFields, refund_face_amount: 100 })] })
    expect(stamped.refundedMinor).toBe(10_000)
    // Legacy doc (no refund_face_amount), refund in another currency: the full face price.
    const legacyOther = run({ event: usdEvent, fee: USD_RULE, tickets: [usd(), usd(refundedFields)] })
    expect(legacyOther.refundedMinor).toBe(10_000)
    // Legacy, same currency, buyer fee included in the refund: capped at face.
    const legacySame = run({ tickets: [ticket(1_000), ticket(1_000, { status: 'refunded', refund_status: 'approved', refund_amount: 1_100, refund_currency: 'HTG' })] })
    expect(legacySame.refundedMinor).toBe(100_000)
    // Legacy, same currency, a smaller refund counts as recorded.
    const partial = run({ tickets: [ticket(1_000, { status: 'refunded', refund_status: 'approved', refund_amount: 400, refund_currency: 'HTG' })] })
    expect(partial.refundedMinor).toBe(40_000)
  })

  it('refund_status approved alone (status still valid) is treated as refunded', () => {
    const a = run({ tickets: [ticket(1_000, { refund_status: 'approved' })] })
    expect(a.netMinor).toBe(0)
  })

  it('a refund in flight is held back, not withdrawable', () => {
    const a = run({ tickets: [ticket(1_000), ticket(1_000, { refund_status: 'processing' }), ticket(1_000, { refund_status: 'manual_required' })] })
    expect(a.netMinor).toBe(90_000)
    expect(a.refundInFlightMinor).toBe(200_000)
  })

  it('free and comp tickets count as sold but carry no money', () => {
    const a = run({ tickets: [ticket(0), ticket(0, { price_paid: undefined }), ticket(500)] })
    expect(a.ticketsSold).toBe(3)
    expect(a.netMinor).toBe(45_000)
    expect(a.unpaidTicketIds).toHaveLength(3)
  })

  it('Stripe Connect sales are already in the organizer’s Stripe account: never withdrawable here', () => {
    const a = run({ tickets: [ticket(100, { payment_method: 'stripe_connect' }), ticket(100)] })
    expect(a.heldByStripeGrossMinor).toBe(10_000)
    expect(a.heldByStripeMinor).toBe(9_000)
    expect(a.netMinor).toBe(9_000)
    expect(a.availableNowMinor).toBe(9_000)
  })
})

describe('already paid: per-event withdrawals and batch payouts (incl. processing / approved)', () => {
  it('per-event ledger withdrawals (pending + processing + completed) are subtracted', () => {
    const a = run({ tickets: [ticket(1_000)], ledger: { withdrawnMinor: 40_000 } })
    expect(a.balanceMinor).toBe(50_000)
    expect(a.availableNowMinor).toBe(50_000)
    expect(a.ceilingMinor).toBe(90_000)
  })

  it.each([['pending'], ['approved'], ['processing'], ['completed']])(
    'a legacy batch payout in status %s reserves its tickets (the old engine ignored `approved`)',
    (status) => {
      const t1 = ticket(1_000, { id: 'paid' })
      const t2 = ticket(1_000, { id: 'fresh' })
      const a = run({ tickets: [t1, t2], batchPayouts: [{ id: 'po1', status, ticketIds: ['paid'] }] })
      expect(a.batchReservedMinor).toBe(90_000)
      expect(a.availableNowMinor).toBe(90_000)
      expect(a.unpaidTicketIds).toEqual(['fresh'])
    }
  )

  it.each([['cancelled'], ['failed'], ['declined']])('a %s batch payout reserves nothing', (status) => {
    const a = run({ tickets: [ticket(1_000, { id: 'x' })], batchPayouts: [{ id: 'po1', status, ticketIds: ['x'] }] })
    expect(a.batchReservedMinor).toBe(0)
    expect(a.availableNowMinor).toBe(90_000)
  })

  it('a batch with recorded per-event amounts subtracts exactly what it paid', () => {
    const a = run({
      tickets: [ticket(1_000, { id: 'x' }), ticket(1_000)],
      batchPayouts: [{ id: 'po1', status: 'pending', ticketIds: ['x'], eventAmounts: { evt1: 60_000, other: 5 } }],
    })
    expect(a.batchReservedMinor).toBe(60_000)
    expect(a.availableNowMinor).toBe(120_000)
  })

  it('a batch that debited the ledger is not subtracted twice', () => {
    const a = run({
      tickets: [ticket(1_000, { id: 'x' })],
      ledger: { withdrawnMinor: 90_000 },
      batchPayouts: [{ id: 'po1', status: 'approved', ticketIds: ['x'], eventAmounts: { evt1: 90_000 }, debitedEventEarnings: true }],
    })
    expect(a.batchReservedMinor).toBe(0)
    expect(a.balanceMinor).toBe(0)
    expect(a.unpaidTicketIds).toEqual([])
  })

  it('never negative', () => {
    const a = run({ tickets: [ticket(100)], ledger: { withdrawnMinor: 1_000_000 } })
    expect(a.balanceMinor).toBe(0)
    expect(a.availableNowMinor).toBe(0)
  })
})

describe('release timing is the release ladder, not 7 days and not SETTLEMENT_HOLD_DAYS', () => {
  it('new organizer: held for 72h after the event ends, then released', () => {
    const held = run({ history: NEW_ORG, event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(48) }, tickets: [ticket(1_000)] })
    expect(held.availableNowMinor).toBe(0)
    expect(held.pendingMinor).toBe(90_000)
    expect(held.reason).toBe('hold_72h')
    expect(held.availableAt).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString())

    const released = run({ history: NEW_ORG, event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(73) }, tickets: [ticket(1_000)] })
    expect(released.availableNowMinor).toBe(90_000)
    expect(released.tier).toBe('new')
  })

  it('established organizer: 24h hold', () => {
    expect(run({ event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(23) }, tickets: [ticket(1_000)] }).availableNowMinor).toBe(0)
    expect(run({ event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(25) }, tickets: [ticket(1_000)] }).availableNowMinor).toBe(90_000)
  })

  it('released 3 days after the end — the old 7-day constant would still say pending', () => {
    const a = run({ history: NEW_ORG, event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(80) }, tickets: [ticket(1_000)] })
    expect(a.releasedNow).toBe(true)
  })

  it('event not over / no end date: nothing released', () => {
    const future = run({ event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(-5) }, tickets: [ticket(1_000)] })
    expect(future.reason).toBe('event_not_over')
    expect(future.availableNowMinor).toBe(0)
    const undated = run({ event: { id: 'evt1', currency: 'HTG', start_datetime: endedHoursAgo(500) }, tickets: [ticket(1_000)] })
    expect(undated.reason).toBe('no_end_date')
    expect(undated.availableNowMinor).toBe(0)
  })

  it('pre-event release needs the admin grant (and the gross threshold)', () => {
    const history = { ...ESTABLISHED, lifetimeGrossMinor: 50_000_000, preEventReleaseApproved: true }
    const a = run({ history, event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(-48) }, tickets: [ticket(1_000)] })
    expect(a.tier).toBe('pre_event')
    expect(a.availableNowMinor).toBe(90_000)
  })

  it('review: held until an admin releases it', () => {
    const lowAttendance = [ticket(1_000, { checked_in: false })]
    const queued = run({ tickets: lowAttendance })
    expect(queued.reason).toBe('payout_under_review')
    expect(queued.availableNowMinor).toBe(0)
    const released = run({ tickets: lowAttendance, reviewStatus: 'released' })
    expect(released.availableNowMinor).toBe(90_000)
    // A pending review row holds even an otherwise automatic release.
    expect(run({ tickets: [ticket(1_000)], reviewStatus: 'pending' }).availableNowMinor).toBe(0)
  })

  it('cancelled / payout-frozen event, currency-review row, unknown release: nothing released (fail closed)', () => {
    const t = [ticket(1_000)]
    expect(run({ tickets: t, event: { id: 'evt1', currency: 'HTG', status: 'cancelled', end_datetime: endedHoursAgo(200) } }).reason).toBe('event_cancelled')
    expect(run({ tickets: t, event: { id: 'evt1', currency: 'HTG', payouts_frozen: true, end_datetime: endedHoursAgo(200) } }).availableNowMinor).toBe(0)
    const blocked = run({ tickets: t, ledger: { withdrawnMinor: 0, currencyBlocked: true } })
    expect(blocked.reason).toBe('earnings_currency_review')
    expect(blocked.availableNowMinor).toBe(0)
    expect(blocked.pendingMinor).toBe(90_000)
    const unknown = computeEventAvailability({ event: { id: 'evt1', end_datetime: endedHoursAgo(200) }, tickets: t, fee: HTG_RULE, release: null, now: NOW })
    expect(unknown.reason).toBe('release_unknown')
    expect(unknown.availableNowMinor).toBe(0)
  })
})

describe('timestamp field drift', () => {
  const end = new Date(NOW.getTime() - 100 * HOUR)
  it.each([
    ['ISO string', end.toISOString()],
    ['Date', end],
    ['Firestore Timestamp', { toDate: () => end }],
    ['serialized Timestamp', { _seconds: end.getTime() / 1000, _nanoseconds: 0 }],
    ['{ seconds }', { seconds: end.getTime() / 1000, nanoseconds: 0 }],
    ['epoch millis', end.getTime()],
  ])('end_datetime as %s releases identically (the old engine read a Timestamp as Invalid Date)', (_label, value) => {
    const a = run({ event: { id: 'evt1', currency: 'HTG', end_datetime: value }, tickets: [ticket(1_000)] })
    expect(a.availableNowMinor).toBe(90_000)
    expect(a.availableAt).toBe(new Date(end.getTime() + 24 * HOUR).toISOString())
  })

  it('endDateTime (camelCase) is accepted too', () => {
    const a = run({ event: { id: 'evt1', currency: 'HTG', endDateTime: end.toISOString() }, tickets: [ticket(1_000)] })
    expect(a.releasedNow).toBe(true)
  })

  it('purchase time is read from purchased_at, purchasedAt, created_at or createdAt', () => {
    const a = run({
      tickets: [
        ticket(10, { purchased_at: undefined, created_at: '2026-09-01T00:00:00.000Z' }),
        ticket(10, { purchased_at: undefined, createdAt: { toDate: () => new Date('2026-09-03T00:00:00.000Z') } }),
        ticket(10, { purchased_at: { _seconds: Date.parse('2026-09-02T00:00:00.000Z') / 1000 } }),
        ticket(10, { purchased_at: undefined, purchasedAt: '2026-09-04T00:00:00.000Z' }),
      ],
    })
    expect(a.periodStart).toBe('2026-09-01T00:00:00.000Z')
    expect(a.periodEnd).toBe('2026-09-04T00:00:00.000Z')
  })

  it('toDateOrNull rejects junk rather than inventing a date', () => {
    expect(toDateOrNull('not a date')).toBeNull()
    expect(toDateOrNull({})).toBeNull()
    expect(toDateOrNull(null)).toBeNull()
  })
})

describe('per-currency separation', () => {
  it('HTG and USD are never summed', () => {
    const htg = run({ tickets: [ticket(1_000)] })
    const usd = run({
      event: { id: 'evt2', currency: 'USD', end_datetime: endedHoursAgo(200) },
      fee: USD_RULE,
      tickets: [ticket(50, { event_id: 'evt2', payment_method: 'stripe', currency: 'USD' })],
    })
    const totals = summarizeAvailability([usd, htg, run({ tickets: [ticket(100)] })])
    expect(totals.map((t) => t.currency)).toEqual(['HTG', 'USD'])
    expect(totals[0].availableNowMinor).toBe(90_000 + 9_000)
    expect(totals[1].availableNowMinor).toBe(4_500)
  })
})

describe('the earnings row every screen reads', () => {
  it('net − withdrawn equals the balance a withdrawal is judged against; available is the released figure', () => {
    const a = run({ tickets: [ticket(10_000)], ledger: { withdrawnMinor: 100_000 } })
    const row = toEarningsRow(a, NOW)
    expect(row.netAmount - row.withdrawnAmount).toBe(a.balanceMinor)
    expect(row.availableToWithdraw).toBe(a.availableNowMinor)
    expect(row.release.releasableMinor).toBe(a.availableNowMinor)
    expect(row.settlementStatus).toBe('ready')
  })

  it('held rows are pending with the release date, so mobile shows 0 and the date', () => {
    const a = run({ history: NEW_ORG, event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(1) }, tickets: [ticket(1_000)] })
    const row = toEarningsRow(a, NOW)
    expect(row.availableToWithdraw).toBe(0)
    expect(row.settlementStatus).toBe('pending')
    expect(row.release.releasedNow).toBe(false)
    expect(row.settlementReadyDate).toBe(a.availableAt)
  })
})

// ---------------------------------------------------------------------------
// Trust boundary: the event doc is organizer-editable; tickets and the ledger
// are server-written. Money inputs must come from the latter.
// ---------------------------------------------------------------------------
import { gateEventData, integrityRefusal } from '@/lib/payouts/availability'

describe('server-authoritative money inputs (S2)', () => {
  it('event re-labelled HTG → USD after sales: held for review, 0 available (was ~130x)', () => {
    const a = run({
      event: { id: 'evt1', currency: 'USD', end_datetime: endedHoursAgo(200) },
      fee: USD_RULE,
      tickets: [ticket(1_000)], // sold in HTG
    })
    expect(a.reason).toBe('ticket_currency_review')
    expect(a.availableNowMinor).toBe(0)
    expect(integrityRefusal(a)?.status).toBe(409)
    expect(toEarningsRow(a, NOW).withdrawalBlocked).toEqual({ code: 'ticket_currency_review', eventCurrency: 'USD' })
  })

  it('a paid ticket with no stamped currency: review; free tickets need none', () => {
    expect(run({ tickets: [ticket(1_000, { currency: undefined })] }).reason).toBe('ticket_currency_review')
    expect(run({ tickets: [ticket(1_000), ticket(0, { currency: undefined })] }).availableNowMinor).toBe(90_000)
    // original_currency (the sale currency) wins over a later `currency` label
    expect(run({ tickets: [ticket(1_000, { currency: 'USD', original_currency: 'HTG' })] }).availableNowMinor).toBe(90_000)
  })

  it('ticket-derived gross above the server ledger gross: review, 0 available', () => {
    const tickets = [ticket(1_000), ticket(1_000)]
    expect(run({ tickets, ledger: { withdrawnMinor: 0, grossMinor: 200_000 } }).availableNowMinor).toBe(180_000)
    const over = run({ tickets, ledger: { withdrawnMinor: 0, grossMinor: 199_999 } })
    expect(over.reason).toBe('ledger_gross_exceeded')
    expect(over.availableNowMinor).toBe(0)
    expect(integrityRefusal(over)?.body.code).toBe('ledger_gross_exceeded')
    // Refunded tickets are not counted against the ledger (it never decrements).
    const refunded = [ticket(1_000), ticket(1_000, { status: 'refunded', refund_status: 'approved' })]
    expect(run({ tickets: refunded, ledger: { withdrawnMinor: 0, grossMinor: 200_000 } }).availableNowMinor).toBe(90_000)
    // No recorded gross → no cap (rows without the figure, events with no row).
    expect(run({ tickets, ledger: { withdrawnMinor: 0, grossMinor: null } }).availableNowMinor).toBe(180_000)
  })

  it('moving end_datetime earlier cannot release early: the hold counts from the stamped end / last purchase', () => {
    const soldFor = endedHoursAgo(10) // the end buyers were sold
    const a = run({
      history: NEW_ORG,
      event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(500) }, // edited to look long over
      tickets: [ticket(1_000, { end_datetime: soldFor })],
    })
    expect(a.availableNowMinor).toBe(0)
    expect(a.reason).toBe('hold_72h')
    expect(a.effectiveEndsAt).toBe(soldFor)
    expect(gateEventData({ end_datetime: endedHoursAgo(500), title: 'x' }, a).end_datetime).toBe(soldFor)

    const lastSale = run({
      history: NEW_ORG,
      event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(500) },
      tickets: [ticket(1_000, { purchased_at: endedHoursAgo(5) })],
    })
    expect(lastSale.availableNowMinor).toBe(0)

    // Postponing still delays (the later of the two wins).
    const postponed = run({
      event: { id: 'evt1', currency: 'HTG', end_datetime: endedHoursAgo(-24) },
      tickets: [ticket(1_000, { end_datetime: endedHoursAgo(200) })],
    })
    expect(postponed.reason).toBe('event_not_over')
  })

  it('a "buyer" stamp WITHOUT the server proof does not waive the fee off the Stripe rails', () => {
    expect(run({ tickets: [ticket(1_000, { fee_incidence: 'buyer', payment_method: 'moncash' })] }).platformFeeMinor).toBe(10_000)
    expect(run({ tickets: [ticket(1_000, { fee_incidence: 'buyer', payment_method: 'sogepay' })] }).platformFeeMinor).toBe(10_000)
    expect(run({ tickets: [ticket(1_000, { fee_incidence: 'buyer', payment_method: 'moncash', buyer_fee_charged: 0 })] }).platformFeeMinor).toBe(10_000)
    expect(run({ tickets: [ticket(1_000, { fee_incidence: 'buyer', payment_method: 'stripe' })] }).platformFeeMinor).toBe(0)
  })

  it('a MonCash / NatCash / SogePay ticket with the buyer_fee_charged proof waives the fee (the buyer paid it)', () => {
    for (const method of ['moncash', 'moncash_button', 'natcash', 'sogepay']) {
      const a = run({ tickets: [ticket(1_000, { fee_incidence: 'buyer', payment_method: method, buyer_fee_charged: 10_000 })] })
      expect(a.platformFeeMinor).toBe(0)
      expect(a.netMinor).toBe(100_000)
    }
    // The proof alone, with an organizer stamp, waives nothing.
    expect(run({ tickets: [ticket(1_000, { fee_incidence: 'organizer', buyer_fee_charged: 10_000 })] }).platformFeeMinor).toBe(10_000)
  })

  it('a server-side cancellation on the ledger holds everything even if the event doc was "un-cancelled"', () => {
    const a = run({ tickets: [ticket(1_000)], ledger: { withdrawnMinor: 0, cancelled: true } })
    expect(a.reason).toBe('event_cancelled')
    expect(a.availableNowMinor).toBe(0)
    expect(gateEventData({ status: 'published' }, a).status).toBe('cancelled')
  })
})

describe('withdrawn = max(all ledger rows, independent payment records)', () => {
  it('duplicate ledger rows: every row counts, and the debit ceiling is cut accordingly', () => {
    // Two rows (pre-deterministic-id), 30k withdrawn on each; debits land on one.
    const a = run({ tickets: [ticket(1_000)], ledger: { withdrawnMinor: 60_000, primaryWithdrawnMinor: 30_000 } })
    expect(a.withdrawnMinor).toBe(60_000)
    expect(a.balanceMinor).toBe(30_000)
    // ceiling − primary row withdrawn (what the debit transaction checks) = balance
    expect(a.ceilingMinor - 30_000).toBe(a.balanceMinor)
  })

  it('live withdrawal requests above the ledger win (a lost ledger debit cannot re-open money)', () => {
    const a = run({ tickets: [ticket(1_000)], ledger: { withdrawnMinor: 0 }, liveRequestsMinor: 50_000 })
    expect(a.withdrawnMinor).toBe(50_000)
    expect(a.availableNowMinor).toBe(40_000)
    expect(a.ceilingMinor).toBe(40_000) // primary row shows 0 withdrawn
  })

  it('ledger-debited batches count on the records side too', () => {
    const a = run({
      tickets: [ticket(1_000, { id: 'x' })],
      ledger: { withdrawnMinor: 0 },
      liveRequestsMinor: 10_000,
      batchPayouts: [{ id: 'b', status: 'approved', ticketIds: ['x'], eventAmounts: { evt1: 70_000 }, debitedEventEarnings: true }],
    })
    expect(a.withdrawnMinor).toBe(80_000)
    expect(a.availableNowMinor).toBe(10_000)
  })

  it('records below the ledger change nothing', () => {
    const a = run({ tickets: [ticket(1_000)], ledger: { withdrawnMinor: 40_000 }, liveRequestsMinor: 10_000 })
    expect(a.withdrawnMinor).toBe(40_000)
    expect(a.availableNowMinor).toBe(50_000)
  })
})

describe('requested refunds hold that ticket’s net until decided', () => {
  it('a requested refund holds only that ticket’s organizer net, not the event', () => {
    const a = run({ tickets: [ticket(1_000), ticket(10_000, { refund_status: 'requested' })] })
    // 10,000 HTG ticket nets 9,000 after the 10% fee; that is what is held.
    expect(a.refundRequestedMinor).toBe(900_000)
    expect(a.netMinor).toBe(90_000 + 900_000)
    expect(a.availableNowMinor).toBe(90_000)
    const row = toEarningsRow(a, NOW)
    expect(row.netAmount - row.withdrawnAmount).toBe(a.balanceMinor)
    expect(row.refundRequestedAmount).toBe(900_000)
  })

  it('a ticket inside a multi-ticket order holds its share of the order fee only', () => {
    const a = run({ tickets: [ticket(1_000, { payment_id: 'p' }), ticket(1_000, { payment_id: 'p', refund_status: 'pending' })] })
    expect(a.refundRequestedMinor).toBe(90_000)
    expect(a.availableNowMinor).toBe(90_000)
  })

  it('denied (or none) releases the hold', () => {
    for (const st of ['denied', 'none', null]) {
      const a = run({ tickets: [ticket(1_000), ticket(1_000, { refund_status: st })] })
      expect(a.refundRequestedMinor).toBe(0)
      expect(a.availableNowMinor).toBe(180_000)
    }
  })

  it('approved is excluded as refunded — never counted twice', () => {
    const a = run({ tickets: [ticket(1_000), ticket(1_000, { status: 'refunded', refund_status: 'approved' })] })
    expect(a.refundRequestedMinor).toBe(0)
    expect(a.availableNowMinor).toBe(90_000)
    // processing / manual_required: in flight, also not double-counted
    const b = run({ tickets: [ticket(1_000), ticket(1_000, { refund_status: 'processing' })] })
    expect(b.refundRequestedMinor).toBe(0)
    expect(b.availableNowMinor).toBe(90_000)
  })

  it('the debit ceiling carries the hold too', () => {
    const a = run({ tickets: [ticket(1_000), ticket(1_000, { refund_status: 'requested' })], ledger: { withdrawnMinor: 0 } })
    expect(a.ceilingMinor).toBe(90_000)
  })
})

import { ticketFactsFromDocs, ticketRefundedFaceMinor } from '@/lib/payouts/availability'
import { ticketFeeIncidence } from '@/lib/payouts/fee-incidence'

describe('refund face value and fee incidence helpers', () => {
  it('ticketFactsFromDocs counts refunds at face value in the ticket’s sale currency', () => {
    const facts = ticketFactsFromDocs([
      { status: 'refunded', price_paid: 100, currency: 'USD', refund_amount: 14_850, refund_currency: 'HTG' },
      { status: 'refunded', price_paid: 100, currency: 'USD', refund_amount: 14_850, refund_currency: 'HTG', refund_face_amount: 100 },
      { status: 'refunded', price_paid: 500, currency: 'HTG', refund_amount: 550, refund_currency: 'HTG' },
    ])
    expect(facts.refundedMinor).toBe(10_000 + 10_000 + 50_000)
  })

  it('ticketRefundedFaceMinor never exceeds the face price', () => {
    expect(ticketRefundedFaceMinor({ price_paid: 10, refund_face_amount: 25 })).toBe(1_000)
    expect(ticketRefundedFaceMinor({ price_paid: 10 })).toBe(1_000)
    expect(ticketRefundedFaceMinor({ price_paid: 0, refund_amount: 0 })).toBe(0)
  })

  it('ticketFeeIncidence: buyer only on Stripe or with the proof', () => {
    expect(ticketFeeIncidence({ fee_incidence: 'buyer', payment_method: 'stripe_connect' })).toBe('buyer')
    expect(ticketFeeIncidence({ fee_incidence: 'buyer', payment_method: 'moncash' })).toBe('organizer')
    expect(ticketFeeIncidence({ fee_incidence: 'buyer', payment_method: 'moncash', buyer_fee_charged: 1 })).toBe('buyer')
    expect(ticketFeeIncidence({ payment_method: 'stripe' })).toBe('organizer')
  })
})
