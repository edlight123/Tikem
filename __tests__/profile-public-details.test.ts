/**
 * @jest-environment node
 *
 * GET /api/profiles/{uid}/public-details: the one rule web and app share for
 * what a profile shows (lib/profile/public-details.ts).
 *  - an org shows its OWN settings details (organizers/{uid}), public;
 *  - a person's bio + socials only for: public profile, a friend, themselves;
 *  - never email / phone / WhatsApp, for either kind.
 */

type Doc = Record<string, any>

const mockStore = new Map<string, Doc>()

function mockSnap(path: string) {
  const data = mockStore.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data ? { ...data } : undefined) }
}
function mockRef(path: string): any {
  return { id: path.split('/').pop(), _path: path, get: async () => mockSnap(path) }
}
function mockQuery(name: string, filters: Array<[string, any]>, max?: number): any {
  return {
    where: (f: string, _op: string, v: any) => mockQuery(name, [...filters, [f, v]], max),
    limit: (n: number) => mockQuery(name, filters, n),
    get: async () => {
      let docs = Array.from(mockStore.keys())
        .filter((p) => p.startsWith(`${name}/`) && p.split('/').length === 2)
        .filter((p) => filters.every(([f, v]) => mockStore.get(p)![f] === v))
        .map((p) => mockSnap(p))
      if (max !== undefined) docs = docs.slice(0, max)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({ ...mockQuery(name, []), doc: (id: string) => mockRef(`${name}/${id}`) }),
    getAll: async (...refs: any[]) => refs.map((r) => mockSnap(r._path)),
  },
}))

let mockViewer: { id: string } | null = null
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => mockViewer }))

const mockRateLimit = jest.fn(async (_opts: any) => ({ limited: false }))
jest.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: (opts: any) => mockRateLimit(opts),
  clientIp: () => '203.0.113.9',
}))

import { GET } from '@/app/api/profiles/[uid]/public-details/route'
import { socialHref } from '@/lib/profile/public-details'

const put = (path: string, data: Doc) => mockStore.set(path, data)
const PII = {
  email: 'secret@example.com',
  phone_number: '+50937001122',
  phone: '+50937001122',
  whatsapp: '+50937001122',
  contact_number: '+50937001122',
}

async function call(uid: string, viewer: string | null) {
  mockViewer = viewer ? { id: viewer } : null
  const res = await GET(new Request(`http://localhost/api/profiles/${uid}/public-details`) as any, {
    params: Promise.resolve({ uid }),
  })
  const body = await res.json()
  return { status: res.status, body, raw: JSON.stringify(body) }
}

function expectNoPII(raw: string) {
  expect(raw).not.toContain('secret@example.com')
  expect(raw).not.toContain('50937001122')
  expect(raw).not.toMatch(/"(email|phone|phone_number|whatsapp|contact_number|privacy)"/)
}

beforeEach(() => {
  mockStore.clear()
  mockRateLimit.mockClear()
  // A private person, with a bio and socials.
  put('users/pat', {
    full_name: 'Pat',
    role: 'attendee',
    bio: 'Konpa every weekend',
    social_links: { instagram: 'pat.ig', tiktok: '@pattok', twitter: '', facebook: 'pat.fb' },
    privacy: { profile_visibility: 'private' },
    ...PII,
  })
  put('public_profiles/pat', { full_name: 'Pat' })
  // An org: details entered in organizer settings.
  put('users/org1', { full_name: 'Owner', role: 'organizer', bio: 'personal bio', social_links: { instagram: 'owner.me' }, ...PII })
  put('public_profiles/org1', { organization_name: 'Lakay Events', tiktok: 'lakaytok', description: 'legacy desc' })
  put('organizers/org1', {
    organization_name: 'Lakay Events',
    organization_description: 'Kompa nights in Pétion-Ville',
    website: 'https://lakay.example.com',
    social_media: { instagram: '@lakay', facebook: 'https://facebook.com/lakay', twitter: 'lakayx', linkedin: 'lakay-co' },
  })
})

describe('org profiles', () => {
  it('returns the org settings details, as safe hrefs, to anyone', async () => {
    const { status, body, raw } = await call('org1', null)
    expect(status).toBe(200)
    expect(body.kind).toBe('org')
    expect(body.org).toEqual({
      description: 'Kompa nights in Pétion-Ville',
      website: 'https://lakay.example.com/',
      instagram: 'https://instagram.com/lakay',
      facebook: 'https://facebook.com/lakay',
      twitter: 'https://twitter.com/lakayx',
      linkedin: 'https://www.linkedin.com/in/lakay-co',
      // Not in organizers/{uid}: filled from the legacy projection field.
      tiktok: 'https://tiktok.com/@lakaytok',
    })
    // The organizer's personal bio/socials are not the org page's.
    expect(raw).not.toContain('personal bio')
    expect(raw).not.toContain('owner.me')
    expect(body.person).toBeUndefined()
    expectNoPII(raw)
  })

  it('treats someone who has hosted a published event as an org', async () => {
    put('events/e1', { organizer_id: 'pat', is_published: true })
    const { body } = await call('pat', null)
    expect(body.kind).toBe('org')
    expect(body.person).toBeUndefined()
  })

  it('a draft event alone does not make an org', async () => {
    put('events/e1', { organizer_id: 'pat', is_published: false })
    expect((await call('pat', null)).body.kind).toBe('person')
  })
})

describe('person profiles', () => {
  it('a private person is hidden from a stranger and from signed-out viewers', async () => {
    put('users/stranger', { full_name: 'S' })
    for (const viewer of ['stranger', null]) {
      const { status, body, raw } = await call('pat', viewer)
      expect(status).toBe(200)
      expect(body).toEqual({ kind: 'person', person: null })
      expect(raw).not.toContain('Konpa')
      expectNoPII(raw)
    }
  })

  it('a pending request is not friendship', async () => {
    put('connections/friend__pat', { users: ['friend', 'pat'], status: 'pending', requester_id: 'friend', recipient_id: 'pat' })
    expect((await call('pat', 'friend')).body.person).toBeNull()
  })

  it('an accepted friend sees bio + socials, and nothing else', async () => {
    put('connections/friend__pat', { users: ['friend', 'pat'], status: 'accepted', requester_id: 'friend', recipient_id: 'pat' })
    const { body, raw } = await call('pat', 'friend')
    expect(body).toEqual({
      kind: 'person',
      person: {
        bio: 'Konpa every weekend',
        socials: {
          instagram: 'https://instagram.com/pat.ig',
          tiktok: 'https://tiktok.com/@pattok',
          twitter: '',
          facebook: 'https://facebook.com/pat.fb',
        },
      },
    })
    expectNoPII(raw)
  })

  it('the person sees their own details', async () => {
    const { body, raw } = await call('pat', 'pat')
    expect(body.person.bio).toBe('Konpa every weekend')
    expectNoPII(raw)
  })

  it('a public person is visible to anyone', async () => {
    put('users/pat', { ...mockStore.get('users/pat'), privacy: { profile_visibility: 'public' } })
    const { body, raw } = await call('pat', null)
    expect(body.person.bio).toBe('Konpa every weekend')
    expectNoPII(raw)
  })
})

describe('route', () => {
  it('404s an unknown or malformed uid', async () => {
    expect((await call('nobody', null)).status).toBe(404)
    expect((await call('../etc', null)).status).toBe(404)
  })

  it('rate-limits per viewer, or per IP when signed out', async () => {
    await call('pat', 'friend')
    expect(mockRateLimit.mock.calls[0][0].key).toBe('public-details:uid:friend')
    await call('pat', null)
    expect(mockRateLimit.mock.calls[1][0].key).toBe('public-details:ip:203.0.113.9')
    mockRateLimit.mockResolvedValueOnce({ limited: true })
    expect((await call('pat', null)).status).toBe(429)
  })
})

describe('socialHref', () => {
  it('refuses non-http links', () => {
    expect(socialHref('instagram', 'javascript:alert(1)')).toBe('')
    expect(socialHref('facebook', 'data:text/html,hi')).toBe('')
    expect(socialHref('twitter', '')).toBe('')
  })
})
