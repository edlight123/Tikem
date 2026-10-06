/**
 * @jest-environment node
 *
 * GET /api/connections/suggestions and GET /api/events/[id]/friends-going:
 * the order of checks (auth, rate limit, remote switch), the per-uid rate
 * limiter, and the Firestore layer end to end against a small in-memory store.
 * The privacy guarantee pinned here: friends-going never names anyone outside
 * the caller's accepted connections, and suggestions never return PII.
 */

type Doc = Record<string, any>

// ── A tiny in-memory Firestore: chained where (==, in, array-contains), limit, getAll ──
const mockStore = new Map<string, Doc>()

function mockSnap(path: string) {
  const data = mockStore.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data ? { ...data } : undefined) }
}
function mockRef(path: string): any {
  return {
    id: path.split('/').pop(),
    _path: path,
    get: async () => mockSnap(path),
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}
function mockQuery(name: string, filters: Array<[string, string, any]>, max?: number): any {
  const depth = name.split('/').length + 1
  return {
    where: (f: string, op: string, v: any) => mockQuery(name, [...filters, [f, op, v]], max),
    limit: (n: number) => mockQuery(name, filters, n),
    get: async () => {
      let docs = Array.from(mockStore.keys())
        .filter((p) => p.startsWith(`${name}/`) && p.split('/').length === depth)
        .filter((p) =>
          filters.every(([f, op, v]) => {
            const val = mockStore.get(p)![f]
            if (op === '==') return val === v
            if (op === 'in') return (v as any[]).includes(val)
            if (op === 'array-contains') return Array.isArray(val) && val.includes(v)
            throw new Error(`op ${op}`)
          })
        )
        .map((p) => mockSnap(p))
      if (max !== undefined) docs = docs.slice(0, max)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}
function mockCollection(name: string): any {
  return { ...mockQuery(name, []), doc: (id: string) => mockRef(`${name}/${id}`) }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => mockCollection(name),
    getAll: async (...refs: any[]) => refs.map((r) => mockSnap(r._path)),
  },
}))

import { handleFriendsGoing, handleSuggestions } from '@/lib/social/handlers'
import { getFriendSuggestions, getFriendsGoing } from '@/lib/social/suggestions-server'
import { socialFlagOn } from '@/lib/social/flags'

const put = (path: string, data: Doc) => mockStore.set(path, data)
const friends = (a: string, b: string, status = 'accepted') =>
  put(`connections/${[a, b].sort().join('__')}`, { users: [a, b].sort(), status, requester_id: a, recipient_id: b })
const user = (uid: string, extra: Doc = {}) =>
  put(`users/${uid}`, {
    full_name: `Name ${uid}`,
    email: `${uid}@example.com`,
    phone_number: '+50937000000',
    ...extra,
  })
const ticket = (id: string, eventId: string, holder: string, status = 'valid') =>
  put(`tickets/${id}`, { event_id: eventId, attendee_id: holder, status })

const NOW = Date.UTC(2026, 9, 5)
const soon = new Date(NOW + 5 * 86400000).toISOString()

beforeEach(() => mockStore.clear())

/** Per-key counter standing in for the Firestore-backed consumeRateLimit. */
function countingLimiter(limit: number) {
  const counts = new Map<string, number>()
  const fn = jest.fn(async (uid: string) => {
    const n = (counts.get(uid) || 0) + 1
    counts.set(uid, n)
    return { limited: n > limit }
  })
  return fn
}

describe('remote switch', () => {
  it('only a literal true turns a feature on', () => {
    expect(socialFlagOn({ friend_suggestions: true }, 'friend_suggestions')).toBe(true)
    expect(socialFlagOn({ friend_suggestions: 'true' }, 'friend_suggestions')).toBe(false)
    expect(socialFlagOn({ phone_link_prompt: true }, 'friend_suggestions')).toBe(false)
    expect(socialFlagOn(null, 'friend_suggestions')).toBe(false)
  })
})

describe('handlers', () => {
  const deps = (over: Partial<Parameters<typeof handleSuggestions>[0]> = {}) => ({
    getUserId: async () => 'u1',
    flagOn: async () => true,
    rateLimit: countingLimiter(3),
    load: jest.fn(async () => []),
    ...over,
  })

  it('401 when signed out, without loading anything', async () => {
    const d = deps({ getUserId: async () => null })
    const res = await handleSuggestions(d)
    expect(res.status).toBe(401)
    expect(d.load).not.toHaveBeenCalled()
  })

  it('flag off (or unreadable) answers enabled:false and reads nothing', async () => {
    for (const flagOn of [async () => false, async () => Promise.reject(new Error('x'))]) {
      const d = deps({ flagOn })
      const res = await handleSuggestions(d)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ enabled: false, suggestions: [] })
      expect(d.load).not.toHaveBeenCalled()
    }
  })

  it('429 after the per-user budget, with Retry-After, and keyed by the signed-in uid', async () => {
    const d = deps()
    for (let i = 0; i < 3; i++) expect((await handleSuggestions(d)).status).toBe(200)
    const res = await handleSuggestions(d)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect((await res.json()).error).toBe('rate_limited')
    expect(d.load).toHaveBeenCalledTimes(3)
    expect(d.rateLimit).toHaveBeenCalledWith('u1')
  })

  it('a limiter that cannot count refuses (fails closed)', async () => {
    const d = deps({ rateLimit: async () => Promise.reject(new Error('firestore down')) })
    expect((await handleSuggestions(d)).status).toBe(429)
    expect(d.load).not.toHaveBeenCalled()
  })

  it('with the switch off no rate-limit counter is spent', async () => {
    const d = deps({ flagOn: async () => false })
    expect((await handleSuggestions(d)).status).toBe(200)
    expect(d.rateLimit).not.toHaveBeenCalled()
  })

  it('signed out never reaches the switch or the counter', async () => {
    const flagOn = jest.fn(async () => true)
    const d = deps({ flagOn, getUserId: async () => null })
    expect((await handleSuggestions(d)).status).toBe(401)
    expect(flagOn).not.toHaveBeenCalled()
    expect(d.rateLimit).not.toHaveBeenCalled()
  })

  it('a failing load degrades to an empty list, never a 500', async () => {
    const res = await handleSuggestions(deps({ load: async () => Promise.reject(new Error('boom')) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true, suggestions: [] })
  })

  it('friends-going: same guards, and private no-store responses', async () => {
    const res401 = await handleFriendsGoing({
      getUserId: async () => null,
      flagOn: async () => true,
      rateLimit: async () => ({ limited: false }),
      load: async () => ({ count: 0, friends: [] }),
    })
    expect(res401.status).toBe(401)
    const off = await handleFriendsGoing({
      getUserId: async () => 'u1',
      flagOn: async () => false,
      rateLimit: async () => ({ limited: false }),
      load: async () => ({ count: 9, friends: [] }),
    })
    expect(await off.json()).toEqual({ enabled: false, count: 0, friends: [] })
    expect(off.headers.get('Cache-Control')).toContain('no-store')
  })
})

describe('getFriendsGoing (Firestore layer)', () => {
  beforeEach(() => {
    put('events/e1', { title: 'Fèt', start_datetime: soon })
    ;['me', 'f1', 'f2', 'f3', 'f4', 'stranger'].forEach((u) => user(u))
    user('f1', { privacy: { attendance_visibility: 'friends' } })
    user('f2', { privacy: { attendance_visibility: 'everyone' }, discoverable: false })
    user('f3', { privacy: { attendance_visibility: 'nobody' } })
    user('f4', { privacy: { attendance_visibility: 'everyone' } })
    user('stranger', { privacy: { attendance_visibility: 'everyone' } })
    friends('me', 'f1')
    friends('me', 'f2')
    friends('me', 'f3')
    friends('me', 'f4', 'pending') // a pending request is not a connection
    ;['f1', 'f2', 'f3', 'f4', 'stranger'].forEach((u, i) => ticket(`t${i}`, 'e1', u))
  })

  it('names only accepted connections who allow it', async () => {
    const r = await getFriendsGoing('me', 'e1')
    expect(r.count).toBe(1)
    expect(r.friends.map((f) => f.uid)).toEqual(['f1'])
    expect(JSON.stringify(r)).not.toContain('stranger')
    expect(JSON.stringify(r)).not.toContain('@example.com')
    expect(JSON.stringify(r)).not.toContain('+509')
  })

  it('a friend who blocked the viewer disappears', async () => {
    put('users/f1/blocked_organizers/me', { organizer_id: 'me' })
    expect((await getFriendsGoing('me', 'e1')).count).toBe(0)
  })

  it('a refunded ticket does not count', async () => {
    ticket('t0', 'e1', 'f1', 'refunded')
    expect((await getFriendsGoing('me', 'e1')).count).toBe(0)
  })

  it('an organizer who hid the guest list hides friends too', async () => {
    put('events/e1', { title: 'Fèt', start_datetime: soon, guestlist_visibility: 'hidden' })
    expect(await getFriendsGoing('me', 'e1')).toEqual({ count: 0, friends: [] })
  })

  it('unknown event: nothing', async () => {
    expect(await getFriendsGoing('me', 'nope')).toEqual({ count: 0, friends: [] })
  })
})

describe('getFriendSuggestions (Firestore layer)', () => {
  beforeEach(() => {
    ;['me', 'f1', 'f2', 'fof', 'fofHidden', 'pend', 'blk', 'co', 'coPrivate'].forEach((u) => user(u))
    user('fofHidden', { discoverable: false })
    user('co', { privacy: { attendance_visibility: 'everyone' } })
    put('public_profiles/fof', { full_name: 'Fof Public', photo_url: 'https://x/p.jpg', username: 'fof', is_verified: true })
    friends('me', 'f1')
    friends('me', 'f2')
    friends('me', 'pend', 'pending')
    // fof + fofHidden + blk + pend share two of my friends
    ;['fof', 'fofHidden', 'blk', 'pend'].forEach((u) => {
      friends('f1', u)
      friends('f2', u)
    })
    put('users/me/blocked_organizers/blk', { organizer_id: 'blk' })
    // co-attendance
    put('events/e1', { start_datetime: soon })
    put('events/old', { start_datetime: new Date(NOW - 200 * 86400000).toISOString() })
    ticket('m1', 'e1', 'me')
    ticket('m2', 'old', 'me')
    ticket('c1', 'e1', 'co')
    ticket('c2', 'e1', 'coPrivate')
    ticket('c3', 'old', 'oldGuy')
  })

  it('ranks, explains, and excludes connections, pending, blocked and non-discoverable', async () => {
    const list = await getFriendSuggestions('me', NOW)
    expect(list.map((s) => [s.uid, s.reason, s.mutualCount])).toEqual([
      ['fof', 'mutual_friends', 2],
      ['co', 'same_events', 0],
    ])
  })

  it('returns public fields only', async () => {
    const [first] = await getFriendSuggestions('me', NOW)
    expect(first).toEqual({
      uid: 'fof',
      displayName: 'Fof Public',
      photoURL: 'https://x/p.jpg',
      username: 'fof',
      isVerified: true,
      reason: 'mutual_friends',
      mutualCount: 2,
    })
    const json = JSON.stringify(await getFriendSuggestions('me', NOW))
    expect(json).not.toContain('@example.com')
    expect(json).not.toContain('+509')
    expect(json).not.toContain('e1')
  })

  it('a candidate who blocked the viewer is not suggested', async () => {
    put('users/fof/blocked_organizers/me', { organizer_id: 'me' })
    expect((await getFriendSuggestions('me', NOW)).map((s) => s.uid)).toEqual(['co'])
  })
})
