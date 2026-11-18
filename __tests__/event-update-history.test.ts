/**
 * GET /api/organizer/event-update?eventId= : the organizer's Messages page
 * history. Gated to manage_events; updates newest first; automatic messages
 * report sent from reminderClaims.
 *
 * @jest-environment node
 */
type Doc = Record<string, any>
const db: Record<string, Record<string, Doc>> = {}
let allowed = true

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: Boolean(db[col]?.[id]), data: () => db[col]?.[id] }),
      }),
      where: (f: string, _op: string, v: any) => ({
        limit: () => ({
          get: async () => ({
            docs: Object.entries(db[col] || {})
              .filter(([, d]) => d[f] === v)
              .map(([id, d]) => ({ id, data: () => d })),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn(async () => ({ user: { id: 'org1' }, error: null })) }))
jest.mock('@/lib/organizer/context', () => ({ canOnEvent: jest.fn(async () => ({ allowed })) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/organizer/event-update/route'

const req = (q: string) => new NextRequest(`http://localhost/api/organizer/event-update${q}`)

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  allowed = true
  db.events = { e1: { title: 'Show', start_datetime: '2099-01-02T20:00:00.000Z' } }
  db.event_updates = {
    a: { event_id: 'e1', title: 'Old', message: 'm', created_at: '2026-11-01T10:00:00.000Z', recipients: 5 },
    b: { event_id: 'e1', title: 'New', message: 'm', created_at: '2026-11-10T10:00:00.000Z' },
    c: { event_id: 'other', title: 'Not this event', message: 'm', created_at: '2026-11-11T10:00:00.000Z' },
  }
  db.reminderClaims = { e1__event_reminder_24h: { claimedAt: '2099-01-01T20:00:00.000Z' } }
})

it('lists this event’s updates newest first, with automatic message status', async () => {
  const res = await GET(req('?eventId=e1'))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.updates.map((u: any) => u.title)).toEqual(['New', 'Old'])
  expect(body.updates[1].recipients).toBe(5)
  const byType = Object.fromEntries(body.automatic.map((a: any) => [a.type, a]))
  expect(byType.event_reminder_24h.sentAt).toBeTruthy()
  expect(byType.event_reminder_24h.at).toBe('2099-01-01T20:00:00.000Z')
  expect(byType.event_reminder_3h.sentAt).toBeNull()
  expect(byType.post_event_followup.at).toBeNull()
})

it('refuses callers who cannot manage the event', async () => {
  allowed = false
  expect((await GET(req('?eventId=e1'))).status).toBe(403)
})

it('needs an eventId', async () => {
  expect((await GET(req(''))).status).toBe(400)
})
