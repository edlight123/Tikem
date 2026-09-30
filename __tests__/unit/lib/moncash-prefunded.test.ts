/**
 * @jest-environment node
 */
jest.mock('@/lib/moncash', () => ({
  moncashPrefundedTransfer: jest.fn(),
  moncashPrefundedTransactionStatus: jest.fn(),
  moncashPrefundedBalance: jest.fn(),
}))

import {
  classifyPrefundedTransferError,
  computePrefundedPayout,
  executePrefundedTransfer,
  normalizeMoncashReceiver,
  prefundedBalanceCovers,
  sameMoncashNumberLast4,
} from '@/lib/payouts/moncash-prefunded'
import {
  moncashPrefundedBalance,
  moncashPrefundedTransactionStatus,
  moncashPrefundedTransfer,
} from '@/lib/moncash'

const transfer = moncashPrefundedTransfer as jest.Mock
const status = moncashPrefundedTransactionStatus as jest.Mock
const balance = moncashPrefundedBalance as jest.Mock

const params = { amount: 970, receiver: '50937007294', desc: 'x', reference: 'wr_1' }

beforeEach(() => {
  transfer.mockReset()
  status.mockReset()
  balance.mockReset()
})

describe('normalizeMoncashReceiver', () => {
  it.each([
    ['37007294', '50937007294'],
    ['+509 3700 7294', '50937007294'],
    ['509-3700-7294', '50937007294'],
    ['0050937007294', '50937007294'],
    ['(509) 37 00 72 94', '50937007294'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeMoncashReceiver(raw)).toBe(expected)
  })

  it.each(['', '1234567', '123456789', '+1 305 555 0100', '51137007294', null, undefined])(
    'rejects %p',
    (raw) => {
      expect(normalizeMoncashReceiver(raw)).toBeNull()
    }
  )
})

describe('sameMoncashNumberLast4', () => {
  it('matches on the saved last 4', () => {
    expect(sameMoncashNumberLast4('50937007294', '7294')).toBe(true)
    expect(sameMoncashNumberLast4('50937007294', '1111')).toBe(false)
  })
  it('never matches without a saved number', () => {
    expect(sameMoncashNumberLast4('50937007294', undefined)).toBe(false)
    expect(sameMoncashNumberLast4('50937007294', '')).toBe(false)
  })
})

describe('computePrefundedPayout', () => {
  it('sends the NET (97%) and books Digicel 3% of what is sent, on top', () => {
    const q = computePrefundedPayout(100_000) // 1,000.00 HTG gross
    expect(q.feeCents).toBe(3_000)
    expect(q.payoutAmountCents).toBe(97_000)
    expect(q.payoutAmountHtgCents).toBe(97_000)
    expect(q.providerFeeHtgCents).toBe(2_910)
    expect(q.poolDebitHtgCents).toBe(99_910)
  })

  it('the 3% collected always covers Digicel\'s 3% of the net', () => {
    for (const g of [5_000, 5_001, 12_345, 99_999, 1_000_000, 7_654_321]) {
      const q = computePrefundedPayout(g)
      expect(q.feeCents).toBeGreaterThanOrEqual(q.providerFeeHtgCents)
      // And the pool is never debited more than the gross withdrawn.
      expect(q.poolDebitHtgCents).toBeLessThanOrEqual(g)
    }
  })

  it('converts USD net to HTG for the transfer', () => {
    const q = computePrefundedPayout(10_000, 130) // $100.00
    expect(q.feeCents).toBe(300)
    expect(q.payoutAmountCents).toBe(9_700)
    expect(q.payoutAmountHtgCents).toBe(1_261_000) // 12,610.00 HTG
    expect(q.providerFeeHtgCents).toBe(37_830)
  })
})

describe('classifyPrefundedTransferError', () => {
  it('treats MonCash 4xx and token failures as definitive rejections', () => {
    expect(classifyPrefundedTransferError(new Error('MonCash REST request failed (400): bad receiver'))).toBe('rejected')
    expect(classifyPrefundedTransferError(new Error('MonCash REST request failed (403): not allowed'))).toBe('rejected')
    expect(classifyPrefundedTransferError(new Error('Failed to get MonCash token (401; ...)'))).toBe('rejected')
    expect(classifyPrefundedTransferError(new Error('MonCash credentials not configured'))).toBe('rejected')
  })

  it('treats anything that might have moved money as ambiguous', () => {
    expect(classifyPrefundedTransferError(new Error('MonCash REST request failed (500): oops'))).toBe('ambiguous')
    expect(classifyPrefundedTransferError(new Error('MonCash REST request failed (504): gateway'))).toBe('ambiguous')
    expect(classifyPrefundedTransferError(new Error('MonCash REST request failed (408): timeout'))).toBe('ambiguous')
    expect(classifyPrefundedTransferError(new Error('MonCash REST request failed (409): duplicate'))).toBe('ambiguous')
    expect(classifyPrefundedTransferError(new TypeError('fetch failed'))).toBe('ambiguous')
    expect(classifyPrefundedTransferError(new Error('Unexpected MonCash prefunded transfer response: {}'))).toBe('ambiguous')
  })

  it('treats our own request timeout as ambiguous — the transfer may have landed', async () => {
    // What monCashRestRequest's AbortSignal.timeout actually throws.
    const err = await fetch('http://127.0.0.1:9', { signal: AbortSignal.timeout(1) }).catch((e) => e)
    expect(classifyPrefundedTransferError(err)).toBe('ambiguous')
    expect(classifyPrefundedTransferError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('ambiguous')
  })
})

describe('executePrefundedTransfer', () => {
  it('completes on a clean transfer', async () => {
    transfer.mockResolvedValue({ transactionId: 'T1', raw: { ok: 1 } })
    await expect(executePrefundedTransfer(params)).resolves.toMatchObject({
      outcome: 'completed',
      transactionId: 'T1',
      confirmedVia: 'transfer',
    })
    expect(status).not.toHaveBeenCalled()
  })

  it('rejects without a status check on a definitive 4xx', async () => {
    transfer.mockRejectedValue(new Error('MonCash REST request failed (400): insufficient balance'))
    await expect(executePrefundedTransfer(params)).resolves.toMatchObject({ outcome: 'rejected' })
    expect(status).not.toHaveBeenCalled()
  })

  it('confirms an ambiguous failure via PrefundedTransactionStatus when it says successful', async () => {
    transfer.mockRejectedValue(new TypeError('fetch failed'))
    status.mockResolvedValue({ transStatus: 'successful', raw: { transStatus: 'successful' } })
    await expect(executePrefundedTransfer(params)).resolves.toMatchObject({
      outcome: 'completed',
      confirmedVia: 'status_check',
    })
    expect(status).toHaveBeenCalledWith('wr_1')
  })

  it('holds (never refunds) when the status check is anything but successful', async () => {
    transfer.mockRejectedValue(new Error('MonCash REST request failed (502): bad gateway'))
    status.mockResolvedValue({ transStatus: 'pending', raw: { transStatus: 'pending' } })
    await expect(executePrefundedTransfer(params)).resolves.toMatchObject({ outcome: 'unconfirmed' })
  })

  it('does not read the envelope "successful" message as the transfer succeeding', async () => {
    transfer.mockRejectedValue(new TypeError('fetch failed'))
    status.mockResolvedValue({ transStatus: 'successful', raw: { message: 'successful' } })
    await expect(executePrefundedTransfer(params)).resolves.toMatchObject({ outcome: 'unconfirmed' })
  })

  it('holds when the status check itself fails', async () => {
    transfer.mockRejectedValue(new TypeError('fetch failed'))
    status.mockRejectedValue(new Error('MonCash REST request failed (503): down'))
    const out = await executePrefundedTransfer(params)
    expect(out.outcome).toBe('unconfirmed')
  })
})

describe('prefundedBalanceCovers', () => {
  it('requires the pool to cover transfer + Digicel fee', async () => {
    balance.mockResolvedValue({ balance: 999.1 })
    await expect(prefundedBalanceCovers(99_910)).resolves.toBe(true)
    balance.mockResolvedValue({ balance: 999.09 })
    await expect(prefundedBalanceCovers(99_910)).resolves.toBe(false)
  })
  it('an empty pool or a failed lookup is a no', async () => {
    balance.mockResolvedValue({ balance: 0 })
    await expect(prefundedBalanceCovers(0)).resolves.toBe(false)
    balance.mockRejectedValue(new Error('down'))
    await expect(prefundedBalanceCovers(1)).resolves.toBe(false)
  })
})
