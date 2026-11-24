/**
 * PATCH /api/ticket-tiers authorizes against the tier's REAL event document.
 *
 * Regression: the route asked the Firestore shim for `*, events(organizer_id)`,
 * a Supabase-style join the shim never resolves, so `tier.events` was
 * undefined and canOnEvent refused every organizer and their team; only
 * platform admins could edit a tier. The same pattern was fixed for sessions,
 * recurring instances and event photos (lib/organizer/event-of-row).
 *
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const events: Record<string, Record<string, any>> = {
  ev1: { organizer_id: 'owner1', country: 'HT', title: 'Konpa night' },
}
const tiers: Record<string, Record<string, any>> = {
  tier1: { id: 'tier1', event_id: 'ev1', name: 'GA', price: 10, total_quantity: 100 },
}
// organizers/{orgId}/team/{uid}
const team: Record<string, Record<string, Record<string, any>>> = {
  owner1: {
    admin1: { role: 'admin', status: 'active' },
    manager1: { role: 'manager', status: 'active' },
    door1: { role: 'staff', status: 'active' },
  },
}

const update = jest.fn()
let currentUser: any = null

const snap = (id: string, data: any) => ({ id, exists: !!data, data: () => data })

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => snap(id, name === 'events' ? events[id] : undefined),
        collection: (sub: string) => ({
          doc: (uid: string) => ({
            get: async () => snap(uid, name === 'organizers' && sub === 'team' ? team[id]?.[uid] : undefined),
          }),
          get: async () => ({ docs: [] }),
        }),
      }),
    }),
  },
}))

jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_f: string, id: string) => ({
          single: async () => ({ data: table === 'ticket_tiers' ? tiers[id] ?? null : null }),
        }),
      }),
      update: (patch: any) => ({
        eq: async (_f: string, id: string) => {
          update(id, patch)
          return { error: null }
        },
      }),
    }),
  }),
}))

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => currentUser }))

import { PATCH } from '@/app/api/ticket-tiers/route'

function req(body: any) {
  return new NextRequest('https://www.tikem.co/api/ticket-tiers', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function rename(user: any) {
  currentUser = user
  update.mockClear()
  return PATCH(req({ tierId: 'tier1', name: 'VIP' }))
}

describe('PATCH /api/ticket-tiers permission', () => {
  it('lets the event organizer edit their tier', async () => {
    const res = await rename({ id: 'owner1', role: 'organizer' })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('tier1', expect.objectContaining({ name: 'VIP' }))
  })

  it("lets the organizer's team admin and manager edit it", async () => {
    for (const id of ['admin1', 'manager1']) {
      const res = await rename({ id, role: 'attendee' })
      expect(res.status).toBe(200)
      expect(update).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses door staff on the team (no manage_events)', async () => {
    const res = await rename({ id: 'door1', role: 'attendee' })
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses another organization', async () => {
    const res = await rename({ id: 'other-org', role: 'organizer' })
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a tier whose event is gone', async () => {
    tiers.orphan = { id: 'orphan', event_id: 'missing' }
    currentUser = { id: 'owner1', role: 'organizer' }
    update.mockClear()
    const res = await PATCH(req({ tierId: 'orphan', name: 'x' }))
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('still enforces the minimum paid price from the event country', async () => {
    events.evUS = { organizer_id: 'owner1', country: 'US' }
    tiers.tierUS = { id: 'tierUS', event_id: 'evUS', name: 'GA', price: 10 }
    currentUser = { id: 'owner1', role: 'organizer' }
    update.mockClear()
    const res = await PATCH(req({ tierId: 'tierUS', price: 50 })) // 0.50 in cents
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
