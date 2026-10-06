/**
 * @jest-environment node
 *
 * Attend-then-refund: walking in through the door denies a refund request
 * nobody has acted on yet; refunds already moving are still refused entry.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

import { checkInTicket } from '@/lib/scan/checkInTicket'

const run = () => checkInTicket({ ticketId: 't1', eventId: 'e1', entryPoint: 'Main', scannedBy: 'staff', checkInMethod: 'manual' })

beforeEach(() => {
  db.store.clear()
  db.write('events/e1', { title: 'Konpa' })
})

describe('check-in and refund requests', () => {
  it('admits a ticket with a pending request and denies the request in the same write', async () => {
    db.write('tickets/t1', { event_id: 'e1', status: 'valid', refund_status: 'requested', attendee_name: 'Ana' })
    const res = await run()
    expect(res).toMatchObject({ success: true, type: 'VALID' })
    expect(db.store.get('tickets/t1')).toMatchObject({ checked_in: true, refund_status: 'denied', refund_denied_reason: 'checked_in' })
  })

  it('still refuses a ticket whose refund is moving', async () => {
    db.write('tickets/t1', { event_id: 'e1', status: 'valid', refund_status: 'processing' })
    expect(await run()).toMatchObject({ success: false, reason: 'REFUNDED' })
  })

  it('leaves a ticket with no request untouched apart from the check-in', async () => {
    db.write('tickets/t1', { event_id: 'e1', status: 'valid' })
    await run()
    expect(db.store.get('tickets/t1')?.refund_status).toBeUndefined()
  })
})
