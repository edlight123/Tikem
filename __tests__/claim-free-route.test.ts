/**
 * Free-ticket issuance: POST /api/tickets/claim-free.
 *
 * Exercises the REAL route handler against a fake Firestore, covering both accepted
 * payload shapes:
 *
 *   1. `{ eventId, tierId?, quantity? }` — the ORIGINAL shape. Mobile build 10 is in
 *      testers' hands sending exactly this against production, so these cases are a
 *      frozen contract: change them only when you intend to break shipped clients.
 *   2. `{ eventId, selections: [{ tierId, quantity }] }` — the web selector's cart,
 *      which can span several free tiers and quantities.
 *
 * Every ticket, in both shapes, must pass the same gate: tier belongs to the event,
 * the tier's OWN price is 0, is_active, inside the sale window, not sold out, the
 * per-user free-claim limit, and a single atomic inventory reservation.
 *
 * @jest-environment node
 */

const state: any = {
  tiers: [] as any[],
  existingTickets: [] as any[],
  added: [] as any[],
  reserveCalls: [] as any[],
  releaseCalls: [] as any[],
  reserveResult: { ok: true } as any,
  /** Fake `promo_codes` collection, keyed by doc id. */
  promos: {} as Record<string, any>,
  /** Every doc written to `promo_code_usage`. */
  usageWrites: [] as any[],
  /** Fake `guest_orders` collection, keyed by order key. */
  guestOrders: {} as Record<string, any>,
  /** Access grants, keyed by uid or `guest_…` id — the whole point of the gate. */
  grants: {} as Record<string, boolean>,
  /** The event's real access code, for the password-protected cases. */
  accessCode: 'LETMEIN',
  accessThrottled: false,
  failedAccessAttempts: 0,
  event: {
    id: 'evt1',
    title: 'Test Event',
    organizer_id: 'org1',
    currency: 'HTG',
    ticket_price: 0,
    // Purchasable: published and in the future (lib/tickets/purchasable.ts).
    is_published: true,
    status: 'published',
    start_datetime: '2099-09-01T18:00:00.000Z',
  } as any,
  /** Once-per-event claim locks (`free_claim_locks`), keyed by doc id. */
  locks: {} as Record<string, any>,
}

jest.mock('@/lib/firebase-db/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => ({ id: 'u1', email: 'u@x.com', full_name: 'U' })) }))
/**
 * Password gate, faked at the module boundary so the route's real branching runs.
 *
 * A grant is keyed by whoever is buying — a uid, or the `guest_…` id minted for a
 * guest order — which is what lets a guest through at all. The code comparison and
 * the throttle are modelled here so "wrong code still fails" is an assertion about
 * the route, not about Firestore.
 */
jest.mock('@/lib/events/access-guard', () => ({
  hasEventAccess: jest.fn(async (event: any, _eventId: string, subjectId: string) =>
    !event?.is_password_protected || Boolean(state.grants[subjectId])
  ),
  accessCodeMatches: jest.fn(async (_eventId: string, code: unknown) =>
    Boolean(state.accessCode) && String(code ?? '').trim() === state.accessCode
  ),
  accessAttemptKey: jest.fn(() => 'ip_test'),
  isAccessThrottled: jest.fn(async () => state.accessThrottled === true),
  recordFailedAccessAttempt: jest.fn(async () => {
    state.failedAccessAttempts += 1
  }),
  clearAccessAttempts: jest.fn(async () => {}),
  grantEventAccess: jest.fn(async (_eventId: string, subjectId: string) => {
    state.grants[subjectId] = true
  }),
}))
/**
 * Ticket DELIVERY is stubbed, not disabled: these tests assert that it is called and
 * with what. (Left real, it would hit Resend with the key in .env.local and actually
 * mail somebody every time the suite runs.)
 */
jest.mock('@/lib/tickets/confirmation', () => ({
  sendTicketConfirmation: jest.fn(async () => ({ emailSent: true, smsSent: false, whatsappSent: false })),
}))
jest.mock('@/lib/notifications/helpers', () => ({
  notifyTicketPurchase: jest.fn(async () => {}),
  notifyOrganizerTicketSale: jest.fn(async () => {}),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }))
jest.mock('@/lib/tickets/inventory', () => {
  const actual = jest.requireActual('@/lib/tickets/inventory')
  return {
    // REAL merge/normalize logic, so the increments we assert are the real ones.
    buildTierSoldIncrements: actual.buildTierSoldIncrements,
    reserveInventoryAtomic: jest.fn(async (params: any) => {
      state.reserveCalls.push(params)
      return state.reserveResult
    }),
    releaseInventoryReservation: jest.fn(async (params: any) => {
      state.releaseCalls.push(params)
    }),
  }
})

/**
 * Fake Firestore. `promo_codes` / `promo_code_usage` / `runTransaction` are modelled
 * for real so the route runs the REAL `resolvePromoCode` + `redeemPromoInTransaction`
 * from lib/promo-codes — event scoping, is_active, expiry and the atomic usage cap are
 * therefore exercised as shipped, not re-implemented by a stub.
 */
jest.mock('@/lib/firebase/admin', () => {
  const promoQuery = (filters: Array<[string, any]> = []): any => ({
    where: (field: string, _op: string, value: any) => promoQuery([...filters, [field, value]]),
    limit: () => promoQuery(filters),
    get: async () => {
      const matched = Object.entries(state.promos)
        .map(([id, d]: any) => ({ id, ...d }))
        .filter((row: any) => filters.every(([f, v]) => String(row[f]) === String(v)))
      return {
        empty: matched.length === 0,
        docs: matched.map((m: any) => ({ id: m.id, data: () => state.promos[m.id] })),
      }
    },
  })

  const promoDocRef = (id: string) => ({
    id,
    get: async () => ({
      exists: Boolean(state.promos[id]),
      id,
      data: () => state.promos[id],
    }),
  })

  return {
    adminDb: {
      runTransaction: async (fn: any) =>
        fn({
          get: async (ref: any) => ref.get(),
          update: (ref: any, patch: any) => {
            state.promos[ref.id] = { ...state.promos[ref.id], ...patch }
          },
          set: (ref: any, data: any) => {
            if (ref.isLock) {
              state.locks[ref.id] = data
              return
            }
            state.usageWrites.push({ id: ref.id, ...data })
          },
        }),
      collection(name: string) {
        if (name === 'events') {
          return {
            doc: () => ({ get: async () => ({ exists: true, id: 'evt1', data: () => state.event }) }),
          }
        }
        if (name === 'free_claim_locks') {
          return {
            doc: (id: string) => ({
              id,
              isLock: true,
              get: async () => ({ exists: Boolean(state.locks[id]), id, data: () => state.locks[id] }),
              set: async (data: any, opts?: any) => {
                state.locks[id] = opts?.merge ? { ...(state.locks[id] || {}), ...data } : data
              },
              create: async (data: any) => {
                if (state.locks[id]) {
                  const err: any = new Error('6 ALREADY_EXISTS: Document already exists')
                  err.code = 6
                  throw err
                }
                state.locks[id] = data
              },
              delete: async () => {
                delete state.locks[id]
              },
            }),
          }
        }
        if (name === 'ticket_tiers') {
          return {
            where: () => ({
              get: async () => ({ docs: state.tiers.map((t: any) => ({ id: t.id, data: () => t })) }),
            }),
          }
        }
        if (name === 'promo_codes') {
          return { doc: (id: string) => promoDocRef(id), ...promoQuery() }
        }
        if (name === 'promo_code_usage') {
          return { doc: () => ({ id: `usage${state.usageWrites.length + 1}` }) }
        }
        if (name === 'guest_orders') {
          return {
            doc: (id: string) => ({
              id,
              set: async (data: any) => {
                state.guestOrders[id] = { ...(state.guestOrders[id] || {}), ...data }
              },
              get: async () => ({
                exists: Boolean(state.guestOrders[id]),
                id,
                data: () => state.guestOrders[id],
              }),
            }),
          }
        }
        if (name === 'tickets') {
          return {
            doc: (id: string) => ({
              id,
              get: async () => {
                const found = [...state.existingTickets, ...state.added].find((t: any) => t.id === id)
                return { exists: Boolean(found), id, data: () => found }
              },
            }),
            // Single-field equality, as the route queries (attendee_id / guest_email / event_id).
            where: (field: string, _op: string, value: any) => ({
              get: async () => ({
                docs: state.existingTickets
                  .filter((t: any) => t[field] === value)
                  .map((t: any) => ({ id: t.id, data: () => t })),
              }),
            }),
            add: async (data: any) => {
              const id = `tkt${state.added.length + 1}`
              const stored = { ...data, id }
              state.added.push(stored)
              return {
                id,
                update: async (patch: any) => Object.assign(stored, patch),
                get: async () => ({ id, data: () => stored }),
              }
            },
          }
        }
        throw new Error(`unexpected collection ${name}`)
      },
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require('@/app/api/tickets/claim-free/route')

function req(body: any, headers: Record<string, string> = {}) {
  // Headers are part of the shape now: guest checkout reads the client IP off the
  // request to stamp on the guest order.
  return {
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as any
}

function reset() {
  state.tiers = [
    { id: 'freeA', event_id: 'evt1', name: 'Free RSVP', price: 0, total_quantity: 100, sold_quantity: 0, sort_order: 0 },
    { id: 'freeB', event_id: 'evt1', name: 'Free Student', price: 0, total_quantity: 50, sold_quantity: 0, sort_order: 1 },
    { id: 'paidA', event_id: 'evt1', name: 'General Admission', price: 1500, total_quantity: 100, sold_quantity: 0 },
  ]
  state.existingTickets = []
  state.locks = {}
  state.added = []
  state.reserveCalls = []
  state.releaseCalls = []
  state.reserveResult = { ok: true }
  state.promos = {
    // 100% off, unlimited: zeroes any paid tier on evt1.
    promoFull: {
      event_id: 'evt1',
      code: 'FREE100',
      discount_type: 'percentage',
      discount_value: 100,
      max_uses: null,
      uses_count: 0,
      is_active: true,
    },
    // 50% off: leaves money on the table, must never reach this endpoint.
    promoHalf: {
      event_id: 'evt1',
      code: 'HALF',
      discount_type: 'percentage',
      discount_value: 50,
      max_uses: null,
      uses_count: 0,
      is_active: true,
    },
    // Fixed amount that exactly covers the 1,500 HTG paid tier.
    promoFixed: {
      event_id: 'evt1',
      code: 'MINUS1500',
      discount_type: 'fixed_amount',
      discount_value: 1500,
      max_uses: 5,
      uses_count: 0,
      is_active: true,
    },
    promoExpired: {
      event_id: 'evt1',
      code: 'OLD100',
      discount_type: 'percentage',
      discount_value: 100,
      max_uses: null,
      uses_count: 0,
      is_active: true,
      expires_at: '2020-01-01T00:00:00.000Z',
    },
    promoInactive: {
      event_id: 'evt1',
      code: 'OFF100',
      discount_type: 'percentage',
      discount_value: 100,
      max_uses: null,
      uses_count: 0,
      is_active: false,
    },
    promoUsedUp: {
      event_id: 'evt1',
      code: 'SPENT',
      discount_type: 'percentage',
      discount_value: 100,
      max_uses: 2,
      uses_count: 2,
      is_active: true,
    },
    // Same 100%-off deal, but it belongs to a DIFFERENT event.
    promoOtherEvent: {
      event_id: 'evt2',
      code: 'FREE100',
      discount_type: 'percentage',
      discount_value: 100,
      max_uses: null,
      uses_count: 0,
      is_active: true,
    },
    // One slot left: enough to pass the soft capacity check, not enough for a 3-ticket claim.
    promoOneLeft: {
      event_id: 'evt1',
      code: 'LASTONE',
      discount_type: 'percentage',
      discount_value: 100,
      max_uses: 1,
      uses_count: 0,
      is_active: true,
    },
  }
  state.usageWrites = []
  state.guestOrders = {}
  state.grants = {}
  state.accessCode = 'LETMEIN'
  state.accessThrottled = false
  state.failedAccessAttempts = 0
  state.event.is_password_protected = false
  jest.clearAllMocks()
}

describe('LEGACY shape {eventId, tierId, quantity} — mobile build 10, must not change', () => {
  beforeEach(reset)

  it('issues N tickets against the named free tier', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 2 }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.count).toBe(2)
    expect(body.message).toBe('2 free tickets claimed successfully!')
    expect(body.tickets).toHaveLength(2)
    expect(state.added.map((t: any) => [t.tier_id, t.tier_name, t.price_paid, t.payment_method]))
      .toEqual([['freeA', 'Free RSVP', 0, 'free'], ['freeA', 'Free RSVP', 0, 'free']])
    expect(state.reserveCalls).toEqual([
      { eventId: 'evt1', quantity: 2, tierIncrements: [{ tierId: 'freeA', quantity: 2 }], logPrefix: '[claim-free]' },
    ])
  })

  it('defaults quantity to 1 and singularizes the message', async () => {
    const body = await (await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).json()
    expect(body.count).toBe(1)
    expect(body.message).toBe('1 free ticket claimed successfully!')
  })

  it('clamps quantity to 10 (not an error) exactly as before', async () => {
    const body = await (await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 99 }))).json()
    expect(body.count).toBe(10)
    expect(state.added).toHaveLength(10)
  })

  it('auto-resolves the free tier when no tierId is sent', async () => {
    const body = await (await POST(req({ eventId: 'evt1', quantity: 1 }))).json()
    expect(body.count).toBe(1)
    expect(state.added[0].tier_id).toBe('freeA')
  })

  it('still refuses a PAID tier with 400 "This ticket tier is not free"', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('This ticket tier is not free')
    expect(state.added).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
  })

  it('still refuses an inactive / out-of-window / sold-out tier', async () => {
    state.tiers[0].is_active = false
    expect((await (await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).json()).error)
      .toBe('This ticket tier is not available.')
    reset()
    state.tiers[0].sales_end = '2020-01-01T00:00:00.000Z'
    expect((await (await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).json()).error)
      .toBe('Ticket sales for this tier have ended.')
    reset()
    state.tiers[0].sold_quantity = 100
    expect((await (await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).json()).error)
      .toBe('This ticket tier is sold out.')
  })

  it('still refuses a tier from another event with 404', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'someone-elses-tier' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Ticket tier not found for this event')
  })

  it('still returns the existing free tickets on a repeat claim (per-user limit)', async () => {
    state.existingTickets = [{ id: 'old1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1' }]
    const body = await (await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 2 }))).json()
    expect(body.message).toBe('You already claimed a ticket for this event.')
    expect(body.count).toBe(1)
    expect(state.added).toHaveLength(0)
  })

  it('still surfaces a capacity refusal without issuing', async () => {
    state.reserveResult = { ok: false, reason: 'tier_capacity', remaining: 1 }
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 3 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Only 1 ticket remaining')
    expect(state.added).toHaveLength(0)
  })
})

describe('NEW shape {eventId, selections}', () => {
  beforeEach(reset)

  it('issues a multi-tier multi-quantity all-free cart, all-or-nothing in ONE reservation', async () => {
    const res = await POST(req({
      eventId: 'evt1',
      selections: [{ tierId: 'freeA', quantity: 2 }, { tierId: 'freeB', quantity: 3 }],
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.count).toBe(5)
    expect(body.issued).toEqual([
      { tierId: 'freeA', tierName: 'Free RSVP', quantity: 2 },
      { tierId: 'freeB', tierName: 'Free Student', quantity: 3 },
    ])
    expect(state.added.map((t: any) => t.tier_id)).toEqual(['freeA', 'freeA', 'freeB', 'freeB', 'freeB'])
    // ONE transaction covering the whole order -> all-or-nothing.
    expect(state.reserveCalls).toHaveLength(1)
    expect(state.reserveCalls[0]).toEqual({
      eventId: 'evt1',
      quantity: 5,
      tierIncrements: [{ tierId: 'freeA', quantity: 2 }, { tierId: 'freeB', quantity: 3 }],
      logPrefix: '[claim-free]',
    })
  })

  it('merges duplicate tier lines', async () => {
    const body = await (await POST(req({
      eventId: 'evt1',
      selections: [{ tierId: 'freeA', quantity: 1 }, { tierId: 'freeA', quantity: 2 }],
    }))).json()
    expect(body.count).toBe(3)
    expect(body.issued).toEqual([{ tierId: 'freeA', tierName: 'Free RSVP', quantity: 3 }])
  })

  it('refuses the WHOLE claim if any line is a paid tier — nothing is issued', async () => {
    const res = await POST(req({
      eventId: 'evt1',
      selections: [{ tierId: 'freeA', quantity: 1 }, { tierId: 'paidA', quantity: 1 }],
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('This ticket tier is not free')
    expect(state.added).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
  })

  it('refuses the whole claim if any line is sold out / not on sale / foreign', async () => {
    state.tiers[1].sold_quantity = 50
    let res = await POST(req({ eventId: 'evt1', selections: [{ tierId: 'freeA', quantity: 1 }, { tierId: 'freeB', quantity: 1 }] }))
    expect((await res.json()).error).toBe('This ticket tier is sold out.')
    expect(state.added).toHaveLength(0)
    reset()
    res = await POST(req({ eventId: 'evt1', selections: [{ tierId: 'freeA', quantity: 1 }, { tierId: 'nope', quantity: 1 }] }))
    expect(res.status).toBe(404)
    expect(state.added).toHaveLength(0)
  })

  it('refuses (does not truncate) a cart over the 10-ticket cap', async () => {
    const res = await POST(req({
      eventId: 'evt1',
      selections: [{ tierId: 'freeA', quantity: 6 }, { tierId: 'freeB', quantity: 6 }],
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('You can claim at most 10 free tickets at a time.')
    expect(state.added).toHaveLength(0)
  })

  it('rejects a selections array with no usable line', async () => {
    const res = await POST(req({ eventId: 'evt1', selections: [{ tierId: 'freeA', quantity: 0 }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No valid ticket selections provided')
  })

  it('an EMPTY selections array falls through to the legacy path (unchanged)', async () => {
    const body = await (await POST(req({ eventId: 'evt1', selections: [], quantity: 2 }))).json()
    expect(body.count).toBe(2)
    expect(state.added[0].tier_id).toBe('freeA')
  })

  it('issues nothing when the atomic reservation refuses the multi-tier order', async () => {
    state.reserveResult = { ok: false, reason: 'tier_capacity', remaining: 0 }
    const res = await POST(req({ eventId: 'evt1', selections: [{ tierId: 'freeA', quantity: 2 }, { tierId: 'freeB', quantity: 2 }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No tickets available')
    expect(state.added).toHaveLength(0)
  })

  it('applies the same per-user free-claim limit', async () => {
    state.existingTickets = [{ id: 'old1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1' }]
    const body = await (await POST(req({ eventId: 'evt1', selections: [{ tierId: 'freeA', quantity: 2 }] }))).json()
    expect(body.message).toBe('You already claimed a ticket for this event.')
    expect(state.added).toHaveLength(0)
  })
})

/**
 * PROMO path: `promoCode` on either payload shape.
 *
 * The server never trusts the caller's arithmetic. It loads the tier price from
 * Firestore, loads the promo from `promo_codes`, recomputes the discount with the
 * same `calculateDiscount` the paid initiators use, and issues only when ITS OWN
 * total is exactly 0.
 */
describe('PROMO-ZEROED claims {…, promoCode}', () => {
  beforeEach(reset)

  it('issues free tickets for a PAID tier when a 100%-off promo zeroes it (legacy shape)', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 2, promoCode: 'FREE100' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.count).toBe(2)
    expect(body.promoApplied).toBe(true)
    expect(body.issued).toEqual([{ tierId: 'paidA', tierName: 'General Admission', quantity: 2 }])
    expect(state.added).toHaveLength(2)
    // Issued as a genuine free ticket, with an audit trail back to the promo.
    expect(state.added[0].price_paid).toBe(0)
    expect(state.added[0].promo_code_id).toBe('promoFull')
    expect(state.added[0].original_price).toBe(1500)
    // Same single atomic reservation as any other claim.
    expect(state.reserveCalls).toEqual([
      { eventId: 'evt1', quantity: 2, tierIncrements: [{ tierId: 'paidA', quantity: 2 }], logPrefix: '[claim-free]' },
    ])
  })

  it('accepts the promo DOC ID as well as the raw code (same as the paid initiators)', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'promoFull' }))
    expect(res.status).toBe(200)
    expect(state.added).toHaveLength(1)
  })

  it('issues a promo-zeroed multi-tier cart through the selections shape', async () => {
    const res = await POST(req({
      eventId: 'evt1',
      selections: [{ tierId: 'paidA', quantity: 1 }, { tierId: 'freeA', quantity: 1 }],
      promoCode: 'FREE100',
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.count).toBe(2)
    expect(state.added.map((t: any) => t.tier_id)).toEqual(['paidA', 'freeA'])
  })

  it('REFUSES a promo that only partially discounts — that belongs on checkout', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'HALF' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('promo_not_free')
    expect(state.added).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
    expect(state.usageWrites).toHaveLength(0)
  })

  it('REFUSES an expired promo', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'promoExpired' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_invalid')
    expect(state.added).toHaveLength(0)
  })

  it('REFUSES an inactive promo', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'promoInactive' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_invalid')
    expect(state.added).toHaveLength(0)
  })

  it('REFUSES a promo whose usage limit is already spent', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'promoUsedUp' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_exhausted')
    expect(state.added).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
  })

  it('REFUSES a promo that belongs to a DIFFERENT event', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'promoOtherEvent' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_invalid')
    expect(state.added).toHaveLength(0)
  })

  it('REFUSES an unknown promo code', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'NOPE' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_invalid')
  })

  it('still refuses a PAID tier claimed free with NO promo (the original bug)', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1 }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('This ticket tier is not free')
    expect(body.code).toBe('tier_not_free')
    expect(state.added).toHaveLength(0)
  })

  it('records the redemption EXACTLY once: uses_count += qty and one usage doc', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 3, promoCode: 'MINUS1500' }))
    expect(res.status).toBe(200)
    expect(state.added).toHaveLength(3)
    expect(state.promos.promoFixed.uses_count).toBe(3)
    expect(state.usageWrites).toHaveLength(1)
    expect(state.usageWrites[0]).toMatchObject({
      promo_code_id: 'promoFixed',
      user_id: 'u1',
      event_id: 'evt1',
      qty: 3,
      discount_applied: 4500,
    })
  })

  it('does NOT burn a promo use when the tier was already free (nothing was discounted)', async () => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 2, promoCode: 'MINUS1500' }))
    expect(res.status).toBe(200)
    expect(state.promos.promoFixed.uses_count).toBe(0)
    expect(state.usageWrites).toHaveLength(0)
    expect(state.added[0].promo_code_id).toBeUndefined()
  })

  it('refuses a promo that cannot cover the whole claim BEFORE reserving anything', async () => {
    // max_uses 1 cannot cover 3 tickets. The pricing-time check is now quantity-aware
    // (promoCanCoverOrder), so this is refused up front instead of reserving and
    // then releasing when the atomic redemption loses.
    const res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 3, promoCode: 'LASTONE' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_exhausted')
    expect(state.added).toHaveLength(0)
    expect(state.promos.promoOneLeft.uses_count).toBe(0)
    expect(state.usageWrites).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
    expect(state.releaseCalls).toEqual([])
  })

  it('keeps every non-promo guard: a promo cannot rescue a sold-out or closed tier', async () => {
    state.tiers[2].sold_quantity = 100
    let res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'FREE100' }))
    expect((await res.json()).code).toBe('tier_sold_out')
    expect(state.added).toHaveLength(0)
    reset()
    state.tiers[2].is_active = false
    res = await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'FREE100' }))
    expect((await res.json()).code).toBe('tier_inactive')
    reset()
    res = await POST(req({ eventId: 'evt1', tierId: 'someone-elses-tier', promoCode: 'FREE100' }))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('tier_not_found')
  })

  it('will not guess WHICH paid tier to zero when no tier is named', async () => {
    state.tiers = [state.tiers[2]] // paid tiers only
    const res = await POST(req({ eventId: 'evt1', quantity: 1, promoCode: 'FREE100' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('promo_requires_tier')
    expect(state.added).toHaveLength(0)
  })

  it('still honors the per-user free-claim limit on the promo path', async () => {
    state.existingTickets = [{ id: 'old1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1' }]
    const body = await (await POST(req({ eventId: 'evt1', tierId: 'paidA', quantity: 1, promoCode: 'FREE100' }))).json()
    expect(body.message).toBe('You already claimed a ticket for this event.')
    expect(state.added).toHaveLength(0)
    expect(state.usageWrites).toHaveLength(0)
  })

  it('caps a promo claim at 10 tickets like any other', async () => {
    const res = await POST(req({
      eventId: 'evt1',
      selections: [{ tierId: 'paidA', quantity: 11 }],
      promoCode: 'FREE100',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('too_many_tickets')
  })
})

/**
 * Ticket DELIVERY.
 *
 * This route imported no email module at all: an attendee of a free/RSVP event got an
 * in-app notification and nothing in their inbox — no confirmation, no QR code,
 * nothing to show at the door. A free ticket is still a ticket.
 */
describe('delivery — a free ticket is emailed like a paid one', () => {
  beforeEach(reset)

  const { sendTicketConfirmation } = require('@/lib/tickets/confirmation')

  it('sends the confirmation (with the QR payload) to the account holder', async () => {
    await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 2 }))

    expect(sendTicketConfirmation).toHaveBeenCalledTimes(1)
    const arg = sendTicketConfirmation.mock.calls[0][0]
    expect(arg.recipient).toMatchObject({ email: 'u@x.com', isGuest: false })
    expect(arg.ticketId).toBe('tkt1')
    // The QR must encode the ticket, which is what the scanner reads.
    expect(arg.qrPayload).toBe('tkt1')
    expect(arg.quantity).toBe(2)
  })

  it('never fails an issued claim because delivery failed', async () => {
    sendTicketConfirmation.mockRejectedValueOnce(new Error('resend down'))
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 1 }))
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(1)
    expect(state.added).toHaveLength(1)
  })
})

/**
 * GUEST claims: an RSVP without an account.
 *
 * The identity is minted server-side; the ticket carries the guest's contact details
 * so support and refunds can still find it; and the response hands back a SIGNED
 * retrieval link rather than any guessable id.
 */
describe('guest claim — no account required', () => {
  // `reset()` deliberately does not rebuild `state.event` (it is shared), so the
  // event-shape flags these tests flip are cleared here rather than leaking forward.
  beforeEach(() => {
    reset()
    delete state.event.country
    delete state.event.is_password_protected
  })

  const { getCurrentUser } = require('@/lib/auth')
  const { sendTicketConfirmation } = require('@/lib/tickets/confirmation')

  const asGuest = () => getCurrentUser.mockResolvedValueOnce(null)

  it('issues a ticket to a guest and returns a signed retrieval link', async () => {
    asGuest()
    const res = await POST(
      req({
        eventId: 'evt1',
        tierId: 'freeA',
        quantity: 1,
        guest: { name: 'Marie Joseph', email: 'Marie@Example.com ', phone: '' },
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.count).toBe(1)

    // The ticket belongs to a `guest_…` id, not a uid, and carries the contact
    // details that refunds/support search on.
    const ticket = state.added[0]
    expect(ticket.attendee_id).toMatch(/^guest_[0-9a-f]{24}$/)
    expect(ticket.is_guest).toBe(true)
    expect(ticket.guest_email).toBe('marie@example.com') // normalized
    expect(ticket.attendee_name).toBe('Marie Joseph')

    // The retrieval link is `{orderKey}.{signature}` — the order key alone is not it.
    const url = String(body.guestTicketUrl || '')
    expect(url).toContain('/tickets/guest/')
    const token = decodeURIComponent(url.split('/tickets/guest/')[1])
    expect(token).toMatch(/^[a-f0-9]{48}\.[A-Za-z0-9_-]{22}$/)

    // …and it verifies against the record that was written.
    const { verifyGuestToken } = require('@/lib/guest/identity')
    const orderKey = verifyGuestToken(token)
    expect(orderKey).toBeTruthy()
    expect(state.guestOrders[orderKey!]).toMatchObject({
      email: 'marie@example.com',
      status: 'issued',
      ticket_ids: ['tkt1'],
    })

    // Delivery goes to the guest, over guest channels, with their own link.
    const arg = sendTicketConfirmation.mock.calls[0][0]
    expect(arg.recipient).toMatchObject({ email: 'marie@example.com', isGuest: true })
    expect(arg.guestToken).toBe(token)
  })

  it('refuses a guest with no contact details at all (401, as before)', async () => {
    asGuest()
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: 1 }))
    expect(res.status).toBe(401)
    expect(state.added).toHaveLength(0)
  })

  it('refuses a malformed email rather than issuing an undeliverable ticket', async () => {
    asGuest()
    const res = await POST(
      req({ eventId: 'evt1', tierId: 'freeA', guest: { name: 'X', email: 'not-an-email' } })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('guest_email_invalid')
    expect(state.added).toHaveLength(0)
  })

  it('requires a phone number for a Haiti event — it is the identifier that reaches people', async () => {
    state.event.country = 'HT'
    asGuest()
    const res = await POST(
      req({ eventId: 'evt1', tierId: 'freeA', guest: { name: 'X', email: 'x@y.com' } })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('guest_phone_required')

    // With one, the local 8-digit form is normalized to E.164.
    asGuest()
    const ok = await POST(
      req({
        eventId: 'evt1',
        tierId: 'freeA',
        guest: { name: 'X', email: 'x@y.com', phone: '3412 3456' },
      })
    )
    expect(ok.status).toBe(200)
    expect(state.added[0].guest_phone).toBe('+50934123456')
  })

  it('refuses a guest who brings NO code to a password-protected event', async () => {
    state.event.is_password_protected = true
    asGuest()
    const res = await POST(
      req({ eventId: 'evt1', tierId: 'freeA', guest: { name: 'X', email: 'x@y.com' } })
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('access_code_required')
    expect(state.added).toHaveLength(0)
    // Nothing is created for a buyer who can't get in — no order, no grant.
    expect(Object.keys(state.guestOrders)).toHaveLength(0)
    expect(Object.keys(state.grants)).toHaveLength(0)
  })

  it('refuses a guest with the WRONG code, and counts the attempt', async () => {
    state.event.is_password_protected = true
    asGuest()
    const res = await POST(
      req({
        eventId: 'evt1',
        tierId: 'freeA',
        guest: { name: 'X', email: 'x@y.com' },
        accessCode: 'NOPE',
      })
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('access_code_incorrect')
    expect(state.added).toHaveLength(0)
    expect(Object.keys(state.guestOrders)).toHaveLength(0)
    expect(Object.keys(state.grants)).toHaveLength(0)
    expect(state.failedAccessAttempts).toBe(1)
  })

  it('refuses a throttled guest before the code is even compared', async () => {
    state.event.is_password_protected = true
    state.accessThrottled = true
    asGuest()
    const res = await POST(
      req({
        eventId: 'evt1',
        tierId: 'freeA',
        guest: { name: 'X', email: 'x@y.com' },
        accessCode: 'LETMEIN',
      })
    )
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('access_throttled')
    expect(state.added).toHaveLength(0)
  })

  it('lets a guest with the CORRECT code in, granting against their guest id', async () => {
    state.event.is_password_protected = true
    asGuest()
    const res = await POST(
      req({
        eventId: 'evt1',
        tierId: 'freeA',
        guest: { name: 'X', email: 'x@y.com' },
        accessCode: ' LETMEIN ',
      })
    )
    expect(res.status).toBe(200)
    expect(state.added).toHaveLength(1)
    // The grant is keyed by the id the ticket is issued to, exactly as a uid would be.
    const guestId = state.added[0].attendee_id
    expect(guestId).toMatch(/^guest_/)
    expect(state.grants[guestId]).toBe(true)
    expect(state.failedAccessAttempts).toBe(0)
  })

  it('still refuses a signed-in user with no grant, code or not', async () => {
    state.event.is_password_protected = true
    const res = await POST(
      req({ eventId: 'evt1', tierId: 'freeA', accessCode: 'LETMEIN' })
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('access_code_required')
    expect(state.added).toHaveLength(0)
  })

  it('dedupes a repeat guest claim on the EMAIL, with a NEUTRAL answer (no tickets leaked)', async () => {
    state.existingTickets = [
      {
        id: 'old1',
        event_id: 'evt1',
        price_paid: 0,
        guest_email: 'marie@example.com',
        guest_phone: '+50937000000',
        qr_code_data: 'old1',
      },
    ]
    asGuest()
    const res = await POST(
      req({ eventId: 'evt1', tierId: 'freeA', guest: { name: 'Marie', email: 'marie@example.com' } })
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('already_claimed')
    expect(body.error).toMatch(/Check your email/)
    // Whoever typed this address learns nothing about the earlier order.
    expect(body.tickets).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('old1')
    expect(JSON.stringify(body)).not.toContain('+50937000000')
    expect(state.added).toHaveLength(0)
  })

  it('a second simultaneous guest claim loses the lock and issues nothing', async () => {
    asGuest()
    const body = { eventId: 'evt1', tierId: 'freeA', guest: { name: 'Marie', email: 'marie@example.com' } }
    const first = await POST(req(body))
    expect(first.status).toBe(200)
    // The query dedup would find the tickets anyway; prove the LOCK alone holds.
    state.existingTickets = []
    asGuest()
    const second = await POST(req(body))
    expect(second.status).toBe(409)
    expect((await second.json()).code).toBe('already_claimed')
    expect(state.reserveCalls).toHaveLength(1)
  })
})

/**
 * Money-path hardening: whole quantities only, and only for a live event.
 */
describe('quantity and event-state gates', () => {
  beforeEach(() => {
    reset()
    state.event.status = 'published'
    state.event.is_published = true
    state.event.start_datetime = '2099-09-01T18:00:00.000Z'
    delete state.event.end_datetime
    delete state.event.rejected
  })

  it.each([0.01, 1.5, 1.01, 'abc'])('refuses a fractional / non-numeric legacy quantity %p', async (q) => {
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA', quantity: q }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_quantity')
    expect(state.added).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
  })

  it('refuses a fractional selection line instead of truncating it', async () => {
    const res = await POST(req({ eventId: 'evt1', selections: [{ tierId: 'freeA', quantity: 1.5 }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_quantity')
    expect(state.added).toHaveLength(0)
  })

  it.each([
    ['cancelled', { status: 'cancelled' }, 'event_cancelled'],
    ['unpublished', { is_published: false, status: 'draft' }, 'event_unavailable'],
    ['rejected', { rejected: true, is_published: false }, 'event_unavailable'],
    ['ended', { start_datetime: '2026-01-01T18:00:00Z', end_datetime: '2026-01-02T02:00:00Z' }, 'event_ended'],
  ])('refuses a %s event', async (_label, patch, code) => {
    Object.assign(state.event, patch)
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe(code)
    expect(state.added).toHaveLength(0)
  })

  it('gives the claim lock back when the reservation is refused, so a retry can succeed', async () => {
    state.reserveResult = { ok: false, reason: 'tier_capacity', remaining: 0 }
    expect((await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).status).toBe(400)
    expect(Object.keys(state.locks)).toHaveLength(0)
    state.reserveResult = { ok: true }
    expect((await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).status).toBe(200)
  })
})

/**
 * The once-per-event lock reopens ONLY when every ticket the claim issued was
 * voided. A ticket transferred away still holds it (claim, transfer, claim again
 * would farm free tickets), and the route never answers success with no tickets.
 */
describe('free claim lock: stale vs held', () => {
  const LOCK_ID = 'evt1__u1'
  beforeEach(() => {
    reset()
    state.event.status = 'published'
    state.event.is_published = true
    state.event.start_datetime = '2099-09-01T18:00:00.000Z'
    delete state.event.end_datetime
    delete state.event.rejected
  })

  it('records the issued ticket ids on the lock', async () => {
    expect((await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).status).toBe(200)
    expect(state.locks[LOCK_ID].ticket_ids).toEqual(state.added.map((t: any) => t.id))
    expect(state.locks[LOCK_ID].issued_at).toBeTruthy()
  })

  it('a ticket transferred away keeps the claim taken: 409, nothing issued', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: '2026-01-01T00:00:00Z', issued_at: 'x', ticket_ids: ['t1'] }
    state.existingTickets = [{ id: 't1', event_id: 'evt1', price_paid: 0, attendee_id: 'friend', status: 'valid' }]
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('already_claimed')
    expect(body.success).toBeUndefined()
    expect(state.added).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
  })

  it('a checked-in, since-cancelled ticket still holds the claim', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: '2026-01-01T00:00:00Z', ticket_ids: ['t1'] }
    state.existingTickets = [{ id: 't1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1', status: 'cancelled', checked_in: true }]
    expect((await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).status).toBe(409)
    expect(state.added).toHaveLength(0)
  })

  it('every issued ticket refunded / cancelled reopens the claim', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: '2026-01-01T00:00:00Z', issued_at: 'x', ticket_ids: ['t1', 't2'] }
    state.existingTickets = [
      { id: 't1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1', status: 'refunded' },
      { id: 't2', event_id: 'evt1', price_paid: 0, attendee_id: 'u1', status: 'cancelled' },
    ]
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.tickets.length).toBeGreaterThan(0)
    expect(state.added).toHaveLength(1)
    expect(state.locks[LOCK_ID].ticket_ids).toEqual([state.added[0].id])
  })

  it('returns the claimant’s own live tickets when they still hold the claim', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: '2026-01-01T00:00:00Z', ticket_ids: ['t1'] }
    state.existingTickets = [{ id: 't1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1', status: 'valid' }]
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA' }))
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.count).toBe(1)
    expect(body.tickets[0].id).toBe('t1')
    expect(state.added).toHaveLength(0)
  })

  it('legacy lock (no ticket ids): all of the claimant’s tickets refunded reopens it', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: '2026-01-01T00:00:00Z' }
    state.existingTickets = [{ id: 'old1', event_id: 'evt1', price_paid: 0, attendee_id: 'u1', status: 'refunded' }]
    expect((await POST(req({ eventId: 'evt1', tierId: 'freeA' }))).status).toBe(200)
    expect(state.added).toHaveLength(1)
  })

  it('legacy lock with no findable tickets stays taken (cannot be shown void)', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: '2026-01-01T00:00:00Z' }
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_claimed')
    expect(state.added).toHaveLength(0)
  })

  it('a fresh lock with nothing issued yet (concurrent claim) is refused, never success with zero tickets', async () => {
    state.locks[LOCK_ID] = { event_id: 'evt1', created_at: new Date().toISOString() }
    const res = await POST(req({ eventId: 'evt1', tierId: 'freeA' }))
    expect(res.status).toBe(409)
    expect(state.added).toHaveLength(0)
  })
})
