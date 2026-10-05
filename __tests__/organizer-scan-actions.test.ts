/**
 * @jest-environment node
 *
 * Door-mode server actions (app/organizer/scan/actions.ts) and the check-in
 * engine behind them (lib/scan/checkInTicket.ts).
 *
 * Guards:
 *  - the actions authorize the caller for the event and record the SESSION uid,
 *    never the client-supplied scannedBy;
 *  - a refund_pending (or otherwise non-live) ticket is refused;
 *  - the re-entry override still refuses refunded / cancelled / refund_pending;
 *  - the response carries a name, never an email.
 */

import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

let access: any = { ok: true, uid: 'staff_1', role: 'staff', canViewAttendees: false, event: { id: 'ev1' } }
const authorizeDoorAccess = jest.fn(async (_eventId: string) => access)
jest.mock('@/lib/scan/doorService', () => ({
  authorizeDoorAccess: (eventId: string) => authorizeDoorAccess(eventId),
}))

import { performCheckIn, performOverrideCheckIn } from '@/app/organizer/scan/actions'
import { ticketBlockReason } from '@/lib/scan/checkInTicket'

const params = (ticketId: string, extra: Record<string, any> = {}) => ({
  ticketId,
  eventId: 'ev1',
  entryPoint: 'Main Entrance',
  scannedBy: 'forged_uid',
  ...extra,
})

beforeEach(() => {
  db.store.clear()
  access = { ok: true, uid: 'staff_1', role: 'staff', canViewAttendees: false, event: { id: 'ev1' } }
  authorizeDoorAccess.mockClear()
  db.write('events/ev1', { title: 'Konpa Night', organizer_id: 'org_1' })
  db.write('users/u_noname', { email: 'secret@example.com' })
  db.write('tickets/t_valid', { event_id: 'ev1', status: 'valid', attendee_name: 'Mika' })
  db.write('tickets/t_confirmed', { event_id: 'ev1', status: 'confirmed', attendee_id: 'u_noname' })
  db.write('tickets/t_guest', { event_id: 'ev1', status: 'confirmed', attendee_id: 'guest_x', guest_email: 'g@example.com' })
  db.write('tickets/t_refund_pending', { event_id: 'ev1', status: 'refund_pending', refund_status: 'manual_required' })
  db.write('tickets/t_processing', { event_id: 'ev1', status: 'valid', refund_status: 'processing' })
  db.write('tickets/t_refunded', { event_id: 'ev1', status: 'refunded', checked_in: true })
  db.write('tickets/t_cancelled', { event_id: 'ev1', status: 'cancelled', checked_in: true })
  db.write('tickets/t_transferred', { event_id: 'ev1', status: 'transferred' })
  db.write('tickets/t_in', { event_id: 'ev1', status: 'valid', checked_in: true, attendee_name: 'Rara' })
})

const ticket = (id: string) => db.store.get(`tickets/${id}`) as Record<string, any>

describe('performCheckIn', () => {
  it('refuses a caller without door access for the event, writing nothing', async () => {
    access = { ok: false, status: 403, error: 'You do not have check-in access for this event' }
    await expect(performCheckIn(params('t_valid'))).rejects.toThrow(/check-in access/)
    expect(authorizeDoorAccess).toHaveBeenCalledWith('ev1')
    expect(ticket('t_valid').checked_in).toBeUndefined()
  })

  it('records the session uid as the scanner, ignoring the client value', async () => {
    const res = await performCheckIn(params('t_valid'))
    expect(res).toMatchObject({ success: true, type: 'VALID', attendeeName: 'Mika' })
    expect(ticket('t_valid')).toMatchObject({ checked_in: true, checked_in_by: 'staff_1', check_in_method: 'scan' })
  })

  it('admits confirmed tickets and never returns an email as the name', async () => {
    const res = await performCheckIn(params('t_confirmed'))
    expect(res).toMatchObject({ success: true, attendeeName: 'Guest' })
    const guest = await performCheckIn(params('t_guest'))
    expect(guest).toMatchObject({ success: true, attendeeName: 'Guest' })
    expect(JSON.stringify([res, guest])).not.toMatch(/@example\.com/)
  })

  it.each([
    ['t_refund_pending', 'REFUNDED'],
    ['t_processing', 'REFUNDED'],
    ['t_transferred', 'CANCELLED'],
  ])('refuses %s as %s', async (id, reason) => {
    const res = await performCheckIn(params(id))
    expect(res).toEqual({ success: false, type: 'INVALID', reason })
    expect(ticket(id).checked_in_by).toBeUndefined()
  })

  it('rejects a path-like ticket id', async () => {
    await expect(performCheckIn(params('ev1/members/x'))).rejects.toThrow(/Invalid ticket id/)
  })
})

describe('performOverrideCheckIn', () => {
  it('re-admits a live ticket that is already in', async () => {
    const res = await performOverrideCheckIn(params('t_in'))
    expect(res).toMatchObject({ success: true, attendeeName: 'Rara' })
    expect(ticket('t_in')).toMatchObject({ reentry_override: true, checked_in_by: 'staff_1' })
  })

  it.each([
    ['t_refunded', 'REFUNDED'],
    ['t_cancelled', 'CANCELLED'],
    ['t_refund_pending', 'REFUNDED'],
  ])('never re-admits %s', async (id, reason) => {
    const res = await performOverrideCheckIn(params(id))
    expect(res).toEqual({ success: false, type: 'INVALID', reason })
    expect(ticket(id).reentry_override).toBeUndefined()
  })

  it('requires door access too', async () => {
    access = { ok: false, status: 401, error: 'Not authenticated' }
    await expect(performOverrideCheckIn(params('t_in'))).rejects.toThrow(/Not authenticated/)
  })
})

describe('ticketBlockReason', () => {
  it('is an allowlist of live statuses', () => {
    expect(ticketBlockReason({ status: 'valid' })).toBeNull()
    expect(ticketBlockReason({ status: 'active' })).toBeNull()
    expect(ticketBlockReason({})).toBeNull()
    expect(ticketBlockReason({ status: 'checked_in' })).toBeNull()
    expect(ticketBlockReason({ status: 'pending' })).toBe('PENDING_PAYMENT')
    expect(ticketBlockReason({ status: 'refund_pending' })).toBe('REFUNDED')
    expect(ticketBlockReason({ status: 'valid', refund_status: 'requested' })).toBeNull()
    expect(ticketBlockReason({ status: 'valid', refund_status: 'approved' })).toBe('REFUNDED')
    expect(ticketBlockReason({ status: 'whatever' })).toBe('CANCELLED')
  })
})
