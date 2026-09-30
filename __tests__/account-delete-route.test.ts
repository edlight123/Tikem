/**
 * POST /api/account/delete — runs the REAL route and the REAL
 * lib/account/deletion over an in-memory Firestore (paths, subcollections,
 * equality queries, merge writes, recursiveDelete, collectionGroup) and a fake
 * Firebase Auth whose tokens carry an `auth_time`.
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Fake Firestore — documents keyed by full path ("users/u1/fcmTokens/t1").
// ---------------------------------------------------------------------------
let store: Record<string, any> = {}

const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
function merge(base: any, patch: any) {
  const out: any = { ...(base || {}) }
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v
  return out
}
const parentOf = (docPath: string) => docPath.slice(0, docPath.lastIndexOf('/'))
const idOf = (docPath: string) => docPath.slice(docPath.lastIndexOf('/') + 1)
const docsIn = (collPath: string) =>
  Object.keys(store).filter((p) => parentOf(p) === collPath)

function snap(path: string) {
  const data = store[path]
  return { id: idOf(path), exists: data !== undefined, ref: docRef(path), data: () => (data === undefined ? undefined : structuredClone(data)) }
}
function docRef(path: string): any {
  return {
    __doc: true,
    id: idOf(path),
    path,
    collection: (name: string) => collRef(`${path}/${name}`),
    get: async () => snap(path),
    set: async (data: any, opts?: any) => {
      store[path] = opts?.merge ? merge(store[path], data) : structuredClone(data)
    },
    update: async (patch: any) => {
      if (store[path] === undefined) throw new Error(`NOT_FOUND ${path}`)
      store[path] = { ...store[path], ...patch }
    },
    delete: async () => {
      delete store[path]
    },
  }
}
function queryOver(paths: () => string[], filters: Array<[string, any]> = []): any {
  return {
    where: (f: string, _op: string, v: any) => queryOver(paths, [...filters, [f, v]]),
    limit: () => queryOver(paths, filters),
    get: async () => {
      const docs = paths()
        .filter((p) => filters.every(([f, v]) => store[p]?.[f] === v))
        .map(snap)
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  }
}
function collRef(path: string): any {
  let n = 0
  return {
    __coll: true,
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto_${++n}`}`),
    ...queryOver(() => docsIn(path)),
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => collRef(name),
    collectionGroup: (name: string) =>
      queryOver(() => Object.keys(store).filter((p) => parentOf(p).split('/').pop() === name && parentOf(p).includes('/'))),
    recursiveDelete: async (ref: any) => {
      const prefix = ref.path
      for (const p of Object.keys(store)) {
        if (ref.__doc ? p === prefix || p.startsWith(`${prefix}/`) : p.startsWith(`${prefix}/`)) delete store[p]
      }
    },
  },
  adminAuth: {
    verifyIdToken: (token: string, checkRevoked: boolean) => fakeVerify(token, checkRevoked),
    verifySessionCookie: (token: string, checkRevoked: boolean) => fakeVerify(token, checkRevoked),
    revokeRefreshTokens: async (uid: string) => {
      if (!authUsers.has(uid)) throw Object.assign(new Error('gone'), { code: 'auth/user-not-found' })
      revoked.add(uid)
    },
    deleteUser: async (uid: string) => {
      if (!authUsers.has(uid)) throw Object.assign(new Error('gone'), { code: 'auth/user-not-found' })
      authUsers.delete(uid)
    },
  },
  adminStorage: {
    bucket: () => ({
      getFiles: async ({ prefix }: { prefix: string }) => [storageFiles.filter((f) => f.startsWith(prefix))],
      deleteFiles: async ({ prefix }: { prefix: string }) => {
        storageFiles = storageFiles.filter((f) => !f.startsWith(prefix))
      },
    }),
  },
}))

// ---------------------------------------------------------------------------
// Fake Auth — token string "tok:<uid>:<authTimeSec>".
// ---------------------------------------------------------------------------
let authUsers = new Set<string>()
let revoked = new Set<string>()
let storageFiles: string[] = []

async function fakeVerify(token: string, checkRevoked: boolean) {
  const [, uid, authTime] = String(token).split(':')
  if (!uid) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
  if (checkRevoked && !authUsers.has(uid)) throw Object.assign(new Error('gone'), { code: 'auth/user-not-found' })
  return { uid, email: `${uid}@example.com`, auth_time: Number(authTime) }
}

import { POST } from '@/app/api/account/delete/route'

const nowSec = () => Math.floor(Date.now() / 1000)
const DAY = 24 * 60 * 60 * 1000
const future = () => new Date(Date.now() + 7 * DAY).toISOString()
const past = () => new Date(Date.now() - 30 * DAY).toISOString()

function req(token: string | null, { cookie }: { cookie?: string } = {}) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (cookie) headers.cookie = `session=${cookie}`
  return new Request('https://www.tikem.co/api/account/delete', { method: 'POST', headers })
}

function seedBuyer(uid = 'u1') {
  authUsers.add(uid)
  store[`users/${uid}`] = { email: `${uid}@example.com`, full_name: 'Ana Buyer', phone_number: '+50937000000' }
  store[`users/${uid}/fcmTokens/tokA`] = { token: 'tokA' }
  store[`users/${uid}/notifications/n1`] = { title: 'hi' }
  store[`public_profiles/${uid}`] = { full_name: 'Ana Buyer' }
  store['events/e_other'] = { organizer_id: 'org9', title: 'Konpa Night', start_datetime: future() }
  store['tickets/t1'] = {
    event_id: 'e_other', attendee_id: uid, user_id: uid, status: 'confirmed',
    attendee_name: 'Ana Buyer', attendee_email: `${uid}@example.com`, price_paid: 1500,
  }
  store['tickets/t_guest'] = { event_id: 'e_other', status: 'valid', guest_email: `${uid}@example.com`, guest_phone: '+509' }
  store['pending_transactions/p1'] = { user_id: uid, amount: 1500, status: 'completed', guest_name: 'Ana' }
  store['favorites/f1'] = { user_id: uid, event_id: 'e_other' }
  store['organizer_follows/fo1'] = { follower_id: uid, organizer_id: 'org9' }
  store['pushSubscriptions/ps1'] = { userId: uid, endpoint: 'x' }
  store['events/e_other/members/' + uid] = { uid, email: `${uid}@example.com`, role: 'scanner' }
  storageFiles = [`profile-images/${uid}/avatar.jpg`, 'profile-images/someone-else/a.jpg']
}

beforeEach(() => {
  store = {}
  authUsers = new Set()
  revoked = new Set()
  storageFiles = []
})

describe('POST /api/account/delete', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await POST(req(null))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
  })

  it('requires a recent sign-in', async () => {
    seedBuyer()
    const stale = nowSec() - 11 * 60
    const res = await POST(req(`tok:u1:${stale}`))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('reauth_required')
    expect(authUsers.has('u1')).toBe(true)
    expect(store['users/u1']).toBeDefined()
  })

  it('prefers a fresh Bearer token over an old session cookie', async () => {
    seedBuyer()
    const res = await POST(req(`tok:u1:${nowSec()}`, { cookie: `tok:u1:${nowSec() - 3 * DAY / 1000}` }))
    expect(res.status).toBe(200)
  })

  it('deletes the auth user and personal data, anonymizes tickets and orders', async () => {
    seedBuyer()
    const res = await POST(req(`tok:u1:${nowSec()}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)

    // Auth
    expect(authUsers.has('u1')).toBe(false)
    expect(revoked.has('u1')).toBe(true)

    // Deleted
    expect(store['users/u1']).toBeUndefined()
    expect(store['users/u1/fcmTokens/tokA']).toBeUndefined()
    expect(store['users/u1/notifications/n1']).toBeUndefined()
    expect(store['public_profiles/u1']).toBeUndefined()
    expect(store['favorites/f1']).toBeUndefined()
    expect(store['organizer_follows/fo1']).toBeUndefined()
    expect(store['pushSubscriptions/ps1']).toBeUndefined()
    expect(store['events/e_other/members/u1']).toBeUndefined()
    expect(storageFiles).toEqual(['profile-images/someone-else/a.jpg'])

    // Anonymized, not deleted
    expect(store['tickets/t1']).toMatchObject({
      event_id: 'e_other', status: 'confirmed', price_paid: 1500,
      attendee_name: 'Deleted user', attendee_email: null, account_deleted: true,
    })
    expect(store['tickets/t_guest']).toMatchObject({ guest_email: null, guest_phone: null, status: 'valid' })
    expect(store['pending_transactions/p1']).toMatchObject({ amount: 1500, guest_name: null, account_deleted: true })

    // Other people's data untouched
    expect(store['events/e_other']).toMatchObject({ title: 'Konpa Night' })

    // Audit: counts only, no PII
    const audit = store['account_deletions/u1']
    expect(audit.status).toBe('completed')
    expect(audit.counts.tickets_anonymized).toBe(2)
    expect(JSON.stringify(audit)).not.toMatch(/example\.com|Ana/)
  })

  it('is idempotent: a second call with the same token succeeds without redoing work', async () => {
    seedBuyer()
    const token = `tok:u1:${nowSec()}`
    expect((await POST(req(token))).status).toBe(200)
    const res = await POST(req(token))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ deleted: true, alreadyDeleted: true })
  })

  it('a token for an unknown user with no deletion record stays unauthorized', async () => {
    const res = await POST(req(`tok:ghost:${nowSec()}`))
    expect(res.status).toBe(401)
  })

  describe('organizer safeguards', () => {
    function seedOrganizer() {
      authUsers.add('org1')
      store['users/org1'] = { email: 'org1@example.com', role: 'organizer' }
      store['organizers/org1'] = { organization_name: 'Lakay Events', phone: '+509' }
      store['organizers/org1/payoutProfiles/haiti'] = { moncash_encrypted: 'xxx', bankDetails_encrypted: 'yyy' }
      store['organizers/org1/payouts/po1'] = { amount: 100, status: 'completed' }
    }

    it('refuses while an upcoming event has sold tickets, and changes nothing', async () => {
      seedOrganizer()
      store['events/ev1'] = { organizer_id: 'org1', title: 'Rara Fest', is_published: true, start_datetime: future() }
      store['tickets/tk1'] = { event_id: 'ev1', status: 'valid', attendee_id: 'buyerX' }

      const res = await POST(req(`tok:org1:${nowSec()}`))
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('organizer_has_active_obligations')
      expect(body.obligations).toEqual([
        { type: 'upcoming_events_with_sales', events: [{ id: 'ev1', title: 'Rara Fest', ticketsSold: 1 }] },
      ])
      expect(authUsers.has('org1')).toBe(true)
      expect(store['users/org1']).toBeDefined()
      expect(store['organizers/org1/payoutProfiles/haiti']).toBeDefined()
      expect(store['account_deletions/org1']).toBeUndefined()
    })

    it('refuses with an unwithdrawn balance and an in-flight withdrawal', async () => {
      seedOrganizer()
      store['events/ev_past'] = { organizer_id: 'org1', title: 'Old', start_datetime: past(), end_datetime: past() }
      store['event_earnings/ev_past'] = {
        eventId: 'ev_past', organizerId: 'org1', currency: 'HTG',
        netAmount: 250000, withdrawnAmount: 50000, availableToWithdraw: 200000, settlementStatus: 'ready',
      }
      store['withdrawal_requests/w1'] = { organizerId: 'org1', status: 'processing', amount: 50000 }

      const res = await POST(req(`tok:org1:${nowSec()}`))
      expect(res.status).toBe(409)
      const { obligations } = await res.json()
      expect(obligations).toEqual(
        expect.arrayContaining([
          { type: 'unwithdrawn_balance', balances: [{ currency: 'HTG', amountMinor: 200000 }] },
          { type: 'withdrawals_in_flight', count: 1 },
        ])
      )
    })

    it('refuses while a promoter wallet holds commission', async () => {
      authUsers.add('pr1')
      store['event_promoters/ep1'] = { claimed_by_uid: 'pr1', event_id: 'e', code: 'JEAN' }
      store['promoter_sales/s1'] = { promoter_id: 'ep1', funded: true, status: 'accrued', commission_cents: 30000, currency: 'HTG' }
      store['promoter_wallets/pr1'] = { withdrawn_by_currency: { HTG: 10000 } }

      const res = await POST(req(`tok:pr1:${nowSec()}`))
      expect(res.status).toBe(409)
      expect((await res.json()).obligations).toEqual([
        { type: 'promoter_wallet_balance', balances: [{ currency: 'HTG', amountMinor: 20000 }] },
      ])
    })

    it('deletes a settled organizer: payout details gone, history kept, unsold upcoming events closed', async () => {
      seedOrganizer()
      store['events/ev_past'] = { organizer_id: 'org1', title: 'Old', start_datetime: past(), end_datetime: past(), is_published: true }
      store['events/ev_draft'] = { organizer_id: 'org1', title: 'Soon', start_datetime: future(), is_published: true }
      store['event_earnings/ev_past'] = {
        eventId: 'ev_past', organizerId: 'org1', currency: 'HTG',
        netAmount: 100000, withdrawnAmount: 100000, availableToWithdraw: 0, settlementStatus: 'ready',
      }
      store['withdrawal_requests/w1'] = {
        organizerId: 'org1', status: 'completed', amount: 100000, moncashNumber: '50937123456',
        bankDetails: { accountNumber: '001234567890', bankName: 'Unibank', accountHolder: 'Jean Org' },
      }

      const res = await POST(req(`tok:org1:${nowSec()}`))
      expect(res.status).toBe(200)

      expect(store['organizers/org1/payoutProfiles/haiti']).toBeUndefined()
      expect(store['organizers/org1/payouts/po1']).toBeDefined()
      expect(store['organizers/org1']).toEqual(expect.objectContaining({ account_deleted: true }))
      expect(store['organizers/org1'].organization_name).toBeUndefined()
      expect(store['events/ev_past']).toMatchObject({ title: 'Old', is_published: true })
      expect(store['events/ev_draft']).toMatchObject({ status: 'cancelled', is_published: false })
      expect(store['withdrawal_requests/w1']).toMatchObject({
        amount: 100000,
        moncashNumber: '••••3456',
        bankDetails: { bankName: 'Unibank', accountNumber: '••••7890', accountHolder: null },
      })
      expect(store['event_earnings/ev_past']).toBeDefined()
      expect(authUsers.has('org1')).toBe(false)
    })
  })
})
