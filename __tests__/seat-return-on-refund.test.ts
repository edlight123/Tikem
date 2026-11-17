/**
 * @jest-environment node
 *
 * A refunded ticket gives its seat back, exactly once (payment audit, 2026-11-17).
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockFake = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockFake
  },
}))
const mockRelease = jest.fn(async (..._a: any[]) => ({ released: true, state: 'sold' }))
jest.mock('@/lib/tickets/inventoryShards', () => ({ releaseSeats: (...a: any[]) => mockRelease(...a) }))

import { returnSeatForRefundedTicket, reservationIdForTicket } from '@/lib/tickets/seatReturn'

beforeEach(() => {
  mockFake.store.clear()
  mockRelease.mockClear()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

it('releases one seat of the ticket tier from the recorded reservation, once', async () => {
  mockFake.write('tickets/t1', { status: 'refunded', tier_id: 'vip', reservation_id: 'hold_' + 'a'.repeat(32) })
  expect(await returnSeatForRefundedTicket('t1')).toBe('returned')
  expect(mockRelease).toHaveBeenCalledWith(
    expect.objectContaining({ reservationId: 'hold_' + 'a'.repeat(32), quantity: 1, tierIncrements: [{ tierId: 'vip', quantity: 1 }] })
  )
  expect(await returnSeatForRefundedTicket('t1')).toBe('already')
  expect(mockRelease).toHaveBeenCalledTimes(1)
})

it('a ticket that is not refunded keeps its seat', async () => {
  mockFake.write('tickets/t2', { status: 'valid', reservation_id: 'r' })
  expect(await returnSeatForRefundedTicket('t2')).toBe('skipped')
  expect(mockRelease).not.toHaveBeenCalled()
})

it('older tickets find their reservation through the order', async () => {
  mockFake.write('stripe_orders/pi_9', { steps: { inventory: { reservation_id: 'hold_x' } } })
  expect(await reservationIdForTicket({ payment_id: 'pi_9', payment_method: 'stripe' })).toBe('hold_x')

  mockFake.write('pending_transactions/p1', { order_id: 'ord-1', transaction_id: 'mc123', seat_hold_id: 'expired' })
  expect(await reservationIdForTicket({ payment_id: 'mc123', payment_method: 'moncash' })).toBe('order_ord-1')
  expect(await reservationIdForTicket({ payment_method: 'comp' })).toBeNull()
})
