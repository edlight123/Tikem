/**
 * POST /api/auth/session hardening and PUT /api/organizer/settings/organization
 * link validation.
 *
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const verifyIdToken = jest.fn()
const createSessionCookie = jest.fn(async () => 'cookie-value')
const cookieSet = jest.fn()
const orgSet = jest.fn(async () => undefined)
const batchSet = jest.fn()
let currentUser: any = null

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: (...a: any[]) => verifyIdToken(...a),
    createSessionCookie: (...a: any[]) => (createSessionCookie as any)(...a),
  },
  adminDb: {
    collection: (name: string) => ({
      doc: () => ({
        _col: name,
        set: (...a: any[]) => (orgSet as any)(...a),
        // Org-team lookups (lib/organizer/context.ts): no memberships here.
        collection: () => ({
          get: async () => ({ docs: [] }),
          doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
        }),
      }),
    }),
    batch: () => ({ set: (...a: any[]) => batchSet(...a), commit: async () => undefined }),
  },
}))
jest.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, delete: jest.fn(), get: jest.fn() }),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => currentUser }))
const rateLimited = { value: false }
const consumeRateLimit = jest.fn(async (_o: any) => ({ limited: rateLimited.value }))
jest.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: (o: any) => consumeRateLimit(o),
  clientIp: () => '203.0.113.9',
}))

import { POST as sessionPOST } from '@/app/api/auth/session/route'
import { PUT as orgPUT } from '@/app/api/organizer/settings/organization/route'

const now = () => Math.floor(Date.now() / 1000)

function sessionReq(body: any, headers: Record<string, string> = {}) {
  return new NextRequest('https://www.tikem.co/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/session', () => {
  beforeEach(() => {
    verifyIdToken.mockReset()
    createSessionCookie.mockClear()
    cookieSet.mockClear()
  })

  it('mints a cookie for a fresh sign-in with no Origin (mobile)', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 10 })
    const res = await sessionPOST(sessionReq({ idToken: 't' }))
    expect(res.status).toBe(200)
    expect(verifyIdToken).toHaveBeenCalledWith('t', true)
    expect(cookieSet).toHaveBeenCalled()
  })

  it('accepts the canonical origin', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 10 })
    const res = await sessionPOST(sessionReq({ idToken: 't' }, { origin: 'https://tikem.co' }))
    expect(res.status).toBe(200)
  })

  it('rejects a foreign Origin', async () => {
    const res = await sessionPOST(sessionReq({ idToken: 't' }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(createSessionCookie).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body', async () => {
    const req = new NextRequest('https://www.tikem.co/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'idToken=t',
    })
    const res = await sessionPOST(req)
    expect(res.status).toBe(415)
  })

  it('rejects a stale sign-in (auth_time older than 5 minutes)', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 3600 })
    const res = await sessionPOST(sessionReq({ idToken: 't' }))
    expect(res.status).toBe(401)
    expect(createSessionCookie).not.toHaveBeenCalled()
  })

  it('still refuses an older sign-in without the bridge flag', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400 * 3, exp: now() + 1800 })
    const res = await sessionPOST(sessionReq({ idToken: 't' }))
    expect(res.status).toBe(401)
    expect(createSessionCookie).not.toHaveBeenCalled()
  })

  it('a bridge with bridge: "true" (not the boolean) is refused', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400 * 3, exp: now() + 1800 })
    const res = await sessionPOST(sessionReq({ idToken: 't', bridge: 'true' }))
    expect(res.status).toBe(401)
  })

  it('bridges an older app sign-in into a session no longer than the ID token', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400 * 3, exp: now() + 1800 })
    const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect(res.status).toBe(200)
    const ms = (createSessionCookie.mock.calls[0] as any)[1].expiresIn
    expect(ms).toBeGreaterThan(1790 * 1000)
    expect(ms).toBeLessThanOrEqual(1800 * 1000)
    // The cookie's own max-age matches (seconds), never the 5-day session.
    const maxAge = (cookieSet.mock.calls[0] as any)[2].maxAge
    expect(maxAge).toBeLessThanOrEqual(1800)
  })

  it('a bridge never outlives an hour', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400, exp: now() + 7200 })
    await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect((createSessionCookie.mock.calls[0] as any)[1].expiresIn).toBe(3600 * 1000)
  })

  it('the bridged session lifetime never exceeds the token exp', async () => {
    for (const left of [301, 900, 1799, 3599]) {
      createSessionCookie.mockClear()
      const exp = now() + left
      verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400, exp })
      const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
      expect(res.status).toBe(200)
      const ms = (createSessionCookie.mock.calls[0] as any)[1].expiresIn
      expect(Date.now() + ms).toBeLessThanOrEqual(exp * 1000 + 1000)
    }
  })

  it('refuses a bridge with under a minute left (no floor stretches it)', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400, exp: now() + 30 })
    const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect(res.status).toBe(401)
    expect(createSessionCookie).not.toHaveBeenCalled()
  })

  it("refuses a bridge whose token ends before Firebase's 5-minute cookie minimum", async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400, exp: now() + 200 })
    const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect(res.status).toBe(401)
    expect(createSessionCookie).not.toHaveBeenCalled()
  })

  it('checks revocation on the bridge path (verifyIdToken with checkRevoked)', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400, exp: now() + 1800 })
    await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect(verifyIdToken).toHaveBeenCalledWith('t', true)
  })

  it('rate limits the bridge path per account and address (429, no cookie)', async () => {
    rateLimited.value = true
    try {
      verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400, exp: now() + 1800 })
      const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
      expect(res.status).toBe(429)
      expect(createSessionCookie).not.toHaveBeenCalled()
      expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'session-bridge:uid:u1' }))
    } finally {
      rateLimited.value = false
    }
  })

  it('a recent sign-in is never rate limited by the bridge limiter', async () => {
    rateLimited.value = true
    try {
      verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 10, exp: now() + 3600 })
      const res = await sessionPOST(sessionReq({ idToken: 't' }))
      expect(res.status).toBe(200)
    } finally {
      rateLimited.value = false
    }
  })

  it('a recent sign-in with the bridge flag still gets the normal 5-day session', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 10, exp: now() + 3600 })
    await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect((createSessionCookie.mock.calls[0] as any)[1].expiresIn).toBe(5 * 86400 * 1000)
  })

  it('a bridge from a foreign Origin is still refused', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: now() - 86400 * 3, exp: now() + 1800 })
    const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(createSessionCookie).not.toHaveBeenCalled()
  })

  it('a bridge with a revoked token is refused', async () => {
    verifyIdToken.mockRejectedValue(new Error('revoked'))
    const res = await sessionPOST(sessionReq({ idToken: 't', bridge: true }))
    expect(res.status).toBe(401)
  })

  it('rejects an invalid or revoked token', async () => {
    verifyIdToken.mockRejectedValue(new Error('revoked'))
    const res = await sessionPOST(sessionReq({ idToken: 't' }))
    expect(res.status).toBe(401)
  })
})

function orgReq(body: any) {
  return new NextRequest('https://www.tikem.co/api/organizer/settings/organization', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/organizer/settings/organization', () => {
  beforeEach(() => {
    orgSet.mockClear()
    currentUser = { id: 'org1', role: 'organizer' }
  })

  it('rejects a javascript: website', async () => {
    const res = await orgPUT(orgReq({ organization_name: 'X', website: 'javascript:alert(1)' }))
    expect(res.status).toBe(400)
    expect(orgSet).not.toHaveBeenCalled()
  })

  it('rejects a javascript: social link', async () => {
    const res = await orgPUT(orgReq({ organization_name: 'X', linkedin: 'javascript:alert(1)//x.com' }))
    expect(res.status).toBe(400)
  })

  it('stores the website and handles as https links', async () => {
    const res = await orgPUT(
      orgReq({ organization_name: 'X', website: 'example.com', instagram: '@john.doe', facebook: 'https://facebook.com/x' })
    )
    expect(res.status).toBe(200)
    const written = (orgSet.mock.calls[0] as any)[0]
    expect(written.website).toBe('https://example.com/')
    expect(written.social_media.instagram).toBe('https://www.instagram.com/john.doe')
    expect(written.social_media.facebook).toBe('https://facebook.com/x')
    // The name also lands in its canonical home, public_profiles (lib/profile/org-brand.ts).
    const canonical = batchSet.mock.calls.find((c: any[]) => c[0]._col === 'public_profiles')
    expect(canonical?.[1]).toEqual({ organization_name: 'X' })
  })

  it('refuses a non-organizer', async () => {
    currentUser = { id: 'u1', role: 'attendee' }
    const res = await orgPUT(orgReq({ organization_name: 'X' }))
    expect(res.status).toBe(403)
  })
})
