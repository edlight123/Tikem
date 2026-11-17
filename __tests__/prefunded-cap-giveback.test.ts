/**
 * @jest-environment node
 *
 * A prefunded transfer MonCash definitively rejected gives its share of the
 * day's cap back, once (owner, 2026-11-17).
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockFake = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockFake
  },
}))
import { returnDailyCapForRejectedTransfer } from '@/lib/payouts/instant-moncash-policy'

beforeEach(() => mockFake.store.clear())

it('gives the pool debit back to the day counter exactly once', async () => {
  mockFake.write('instant_moncash_transfer_days/2026-11-17', { totalHtgCents: 103_000, count: 2 })
  mockFake.write('withdrawal_requests/w1', { status: 'failed' })
  const args = {
    withdrawalRef: mockFake.collection('withdrawal_requests').doc('w1'),
    dailyRef: mockFake.collection('instant_moncash_transfer_days').doc('2026-11-17'),
    poolDebitHtgCents: 51_500,
  }
  expect(await returnDailyCapForRejectedTransfer(args)).toBe(true)
  expect(mockFake.store.get('instant_moncash_transfer_days/2026-11-17')).toMatchObject({ totalHtgCents: 51_500, count: 1 })
  expect(await returnDailyCapForRejectedTransfer(args)).toBe(false)
  expect(mockFake.store.get('instant_moncash_transfer_days/2026-11-17')).toMatchObject({ totalHtgCents: 51_500, count: 1 })
})

it('never takes the counter below zero', async () => {
  mockFake.write('admin_moncash_transfer_days/2026-11-17', { totalHtgCents: 100, count: 1 })
  mockFake.write('withdrawal_requests/w2', {})
  await returnDailyCapForRejectedTransfer({
    withdrawalRef: mockFake.collection('withdrawal_requests').doc('w2'),
    dailyRef: mockFake.collection('admin_moncash_transfer_days').doc('2026-11-17'),
    poolDebitHtgCents: 5_000,
  })
  expect(mockFake.store.get('admin_moncash_transfer_days/2026-11-17')).toMatchObject({ totalHtgCents: 0, count: 0 })
})
