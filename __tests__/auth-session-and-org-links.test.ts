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
let currentUser: any = null

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: (...a: any[]) => verifyIdToken(...a),
    createSessionCookie: (...a: any[]) => (createSessionCookie as any)(...a),
  },
  adminDb: {
    collection: () => ({ doc: () => ({ set: (...a: any[]) => (orgSet as any)(...a) }) }),
  },
}))
jest.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, delete: jest.fn(), get: jest.fn() }),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => currentUser }))

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

  it('stores a normalised website and plain handles', async () => {
    const res = await orgPUT(
      orgReq({ organization_name: 'X', website: 'example.com', instagram: '@john.doe', facebook: 'https://facebook.com/x' })
    )
    expect(res.status).toBe(200)
    const written = (orgSet.mock.calls[0] as any)[0]
    expect(written.website).toBe('https://example.com/')
    expect(written.social_media.instagram).toBe('@john.doe')
    expect(written.social_media.facebook).toBe('https://facebook.com/x')
  })

  it('refuses a non-organizer', async () => {
    currentUser = { id: 'u1', role: 'attendee' }
    const res = await orgPUT(orgReq({ organization_name: 'X' }))
    expect(res.status).toBe(403)
  })
})
