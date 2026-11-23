jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
import { toDoorRow } from '@/lib/scan/doorRules'
import { doorPaymentPatch } from '@/lib/scan/doorPayment'

const door = (o: any = {}) => ({
  status: 'valid',
  attendee_name: 'Amina',
  payment_method: 'pay_at_door',
  door_price: 10,
  door_currency: 'CAD',
  door_paid: false,
  ...o,
})

describe('door list rows show what is owed', () => {
  it('an unpaid door ticket owes its door price', () => {
    expect(toDoorRow('t1', door())).toMatchObject({ doorOwes: 10, doorCurrency: 'CAD', doorPaid: false })
  })
  it('a paid door ticket owes nothing', () => {
    expect(toDoorRow('t1', door({ door_paid: true }))).toMatchObject({ doorOwes: 0, doorPaid: true })
  })
  it('a free ticket has no door balance', () => {
    expect(toDoorRow('t1', { status: 'valid', payment_method: 'free' })).toMatchObject({ doorOwes: null, doorCurrency: null, doorPaid: false })
  })
  it('a transferred door ticket still owes (the fields travel with the ticket)', () => {
    expect(toDoorRow('t1', door({ qr_version: 1 }))).toMatchObject({ doorOwes: 10, qrVersion: 1 })
  })
})

describe('marking a door ticket paid', () => {
  const now = '2026-11-20T19:00:00.000Z'
  it('records the amount, when and who', () => {
    expect(doorPaymentPatch(door(), { paid: true, staffUid: 'staff1', now })).toEqual({
      ok: true,
      patch: { door_paid: true, door_amount: 10, door_paid_at: now, door_paid_by: 'staff1', updated_at: now },
    })
  })
  it('is idempotent: the first payment record is kept', () => {
    const first = door({ door_paid: true, door_amount: 10, door_paid_at: '2026-11-20T18:00:00.000Z', door_paid_by: 'staff1' })
    expect(doorPaymentPatch(first, { paid: true, staffUid: 'staff2', now })).toEqual({ ok: true, patch: null })
  })
  it('can be undone', () => {
    const paid = door({ door_paid: true, door_amount: 10, door_paid_at: now, door_paid_by: 'staff1' })
    expect(doorPaymentPatch(paid, { paid: false, staffUid: 'staff1', now })).toEqual({
      ok: true,
      patch: { door_paid: false, door_amount: null, door_paid_at: null, door_paid_by: null, updated_at: now },
    })
  })
  it('refuses a ticket that is not pay at the door', () => {
    expect(doorPaymentPatch({ status: 'valid', payment_method: 'free' }, { paid: true, staffUid: 's', now })).toEqual({
      ok: false,
      code: 'not_door_ticket',
    })
  })
  it('refuses a cancelled ticket', () => {
    expect(doorPaymentPatch(door({ status: 'cancelled' }), { paid: true, staffUid: 's', now })).toEqual({
      ok: false,
      code: 'not_live',
    })
  })
})
