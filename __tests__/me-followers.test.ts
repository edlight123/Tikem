/**
 * GET /api/me/followers: the signed-in organizer's followers, newest first,
 * public fields only.
 *
 * @jest-environment node
 */
type Doc = Record<string, any>
const follows: Doc[] = []
let me: any = { id: 'org1', email: 'org@x.com' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where: (_f: string, _op: string, v: any) => ({
        limit: () => ({
          get: async () => ({ docs: follows.filter((d) => d.organizer_id === v).map((d) => ({ data: () => d })) }),
        }),
      }),
    }),
  },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => me) }))
jest.mock('@/lib/firestore/connections', () => ({
  getPublicUserSummaries: jest.fn(async (ids: string[]) => {
    const m = new Map()
    for (const id of ids) m.set(id, { uid: id, displayName: `Name ${id}`, photoURL: '', isVerified: false, email: 'leak@x.com' })
    return m
  }),
}))

import { GET } from '@/app/api/me/followers/route'

beforeEach(() => {
  follows.length = 0
  me = { id: 'org1', email: 'org@x.com' }
})

it('lists followers newest first, public fields only', async () => {
  follows.push(
    { organizer_id: 'org1', follower_id: 'a', created_at: '2026-11-01T00:00:00Z' },
    { organizer_id: 'org1', follower_id: 'b', created_at: '2026-11-10T00:00:00Z' },
    { organizer_id: 'other', follower_id: 'c', created_at: '2026-11-11T00:00:00Z' },
  )
  const res = await GET()
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.followers.map((f: any) => f.uid)).toEqual(['b', 'a'])
  expect(body.total).toBe(2)
  expect(JSON.stringify(body)).not.toMatch(/leak@x\.com/)
})

it('requires sign-in', async () => {
  me = null
  expect((await GET()).status).toBe(401)
})
