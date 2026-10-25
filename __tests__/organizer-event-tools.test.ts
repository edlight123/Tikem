/**
 * Organizer event tools: live-status counting, org analytics totals, attendee
 * name fallback for guest/comp tickets, status display, composer defaults, and
 * the guest-list add route issuing tickets through the comps path.
 *
 * @jest-environment node
 */

import { summarizeEventTickets, summarizeOrgSales, ticketCountsAsSold } from '../lib/organizer/salesSummary'
import { toTicketRow } from '../lib/organizer/eventOrders'
import { ticketDisplayKey, ticketIsActionable } from '../lib/organizer/ticketStatusDisplay'
import { composerSeedFromDefaults } from '../lib/events/composer-country'
import { serializeGuest } from '../lib/guest-list'

// ── Guest-list route fakes ────────────────────────────────────────────────
const state: any = { guests: {} as Record<string, any>, nextId: 1, issueCalls: [] as any[], issueResult: null as any }

jest.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ user: { id: 'u_owner', role: 'organizer' }, error: null }),
}))
jest.mock('@/lib/organizer/context', () => ({
  canOnEvent: async () => ({ allowed: true, role: 'owner' }),
}))
jest.mock('@/lib/guest-list-server', () => ({ loadGuestTicketStates: async () => [] }))
jest.mock('@/lib/tickets/compIssue', () => ({
  compTicketLink: () => null,
  issueCompTickets: async (p: any) => {
    state.issueCalls.push(p)
    return state.issueResult
  },
}))
jest.mock('@/lib/firebase/admin', () => {
  const guestDoc = (id: string) => ({
    id,
    update: async (patch: any) => {
      state.guests[id] = { ...state.guests[id], ...patch }
    },
    delete: async () => {
      delete state.guests[id]
    },
  })
  const guests = {
    where: (_f: string, _op: string, value: any) => ({
      limit: () => ({
        get: async () => ({ empty: !Object.values(state.guests).some((g: any) => g.email === value) }),
      }),
    }),
    add: async (data: any) => {
      const id = `g${state.nextId++}`
      state.guests[id] = data
      return guestDoc(id)
    },
  }
  return {
    adminDb: {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => ({ exists: true, data: () => ({ id, organizer_id: 'u_owner', title: 'Kanaval' }) }),
          collection: () => guests,
        }),
      }),
    },
  }
})

describe('live-status counting', () => {
  const tickets = [
    { status: 'valid', price_paid: 10, original_currency: 'USD' },
    { status: 'confirmed', price_paid: 10 },
    { status: 'active', price_paid: 0, checked_in: true },
    { status: 'checked_in', price_paid: 5 },
    { status: 'refunded', price_paid: 10 },
    { status: 'refund_pending', price_paid: 10 },
    { status: 'cancelled', price_paid: 10 },
    { status: 'valid', price_paid: 10, refund_status: 'approved' },
  ]

  it('counts valid / confirmed / active / checked_in and nothing refunded', () => {
    expect(tickets.filter(ticketCountsAsSold)).toHaveLength(4)
    const s = summarizeEventTickets(tickets, 'USD')
    expect(s.ticketsSold).toBe(4)
    expect(s.checkedIn).toBe(2)
    expect(s.revenueByCurrencyCents).toEqual({ USD: 2500 })
  })

  it('keeps an HTG event in HTG even when the ticket says it was charged in USD', () => {
    const s = summarizeEventTickets([{ status: 'valid', price_paid: 1000, currency: 'USD' }], 'HTG')
    expect(s.revenueByCurrencyCents).toEqual({ HTG: 100000 })
  })
})

describe('org analytics totals from per-event tickets', () => {
  it('sums tickets across events and keeps money per currency', () => {
    const now = new Date('2026-10-25T15:00:00')
    const events = [
      { id: 'a', currency: 'USD' },
      { id: 'b', currency: 'HTG' },
      { id: 'c', currency: 'USD' },
    ]
    const byEvent = new Map<string, any[]>([
      ['a', [
        { status: 'valid', price_paid: 20, purchased_at: '2026-10-25T10:00:00' },
        { status: 'refunded', price_paid: 20, purchased_at: '2026-10-25T10:00:00' },
      ]],
      ['b', [
        { status: 'confirmed', price_paid: 1500, purchased_at: '2026-10-24T10:00:00' },
        { status: 'active', price_paid: 1500, purchased_at: '2026-01-01T10:00:00' },
      ]],
    ])
    const s = summarizeOrgSales(events, byEvent, now)
    expect(s.totalTicketsSold).toBe(3)
    expect(s.revenueByCurrencyCents).toEqual({ USD: 2000, HTG: 300000 })
    expect(s.primaryCurrency).toBe('HTG')
    expect(s.events.find((e) => e.id === 'a')).toMatchObject({ ticketCount: 1, revenueCents: 2000, currency: 'USD' })
    expect(s.events.find((e) => e.id === 'c')).toMatchObject({ ticketCount: 0, revenueCents: 0 })
    expect(s.last7Days).toHaveLength(7)
    expect(s.last7Days[6]).toMatchObject({ date: '2026-10-25', sales: 1, revenueCents: 0 })
    expect(s.last7Days[5]).toMatchObject({ date: '2026-10-24', sales: 1, revenueCents: 150000 })
  })
})

describe('attendee name fallback', () => {
  it('uses the guest checkout details when there is no users doc', () => {
    const row = toTicketRow(
      't1',
      { attendee_id: 'guest_abc', is_guest: true, attendee_name: 'Ana Joseph', guest_email: 'ana@x.co', status: 'valid' },
      null,
      'HTG'
    )
    expect(row.buyer.name).toBe('Ana Joseph')
    expect(row.buyer.email).toBe('ana@x.co')
  })

  it('uses the comp recipient on a ticket with no account', () => {
    const row = toTicketRow('t2', { source: 'comp', recipient_name: 'Press', recipient_email: 'p@x.co', status: 'valid' }, null, 'USD')
    expect(row.buyer.name).toBe('Press')
    expect(row.buyer.email).toBe('p@x.co')
  })
})

describe('ticket status display', () => {
  it('maps every status to a label and only live tickets take actions', () => {
    expect(ticketDisplayKey('refunded', false)).toBe('refunded')
    expect(ticketDisplayKey('refund_pending', false)).toBe('refund_pending')
    expect(ticketDisplayKey('cancelled', false)).toBe('cancelled')
    expect(ticketDisplayKey('valid', true)).toBe('checked_in')
    expect(ticketDisplayKey('confirmed', false)).toBe('valid')
    expect(ticketIsActionable('refunded')).toBe(false)
    expect(ticketIsActionable('refund_pending')).toBe(false)
    expect(ticketIsActionable('active')).toBe(true)
  })
})

describe('composer defaults', () => {
  const cats = ['Concert', 'Party', 'Sports', 'Other']
  it('uses a default currency only when the country allows it', () => {
    expect(composerSeedFromDefaults({ default_currency: 'HTG' }, 'HT', cats).currency).toBe('HTG')
    expect(composerSeedFromDefaults({ default_currency: 'HTG' }, 'US', cats).currency).toBeUndefined()
    expect(composerSeedFromDefaults({ default_currency: 'USD' }, 'CA', cats).currency).toBeUndefined()
  })
  it('uses the timezone only for the same country, and maps categories', () => {
    const d = { default_country: 'US', default_timezone: 'America/Chicago', default_categories: ['Music'] }
    expect(composerSeedFromDefaults(d, 'US', cats)).toMatchObject({ timezone: 'America/Chicago', category: 'Concert' })
    expect(composerSeedFromDefaults(d, 'FR', cats).timezone).toBeUndefined()
    expect(composerSeedFromDefaults({ default_country: 'US', default_timezone: 'Nope' }, 'US', cats).timezone).toBeUndefined()
  })
})

describe('guest serializer reads check-in from tickets', () => {
  it('reports checked in when the door scanned a guest ticket', () => {
    const g = serializeGuest('g1', { name: 'A', ticket_ids: ['t1', 't2'], email_sent: true }, [
      { id: 't1', status: 'valid', checked_in: true },
      { id: 't2', status: 'valid', checked_in: false },
    ])
    expect(g.checked_in).toBe(true)
    expect(g.checked_in_count).toBe(1)
    expect(g.ticket_status).toBe('issued')
  })
  it('marks cancelled when none of the tickets is live', () => {
    const g = serializeGuest('g2', { ticket_ids: ['t1'] }, [{ id: 't1', status: 'cancelled', checked_in: false }])
    expect(g.ticket_status).toBe('cancelled')
  })
})

describe('POST /api/organizer/events/[id]/guests', () => {
  beforeEach(() => {
    state.guests = {}
    state.issueCalls = []
    state.issueResult = {
      ok: true,
      ticketIds: ['tk1', 'tk2'],
      tierId: 'tier1',
      tierName: 'GA',
      reservationId: 'res1',
      emailed: false,
      emailLimited: false,
      ticketLink: 'https://tikem.co/tickets/guest/abc',
      guestOrderKey: 'a'.repeat(48),
      recipientUid: null,
    }
  })

  const post = async (body: any) => {
    const { POST } = await import('../app/api/organizer/events/[id]/guests/route')
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: 'evt1' }),
    })
    return { status: res.status, body: await res.json() }
  }

  it('issues tickets through the comps path (two with a +1) and returns the share link', async () => {
    const r = await post({ name: 'Jean', plus_one: true })
    expect(r.status).toBe(201)
    expect(state.issueCalls).toHaveLength(1)
    expect(state.issueCalls[0]).toMatchObject({ eventId: 'evt1', quantity: 2, source: 'guest_list', recipientName: 'Jean' })
    expect(r.body.ticketLink).toBe('https://tikem.co/tickets/guest/abc')
    expect(r.body.emailed).toBe(false)
    const saved: any = Object.values(state.guests)[0]
    expect(saved.ticket_ids).toEqual(['tk1', 'tk2'])
    expect(saved.reservation_id).toBe('res1')
  })

  it('removes the guest again when the tickets cannot be issued', async () => {
    state.issueResult = { ok: false, status: 409, error: 'Not enough capacity left for these tickets.', code: 'event_capacity' }
    const r = await post({ name: 'Jean', email: 'jean@x.co' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/capacity/)
    expect(Object.keys(state.guests)).toHaveLength(0)
  })
})
