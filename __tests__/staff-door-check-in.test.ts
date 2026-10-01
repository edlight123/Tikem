/**
 * Door access for check-in-only staff: GET /api/staff/events/:id/door-list and
 * POST /api/staff/events/:id/check-in.
 *
 * Covers the authorization matrix (owner, owner-role member, admin, check-in
 * staff, view-only staff, stranger), the check-in verdicts, the transaction
 * write, the door list's field allow-list (no PII beyond the display name), and
 * parity between the server rules and the Expo app's offline copy.
 *
 * @jest-environment node
 */

import {
  belongsOnDoorList,
  evaluateDoorAccess,
  judgeDoorRow as serverJudge,
  resolveTier,
  toDoorRow,
} from '@/lib/scan/doorRules'
import { judgeDoorRow as mobileJudge, enqueueCheckIn, findDoorRow, markRowCheckedIn } from '../mobile/lib/doorList'

// ---------------------------------------------------------------------------
// Fake Firestore + auth
// ---------------------------------------------------------------------------

const state: {
  user: any
  docs: Record<string, Record<string, any>>
  updates: Array<{ path: string; data: Record<string, any> }>
  transactions: number
} = { user: null, docs: {}, updates: [], transactions: 0 }

function docRef(path: string): any {
  const id = path.split('/').pop()!
  return {
    id,
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snap(path),
    update: async (data: any) => {
      state.updates.push({ path, data })
    },
  }
}

function snap(path: string) {
  const data = state.docs[path]
  return { id: path.split('/').pop()!, exists: data !== undefined, data: () => data, ref: docRef(path) }
}

function collectionRef(path: string, filters: Array<[string, any]> = [], max = Infinity): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, _op: string, value: any) => collectionRef(path, [...filters, [field, value]], max),
    limit: (n: number) => collectionRef(path, filters, n),
    get: async () => {
      const prefix = `${path}/`
      const docs = Object.keys(state.docs)
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .filter((p) => filters.every(([f, v]) => state.docs[p][f] === v))
        .slice(0, max)
        .map((p) => snap(p))
      return { empty: docs.length === 0, docs, size: docs.length }
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: any[]) => refs.map((r) => snap(r.path)),
    runTransaction: async (fn: any) => {
      state.transactions += 1
      const pending: Array<{ path: string; data: any }> = []
      const result = await fn({
        get: async (ref: any) => snap(ref.path),
        update: (ref: any, data: any) => pending.push({ path: ref.path, data }),
      })
      for (const w of pending) {
        state.updates.push(w)
        state.docs[w.path] = { ...state.docs[w.path], ...w.data }
      }
      return result
    },
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => state.user) }))
jest.mock('@/lib/admin', () => ({ isAdmin: (email?: string | null) => email === 'boss@tikem.co' }))

import { GET as doorListGET } from '@/app/api/staff/events/[id]/door-list/route'
import { POST as checkInPOST } from '@/app/api/staff/events/[id]/check-in/route'

const EVENT = 'evt1'
const ctx = { params: Promise.resolve({ id: EVENT }) }
const future = new Date(Date.now() + 7 * 864e5).toISOString()

function seed() {
  state.updates = []
  state.transactions = 0
  state.docs = {
    [`events/${EVENT}`]: {
      title: 'Kanaval',
      organizer_id: 'owner1',
      allow_reentry: false,
      ticket_tiers: [{ id: 'vip', name: 'VIP', valid_from: '2000-01-01T00:00:00.000Z' }],
    },
    [`events/${EVENT}/members/coowner`]: { role: 'owner', permissions: { checkin: true, viewAttendees: true } },
    [`events/${EVENT}/members/door1`]: { role: 'staff', permissions: { checkin: true, viewAttendees: false } },
    [`events/${EVENT}/members/viewer1`]: { role: 'staff', permissions: { checkin: false, viewAttendees: true } },
    [`users/owner1`]: { full_name: 'Owner' },
    [`users/buyer2`]: { full_name: 'Bèl Moun', email: 'bel@x.co', phone_number: '+509' },
    'tickets/t1': {
      event_id: EVENT,
      status: 'valid',
      attendee_name: 'Ana Pierre',
      attendee_email: 'ana@x.co',
      guest_email: 'ana@x.co',
      phone: '+50912345678',
      price_paid: 1500,
      currency: 'HTG',
      payment_method: 'moncash',
      payment_id: 'mc_1',
      tier_name: 'GA',
      qr_code_data: 't1',
      end_datetime: future,
    },
    'tickets/t2': { event_id: EVENT, status: 'confirmed', attendee_id: 'buyer2', tier_id: 'vip', qr_code_data: 'QR-T2' },
    'tickets/t3': { event_id: EVENT, status: 'refunded', attendee_name: 'Refunded Ray' },
    'tickets/t4': {
      event_id: EVENT,
      status: 'refunded',
      attendee_name: 'Was In',
      checked_in: true,
      checked_in_at: '2026-09-01T20:00:00.000Z',
    },
    'tickets/t5': { event_id: EVENT, status: 'active', attendee_name: 'Already', checked_in: true, checked_in_by: 'door1' },
    'tickets/other': { event_id: 'evt2', status: 'valid', attendee_name: 'Elsewhere' },
  }
}

const as = (user: any) => {
  state.user = user
}
const OWNER = { id: 'owner1', email: 'o@x.co', role: 'organizer' }
const COOWNER = { id: 'coowner', email: 'c@x.co', role: 'attendee' }
const ADMIN = { id: 'admin1', email: 'boss@tikem.co', role: 'attendee' }
const DOOR = { id: 'door1', email: 'd@x.co', role: 'attendee' }
const VIEWER = { id: 'viewer1', email: 'v@x.co', role: 'attendee' }
const STRANGER = { id: 'nobody', email: 'n@x.co', role: 'organizer' }

const post = (body: any) =>
  checkInPOST(
    new Request('http://localhost/api/staff/events/evt1/check-in', { method: 'POST', body: JSON.stringify(body) }),
    ctx
  )

beforeEach(seed)

// ---------------------------------------------------------------------------
// Authorization matrix
// ---------------------------------------------------------------------------

describe('evaluateDoorAccess', () => {
  const event = { organizer_id: 'owner1' }
  it.each([
    ['organizer', { uid: 'owner1', isAdmin: false, event, member: null }, 'owner'],
    ['legacy organizerId', { uid: 'owner1', isAdmin: false, event: { organizerId: 'owner1' }, member: null }, 'owner'],
    ['owner-role member', { uid: 'm', isAdmin: false, event, member: { role: 'owner' } }, 'owner'],
    ['admin', { uid: 'a', isAdmin: true, event, member: null }, 'admin'],
    ['check-in staff', { uid: 's', isAdmin: false, event, member: { permissions: { checkin: true } } }, 'staff'],
  ])('allows the %s', (_label, input, role) => {
    expect(evaluateDoorAccess(input as any)).toMatchObject({ allowed: true, role })
  })

  it.each([
    ['view-only staff', { uid: 's', isAdmin: false, event, member: { permissions: { checkin: false, viewAttendees: true } } }, 403],
    ['member with no permissions', { uid: 's', isAdmin: false, event, member: { role: 'staff' } }, 403],
    ['checkin as a truthy string', { uid: 's', isAdmin: false, event, member: { permissions: { checkin: 'yes' } } }, 403],
    ['stranger', { uid: 'x', isAdmin: false, event, member: null }, 403],
    ['signed-out user', { uid: null, isAdmin: false, event, member: null }, 401],
    ['missing event', { uid: 'owner1', isAdmin: false, event: null, member: null }, 404],
  ])('refuses the %s', (_label, input, status) => {
    expect(evaluateDoorAccess(input as any)).toMatchObject({ allowed: false, status })
  })

  it('reports whether staff may also view attendees', () => {
    expect(
      evaluateDoorAccess({ uid: 's', isAdmin: false, event, member: { permissions: { checkin: true, viewAttendees: true } } })
    ).toMatchObject({ canViewAttendees: true })
    expect(
      evaluateDoorAccess({ uid: 's', isAdmin: false, event, member: { permissions: { checkin: true } } })
    ).toMatchObject({ canViewAttendees: false })
  })
})

describe('route authorization matrix', () => {
  it.each([
    ['owner', OWNER, 200],
    ['owner-role member', COOWNER, 200],
    ['admin', ADMIN, 200],
    ['check-in staff', DOOR, 200],
    ['view-only staff', VIEWER, 403],
    ['stranger', STRANGER, 403],
    ['signed out', null, 401],
  ])('door-list: %s -> %i', async (_label, user, status) => {
    as(user)
    const res = await doorListGET(new Request('http://localhost'), ctx)
    expect(res.status).toBe(status)
  })

  it.each([
    ['owner', OWNER, 200],
    ['admin', ADMIN, 200],
    ['check-in staff', DOOR, 200],
    ['view-only staff', VIEWER, 403],
    ['stranger', STRANGER, 403],
    ['signed out', null, 401],
  ])('check-in: %s -> %i, and nothing is written when refused', async (_label, user, status) => {
    as(user)
    const res = await post({ ticketId: 't1' })
    expect(res.status).toBe(status)
    if (status !== 200) {
      expect(state.updates).toEqual([])
      expect(state.transactions).toBe(0)
    }
  })

  it('404s an unknown event', async () => {
    as(OWNER)
    const res = await doorListGET(new Request('http://localhost'), { params: Promise.resolve({ id: 'nope' }) })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Door list contents
// ---------------------------------------------------------------------------

describe('GET door-list', () => {
  it('lists live tickets plus checked-in ones, with only the door fields', async () => {
    as(DOOR)
    const res = await doorListGET(new Request('http://localhost'), ctx)
    const json: any = await res.json()
    const ids = json.rows.map((r: any) => r.id).sort()
    // t3 is refunded and never came in; `other` belongs to another event.
    expect(ids).toEqual(['t1', 't2', 't4', 't5'])

    const allowed = ['id', 'code', 'name', 'tier', 'status', 'live', 'checkedIn', 'checkedInAt', 'endsAt', 'validFrom', 'validUntil']
    for (const row of json.rows) expect(Object.keys(row).sort()).toEqual([...allowed].sort())

    const text = JSON.stringify(json)
    for (const secret of ['ana@x.co', 'bel@x.co', '+509', '1500', 'moncash', 'mc_1', 'HTG']) {
      expect(text).not.toContain(secret)
    }
    expect(json.event).toEqual({ id: EVENT, title: 'Kanaval', allowReentry: false })
  })

  it('resolves the display name from the profile for older tickets, and the tier window', async () => {
    as(DOOR)
    const json: any = await (await doorListGET(new Request('http://localhost'), ctx)).json()
    const t2 = json.rows.find((r: any) => r.id === 't2')
    expect(t2).toMatchObject({ name: 'Bèl Moun', tier: 'VIP', code: 'QR-T2', live: true, validFrom: '2000-01-01T00:00:00.000Z' })
    const t4 = json.rows.find((r: any) => r.id === 't4')
    expect(t4).toMatchObject({ live: false, checkedIn: true, checkedInAt: '2026-09-01T20:00:00.000Z' })
  })
})

// ---------------------------------------------------------------------------
// Check-in validation + transaction
// ---------------------------------------------------------------------------

describe('POST check-in', () => {
  beforeEach(() => as(DOOR))

  it('checks a live ticket in, in a transaction, writing the scanner fields', async () => {
    const res = await post({ ticketId: 't1', method: 'manual', entryPoint: 'Gate A' })
    const json: any = await res.json()
    expect(json).toMatchObject({ ok: true, verdict: 'CHECKED_IN' })
    expect(json.row).toMatchObject({ id: 't1', checkedIn: true, name: 'Ana Pierre' })
    expect(JSON.stringify(json)).not.toContain('ana@x.co')
    expect(state.transactions).toBe(1)
    expect(state.updates).toEqual([
      {
        path: 'tickets/t1',
        data: {
          checked_in: true,
          checked_in_by: 'door1',
          check_in_method: 'manual',
          entry_point: 'Gate A',
          checked_in_at: '__server_ts__',
          updated_at: '__server_ts__',
        },
      },
    ])
  })

  it('cannot admit the same ticket twice', async () => {
    await post({ ticketId: 't1' })
    const second: any = await (await post({ ticketId: 't1' })).json()
    expect(second).toMatchObject({ ok: false, verdict: 'ALREADY_CHECKED_IN', mine: true })
    expect(state.updates).toHaveLength(1)
  })

  it('reports "already in" by another user as not mine', async () => {
    as(OWNER)
    const json: any = await (await post({ ticketId: 't5' })).json()
    expect(json).toMatchObject({ verdict: 'ALREADY_CHECKED_IN', mine: false })
  })

  it('finds a ticket by the code its QR encodes, or a scanned URL', async () => {
    expect(await (await post({ code: 'QR-T2', override: true })).json()).toMatchObject({ verdict: 'CHECKED_IN' })
    seed()
    expect(await (await post({ code: 'https://tikem.co/tickets/t1' })).json()).toMatchObject({ verdict: 'CHECKED_IN' })
  })

  it.each([
    ['an unknown ticket', { ticketId: 'missing' }, 'NOT_FOUND'],
    ['a ticket for another event', { ticketId: 'other' }, 'WRONG_EVENT'],
    ['a refunded ticket', { ticketId: 't3' }, 'CANCELLED'],
    ['an already checked-in ticket', { ticketId: 't5' }, 'ALREADY_CHECKED_IN'],
  ])('refuses %s without writing', async (_label, body, verdict) => {
    const json: any = await (await post(body)).json()
    expect(json).toMatchObject({ ok: false, verdict })
    expect(state.updates).toEqual([])
  })

  it('refuses an expired ticket', async () => {
    state.docs['tickets/t1'].end_datetime = '2001-01-01T00:00:00.000Z'
    expect(await (await post({ ticketId: 't1' })).json()).toMatchObject({ verdict: 'EXPIRED' })
    expect(state.updates).toEqual([])
  })

  it('blocks outside the tier entry window unless overridden', async () => {
    state.docs[`events/${EVENT}`].ticket_tiers[0].valid_from = '2999-01-01T00:00:00.000Z'
    expect(await (await post({ ticketId: 't2' })).json()).toMatchObject({ verdict: 'OUTSIDE_WINDOW' })
    expect(state.updates).toEqual([])
    expect(await (await post({ ticketId: 't2', override: true })).json()).toMatchObject({ verdict: 'CHECKED_IN' })
  })

  it('uses ticket_tiers/{id} when the event does not embed the tier', async () => {
    state.docs['tickets/t1'].tier_id = 'early'
    state.docs['ticket_tiers/early'] = { name: 'Early', valid_until: '2001-01-01T00:00:00.000Z' }
    expect(await (await post({ ticketId: 't1' })).json()).toMatchObject({ verdict: 'OUTSIDE_WINDOW' })
  })

  it('allows re-entry only when the event allows it, and records reentry_override', async () => {
    expect(await (await post({ ticketId: 't5', reentry: true })).json()).toMatchObject({ verdict: 'ALREADY_CHECKED_IN' })
    state.docs[`events/${EVENT}`].allow_reentry = true
    expect(await (await post({ ticketId: 't5', reentry: true })).json()).toMatchObject({ verdict: 'CHECKED_IN' })
    expect(state.updates[0].data).toMatchObject({ reentry_override: true, checked_in: true })
    // A ticket refunded after it came in is not let back in.
    expect(await (await post({ ticketId: 't4', reentry: true })).json()).toMatchObject({ verdict: 'ALREADY_CHECKED_IN' })
    expect(state.updates).toHaveLength(1)
  })

  it('400s without a ticket id or code', async () => {
    expect((await post({})).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Pure helpers + mobile parity
// ---------------------------------------------------------------------------

describe('door rules', () => {
  it('keeps live and checked-in tickets on the list', () => {
    expect(belongsOnDoorList({ status: 'valid' })).toBe(true)
    expect(belongsOnDoorList({ status: '' })).toBe(true)
    expect(belongsOnDoorList({ status: 'pending' })).toBe(false)
    expect(belongsOnDoorList({ status: 'refunded', checked_in: true })).toBe(true)
  })

  it('resolves tiers by id, then fetched doc, then name', () => {
    const tiers = [{ id: 'a', name: 'GA' }]
    expect(resolveTier(tiers, 'a', '', null)).toEqual(tiers[0])
    expect(resolveTier(tiers, 'b', 'GA', { name: 'B' })).toEqual({ name: 'B' })
    expect(resolveTier(tiers, '', 'ga ', null)).toEqual(tiers[0])
    expect(resolveTier(tiers, '', '', null)).toBeNull()
  })
})

describe('mobile offline judge matches the server', () => {
  const now = new Date('2026-10-01T20:00:00.000Z')
  const cases: Array<[string, Record<string, any>, Record<string, any> | null, any]> = [
    ['live', { status: 'valid' }, null, {}],
    ['legacy no status', {}, null, {}],
    ['expired', { status: 'valid', end_datetime: '2026-10-01T19:00:00.000Z' }, null, {}],
    ['already in', { status: 'valid', checked_in: true }, null, {}],
    ['already in, re-entry allowed', { status: 'valid', checked_in: true }, null, { reentry: true, allowReentry: true }],
    ['already in, re-entry not allowed', { status: 'valid', checked_in: true }, null, { reentry: true }],
    ['refunded', { status: 'refunded' }, null, {}],
    ['pending', { status: 'pending' }, null, {}],
    ['before window', { status: 'valid' }, { valid_from: '2026-10-02T00:00:00.000Z' }, {}],
    ['after window', { status: 'valid' }, { valid_until: '2026-10-01T00:00:00.000Z' }, {}],
    ['after window, overridden', { status: 'valid' }, { valid_until: '2026-10-01T00:00:00.000Z' }, { override: true }],
    ['in window', { status: 'active' }, { valid_from: '2026-10-01T00:00:00.000Z', valid_until: '2026-10-02T00:00:00.000Z' }, {}],
  ]

  it.each(cases)('%s', (_label, ticket, tier, opts) => {
    const row = toDoorRow('t', { event_id: EVENT, ...ticket }, { tier })
    const c = { allowReentry: false, now, ...opts }
    expect(mobileJudge(row as any, c)).toEqual(serverJudge(row, { eventId: EVENT, ...c }))
  })

  it('both refuse a missing ticket', () => {
    expect(mobileJudge(null, { allowReentry: false })).toEqual(serverJudge(null, { eventId: EVENT, allowReentry: false }))
  })
})

describe('mobile door list helpers', () => {
  const rows = [toDoorRow('t1', { qr_code_data: 'CODE1', status: 'valid' }), toDoorRow('t2', { status: 'valid' })] as any

  it('finds a row by id or by code', () => {
    expect(findDoorRow(rows, 't2')?.id).toBe('t2')
    expect(findDoorRow(rows, 'CODE1')?.id).toBe('t1')
    expect(findDoorRow(rows, 'zzz')).toBeNull()
  })

  it('marks a row in so an offline re-scan reads "already in"', () => {
    const next = markRowCheckedIn(rows, 't1', '2026-10-01T20:00:00.000Z')
    expect(mobileJudge(next[0], { allowReentry: false }).verdict).toBe('ALREADY_CHECKED_IN')
  })

  it('queues a ticket once', () => {
    const item = {
      key: 'k',
      eventId: EVENT,
      ticketId: 't1',
      method: 'scan' as const,
      entryPoint: null,
      reentry: false,
      override: false,
      queuedAt: '',
      name: 'Ana',
    }
    const q = enqueueCheckIn(enqueueCheckIn([], item), { ...item, key: 'k2' })
    expect(q).toHaveLength(1)
  })
})
