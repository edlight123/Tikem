/**
 * POST /api/track/click — bot filter, per-IP throttle, per-browser cookie
 * dedupe, and promoter-ref clicks. Real route + real lib/tracking-links over a
 * mockFake Firestore.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'

const mockFake = createFakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)

const LINK = 'LinkAAAAAAAAAAAAAAAA'
const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

function req(body: any, opts: { ip?: string; ua?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': opts.ua ?? BROWSER_UA,
    'x-forwarded-for': opts.ip ?? '10.0.0.1',
  }
  if (opts.cookie) headers.cookie = opts.cookie
  return new Request('https://www.tikem.co/api/track/click', { method: 'POST', headers, body: JSON.stringify(body) })
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') || ''
  return raw
    .split(/,(?=\s*tk_clk_)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

let POST: (r: Request) => Promise<Response>

beforeEach(() => {
  mockFake.reset()
  mockFake.seed('tracking_links', LINK, { event_id: 'evt1', clicks: 0 })
  mockFake.seed('event_promoters', 'p1', { event_id: 'evt1', code: 'STEEVE', is_active: true, clicks: 0 })
  mockFake.seed('event_promoters', 'p2', { event_id: 'evt1', code: 'PAUSED', is_active: false, clicks: 0 })
  // Fresh module per test so the in-memory IP limiter starts empty.
  jest.isolateModules(() => {
    POST = require('@/app/api/track/click/route').POST
  })
})

const clicks = () => mockFake.get('tracking_links', LINK)!.clicks

it('counts a real click, never blocks (204), and sets a 30-minute dedupe cookie', async () => {
  const res = await POST(req({ eventId: 'evt1', t: LINK }))
  expect(res.status).toBe(204)
  expect(clicks()).toBe(1)
  const setCookie = res.headers.get('set-cookie') || ''
  expect(setCookie).toContain(`tk_clk_t_${LINK}=1`)
  expect(setCookie).toContain('Max-Age=1800')
  expect(setCookie).toContain('HttpOnly')
})

it('dedupes the same browser via the cookie it was given', async () => {
  const first = await POST(req({ eventId: 'evt1', t: LINK }))
  const cookie = cookieFrom(first)
  await POST(req({ eventId: 'evt1', t: LINK }, { cookie }))
  await POST(req({ eventId: 'evt1', t: LINK }, { cookie }))
  expect(clicks()).toBe(1)
  // A different browser (no cookie) still counts.
  await POST(req({ eventId: 'evt1', t: LINK }, { ip: '10.0.0.2' }))
  expect(clicks()).toBe(2)
})

it('ignores link unfurlers and crawlers', async () => {
  const res = await POST(req({ eventId: 'evt1', t: LINK }, { ua: 'WhatsApp/2.23.20.0 A' }))
  expect(res.status).toBe(204)
  expect(res.headers.get('x-tikem-click')).toBe('bot')
  await POST(req({ eventId: 'evt1', t: LINK }, { ua: 'facebookexternalhit/1.1' }))
  expect(clicks()).toBe(0)
})

it('throttles one IP after 60 beacons a minute', async () => {
  for (let i = 0; i < 60; i++) await POST(req({ eventId: 'evt1', t: LINK }))
  expect(clicks()).toBe(60)
  const res = await POST(req({ eventId: 'evt1', t: LINK }))
  expect(res.status).toBe(204)
  expect(res.headers.get('x-tikem-click')).toBe('throttled')
  expect(clicks()).toBe(60)
  // Another address is unaffected.
  await POST(req({ eventId: 'evt1', t: LINK }, { ip: '10.9.9.9' }))
  expect(clicks()).toBe(61)
})

it('counts promoter-link clicks for active promoters only', async () => {
  await POST(req({ eventId: 'evt1', ref: 'steeve' }))
  await POST(req({ eventId: 'evt1', ref: 'PAUSED' }))
  await POST(req({ eventId: 'evt1', ref: 'NOBODY' }))
  expect(mockFake.get('event_promoters', 'p1')!.clicks).toBe(1)
  expect(mockFake.get('event_promoters', 'p2')!.clicks).toBe(0)
})

it('answers 204 to junk without touching anything', async () => {
  for (const body of [{}, { eventId: 'evt1' }, { eventId: 'evt1', t: '../x' }, { eventId: 'bad id!', t: LINK }]) {
    const res = await POST(req(body))
    expect(res.status).toBe(204)
  }
  expect(clicks()).toBe(0)
})
