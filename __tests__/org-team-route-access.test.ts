/**
 * Organization teams on the server routes (docs/specs/org-teams.md): a team
 * manager runs the org's events, never its money; a stranger gets 403; a
 * platform admin keeps the event override; an org admin edits the org brand.
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

const createNotification = jest.fn(async () => undefined)
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: (...a: any[]) => (createNotification as any)(...a) }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: async () => undefined }))

import { POST as eventUpdatePOST } from '@/app/api/organizer/event-update/route'
import { GET as payoutHistoryGET } from '@/app/api/organizer/payout-history/route'
import { POST as withdrawMoncashPOST } from '@/app/api/organizer/withdraw-moncash/route'
import { PUT as orgSettingsPUT } from '@/app/api/organizer/settings/organization/route'
import { requireEventAccess, requireOrg } from '@/lib/organizer/context'

const OWNER = { id: 'owner1', role: 'organizer', full_name: 'Kompa Nights' }
const MANAGER = { id: 'mgr1', role: 'attendee', full_name: 'Jean Manager' }
const ADMIN_MEMBER = { id: 'adm1', role: 'attendee', full_name: 'Ann Admin' }
const STRANGER = { id: 'nobody', role: 'organizer', full_name: 'Eve' }
const PLATFORM_ADMIN = { id: 'staff1', role: 'admin', full_name: 'Tikem Staff' }

function seed() {
  store.clear()
  store.set('events/ev1', { title: 'Kompa Night', organizer_id: 'owner1' })
  store.set('organizers/owner1/team/mgr1', { uid: 'mgr1', role: 'manager', status: 'active' })
  store.set('users/mgr1/org_memberships/owner1', { org_id: 'owner1', role: 'manager', org_name: 'Kompa Nights' })
  store.set('organizers/owner1/team/adm1', { uid: 'adm1', role: 'admin', status: 'active' })
  store.set('users/adm1/org_memberships/owner1', { org_id: 'owner1', role: 'admin', org_name: 'Kompa Nights' })
  store.set('tickets/t1', { event_id: 'ev1', status: 'valid', attendee_id: 'buyer1' })
}

function eventUpdateReq() {
  return new NextRequest('https://www.tikem.co/api/organizer/event-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventId: 'ev1', title: 'Doors at 8', message: 'See you there' }),
  })
}

beforeEach(() => {
  seed()
  orgHeader = null
  currentUser = null
  createNotification.mockClear()
})

describe('per-event routes', () => {
  it('a manager of the org can update (send an update for) its event', async () => {
    currentUser = MANAGER
    const res = await eventUpdatePOST(eventUpdateReq())
    expect(res.status).toBe(200)
    const update = Array.from(store.entries()).find(([k]) => k.startsWith('event_updates/'))![1]
    // The actor stays the member who did it.
    expect(update.created_by).toBe('mgr1')
    expect(createNotification).toHaveBeenCalledWith('buyer1', 'event_updated', expect.any(String), 'Doors at 8', '/events/ev1', { eventId: 'ev1' })
  })

  it('the owner path is unchanged', async () => {
    currentUser = OWNER
    expect((await eventUpdatePOST(eventUpdateReq())).status).toBe(200)
  })

  it('a non-member gets 403', async () => {
    currentUser = STRANGER
    const res = await eventUpdatePOST(eventUpdateReq())
    expect(res.status).toBe(403)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('an org staff member gets 403 (door access is per event only)', async () => {
    store.set('organizers/owner1/team/st1', { uid: 'st1', role: 'staff', status: 'active' })
    currentUser = { id: 'st1', role: 'attendee' }
    expect((await eventUpdatePOST(eventUpdateReq())).status).toBe(403)
  })

  it('requireEventAccess honours platform admins, and refuses strangers', async () => {
    currentUser = PLATFORM_ADMIN
    const ok = await requireEventAccess('ev1', 'manage_events')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.orgId).toBe('owner1')

    currentUser = STRANGER
    const denied = await requireEventAccess('ev1', 'view')
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.response.status).toBe(403)
  })
})

describe('money stays with the owner', () => {
  it('a manager acting for the org cannot reach payouts (403)', async () => {
    currentUser = MANAGER
    orgHeader = 'owner1'
    const res = await payoutHistoryGET()
    expect(res.status).toBe(403)
    // Payout history is read-only finances now (requireFinanceView): managers never.
    expect((await res.json()).code).toBe('no_finance')
  })

  it('a manager acting for the org cannot withdraw (403, before any money logic)', async () => {
    currentUser = MANAGER
    orgHeader = 'owner1'
    const req = new NextRequest('https://www.tikem.co/api/organizer/withdraw-moncash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'ev1', amount: 1000 }),
    })
    const res = await withdrawMoncashPOST(req)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('owner_only')
  })

  it("an org admin cannot either: requireOrg('owner_only') refuses every team role", async () => {
    currentUser = ADMIN_MEMBER
    orgHeader = 'owner1'
    const gate = await requireOrg('owner_only')
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.response.status).toBe(403)
  })
})

describe('org profile settings', () => {
  const bucket = 'tikem-test.appspot.com'
  const prevBucket = process.env.FIREBASE_STORAGE_BUCKET
  beforeAll(() => {
    process.env.FIREBASE_STORAGE_BUCKET = bucket
  })
  afterAll(() => {
    process.env.FIREBASE_STORAGE_BUCKET = prevBucket
  })

  function orgReq(body: any) {
    return new NextRequest('https://www.tikem.co/api/organizer/settings/organization', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-tikem-org': 'owner1' },
      body: JSON.stringify(body),
    })
  }

  it('an org admin renames the ACTING org and sets its logo (public projection included)', async () => {
    currentUser = ADMIN_MEMBER
    orgHeader = 'owner1'
    const logo = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/organization-logos%2Fowner1%2F1.png?alt=media`
    const res = await orgSettingsPUT(orgReq({ organization_name: 'Kompa Nights HT', organization_logo: logo }))
    expect(res.status).toBe(200)
    expect(store.get('public_profiles/owner1')).toMatchObject({ organization_name: 'Kompa Nights HT', organization_logo: logo })
    expect(store.get('users/owner1')).toMatchObject({ organization_name: 'Kompa Nights HT', organization_logo: logo })
    expect(store.get('organizers/owner1')).toMatchObject({ organization_name: 'Kompa Nights HT' })
    // Nothing landed on the admin's own account.
    expect(store.get('public_profiles/adm1')).toBeUndefined()
  })

  it('a logo-only body keeps the name and other fields', async () => {
    currentUser = OWNER
    store.set('organizers/owner1', { organization_name: 'Kompa Nights', website: 'https://kompa.ht/' })
    const logo = `https://storage.googleapis.com/${bucket}/organization-logos/owner1/2.png`
    const res = await orgSettingsPUT(orgReq({ organization_logo: logo }))
    expect(res.status).toBe(200)
    expect(store.get('organizers/owner1')).toMatchObject({ organization_name: 'Kompa Nights', website: 'https://kompa.ht/', organization_logo: logo })
  })

  it('rejects a logo that is not https in our bucket', async () => {
    currentUser = OWNER
    for (const bad of ['http://storage.googleapis.com/' + bucket + '/x.png', 'https://evil.example/x.png', 'https://storage.googleapis.com/other-bucket/x.png']) {
      const res = await orgSettingsPUT(orgReq({ organization_name: 'X', organization_logo: bad }))
      expect(res.status).toBe(400)
    }
  })

  it('a manager may not edit the org profile (403)', async () => {
    currentUser = MANAGER
    orgHeader = 'owner1'
    const res = await orgSettingsPUT(orgReq({ organization_name: 'Hijack' }))
    expect(res.status).toBe(403)
    expect(store.get('public_profiles/owner1')).toBeUndefined()
  })
})
