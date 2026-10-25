/**
 * The notification promises the website makes, proven at the seams (audit
 * findings #7, #8, #9, #10, #12). Everything runs against an in-memory
 * Firestore; no email, push or network call leaves the test.
 *
 * @jest-environment node
 */

type Doc = Record<string, any>
const mockStore = new Map<string, Map<string, Doc>>()
let mockAutoId = 0

function mockCol(name: string): Map<string, Doc> {
  if (!mockStore.has(name)) mockStore.set(name, new Map())
  return mockStore.get(name)!
}

/** Firestore-like comparison: values of different types never match a range. */
function mockCompare(a: any, b: any, op: string): boolean {
  const ta = a instanceof Date ? 'date' : typeof a
  const tb = b instanceof Date ? 'date' : typeof b
  if (ta !== tb) return false
  const av = ta === 'date' ? a.getTime() : a
  const bv = tb === 'date' ? b.getTime() : b
  if (op === '==') return av === bv
  if (op === '>=') return av >= bv
  if (op === '<=') return av <= bv
  throw new Error(`op ${op} not faked`)
}

function mockDocRef(name: string, id: string): any {
  return {
    id,
    get: async () => ({ exists: mockCol(name).has(id), id, data: () => mockCol(name).get(id), ref: mockDocRef(name, id) }),
    set: async (d: Doc, opts?: { merge?: boolean }) => {
      mockCol(name).set(id, opts?.merge ? { ...(mockCol(name).get(id) || {}), ...d } : { ...d })
    },
    update: async (d: Doc) => {
      if (!mockCol(name).has(id)) throw new Error('no doc')
      mockCol(name).set(id, { ...mockCol(name).get(id), ...d })
    },
    delete: async () => {
      mockCol(name).delete(id)
    },
    collection: (sub: string) => mockCollectionRef(`${name}/${id}/${sub}`),
  }
}

function mockQuery(name: string, filters: Array<[string, string, any]>, lim?: number): any {
  return {
    where: (f: string, op: string, v: any) => mockQuery(name, [...filters, [f, op, v]], lim),
    limit: (n: number) => mockQuery(name, filters, n),
    orderBy: () => mockQuery(name, filters, lim),
    get: async () => {
      const docs = [...mockCol(name)]
        .filter(([, d]) => filters.every(([f, op, v]) => mockCompare(d[f], v, op)))
        .slice(0, lim ?? Infinity)
        .map(([id, d]) => ({ id, exists: true, data: () => d, ref: mockDocRef(name, id) }))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

function mockCollectionRef(name: string): any {
  return {
    ...mockQuery(name, []),
    doc: (id: string) => mockDocRef(name, id),
    add: async (d: Doc) => {
      const id = `auto_${++mockAutoId}`
      mockCol(name).set(id, { ...d })
      return mockDocRef(name, id)
    },
  }
}

const mockDb = {
  collection: (name: string) => mockCollectionRef(name),
  runTransaction: async (fn: (tx: any) => any) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, d: Doc, o?: any) => ref.set(d, o),
      update: (ref: any, d: Doc) => ref.update(d),
    }),
}

jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockDb
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '<ts>',
    arrayUnion: (...v: any[]) => v,
    arrayRemove: (...v: any[]) => v,
    increment: (n: number) => n,
  },
}))

const mockExpoPush = jest.fn(async (..._args: any[]) => undefined)
jest.mock('@/lib/push/expo', () => ({
  sendExpoPushNotificationToUser: (...args: any[]) => mockExpoPush(...args),
}))

jest.mock('@/lib/firestore/public-profile', () => ({
  syncPublicProfileAdmin: jest.fn(async () => undefined),
}))

const mockGetCurrentUser = jest.fn()
jest.mock('@/lib/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}))

const mockSendEmail = jest.fn(async (..._args: any[]) => ({ success: true }))
jest.mock('@/lib/email', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  getWaitlistNotificationEmail: () => '<html>available</html>',
  emailSubjects: { waitlist: () => 'Tickets are available' },
}))

jest.mock('@/lib/email-kit/recipient', () => ({
  resolveEmailLang: async () => 'en',
}))

const mockSendDiscretionary = jest.fn(async (..._args: any[]) => true)
jest.mock('@/lib/notifications/campaigns', () => ({
  ...jest.requireActual('@/lib/notifications/campaigns'),
  sendDiscretionary: (...args: any[]) => mockSendDiscretionary(...args),
}))

import { sendPushNotification } from '@/lib/notification-triggers'
import { isCategoryEnabled } from '@/lib/notifications/policy'
import { readUserNotifyPrefs, sanitizeUserNotifyPrefs } from '@/lib/notifications/userPreferences'
import { updateUserProfileAdmin, getUserProfileAdmin } from '@/lib/firestore/user-profile-admin'
import { runFavoriteReminders, favoriteReminderCapKey } from '@/lib/notifications/favorite-reminders'
import { favoritedBy } from '@/lib/notifications/campaigns'
import { sanitizeOrganizerNotificationPreferences } from '@/lib/organizer/notificationPreferences'
import { notifyWaitlistForEvent, shouldNotifyEntry, RENOTIFY_GAP_MS } from '@/lib/waitlist'
import { POST as joinWaitlist } from '@/app/api/waitlist/join/route'

beforeEach(() => {
  mockStore.clear()
  mockExpoPush.mockClear()
  mockSendEmail.mockClear()
  mockSendDiscretionary.mockClear()
  mockGetCurrentUser.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('#7 sendPushNotification', () => {
  it('pushes to the mobile devices directly and never calls the admin-only HTTP route', async () => {
    const env = { ...process.env }
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.tikem.co'
    const fetchSpy = jest.fn()
    const realFetch = global.fetch
    ;(global as any).fetch = fetchSpy
    try {
      await sendPushNotification('u1', 'Title', 'Body', '/events/e1', { type: 'x' })
    } finally {
      ;(global as any).fetch = realFetch
      process.env = env
    }
    expect(mockExpoPush).toHaveBeenCalledWith('u1', 'Title', 'Body', '/events/e1', { type: 'x' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('#8 profile notification switches', () => {
  it('writes the top-level notify_* fields the send policy reads', async () => {
    mockCol('users').set('u1', { email: 'a@b.co' })
    await updateUserProfileAdmin('u1', {
      notifyPrefs: {
        notify_reminders: false,
        notify_event_updates: true,
        notify_discovery: false,
        notify_filling_fast: false,
        notify_national_day: true,
      },
    })
    const doc = mockCol('users').get('u1')!
    expect(doc.notify_reminders).toBe(false)
    expect(doc.notify_discovery).toBe(false)
    expect(doc.notify_filling_fast).toBe(false)
    expect(isCategoryEnabled(doc, 'reminder')).toBe(false)
    expect(isCategoryEnabled(doc, 'discovery')).toBe(false)
    expect(isCategoryEnabled(doc, 'filling_fast')).toBe(false)
    expect(isCategoryEnabled(doc, 'event_change')).toBe(true)
    expect(isCategoryEnabled(doc, 'national_day')).toBe(true)
    // ...and reads them back for the card.
    const profile = await getUserProfileAdmin('u1')
    expect(profile?.notifyPrefs?.notify_reminders).toBe(false)
  })

  it('honours the old nested switches when no top-level field exists, but never maps promos', () => {
    const legacy = { notify: { reminders: false, updates: false, promos: false } }
    expect(isCategoryEnabled(legacy, 'reminder')).toBe(false)
    expect(isCategoryEnabled(legacy, 'event_change')).toBe(false)
    expect(isCategoryEnabled(legacy, 'discovery')).toBe(true)
    // Top-level wins over nested.
    expect(isCategoryEnabled({ ...legacy, notify_reminders: true }, 'reminder')).toBe(true)
    expect(readUserNotifyPrefs(legacy).notify_filling_fast).toBe(true)
  })

  it('drops unknown or non-boolean fields', () => {
    expect(sanitizeUserNotifyPrefs({ notify_reminders: false, role: 'admin', notify_discovery: 'no' })).toEqual({
      notify_reminders: false,
    })
  })
})

describe('#9 saved-event reminders and filling fast', () => {
  it('filling fast reads event_favorites, the collection the save buttons write', async () => {
    mockCol('event_favorites').set('f1', { user_id: 'u1', event_id: 'e1' })
    mockCol('favorites').set('f2', { user_id: 'ghost', event_id: 'e1' })
    expect(await favoritedBy('e1')).toEqual(['u1'])
  })

  it('reminds savers of both date shapes, skips live-ticket holders, and caps per (user, event)', async () => {
    const now = new Date('2026-10-25T14:00:00.000Z')
    const inTwoDays = new Date(now.getTime() + 2 * 86400000)
    mockCol('events').set('e1', { title: 'String date', is_published: true, start_datetime: inTwoDays.toISOString() })
    mockCol('events').set('e2', { title: 'Timestamp date', is_published: true, start_datetime: inTwoDays })
    mockCol('events').set('e3', { title: 'Cancelled', is_published: true, status: 'cancelled', start_datetime: inTwoDays })
    mockCol('event_favorites').set('a', { user_id: 'u1', event_id: 'e1' })
    mockCol('event_favorites').set('b', { user_id: 'u2', event_id: 'e1' })
    mockCol('event_favorites').set('c', { user_id: 'u3', event_id: 'e2' })
    mockCol('event_favorites').set('d', { user_id: 'u4', event_id: 'e3' })
    mockCol('favorites').set('x', { user_id: 'ghost', event_id: 'e1' })
    // u2 bought through MonCash: `confirmed`, not `valid`.
    mockCol('tickets').set('t1', { event_id: 'e1', attendee_id: 'u2', status: 'confirmed' })

    const result = await runFavoriteReminders(now)

    const sent = mockSendDiscretionary.mock.calls.map((c) => [c[0].userId, c[0].capKey, c[0].category])
    expect(sent.sort()).toEqual(
      [
        ['u1', favoriteReminderCapKey('e1'), 'saved_event'],
        ['u3', favoriteReminderCapKey('e2'), 'saved_event'],
      ].sort()
    )
    expect(result).toEqual({ eventsChecked: 2, remindersSent: 2 })
  })

  it('the saved-event category obeys the reminder switch', () => {
    expect(isCategoryEnabled({ notify_reminders: false }, 'saved_event')).toBe(false)
  })
})

describe('#10 organizer notification preferences', () => {
  it('stores only known boolean switches', () => {
    expect(
      sanitizeOrganizerNotificationPreferences({ push_ticket_sales: false, is_admin: true, sms_ticket_sales: 'yes' })
    ).toEqual({ push_ticket_sales: false })
  })
})

describe('#12 waitlist', () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString()
  const join = (eventId: string) =>
    joinWaitlist(
      new Request('http://localhost/api/waitlist/join', {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      })
    )

  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'u1@example.com' })
  })

  it('rejects joining when the organizer did not turn the waitlist on', async () => {
    mockCol('events').set('e1', { title: 'Show', is_published: true, start_datetime: future, total_tickets: 10, tickets_sold: 10 })
    const res = await join('e1')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('waitlist_disabled')
    expect(mockCol('event_waitlist').size).toBe(0)
  })

  it('rejects joining while tickets can still be bought', async () => {
    mockCol('events').set('e1', {
      title: 'Show', is_published: true, start_datetime: future, total_tickets: 10, tickets_sold: 4, enable_waitlist: true,
    })
    const res = await join('e1')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('tickets_available')
  })

  it('joins a sold-out event with the waitlist on', async () => {
    mockCol('events').set('e1', {
      title: 'Show', is_published: true, start_datetime: future, total_tickets: 10, tickets_sold: 10, enable_waitlist: true,
    })
    const res = await join('e1')
    expect(res.status).toBe(200)
    const entries = [...mockCol('event_waitlist').values()]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ event_id: 'e1', user_id: 'u1', email: 'u1@example.com', status: 'waiting', position: 1 })
  })

  it('emails each waiting person once per release burst', async () => {
    const t0 = Date.now()
    mockCol('events').set('e1', {
      title: 'Show', is_published: true, start_datetime: future, total_tickets: 10, tickets_sold: 10, enable_waitlist: true,
    })
    mockCol('event_waitlist').set('w1', { event_id: 'e1', user_id: 'u1', email: 'u1@example.com', position: 1, status: 'waiting' })
    mockCol('event_waitlist').set('w2', { event_id: 'e1', user_id: 'u2', email: 'u2@example.com', position: 2, status: 'waiting' })

    // Sold out: nobody is emailed.
    expect((await notifyWaitlistForEvent('e1', t0)).notified).toBe(0)

    // A seat frees up: both are emailed, once.
    mockCol('events').get('e1')!.tickets_sold = 9
    expect((await notifyWaitlistForEvent('e1', t0 + 1000)).notified).toBe(2)
    expect((await notifyWaitlistForEvent('e1', t0 + 2000)).notified).toBe(0)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)

    // Sells out, frees up again within the gap: still no second email.
    mockCol('events').get('e1')!.tickets_sold = 10
    await notifyWaitlistForEvent('e1', t0 + 3000)
    mockCol('events').get('e1')!.tickets_sold = 9
    expect((await notifyWaitlistForEvent('e1', t0 + 4000)).notified).toBe(0)

    // A later burst, past the gap: one more email each.
    mockCol('events').get('e1')!.tickets_sold = 10
    await notifyWaitlistForEvent('e1', t0 + RENOTIFY_GAP_MS + 5000)
    mockCol('events').get('e1')!.tickets_sold = 9
    expect((await notifyWaitlistForEvent('e1', t0 + RENOTIFY_GAP_MS + 6000)).notified).toBe(2)
    expect(mockSendEmail).toHaveBeenCalledTimes(4)
  })

  it('shouldNotifyEntry skips people already told in this burst or who left the list', () => {
    const now = Date.now()
    expect(shouldNotifyEntry({ status: 'waiting' }, 1, now)).toBe(true)
    expect(shouldNotifyEntry({ status: 'waiting', notified_burst: 1 }, 1, now)).toBe(false)
    expect(shouldNotifyEntry({ status: 'purchased' }, 1, now)).toBe(false)
    expect(
      shouldNotifyEntry({ status: 'waiting', notified_burst: 1, notified_at: new Date(now - 1000).toISOString() }, 2, now)
    ).toBe(false)
  })
})
