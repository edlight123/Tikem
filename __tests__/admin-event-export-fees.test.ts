/**
 * @jest-environment node
 *
 * The admin financial export prices each order exactly as the earnings
 * ledger does (lib/earnings.ts calculateEventCurrencyFees): the event's
 * market terms (US 6% + $0.99 per paid ticket, not a flat 10%), and nothing
 * deducted when the buyer paid the fee on top.
 */

import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))
jest.mock('@/lib/auth', () => ({
  requireAdmin: async () => ({ user: { id: 'admin1', email: 'a@x.co' }, error: null }),
}))
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: async () => undefined }))
jest.mock('@/lib/admin/platform-settings', () => {
  const { DEFAULT_PLATFORM_SETTINGS } = jest.requireActual('@/types/platform-settings')
  return { getPlatformSettings: async () => ({ id: 'global', ...DEFAULT_PLATFORM_SETTINGS }) }
})

import { GET } from '@/app/api/admin/events/[eventId]/export/route'

async function summary(eventId: string) {
  const res = await GET(new Request(`http://x/api/admin/events/${eventId}/export?mode=summary`), {
    params: Promise.resolve({ eventId }),
  })
  const [header, row] = (await res.text()).split('\n')
  const unquote = (line: string) => line.split('","').map((c) => c.replace(/^"|"$/g, ''))
  const cols = unquote(header)
  const vals = unquote(row)
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]))
}

beforeEach(() => db.store.clear())

it('US organizer-absorbed sale: 6% + $0.99 per ticket, not 10%', async () => {
  db.write('events/evUS', { title: 'US', country: 'US', currency: 'USD' })
  db.write('tickets/t1', {
    event_id: 'evUS', status: 'valid', price_paid: 20, payment_method: 'stripe',
    payment_id: 'p1', fee_incidence: 'organizer', charged_amount: 20, charged_currency: 'USD',
  })
  const s = await summary('evUS')
  expect(s.platformFeeAmount).toBe('2.19') // 1.20 + 0.99
  expect(s.organizerNetAmount).toBe('17.81')
})

it('US buyer-pays sale: organizer nets the full face value', async () => {
  db.write('events/evUS', { title: 'US', country: 'US', currency: 'USD' })
  db.write('tickets/t1', {
    event_id: 'evUS', status: 'valid', price_paid: 20, payment_method: 'stripe',
    payment_id: 'p1', fee_incidence: 'buyer', charged_amount: 22.19, charged_currency: 'USD',
  })
  const s = await summary('evUS')
  expect(s.platformFeeAmount).toBe('0.00')
  expect(s.organizerNetAmount).toBe('20.00')
})

it('Haiti MonCash sale keeps 10%, fixed fee per ticket applies per paid ticket in FR', async () => {
  db.write('events/evHT', { title: 'HT', country: 'HT', currency: 'HTG' })
  db.write('tickets/t1', {
    event_id: 'evHT', status: 'valid', price_paid: 1000, payment_method: 'moncash', payment_id: 'p1',
  })
  const ht = await summary('evHT')
  expect(ht.platformFeeAmount).toBe('100.00')
  expect(ht.organizerNetAmount).toBe('900.00')

  db.write('events/evFR', { title: 'FR', country: 'France', currency: 'EUR' })
  for (const id of ['a', 'b']) {
    db.write(`tickets/fr_${id}`, {
      event_id: 'evFR', status: 'valid', price_paid: 10, payment_method: 'stripe',
      payment_id: 'pFR', fee_incidence: 'organizer', charged_amount: 10, charged_currency: 'EUR',
    })
  }
  const fr = await summary('evFR')
  // 2.5% of 20 = 0.50, + 2 × €0.50
  expect(fr.platformFeeAmount).toBe('1.50')
  expect(fr.organizerNetAmount).toBe('18.50')
})
