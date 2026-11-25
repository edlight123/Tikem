/**
 * Money map: per currency and rail, collected − refunded − chargebacks −
 * moved out (fees included) + moved in; organizer wires matched against the
 * withdrawal they settle; and the Haiti owed-vs-prefunded shortfall.
 */
import {
  checkPayout,
  computeMoneyMap,
  saleFactsFromTicket,
  transferInRange,
  type FundTransfer,
  type MoneyMapInput,
} from '@/lib/payouts/money-map'

const transfer = (over: Partial<FundTransfer>): FundTransfer => ({
  id: over.id || `t${Math.random()}`,
  kind: 'movement',
  fromAccount: 'stripe_platform',
  toAccount: 'bank',
  amountMinor: 0,
  currency: 'USD',
  toAmountMinor: over.amountMinor || 0,
  toCurrency: over.currency || 'USD',
  fxRate: null,
  feeMinor: 0,
  reference: null,
  date: '2026-11-10',
  note: null,
  createdAt: null,
  createdBy: null,
  createdByEmail: null,
  organizerId: null,
  withdrawalId: null,
  withdrawal: null,
  ...over,
})

const haiti = (over: Partial<MoneyMapInput['haiti']> = {}): MoneyMapInput['haiti'] => ({
  owedEventsHtgMinor: 0,
  owedEventsUsdMinor: 0,
  unsentWithdrawalsHtgMinor: 0,
  poolBalanceHtg: 0,
  htgPerUsd: 131.58,
  ...over,
})

const htCard = (over: Record<string, any> = {}) => ({
  status: 'valid',
  payment_method: 'stripe',
  funds_rail: 'stripe_platform',
  price_paid: 5000,
  currency: 'HTG',
  original_currency: 'HTG',
  charged_amount: 38,
  charged_currency: 'USD',
  ...over,
})
const moncash = (over: Record<string, any> = {}) => ({
  status: 'confirmed',
  payment_method: 'moncash',
  price_paid: 2500,
  currency: 'HTG',
  charged_amount: 2500,
  charged_currency: 'HTG',
  ...over,
})

describe('saleFactsFromTicket', () => {
  it('a Haiti card sale is USD on Tikèm\'s Stripe balance, not HTG', () => {
    expect(saleFactsFromTicket(htCard())).toEqual({
      account: 'stripe_platform',
      currency: 'USD',
      grossMinor: 3800,
      refundedMinor: 0,
      disputedMinor: 0,
    })
  })

  it('a refund keeps the gross and records what went back', () => {
    const f = saleFactsFromTicket(htCard({ status: 'refunded', refund_amount: 36, refund_currency: 'USD' }))
    expect(f).toEqual(expect.objectContaining({ grossMinor: 3800, refundedMinor: 3600 }))
    const otherCurrency = saleFactsFromTicket(htCard({ refund_status: 'approved', refund_amount: 5000, refund_currency: 'HTG' }))
    expect(otherCurrency?.refundedMinor).toBe(3800)
  })

  it('a chargeback is subtracted; cancelled, pending and free tickets carry nothing', () => {
    expect(saleFactsFromTicket(htCard({ status: 'disputed' }))?.disputedMinor).toBe(3800)
    expect(saleFactsFromTicket(htCard({ status: 'cancelled' }))).toBeNull()
    expect(saleFactsFromTicket({ status: 'valid', payment_method: 'free', price_paid: 0 })).toBeNull()
  })

  it('door cash counts only once taken, on the cash line', () => {
    const door = { status: 'valid', payment_method: 'pay_at_door', price_paid: 0, door_price: 500, door_currency: 'HTG' }
    expect(saleFactsFromTicket(door)).toBeNull()
    expect(saleFactsFromTicket({ ...door, door_paid: true, door_amount: 500 })).toEqual(
      expect.objectContaining({ account: 'cash', currency: 'HTG', grossMinor: 50000 })
    )
  })

  it('an old ticket with no charged amount falls back to its face value', () => {
    expect(saleFactsFromTicket({ status: 'valid', payment_method: 'moncash', price_paid: 1000, currency: 'HTG' })).toEqual(
      expect.objectContaining({ account: 'moncash', currency: 'HTG', grossMinor: 100000 })
    )
  })
})

describe('computeMoneyMap', () => {
  it('splits by currency and rail and applies movements, fees included', () => {
    const map = computeMoneyMap({
      tickets: [htCard(), htCard(), moncash(), moncash({ status: 'refunded', refund_amount: 2500, refund_currency: 'HTG' })],
      transfers: [
        // Stripe paid 50 USD out to the bank.
        transfer({ fromAccount: 'stripe_platform', toAccount: 'bank', amountMinor: 5000, currency: 'USD', toAmountMinor: 5000, toCurrency: 'USD' }),
        // The bank wired 40 USD (+ 15 USD fee) into Digicel prefunding, arriving as HTG.
        transfer({
          fromAccount: 'bank',
          toAccount: 'moncash_prefunded',
          amountMinor: 4000,
          currency: 'USD',
          feeMinor: 1500,
          toAmountMinor: 526_320,
          toCurrency: 'HTG',
          fxRate: 131.58,
        }),
      ],
      haiti: haiti(),
    })
    expect(map.currencies.map((c) => c.currency)).toEqual(['HTG', 'USD'])
    const usd = map.currencies.find((c) => c.currency === 'USD')!
    const stripe = usd.lines.find((l) => l.account === 'stripe_platform')!
    expect(stripe).toEqual(expect.objectContaining({ tickets: 2, grossMinor: 7600, transferredOutMinor: 5000, balanceMinor: 2600 }))
    const bank = usd.lines.find((l) => l.account === 'bank')!
    expect(bank).toEqual(expect.objectContaining({ transferredInMinor: 5000, transferredOutMinor: 5500, balanceMinor: -500 }))
    const htg = map.currencies.find((c) => c.currency === 'HTG')!
    expect(htg.lines.find((l) => l.account === 'moncash')).toEqual(
      expect.objectContaining({ tickets: 2, grossMinor: 500_000, refundedMinor: 250_000, balanceMinor: 250_000 })
    )
    expect(htg.lines.find((l) => l.account === 'moncash_prefunded')?.balanceMinor).toBe(526_320)
  })

  it('money that sits with organizers is shown but not counted as Tikèm\'s', () => {
    const map = computeMoneyMap({
      tickets: [
        { status: 'valid', payment_method: 'stripe_connect', price_paid: 25, currency: 'USD', charged_amount: 27.49, charged_currency: 'USD' },
        htCard(),
      ],
      transfers: [],
      haiti: haiti(),
    })
    const usd = map.currencies[0]
    expect(usd.lines.find((l) => l.account === 'stripe_connect')?.tikemHeld).toBe(false)
    expect(usd.tikemCollectedMinor).toBe(3800)
  })

  it('handles a PayPal rail written by another checkout', () => {
    const map = computeMoneyMap({
      tickets: [{ status: 'valid', funds_rail: 'paypal', price_paid: 20, currency: 'USD', charged_amount: 20, charged_currency: 'USD' }],
      transfers: [],
      haiti: haiti(),
    })
    expect(map.currencies[0].lines[0]).toEqual(expect.objectContaining({ account: 'paypal', grossMinor: 2000, tikemHeld: true }))
  })

  it('Haiti: shortfall = owed (events + unsent MonCash withdrawals) − pool, in HTG and USD', () => {
    const map = computeMoneyMap({
      tickets: [htCard()],
      transfers: [],
      haiti: haiti({
        owedEventsHtgMinor: 10_000_000, // 100,000 HTG
        unsentWithdrawalsHtgMinor: 2_000_000, // 20,000 HTG
        poolBalanceHtg: 50_000,
        owedEventsBankRailHtgMinor: 3_000_000,
        unsentBankWithdrawalsHtgMinor: 1_000_000,
      }),
    })
    expect(map.haiti.owedMinor).toBe(12_000_000)
    expect(map.haiti.poolBalanceMinor).toBe(5_000_000)
    expect(map.haiti.shortfallMinor).toBe(7_000_000)
    // 70,000 HTG / 131.58 = 531.99 USD, rounded up.
    expect(map.haiti.shortfallUsdMinor).toBe(53_200)
    expect(map.haiti.owedByWireMinor).toBe(4_000_000)
    expect(map.haiti.movableUsdMinor).toBe(3800)
  })

  it('no shortfall when the pool covers it; unknown when the pool cannot be read', () => {
    expect(computeMoneyMap({ tickets: [], transfers: [], haiti: haiti({ owedEventsHtgMinor: 100, poolBalanceHtg: 10 }) }).haiti.shortfallMinor).toBe(0)
    const unread = computeMoneyMap({ tickets: [], transfers: [], haiti: haiti({ owedEventsHtgMinor: 100, poolBalanceHtg: null, poolError: 'down' }) })
    expect(unread.haiti.shortfallMinor).toBeNull()
    expect(unread.haiti.shortfallUsdMinor).toBeNull()
    expect(unread.haiti.poolError).toBe('down')
  })

  it('applies the date range to the ledger', () => {
    expect(transferInRange({ date: '2026-11-10' }, '2026-11-01', '2026-11-30')).toBe(true)
    expect(transferInRange({ date: '2026-10-31' }, '2026-11-01', null)).toBe(false)
    expect(transferInRange({ date: '2026-12-01' }, null, '2026-11-30')).toBe(false)
    const map = computeMoneyMap({
      from: '2026-11-01',
      tickets: [],
      transfers: [transfer({ amountMinor: 100, date: '2026-10-01' })],
      haiti: haiti(),
    })
    expect(map.transfers).toHaveLength(0)
  })
})

describe('organizer wires', () => {
  const wire = (over: Partial<FundTransfer> = {}) =>
    transfer({
      kind: 'organizer_payout',
      fromAccount: 'bank',
      toAccount: 'organizer',
      amountMinor: 76_000, // 760 USD
      currency: 'USD',
      feeMinor: 4_500, // 45 USD wire fee
      toAmountMinor: 10_000_000, // 100,000 HTG
      toCurrency: 'HTG',
      fxRate: 131.58,
      organizerId: 'org1',
      withdrawalId: 'w1',
      withdrawal: { amountMinor: 10_000_000, currency: 'HTG', status: 'pending', eventId: 'evt1' },
      reference: 'FT123',
      ...over,
    })

  it('leaves the sending account (fee included) and credits no Tikèm account', () => {
    const map = computeMoneyMap({ tickets: [], transfers: [wire()], haiti: haiti() })
    const usd = map.currencies.find((c) => c.currency === 'USD')!
    expect(usd.lines).toHaveLength(1)
    expect(usd.lines[0]).toEqual(expect.objectContaining({ account: 'bank', transferredOutMinor: 80_500, balanceMinor: -80_500 }))
    expect(map.currencies.find((c) => c.currency === 'HTG')).toBeUndefined()
    expect(map.payouts).toEqual([
      { currency: 'USD', count: 1, amountMinor: 76_000, feeMinor: 4_500, received: [{ currency: 'HTG', amountMinor: 10_000_000 }] },
    ])
  })

  it('is matched against the withdrawal it settles', () => {
    expect(checkPayout(wire()).state).toBe('matched')
    const short = checkPayout(wire({ toAmountMinor: 9_800_000 }))
    expect(short).toEqual(expect.objectContaining({ state: 'variance', varianceMinor: -200_000 }))
    expect(checkPayout(wire({ withdrawalId: null, withdrawal: null })).state).toBe('unlinked')
    expect(
      checkPayout(wire({ withdrawal: { amountMinor: 76_000, currency: 'USD', status: 'pending', eventId: null } })).state
    ).toBe('currency_mismatch')
  })

  it('lists every wire with its check, newest first', () => {
    const map = computeMoneyMap({
      tickets: [],
      transfers: [wire({ id: 'a', date: '2026-11-01' }), wire({ id: 'b', date: '2026-11-15', withdrawalId: null, withdrawal: null })],
      haiti: haiti(),
    })
    expect(map.payoutChecks.map((p) => [p.id, p.state])).toEqual([
      ['b', 'unlinked'],
      ['a', 'matched'],
    ])
  })
})
