/**
 * GET /api/organizer/events/:id/add-ons shows sales and revenue, so it sits
 * behind the per-event finance gate (requireEventFinance), like the other
 * finance routes. Door staff use the pickup route, which has its own gate.
 *
 * @jest-environment node
 */
import { NextResponse } from 'next/server'

const mockUser = { current: { id: 'u1' } as any }
const mockGate = { allow: true }
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => mockUser.current) }))
jest.mock('@/lib/organizer/financeAccess', () => ({
  requireEventFinance: jest.fn(async () =>
    mockGate.allow
      ? { ok: true, value: { event: { currency: 'CAD', add_ons: [{ id: 'ao_meal', name: 'Meal', price: 15, quantity: 50 }] }, orgId: 'org1' } }
      : {
          ok: false,
          response: require('next/server').NextResponse.json({ error: 'Your team role does not include finances', code: 'no_finance' }, { status: 403 }),
        }
  ),
}))
jest.mock('@/lib/addons/server', () => ({
  addOnSalesForEvent: jest.fn(async () => ({ rows: [], totalSold: 3, totalPickedUp: 1, totalRevenue: 45 })),
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const { GET } = require('@/app/api/organizer/events/[id]/add-ons/route')
const { requireEventFinance } = require('@/lib/organizer/financeAccess')
const { addOnSalesForEvent } = require('@/lib/addons/server')

const call = () => GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'evt1' }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockUser.current = { id: 'u1' }
  mockGate.allow = true
})

describe('add-on sales route', () => {
  it('a role without finances gets 403 and no sales are read', async () => {
    mockGate.allow = false
    const res: NextResponse = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('no_finance')
    expect(requireEventFinance).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'evt1')
    expect(addOnSalesForEvent).not.toHaveBeenCalled()
  })

  it('signed out is a 401', async () => {
    mockUser.current = null
    const res: NextResponse = await call()
    expect(res.status).toBe(401)
    expect(addOnSalesForEvent).not.toHaveBeenCalled()
  })

  it('a finance role gets the summary and stock', async () => {
    const res: NextResponse = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(expect.objectContaining({ currency: 'CAD', totalSold: 3, totalRevenue: 45 }))
    expect(body.stock).toEqual([{ id: 'ao_meal', name: 'Meal', quantity: 50 }])
  })
})
