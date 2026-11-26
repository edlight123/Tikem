/**
 * Attendee communications, end to end with email and push mocked:
 *   - the organizer message fan-out (lib/events/attendee-broadcast.ts) reaches
 *     guests by email and account holders by push, in their language, honours
 *     the "Messages from organizers" switch and carries List-Unsubscribe;
 *   - the event-change notice (lib/events/change-notices.ts) reaches everyone
 *     once, regardless of opt-outs, with old → new;
 *   - the message route refuses a past event, a phishing message and a 4th
 *     message of the day.
 *
 * @jest-environment node
 */
type Doc = Record<string, any>
const store = new Map<string, Doc>()
const added: Array<{ path: string; data: Doc }> = []

jest.mock('@/lib/firebase/admin', () => {
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    get: async () => ({ exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path) }),
    set: async (d: Doc, o?: any) => void store.set(path, o?.merge ? { ...(store.get(path) || {}), ...d } : d),
    update: async (d: Doc) => void store.set(path, { ...(store.get(path) || {}), ...d }),
    collection: (c: string) => col(`${path}/${c}`),
  })
  const col = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    add: async (d: Doc) => {
      added.push({ path, data: d })
      const id = `auto${added.length}`
      store.set(`${path}/${id}`, d)
      return { id, update: async (u: Doc) => void store.set(`${path}/${id}`, { ...d, ...u }) }
    },
  })
  return { adminDb: { collection: (c: string) => col(c) } }
})

const sendEmail = jest.fn(async (_a: any) => ({ success: true }))
jest.mock('@/lib/email', () => {
  const actual = jest.requireActual('@/lib/email')
  return { ...actual, sendEmail: (a: any) => sendEmail(a) }
})
const sendPushNotification = jest.fn(async (..._a: any[]) => undefined)
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: (...a: any[]) => sendPushNotification(...a) }))

let rows: any[] = []
jest.mock('@/lib/organizer/eventOrdersLoader', () => ({ loadEventTicketRows: async () => rows }))

let limited = false
jest.mock('@/lib/rate-limit', () => ({ consumeRateLimit: async () => ({ limited }) }))
jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ user: { id: 'org1' }, error: null }) }))
jest.mock('@/lib/organizer/context', () => ({ canOnEvent: async () => ({ allowed: true }) }))

import { NextRequest } from 'next/server'
import { broadcastToAttendees } from '@/lib/events/attendee-broadcast'
import { POST } from '@/app/api/organizer/event-update/route'

const row = (o: Partial<any>) => ({
  status: 'valid',
  isGuest: false,
  buyerKey: '',
  pricePaid: 0,
  buyer: { name: '', email: '', city: '' },
  ...o,
})

const EVENT = {
  id: 'ev1',
  title: 'Kompa Night',
  is_published: true,
  start_datetime: '2099-05-01T23:00:00.000Z',
  venue_name: 'Ritz',
  city: 'Montréal',
  timezone: 'America/Toronto',
}

beforeEach(() => {
  store.clear()
  added.length = 0
  sendEmail.mockClear()
  sendPushNotification.mockClear()
  limited = false
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'a-test-secret-that-is-long-enough-for-hmac-use'
  store.set('users/u_fr', { language: 'fr', email: 'fr@x.co' })
  store.set('users/u_off', { language: 'en', notify_organizer_messages: false })
  store.set('events/ev1', EVENT)
  rows = [
    row({ buyerKey: 'u_fr', buyer: { name: 'A', email: 'fr@x.co', city: '' }, pricePaid: 20 }),
    row({ buyerKey: 'u_fr', buyer: { name: 'A', email: 'fr@x.co', city: '' } }), // second ticket, same person
    row({ isGuest: true, buyer: { name: 'G', email: 'guest@x.co', city: '' } }),
    row({ buyerKey: 'u_off', buyer: { name: 'O', email: 'off@x.co', city: '' } }),
    row({ buyerKey: 'u_gone', status: 'refunded', buyer: { name: 'R', email: 'gone@x.co', city: '' } }),
  ]
})

describe('organizer message fan-out', () => {
  it('reaches every live holder once and honours the organizer-messages switch', async () => {
    const out = await broadcastToAttendees({ event: EVENT, senderId: 'org1', title: 'Doors at 8', message: 'See you there.' })
    expect(out.recipients).toBe(3)
    expect(out.optedOut).toBe(1)
    const to = sendEmail.mock.calls.map((c) => c[0].to).sort()
    expect(to).toEqual(['fr@x.co', 'guest@x.co'])
    expect(sendPushNotification.mock.calls.map((c) => c[0])).toEqual(['u_fr'])
    // Language: the French holder's email is French.
    const fr = sendEmail.mock.calls.find((c) => c[0].to === 'fr@x.co')![0]
    expect(fr.subject).toBe("Message de l'organisateur : Kompa Night")
    expect(fr.html).toContain('lang="fr"')
    expect(added.some((a) => a.path === 'users/u_off/notifications')).toBe(true)
  })
})

// Change notices (lib/events/change-notices) run from a debounced cron with a
// stored baseline; their decisions are covered in event-change-detect.test.ts.

describe('POST /api/organizer/event-update', () => {
  const req = (body: any) =>
    new NextRequest('https://tikem.test/api/organizer/event-update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('sends a message and records it', async () => {
    const res = await POST(req({ eventId: 'ev1', message: 'Doors at 8pm.' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notified).toBe(3)
    expect(added.some((a) => a.path === 'event_updates' && a.data.message === 'Doors at 8pm.')).toBe(true)
  })

  it('accepts the web sheet’s older body shape', async () => {
    expect((await POST(req({ eventId: 'ev1', updateMessage: 'Hello' }))).status).toBe(200)
  })

  it('refuses a phishing message without sending anything', async () => {
    const res = await POST(req({ eventId: 'ev1', message: 'Verify your account at https://evil.example now' }))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('phishing')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses an unpublished or cancelled event', async () => {
    store.set('events/ev1', { ...EVENT, status: 'cancelled' })
    const res = await POST(req({ eventId: 'ev1', message: 'Hi' }))
    expect(res.status).toBe(409)
  })

  it('refuses past the daily limit', async () => {
    limited = true
    const res = await POST(req({ eventId: 'ev1', message: 'Hi again' }))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('update_limit')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
