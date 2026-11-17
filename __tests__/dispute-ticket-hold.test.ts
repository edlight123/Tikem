/**
 * @jest-environment node
 *
 * A disputed card payment's tickets follow the dispute (payment audit,
 * 2026-11-17): held (not live: refused at the door, out of the organizer's
 * balance) while open or lost; given back if the dispute is won.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockFake = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockFake
  },
}))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notifications/orgRecipients', () => ({ resolveOrgRecipients: jest.fn(async () => []) }))
jest.mock('@/lib/admin', () => ({ getAdminEmails: jest.fn(async () => []) }))

import { applyDisputeToTickets, DISPUTED_TICKET_STATUS } from '@/lib/disputes'
import { isLiveTicketStatus } from '@/lib/tickets/status'

const t = (id: string) => mockFake.store.get(`tickets/${id}`) as any

beforeEach(() => {
  mockFake.store.clear()
  mockFake.write('tickets/a', { status: 'valid', payment_id: 'pi_1' })
  mockFake.write('tickets/b', { status: 'confirmed', payment_id: 'pi_1' })
  mockFake.write('tickets/c', { status: 'refunded', payment_id: 'pi_1' })
})

it('an open dispute holds every live ticket and leaves a refunded one alone', async () => {
  const res = await applyDisputeToTickets('dp_1', 'open', ['a', 'b', 'c'])
  expect(res).toEqual({ held: 2, restored: 0 })
  expect(t('a')).toMatchObject({ status: DISPUTED_TICKET_STATUS, pre_dispute_status: 'valid', dispute_id: 'dp_1' })
  expect(t('b').pre_dispute_status).toBe('confirmed')
  expect(t('c').status).toBe('refunded')
  expect(isLiveTicketStatus(t('a').status)).toBe(false)
  // Redelivery changes nothing.
  expect(await applyDisputeToTickets('dp_1', 'open', ['a', 'b'])).toEqual({ held: 0, restored: 0 })
})

it('won gives each ticket back its own status; lost keeps them held', async () => {
  await applyDisputeToTickets('dp_1', 'open', ['a', 'b'])
  expect(await applyDisputeToTickets('dp_1', 'lost', ['a', 'b'])).toEqual({ held: 0, restored: 0 })
  expect(t('a').status).toBe(DISPUTED_TICKET_STATUS)

  await applyDisputeToTickets('dp_2', 'open', ['x'])
  mockFake.write('tickets/d', { status: 'valid' })
  await applyDisputeToTickets('dp_3', 'open', ['d'])
  expect(await applyDisputeToTickets('dp_3', 'won', ['d'])).toEqual({ held: 0, restored: 1 })
  expect(t('d').status).toBe('valid')
})

it('a different dispute cannot release a ticket another dispute holds', async () => {
  await applyDisputeToTickets('dp_1', 'open', ['a'])
  expect(await applyDisputeToTickets('dp_other', 'won', ['a'])).toEqual({ held: 0, restored: 0 })
  expect(t('a').status).toBe(DISPUTED_TICKET_STATUS)
})
