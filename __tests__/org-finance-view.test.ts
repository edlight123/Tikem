/**
 * Read-only finances for org admins (docs/specs/org-teams.md): the owner can
 * grant an ADMIN "can see finances (read only)". That admin sees the org's
 * payout history (scoped to the org, not themselves) and still never reaches
 * withdrawals or payout destinations. Managers never see finances. Only the
 * owner can set finance_view.
 *
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// In-memory Firestore: enough for doc get/set, subcollections, simple queries
// and batches.
// ---------------------------------------------------------------------------
const store = new Map<string, any>()

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: store.has(path),
      id: path.split('/').pop(),
      data: () => store.get(path),
    }),
    set: async (data: any, opts?: any) => {
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data)
    },
    update: async (data: any) => {
      store.set(path, { ...(store.get(path) || {}), ...data })
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => colRef(`${path}/${name}`),
  }
}

function colRef(path: string, filters: [string, any][] = []): any {
  const matches = () =>
    Array.from(store.entries())
      .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
      .filter(([, v]) => filters.every(([f, val]) => (Array.isArray(val) ? val.includes(v?.[f]) : v?.[f] === val)))
  return {
    doc: (id?: string) => docRef(`${path}/${id || `auto${store.size}`}`),
    add: async (data: any) => {
      const ref = docRef(`${path}/auto${store.size}`)
      await ref.set(data)
      return ref
    },
    where: (f: string, _op: string, v: any) => colRef(path, [...filters, [f, v]]),
    orderBy: () => colRef(path, filters),
    limit: () => colRef(path, filters),
    get: async () => {
      const docs = matches().map(([k, v]) => ({ id: k.split('/').pop(), exists: true, data: () => v, ref: docRef(k) }))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => colRef(name),
    doc: (path: string) => docRef(path),
    batch: () => {
      const ops: (() => Promise<void>)[] = []
      return {
        set: (ref: any, data: any, opts?: any) => ops.push(() => ref.set(data, opts)),
        delete: (ref: any) => ops.push(() => ref.delete()),
        update: (ref: any, data: any) => ops.push(() => ref.update(data)),
        commit: async () => {
          for (const op of ops) await op()
        },
      }
    },
  },
  adminAuth: {},
  adminStorage: { bucket: () => ({ name: 'tikem-test.appspot.com' }) },
}))

// The acting org arrives as the X-Tikem-Org header (mobile).
let orgHeader: string | null = null
jest.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === 'x-tikem-org' ? orgHeader : null) }),
  cookies: async () => ({ get: () => undefined }),
}))

let currentUser: any = null
jest.mock('@/lib/auth', () => ({
  getCurrentUser: async () => currentUser,
  requireAuth: async () => (currentUser ? { user: currentUser, error: null } : { user: null, error: 'Not authenticated' }),
}))

jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }))
jest.mock('@/lib/rate-limit', () => ({ clientIp: () => '127.0.0.1', consumeRateLimit: async () => ({ limited: false }) }))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => undefined) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => undefined) }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: async () => undefined }))

import { GET as payoutHistoryGET } from '@/app/api/organizer/payout-history/route'
import { POST as withdrawMoncashPOST } from '@/app/api/organizer/withdraw-moncash/route'
import { GET as bankDestinationsGET } from '@/app/api/organizer/payout-destinations/bank/route'
import { GET as eventEarningsGET } from '@/app/api/organizer/events/[id]/earnings/route'
import { POST as teamPOST, PATCH as teamPATCH } from '@/app/api/organizer/team/route'

const OWNER = { id: 'owner1', role: 'organizer', email: 'owner@kompa.ht', full_name: 'Kompa Nights' }
const FIN_ADMIN = { id: 'fin1', role: 'attendee', email: 'fin@kompa.ht', full_name: 'Fanfan Finance' }
const PLAIN_ADMIN = { id: 'adm1', role: 'attendee', email: 'adm@kompa.ht', full_name: 'Ann Admin' }
const MANAGER = { id: 'mgr1', role: 'attendee', email: 'mgr@kompa.ht', full_name: 'Jean Manager' }

function seat(uid: string, role: string, extra: Record<string, any> = {}) {
  store.set(`organizers/owner1/team/${uid}`, { uid, email: `${uid}@kompa.ht`, role, status: 'active', ...extra })
  store.set(`users/${uid}/org_memberships/owner1`, { org_id: 'owner1', role, org_name: 'Kompa Nights' })
}

beforeEach(() => {
  store.clear()
  orgHeader = null
  currentUser = null
  store.set('users/owner1', { email: 'owner@kompa.ht', role: 'organizer' })
  store.set('events/ev1', { title: 'Kompa Night', organizer_id: 'owner1' })
  seat('fin1', 'admin', { finance_view: true })
  seat('adm1', 'admin')
  seat('mgr1', 'manager')
  // The org's withdrawals, and one of the finance admin's OWN (must not leak in).
  store.set('withdrawal_requests/w1', { organizerId: 'owner1', amount: 500000, currency: 'HTG', status: 'completed', method: 'moncash', createdAt: '2026-10-01T00:00:00Z' })
  store.set('withdrawal_requests/w2', { organizerId: 'owner1', amount: 120000, currency: 'HTG', status: 'pending', method: 'bank', createdAt: '2026-10-10T00:00:00Z' })
  store.set('withdrawal_requests/w3', { organizerId: 'fin1', amount: 999, currency: 'USD', status: 'completed', method: 'bank', createdAt: '2026-10-11T00:00:00Z' })
})

function jsonReq(url: string, method: string, body: any) {
  return new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

describe('read-only finances', () => {
  it('a finance admin GETs the ORG\'s payout history, not their own', async () => {
    currentUser = FIN_ADMIN
    orgHeader = 'owner1'
    const res = await payoutHistoryGET()
    expect(res.status).toBe(200)
    const { payouts } = await res.json()
    expect(payouts.map((p: any) => p.id).sort()).toEqual(['w1', 'w2'])
    expect(payouts.every((p: any) => p.organizerId === 'owner1')).toBe(true)
  })

  it('the owner still gets their payout history', async () => {
    currentUser = OWNER
    const res = await payoutHistoryGET()
    expect(res.status).toBe(200)
    expect((await res.json()).payouts).toHaveLength(2)
  })

  it('a manager gets 403', async () => {
    currentUser = MANAGER
    orgHeader = 'owner1'
    const res = await payoutHistoryGET()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('no_finance')
  })

  it('an admin WITHOUT the grant gets 403', async () => {
    currentUser = PLAIN_ADMIN
    orgHeader = 'owner1'
    expect((await payoutHistoryGET()).status).toBe(403)
  })

  it('a manager cannot read an event\'s earnings (403)', async () => {
    currentUser = MANAGER
    const res = await eventEarningsGET(new Request('https://www.tikem.co/api/organizer/events/ev1/earnings'), {
      params: Promise.resolve({ id: 'ev1' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('a finance admin still never moves money', () => {
  it('withdraw-moncash: 403', async () => {
    currentUser = FIN_ADMIN
    orgHeader = 'owner1'
    const res = await withdrawMoncashPOST(
      jsonReq('https://www.tikem.co/api/organizer/withdraw-moncash', 'POST', { eventId: 'ev1', amount: 1000 }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('owner_only')
  })

  it('payout-destinations (bank details): 403', async () => {
    currentUser = FIN_ADMIN
    orgHeader = 'owner1'
    const res = await bankDestinationsGET(new NextRequest('https://www.tikem.co/api/organizer/payout-destinations/bank'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('owner_only')
  })
})

describe('only the owner sets finance_view', () => {
  const invite = (body: any) => teamPOST(jsonReq('https://www.tikem.co/api/organizer/team', 'POST', body))
  const patch = (body: any) => teamPATCH(jsonReq('https://www.tikem.co/api/organizer/team', 'PATCH', body))

  it('POST: an admin cannot invite with finance_view (403)', async () => {
    currentUser = PLAIN_ADMIN
    orgHeader = 'owner1'
    const res = await invite({ email: 'new@kompa.ht', role: 'admin', finance_view: true })
    expect(res.status).toBe(403)
    expect(Array.from(store.keys()).some((k) => k.startsWith('org_team_invites/'))).toBe(false)
  })

  it('POST: the owner invites an admin with finance_view', async () => {
    currentUser = OWNER
    const res = await invite({ email: 'new@kompa.ht', role: 'admin', finance_view: true })
    expect(res.status).toBe(200)
    expect((await res.json()).member.finance_view).toBe(true)
    const inv = Array.from(store.entries()).find(([k]) => k.startsWith('org_team_invites/'))![1]
    expect(inv).toMatchObject({ email: 'new@kompa.ht', role: 'admin', finance_view: true })
  })

  it('POST: not even the owner can give it to a manager (403)', async () => {
    currentUser = OWNER
    expect((await invite({ email: 'new@kompa.ht', role: 'manager', finance_view: true })).status).toBe(403)
  })

  it('PATCH: an admin cannot grant it (403) and nothing changes', async () => {
    currentUser = PLAIN_ADMIN
    orgHeader = 'owner1'
    const res = await patch({ memberId: 'adm1', role: 'admin', finance_view: true })
    expect(res.status).toBe(403)
    expect(store.get('organizers/owner1/team/adm1').finance_view).toBeUndefined()
  })

  it('PATCH: an admin cannot revoke it either (403)', async () => {
    currentUser = PLAIN_ADMIN
    orgHeader = 'owner1'
    expect((await patch({ memberId: 'fin1', role: 'admin', finance_view: false })).status).toBe(403)
    expect(store.get('organizers/owner1/team/fin1').finance_view).toBe(true)
  })

  it('PATCH: the owner grants and removes it', async () => {
    currentUser = OWNER
    expect((await patch({ memberId: 'adm1', role: 'admin', finance_view: true })).status).toBe(200)
    expect(store.get('organizers/owner1/team/adm1').finance_view).toBe(true)
    expect((await patch({ memberId: 'adm1', role: 'admin', finance_view: false })).status).toBe(200)
    expect(store.get('organizers/owner1/team/adm1').finance_view).toBe(false)
  })

  it('PATCH: an admin re-roling someone without finance_view keeps the grant as is', async () => {
    currentUser = PLAIN_ADMIN
    orgHeader = 'owner1'
    expect((await patch({ memberId: 'fin1', role: 'admin' })).status).toBe(200)
    expect(store.get('organizers/owner1/team/fin1').finance_view).toBe(true)
  })

  it('PATCH: demoting a finance admin to manager drops the grant', async () => {
    currentUser = OWNER
    expect((await patch({ memberId: 'fin1', role: 'manager' })).status).toBe(200)
    expect(store.get('organizers/owner1/team/fin1')).toMatchObject({ role: 'manager', finance_view: false })
  })
})
