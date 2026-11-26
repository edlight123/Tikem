/**
 * Deleting a draft that never sold (ported from Tikra 967a562c, adapted).
 * Only drafts with no trace of a sale may go; published events keep Cancel.
 *
 *  - the pure guard matrix (lib/events/draftDelete) and the app copy's parity
 *  - the route over an in-memory Firestore: what goes with the event, what
 *    stays, and a refusal for EVERY kind of sale / order / printed batch /
 *    door-team request / add-on / hold / money row
 *  - team scoping by the event's own org (never the acting-org header)
 *  - the security rule: no client deletes an event
 *
 * @jest-environment node
 */
import fs from 'fs'
import path from 'path'
import { FakeFirestore } from './helpers/fakeFirestore'
import { DRAFT_DELETE_MESSAGES, draftDeleteBlock, isDraftEvent } from '@/lib/events/draftDelete'
import * as mobile from '../mobile/lib/draftDelete'

class RecursiveFakeFirestore extends FakeFirestore {
  async recursiveDelete(ref: any) {
    for (const p of Array.from(this.store.keys())) {
      if (p === ref._path || p.startsWith(`${ref._path}/`)) this.store.delete(p)
    }
  }
}
const db = new RecursiveFakeFirestore()

const deletedFiles: string[] = []
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
  adminStorage: {
    bucket: () => ({
      name: 'tikem-bkt',
      file: (p: string) => ({
        delete: async () => {
          deletedFiles.push(p)
        },
      }),
    }),
  },
}))

let orgHeader: string | null = null
jest.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === 'x-tikem-org' ? orgHeader : null) }),
  cookies: async () => ({ get: () => undefined }),
}))

let currentUser: any = null
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => currentUser }))

const logAdminAction = jest.fn(async (..._a: any[]) => undefined)
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: (...a: any[]) => logAdminAction(...a) }))

import { GET, POST } from '@/app/api/events/[id]/delete-draft/route'

const call = (id: string) => POST({} as any, { params: Promise.resolve({ id }) })
const check = (id: string) => GET({} as any, { params: Promise.resolve({ id }) })

const poster = (name: string) =>
  `https://firebasestorage.googleapis.com/v0/b/tikem-bkt/o/${encodeURIComponent(`event-images/${name}`)}?alt=media&token=t`

const DRAFT = { organizer_id: 'org1', status: 'draft', is_published: false, tickets_sold: 0, title: 'My draft' }

function seed(extra: Record<string, any> = {}) {
  db.store.clear()
  const base: Record<string, any> = {
    'events/d1': { ...DRAFT, banner_image_url: poster('d1.jpg') },
    'events/d1/private/code': { hash: 'x' },
    'events/d1/updates/u1': { body: 'hi' },
    'events/d1/inventory_shards/0': { b: {} },
    'ticket_tiers/d1-t0': { event_id: 'd1', sold_quantity: 0 },
    'ticket_tiers/d1-t1': { event_id: 'd1', sold_quantity: 0 },
    'promo_codes/p1': { event_id: 'd1', code: 'EARLY' },
    'event_promoters/pr1': { event_id: 'd1', code: 'DJ' },
    'tracking_links/tl1': { event_id: 'd1' },
    'group_discounts/g1': { event_id: 'd1' },
    'event_updates/eu1': { event_id: 'd1' },
    'event_favorites/f1': { event_id: 'd1', user_id: 'u9' },
    'inventory_reservations/r-old': { event_id: 'd1', state: 'released' },
    'event_view_stats/d1': { total: 3 },
    'event_view_stats/d1/days/2026-11-25': { count: 3 },
    // Someone else's things that must survive.
    'events/other': { organizer_id: 'org2', status: 'draft', is_published: false },
    'ticket_tiers/other-t0': { event_id: 'other', sold_quantity: 0 },
    'promo_codes/p-other': { event_id: 'other' },
    'events/live': { organizer_id: 'org1', status: 'published', is_published: true, tickets_sold: 0 },
    // Team of org1.
    'organizers/org1/team/mgr': { uid: 'mgr', role: 'manager', status: 'active' },
    'organizers/org1/team/door': { uid: 'door', role: 'staff', status: 'active' },
    'organizers/org1/team/sell': { uid: 'sell', role: 'seller', status: 'active' },
    'organizers/org1/team/gone': { uid: 'gone', role: 'admin', status: 'removed' },
    ...extra,
  }
  for (const [p, d] of Object.entries(base)) if (d !== undefined) db.store.set(p, d)
}

const owner = { id: 'org1', email: 'o@x.com', role: 'organizer' }

describe('draftDeleteBlock (pure)', () => {
  const draft = { status: 'draft', is_published: false, tickets_sold: 0 }
  it('allows a draft (or pending, or legacy statusless unpublished) with nothing on it', () => {
    expect(draftDeleteBlock(draft)).toBeNull()
    expect(draftDeleteBlock({ ...draft, status: 'pending' })).toBeNull()
    expect(draftDeleteBlock({ is_published: false })).toBeNull()
  })
  it('refuses published, cancelled, frozen, sold and add-on-sold events', () => {
    expect(draftDeleteBlock({ ...draft, is_published: true })).toBe('published')
    expect(draftDeleteBlock({ ...draft, status: 'published' })).toBe('published')
    expect(draftDeleteBlock({ ...draft, status: 'cancelled' })).toBe('cancelled')
    expect(draftDeleteBlock({ ...draft, cancelled_at: '2027-01-01' })).toBe('cancelled')
    expect(draftDeleteBlock({ ...draft, payouts_frozen: true })).toBe('frozen')
    expect(draftDeleteBlock({ ...draft, tickets_sold: 2 })).toBe('has_tickets')
    expect(draftDeleteBlock({ ...draft, add_ons_sold: { a1: 0, a2: 1 } })).toBe('has_add_ons')
    expect(draftDeleteBlock(null)).toBe('not_found')
  })
  it('refuses on every outside signal', () => {
    expect(draftDeleteBlock(draft, { tickets: 1 })).toBe('has_tickets')
    expect(draftDeleteBlock(draft, { soldOnTiers: 1 })).toBe('has_tickets')
    expect(draftDeleteBlock(draft, { printedBatches: 1 })).toBe('has_printed')
    expect(draftDeleteBlock(draft, { doorTeamRequests: 1 })).toBe('has_door_team')
    expect(draftDeleteBlock(draft, { orders: 1 })).toBe('has_orders')
    expect(draftDeleteBlock(draft, { holds: 1 })).toBe('has_holds')
    expect(draftDeleteBlock(draft, { moneyRows: 1 })).toBe('has_money')
    expect(draftDeleteBlock(draft, { guests: 1 })).toBe('has_guests')
  })
  it('has a message for every code', () => {
    for (const code of Object.keys(DRAFT_DELETE_MESSAGES)) expect(DRAFT_DELETE_MESSAGES[code as keyof typeof DRAFT_DELETE_MESSAGES]).toBeTruthy()
  })
  it('the app copy agrees', () => {
    const cases: Array<[any, any]> = [
      [draft, {}],
      [{ ...draft, is_published: true }, {}],
      [{ ...draft, status: 'cancelled' }, {}],
      [{ ...draft, payouts_frozen: true }, {}],
      [{ ...draft, add_ons_sold: { a: 1 } }, {}],
      [draft, { orders: 3 }],
      [draft, { printedBatches: 1 }],
      [draft, { doorTeamRequests: 1 }],
      [draft, { holds: 1 }],
      [draft, { moneyRows: 1 }],
      [draft, { guests: 1 }],
      [{ is_published: false }, {}],
      [null, {}],
    ]
    for (const [e, o] of cases) expect(mobile.draftDeleteBlock(e, o)).toBe(draftDeleteBlock(e, o))
    expect(mobile.isDraftEvent(draft)).toBe(isDraftEvent(draft))
    expect(mobile.DRAFT_DELETE_MESSAGES).toEqual(DRAFT_DELETE_MESSAGES)
  })
})

describe('POST /api/events/[id]/delete-draft', () => {
  beforeEach(() => {
    seed()
    currentUser = owner
    orgHeader = null
    deletedFiles.length = 0
    logAdminAction.mockClear()
  })

  it('deletes a draft with everything it owns, its poster, and logs it', async () => {
    const res = await call('d1')
    expect(res.status).toBe(200)
    const left = Array.from(db.store.keys()).filter((p) => p.includes('d1') || p === 'promo_codes/p1' || p === 'event_promoters/pr1' || p === 'tracking_links/tl1' || p === 'group_discounts/g1' || p === 'event_updates/eu1' || p === 'event_favorites/f1' || p === 'inventory_reservations/r-old')
    expect(left).toEqual([])
    // Others' things stay.
    expect(db.store.get('events/other')).toBeDefined()
    expect(db.store.get('ticket_tiers/other-t0')).toBeDefined()
    expect(db.store.get('promo_codes/p-other')).toBeDefined()
    expect(deletedFiles).toEqual(['event-images/d1.jpg'])
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.draft_delete', adminId: 'org1', resourceId: 'd1', resourceType: 'event' }),
    )
  })

  it('keeps a poster another event uses, and never touches generated / library posters', async () => {
    seed({ 'events/copy': { organizer_id: 'org1', is_published: true, banner_image_url: poster('d1.jpg') } })
    expect((await call('d1')).status).toBe(200)
    expect(deletedFiles).toEqual([])

    seed({ 'events/d1': { ...DRAFT, banner_image_url: 'https://firebasestorage.googleapis.com/v0/b/tikem-bkt/o/posters%2Forg1%2Fh.jpg?alt=media' } })
    expect((await call('d1')).status).toBe(200)
    seed({ 'events/d1': { ...DRAFT, banner_image_url: '/flyers/kanaval.jpg' } })
    expect((await call('d1')).status).toBe(200)
    expect(deletedFiles).toEqual([])
  })

  const refusals: Array<[string, Record<string, any>, string]> = [
    ['a paid ticket', { 'tickets/t1': { event_id: 'd1', status: 'valid', price_paid: 500 } }, 'has_tickets'],
    ['a free ticket', { 'tickets/t1': { event_id: 'd1', status: 'valid', price_paid: 0 } }, 'has_tickets'],
    ['a comp ticket', { 'tickets/t1': { event_id: 'd1', status: 'valid', is_comp: true } }, 'has_tickets'],
    ['a guest checkout ticket', { 'tickets/t1': { event_id: 'd1', is_guest: true, guest_email: 'g@x.com' } }, 'has_tickets'],
    ['a refunded ticket (it still happened)', { 'tickets/t1': { event_id: 'd1', status: 'refunded' } }, 'has_tickets'],
    ['a legacy eventId ticket', { 'tickets/t1': { eventId: 'd1', status: 'valid' } }, 'has_tickets'],
    ['a tier sold counter', { 'ticket_tiers/d1-t0': { event_id: 'd1', sold_quantity: 2 } }, 'has_tickets'],
    ['the event sold counter', { 'events/d1': { ...DRAFT, tickets_sold: 1 } }, 'has_tickets'],
    ['an add-on sale', { 'events/d1': { ...DRAFT, add_ons_sold: { meal: 1 } } }, 'has_add_ons'],
    ['a guest-list entry', { 'events/d1/guests/g1': { name: 'Ana' } }, 'has_guests'],
    ['an attend request', { 'attend_requests/d1_u2': { event_id: 'd1', user_id: 'u2', status: 'pending' } }, 'has_guests'],
    ['a waitlist entry', { 'event_waitlist/w1': { event_id: 'd1', user_id: 'u2', status: 'waiting' } }, 'has_guests'],
    ['a printed batch', { 'physical_batches/b1': { event_id: 'd1', status: 'requested' } }, 'has_printed'],
    ['a door-team request', { 'door_team_requests/dt1': { event_id: 'd1', status: 'requested' } }, 'has_door_team'],
    ['a pending MonCash order', { 'pending_transactions/m1': { event_id: 'd1', status: 'pending', payment_method: 'moncash' } }, 'has_orders'],
    ['a pending SogePay order', { 'pending_transactions/s1': { event_id: 'd1', status: 'processing', payment_method: 'sogepay' } }, 'has_orders'],
    ['a sold reservation (Stripe order)', { 'inventory_reservations/r1': { event_id: 'd1', state: 'sold' } }, 'has_orders'],
    ['a live seat hold', { 'inventory_reservations/r1': { event_id: 'd1', state: 'held', hold_expires_at: Date.now() + 60_000 } }, 'has_holds'],
    ['an earnings row', { 'event_earnings/e1': { eventId: 'd1', grossSales: 0 } }, 'has_money'],
    ['an earnings doc keyed by the event', { 'event_earnings/d1': { grossSales: 0 } }, 'has_money'],
    ['a payout release', { 'payout_releases/pr1': { eventId: 'd1' } }, 'has_money'],
    ['a withdrawal', { 'withdrawal_requests/w1': { eventId: 'd1' } }, 'has_money'],
    ['a promoter commission', { 'promoter_sales/ps1': { event_id: 'd1' } }, 'has_money'],
    ['a published event', { 'events/d1': { ...DRAFT, is_published: true, status: 'published' } }, 'published'],
    ['a cancelled event', { 'events/d1': { ...DRAFT, status: 'cancelled' } }, 'cancelled'],
    ['a frozen event', { 'events/d1': { ...DRAFT, payouts_frozen: true } }, 'frozen'],
  ]

  it.each(refusals)('refuses a draft with %s, and deletes nothing', async (_label, extra, code) => {
    seed(extra)
    const before = new Map(db.store)
    const res = await call('d1')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe(code)
    expect(new Map(db.store)).toEqual(before)
    expect(deletedFiles).toEqual([])
    expect(logAdminAction).not.toHaveBeenCalled()
    // The check (what the app and web show) agrees.
    const c = await (await check('d1')).json()
    expect(c).toEqual(expect.objectContaining({ deletable: false, code }))
  })

  it('ignores dead orders and expired holds', async () => {
    seed({
      'pending_transactions/m1': { event_id: 'd1', status: 'failed' },
      'inventory_reservations/r1': { event_id: 'd1', state: 'held', hold_expires_at: Date.now() - 1000 },
      'inventory_reservations/r2': { event_id: 'd1', state: 'expired' },
    })
    expect((await (await check('d1')).json()).deletable).toBe(true)
    expect((await call('d1')).status).toBe(200)
  })

  it('scopes by the event’s own org and the team role, never the acting org', async () => {
    currentUser = { id: 'mgr', email: 'm@x.com' }
    expect((await (await check('d1')).json()).deletable).toBe(true)

    for (const uid of ['door', 'sell', 'gone', 'stranger']) {
      seed()
      currentUser = { id: uid, email: `${uid}@x.com` }
      orgHeader = 'org1' // claiming org1 changes nothing
      expect((await call('d1')).status).toBe(403)
      expect(db.store.get('events/d1')).toBeDefined()
    }
    // Org1's owner acting with another org selected still owns org1's draft.
    seed()
    currentUser = owner
    orgHeader = 'org2'
    expect((await call('d1')).status).toBe(200)
    // ...and cannot delete org2's draft.
    expect((await call('other')).status).toBe(403)
    expect(db.store.get('events/other')).toBeDefined()

    currentUser = null
    expect((await call('other')).status).toBe(401)
    currentUser = owner
    expect((await call('nope')).status).toBe(404)
  })

  it('manager deletes: the actor is logged, not the org', async () => {
    currentUser = { id: 'mgr', email: 'm@x.com' }
    expect((await call('d1')).status).toBe(200)
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'mgr', details: expect.objectContaining({ organizerId: 'org1', actorRole: 'manager' }) }),
    )
  })
})

describe('firestore.rules', () => {
  it('no client may delete an event', () => {
    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    const events = rules.slice(rules.indexOf('match /events/{eventId}'), rules.indexOf('match /members/{memberId}'))
    expect(events).toMatch(/allow delete: if false;/)
    expect(events).not.toMatch(/allow delete: if isSignedIn/)
  })

  it('the app no longer deletes events or tiers from the client for a draft', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobile/lib/api/events.ts'), 'utf8')
    expect(src).not.toMatch(/deleteDoc\(doc\(db, 'events'/)
    expect(src).toMatch(/delete-draft/)
  })
})
