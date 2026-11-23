/**
 * @jest-environment node
 *
 * POST /api/flyers/read: reads only our own uploads, budgets reads per user
 * (or per IP for the guest composer), and returns the parsed fields.
 */
const consumeRateLimit = jest.fn(async (_opts: any) => ({ limited: false }))
jest.mock('@/lib/rate-limit', () => ({
  clientIp: () => '203.0.113.9',
  consumeRateLimit: (opts: any) => consumeRateLimit(opts),
}))
const getCurrentUser = jest.fn(async (): Promise<any> => ({ id: 'org-1' }))
jest.mock('@/lib/auth', () => ({ getCurrentUser: () => getCurrentUser() }))
const fetchOwnPoster = jest.fn(async (_url: string): Promise<Buffer | null> => Buffer.from('img'))
jest.mock('@/lib/posters/hosts', () => ({
  isOwnPoster: (u: string) => typeof u === 'string' && u.startsWith('https://firebasestorage.googleapis.com/v0/b/bucket/'),
  fetchOwnPoster: (u: string) => fetchOwnPoster(u),
}))
const ocrFlyer = jest.fn(async (_buf: Buffer) => [
  { text: 'KONPA LAKAY', height: 120, confidence: 92 },
  { text: 'Samdi 12 Desanm 2026 a 9è', height: 40, confidence: 92 },
  { text: 'Prevant 1,500 HTG', height: 40, confidence: 90 },
])
jest.mock('@/lib/flyer/ocr-server', () => ({ ocrFlyer: (b: Buffer) => ocrFlyer(b) }))

import { POST } from '@/app/api/flyers/read/route'

const OURS = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/event-images%2Fa.jpg?alt=media'
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/flyers/read', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  jest.clearAllMocks()
  getCurrentUser.mockResolvedValue({ id: 'org-1' })
  consumeRateLimit.mockResolvedValue({ limited: false })
})

it('reads one of our flyers into composer fields', async () => {
  const res = await post({ url: OURS })
  expect(res.status).toBe(200)
  const { read } = await res.json()
  expect(read).toMatchObject({ title: 'Konpa Lakay', start_time: '21:00', price: 1500, currency: 'HTG' })
  expect(read.date).toMatch(/-12-12$/)
  expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'flyer-read:user:org-1', limit: 40 }))
})

it('refuses an image that is not ours, before any work', async () => {
  const res = await post({ url: 'https://evil.example.com/flyer.jpg' })
  expect(res.status).toBe(400)
  expect(consumeRateLimit).not.toHaveBeenCalled()
  expect(fetchOwnPoster).not.toHaveBeenCalled()
})

it('budgets the guest composer per IP, more tightly', async () => {
  getCurrentUser.mockResolvedValue(null)
  await post({ url: OURS })
  expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'flyer-read:ip:203.0.113.9', limit: 10 }))
})

it('answers 429 at the daily cap', async () => {
  consumeRateLimit.mockResolvedValue({ limited: true })
  const res = await post({ url: OURS })
  expect(res.status).toBe(429)
  expect(ocrFlyer).not.toHaveBeenCalled()
})

it('says so when the image cannot be fetched or read', async () => {
  fetchOwnPoster.mockRejectedValueOnce(new Error('not an image'))
  expect((await post({ url: OURS })).status).toBe(422)
  ocrFlyer.mockRejectedValueOnce(new Error('wasm'))
  expect((await post({ url: OURS })).status).toBe(500)
})
