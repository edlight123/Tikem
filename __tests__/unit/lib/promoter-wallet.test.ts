/**
 * Wallet money math: released-vs-pending bucketing, prior withdrawals, the
 * unsupported-currency fence, and the 3% instant fee. The release decision
 * itself is the organizer ladder's (tested in payout-release-rules); here it
 * arrives as a boolean per line.
 */

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: jest.fn() } }))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({ previewRelease: jest.fn() }))
jest.mock('@/lib/earnings', () => ({ getEventEarnings: jest.fn() }))
jest.mock('@/lib/payouts/availability-server', () => ({ loadEventAvailability: jest.fn() }))
jest.mock('@/lib/promoters', () => ({ excludeStripeConnectSales: jest.fn(async (rows: any[]) => rows) }))
jest.mock('@/lib/moncash', () => ({ moncashPrefundedTransfer: jest.fn() }))
jest.mock('@/lib/currency', () => ({ fetchUsdToHtgRate: jest.fn() }))

import {
  computeWalletBuckets,
  computeWithdrawalFee,
  PROMOTER_WITHDRAWAL_FEE_PERCENT,
  promoterHoldFromAvailability,
} from '@/lib/promoter-wallet'

describe('computeWalletBuckets', () => {
  it('splits released vs pending per currency', () => {
    const buckets = computeWalletBuckets(
      [
        { currency: 'HTG', commissionCents: 50_000, released: true },
        { currency: 'HTG', commissionCents: 20_000, released: false },
        { currency: 'USD', commissionCents: 1_000, released: true },
      ],
      {}
    )
    expect(buckets.availableByCurrency).toEqual({ HTG: 50_000, USD: 1_000 })
    expect(buckets.pendingByCurrency).toEqual({ HTG: 20_000 })
  })

  it('nets prior withdrawals out of the released bucket only', () => {
    const buckets = computeWalletBuckets(
      [
        { currency: 'HTG', commissionCents: 50_000, released: true },
        { currency: 'HTG', commissionCents: 30_000, released: false },
      ],
      { HTG: 40_000 }
    )
    expect(buckets.availableByCurrency).toEqual({ HTG: 10_000 })
    expect(buckets.pendingByCurrency).toEqual({ HTG: 30_000 })
  })

  it('records a debt (signed balance) when a reversal outruns withdrawals, instead of hiding it', () => {
    const buckets = computeWalletBuckets(
      [{ currency: 'HTG', commissionCents: 10_000, released: true }],
      { HTG: 25_000 }
    )
    expect(buckets.availableByCurrency).toEqual({})
    expect(buckets.owedByCurrency).toEqual({ HTG: 15_000 })
  })

  it('new commission pays the debt down before anything is available again', () => {
    const buckets = computeWalletBuckets(
      [
        { currency: 'HTG', commissionCents: 10_000, released: true },
        { currency: 'HTG', commissionCents: 20_000, released: true },
      ],
      { HTG: 25_000 }
    )
    expect(buckets.owedByCurrency).toEqual({})
    expect(buckets.availableByCurrency).toEqual({ HTG: 5_000 })
  })

  it('a temporarily held (pending) event is not mistaken for a debt', () => {
    const buckets = computeWalletBuckets(
      [{ currency: 'HTG', commissionCents: 30_000, released: false }],
      { HTG: 25_000 }
    )
    expect(buckets.owedByCurrency).toEqual({})
    expect(buckets.availableByCurrency).toEqual({})
  })

  it('fences non-MonCash currencies off from withdrawal', () => {
    const buckets = computeWalletBuckets(
      [{ currency: 'EUR', commissionCents: 5_000, released: true }],
      {}
    )
    expect(buckets.availableByCurrency).toEqual({})
    expect(buckets.unsupportedByCurrency).toEqual({ EUR: 5_000 })
  })
})

describe('computeWithdrawalFee', () => {
  it('charges the promoter 3% and pays the rest', () => {
    expect(PROMOTER_WITHDRAWAL_FEE_PERCENT).toBe(0.03)
    expect(computeWithdrawalFee(100_000)).toEqual({ feeCents: 3_000, payoutCents: 97_000 })
  })
  it('handles zero and junk safely', () => {
    expect(computeWithdrawalFee(0)).toEqual({ feeCents: 0, payoutCents: 0 })
    expect(computeWithdrawalFee(NaN as any)).toEqual({ feeCents: 0, payoutCents: 0 })
  })
})

describe('promoterHoldFromAvailability', () => {
  const clear = { reason: 'eligible', refundRequestedMinor: 0, refundInFlightMinor: 0 } as any
  it('passes a clean event through to the ladder', () => {
    expect(promoterHoldFromAvailability(clear)).toBeNull()
    expect(promoterHoldFromAvailability({ ...clear, reason: 'nothing_owed' })).toBeNull()
  })
  it('holds on integrity, cancellation, freeze and review', () => {
    for (const reason of ['payouts_frozen', 'event_cancelled', 'ticket_currency_review', 'ledger_gross_exceeded', 'earnings_currency_review', 'payout_under_review', 'release_unknown']) {
      expect(promoterHoldFromAvailability({ ...clear, reason })).toBe(reason)
    }
  })
  it('holds while any refund is requested or in flight', () => {
    expect(promoterHoldFromAvailability({ ...clear, refundRequestedMinor: 1 })).toBe('refund_requested')
    expect(promoterHoldFromAvailability({ ...clear, refundInFlightMinor: 1 })).toBe('refund_in_flight')
  })
})
