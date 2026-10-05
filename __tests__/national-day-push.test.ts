/**
 * The national-day push (lib/notifications/national-day-push + its cron).
 *
 * Runs the real `sendDiscretionary` against an in-memory Firestore so the
 * opt-out, the cap-before-send and the once-per-year key are proven at the
 * seam, not assumed. Every send is a mock: nothing here reaches Expo, web push
 * or a real database.
 *
 * @jest-environment node
 */

type Doc = Record<string, any>
const users = new Map<string, Doc>()
const caps = new Map<string, Doc>()
const notifications: Doc[] = []
let configDoc: Doc | null = null
let configReadFails = false
let userReads = 0

function matches(doc: Doc, filters: Array<[string, string, any]>): boolean {
  return filters.every(([field, op, value]) => {
    const v = doc[field]
    if (op === '!=') return v !== undefined && v !== value
    if (op === 'in') return (value as any[]).includes(v)
    if (op === '==') return v === value
    throw new Error(`unsupported op ${op}`)
  })
}

function usersQuery(filters: Array<[string, string, any]> = [], lim = Infinity, after: string | null = null): any {
  return {
    where: (f: string, op: string, v: any) => usersQuery([...filters, [f, op, v]], lim, after),
    limit: (n: number) => usersQuery(filters, n, after),
    startAfter: (snap: { id: string }) => usersQuery(filters, lim, snap.id),
    get: async () => {
      const ids = Array.from(users.keys())
        .sort()
        .filter((id) => (after === null || id > after) && matches(users.get(id)!, filters))
        .slice(0, lim)
      userReads += ids.length
      const docs = ids.map((id) => ({ id, data: () => users.get(id) }))
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection(name: string) {
      if (name === 'users') {
        return {
          ...usersQuery(),
          doc: (id: string) => ({
            get: async () => ({ exists: users.has(id), data: () => users.get(id) }),
          }),
        }
      }
      if (name === 'config') {
        return {
          doc: () => ({
            get: async () => {
              if (configReadFails) throw new Error('firestore down')
              return { exists: !!configDoc, data: () => configDoc }
            },
          }),
        }
      }
      // notificationCaps
      return {
        doc: (id: string) => ({
          get: async () => ({ exists: caps.has(id), data: () => caps.get(id) }),
          set: async (data: Doc) => {
            caps.set(id, data)
          },
        }),
      }
    },
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '<ts>' },
}))

const createNotification = jest.fn(async (...args: any[]) => {
  notifications.push({ args })
  return 'notif'
})
jest.mock('@/lib/notifications/helpers', () => ({
  createNotification: (...args: any[]) => createNotification(...args),
}))

const sendPushNotification = jest.fn(async (..._args: any[]) => undefined)
jest.mock('@/lib/notification-triggers', () => ({
  sendPushNotification: (...args: any[]) => sendPushNotification(...args),
}))

import {
  isNationalDayPushHour,
  nationalDayCapKey,
  nationalDayPushCopy,
  nationalDayPushLinks,
  pushableDay,
  pushHourBands,
  pushLanguage,
  runNationalDayPush,
} from '@/lib/notifications/national-day-push'
import { decideSend, isCategoryEnabled } from '@/lib/notifications/policy'
import { NATIONAL_DAYS, nationalDayPushable, resolveNationalDays } from '@/lib/nationalDays'
import { GET } from '@/app/api/cron/national-day-push/route'

// 18 Nov 2026. Haiti and New York are both on UTC-5 by then (DST ended 1 Nov),
// Paris on UTC+1.
const NOV18_0900_HAITI_AND_MIAMI = new Date('2026-11-18T14:00:00Z')
const NOV18_0900_PARIS = new Date('2026-11-18T08:00:00Z') // 03:00 in Haiti, already the 18th there
const NOV18_1000_HAITI = new Date('2026-11-18T15:00:00Z')

const vertieres = NATIONAL_DAYS.find((d) => d.key === 'vertieres')!

function seedUsers() {
  users.set('pap', { last_seen_country: 'HT', last_seen_city: 'Port-au-Prince', language: 'ht' })
  users.set('mia', { last_seen_country: 'US', last_seen_city: 'Miami', language: 'en' })
  users.set('par', { last_seen_country: 'FR', last_seen_city: 'Paris', language: 'fr' })
  users.set('muted', { last_seen_country: 'HT', language: 'ht', notify_national_day: false })
  users.set('nolang', { last_seen_country: 'HT' })
  // Never registered a push token: no last_seen_country, never queried.
  users.set('web-only', { language: 'fr' })
}

const pushedTo = () => sendPushNotification.mock.calls.map((c) => c[0]).sort()

beforeEach(() => {
  users.clear()
  caps.clear()
  notifications.length = 0
  configDoc = null
  configReadFails = false
  userReads = 0
  createNotification.mockClear()
  sendPushNotification.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

/** sendDiscretionary checks quiet hours against the wall clock, so pin it. */
async function runAt(now: Date, config: any = null) {
  jest.useFakeTimers().setSystemTime(now)
  return runNationalDayPush(now, config)
}

describe('which day may push', () => {
  it('pushes on the day itself', () => {
    const pick = pushableDay(NOV18_0900_HAITI_AND_MIAMI, null)
    expect(pick.active?.day.key).toBe('vertieres')
    expect(pick.active?.phase).toBe('today')
    expect((pick as any).year).toBe(2026)
  })

  it('stays silent during the lead days', () => {
    expect(pushableDay(new Date('2026-11-16T14:00:00Z'), null)).toEqual({ active: null, reason: 'upcoming' })
  })

  it('never pushes on a low-key day', () => {
    for (const iso of ['2026-05-01', '2026-08-15', '2026-11-02', '2026-12-05']) {
      const pick = pushableDay(new Date(`${iso}T14:00:00Z`), null)
      expect(pick).toEqual({ active: null, reason: 'low-key day' })
    }
  })

  it('respects a day disabled in the remote config', () => {
    expect(pushableDay(NOV18_0900_HAITI_AND_MIAMI, { disabled: ['vertieres'] }).active).toBeNull()
  })

  it('respects push: false from the remote overrides', () => {
    const pick = pushableDay(NOV18_0900_HAITI_AND_MIAMI, { overrides: { vertieres: { push: false } } })
    expect(pick).toEqual({ active: null, reason: 'push disabled for this day' })
  })

  it('respects push: false in the calendar, and a remote push: true lifts it', () => {
    const base = NATIONAL_DAYS.map((d) => (d.key === 'vertieres' ? { ...d, push: false } : d))
    const silenced = resolveNationalDays(null, base).find((d) => d.key === 'vertieres')!
    expect(nationalDayPushable({ day: silenced, phase: 'today', daysUntil: 0, start: '2026-11-18', end: '2026-11-18' })).toBe(false)
    const lifted = resolveNationalDays({ overrides: { vertieres: { push: true } } }, base).find((d) => d.key === 'vertieres')!
    expect(lifted.push).toBe(true)
  })

  it('ignores a push override that is not a boolean', () => {
    const day = resolveNationalDays({ overrides: { vertieres: { push: 'no' as any } } }).find((d) => d.key === 'vertieres')!
    expect(day.push).toBeUndefined()
  })
})

describe('local 09:00 across time zones', () => {
  it('puts Port-au-Prince and Miami in the same run in November', () => {
    expect(isNationalDayPushHour(NOV18_0900_HAITI_AND_MIAMI, 'HT')).toBe(true)
    expect(isNationalDayPushHour(NOV18_0900_HAITI_AND_MIAMI, 'US')).toBe(true)
    expect(isNationalDayPushHour(NOV18_0900_HAITI_AND_MIAMI, 'FR')).toBe(false)
    expect(isNationalDayPushHour(NOV18_0900_PARIS, 'FR')).toBe(true)
    expect(isNationalDayPushHour(NOV18_0900_PARIS, 'HT')).toBe(false)
  })

  it('follows each zone through daylight saving', () => {
    // Haiti keeps DST: 09:00 on 18 May (Flag Day) is 13:00 UTC.
    expect(isNationalDayPushHour(new Date('2027-05-18T13:00:00Z'), 'HT')).toBe(true)
    // The unknown-country fallback is a fixed UTC-5, as policy.ts has it.
    expect(isNationalDayPushHour(new Date('2027-05-18T14:00:00Z'), null)).toBe(true)
  })

  it('names the bands at 09:00 so other hours skip the scan', () => {
    expect(pushHourBands(NOV18_0900_HAITI_AND_MIAMI)).toEqual({ countries: ['HT', 'US', 'CA'], fallback: true })
    expect(pushHourBands(NOV18_0900_PARIS)).toEqual({ countries: ['FR'], fallback: false })
    expect(pushHourBands(NOV18_1000_HAITI)).toEqual({ countries: [], fallback: false })
  })
})

describe('copy, links and cap key', () => {
  it('formats the cap key per day and year', () => {
    expect(nationalDayCapKey('vertieres', 2026)).toBe('national_day:vertieres:2026')
  })

  it("picks the copy in the user's saved language, English by default", () => {
    expect(nationalDayPushCopy(vertieres, 'ht')).toEqual({ title: vertieres.title.ht, body: vertieres.message.ht })
    expect(nationalDayPushCopy(vertieres, 'fr-FR').title).toBe(vertieres.title.fr)
    expect(nationalDayPushCopy(vertieres, undefined).title).toBe(vertieres.title.en)
    expect(pushLanguage('de')).toBe('en')
  })

  it('links the web to discover and the app to the themed list', () => {
    expect(nationalDayPushLinks('vertieres')).toEqual({
      url: '/discover?day=vertieres',
      deepLink: 'tikem://national-day/vertieres',
    })
  })

  it('is a discretionary category with an opt-out that defaults on', () => {
    expect(isCategoryEnabled({}, 'national_day')).toBe(true)
    expect(isCategoryEnabled({ notify_national_day: false }, 'national_day')).toBe(false)
    expect(
      decideSend({ user: { last_seen_country: 'HT' }, category: 'national_day', now: new Date('2026-11-18T03:00:00Z') })
    ).toEqual({ send: false, reason: 'quiet_hours' })
  })
})

describe('runNationalDayPush', () => {
  it('sends once to everyone at 09:00, skipping the opted out and other zones', async () => {
    seedUsers()
    const res = await runAt(NOV18_0900_HAITI_AND_MIAMI)
    expect(res).toMatchObject({ ok: true, day: 'vertieres', notified: 3 })
    expect(pushedTo()).toEqual(['mia', 'nolang', 'pap'])

    const byUser = Object.fromEntries(sendPushNotification.mock.calls.map((c) => [c[0], c]))
    expect(byUser.pap[1]).toBe(vertieres.title.ht)
    expect(byUser.pap[2]).toBe(vertieres.message.ht)
    expect(byUser.mia[1]).toBe(vertieres.title.en)
    expect(byUser.nolang[1]).toBe(vertieres.title.en)
    expect(byUser.pap[3]).toBe('/discover?day=vertieres')
    expect(byUser.pap[4]).toMatchObject({
      type: 'national_day',
      nationalDay: 'vertieres',
      deepLink: 'tikem://national-day/vertieres',
    })

    // The bell entry, as every discretionary campaign writes one.
    expect(createNotification).toHaveBeenCalledTimes(3)
    expect(caps.has('pap__national_day:vertieres:2026')).toBe(true)
    expect(caps.has('muted__national_day:vertieres:2026')).toBe(false)
  })

  it('is idempotent when the cron fires twice in the hour', async () => {
    seedUsers()
    await runAt(NOV18_0900_HAITI_AND_MIAMI)
    sendPushNotification.mockClear()
    const again = await runAt(new Date('2026-11-18T14:20:00Z'))
    expect(again.notified).toBe(0)
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('reaches Paris at 09:00 Paris, in French', async () => {
    seedUsers()
    const res = await runAt(NOV18_0900_PARIS)
    expect(res.notified).toBe(1)
    expect(pushedTo()).toEqual(['par'])
    expect(sendPushNotification.mock.calls[0][1]).toBe(vertieres.title.fr)
  })

  it('reads no users in an hour when nobody is at 09:00', async () => {
    seedUsers()
    const res = await runAt(NOV18_1000_HAITI)
    expect(res).toMatchObject({ notified: 0, scanned: 0, reason: 'not 09:00 for anyone' })
    expect(userReads).toBe(0)
  })

  it('sends nothing during the lead days or on a low-key day', async () => {
    seedUsers()
    expect((await runAt(new Date('2026-11-16T14:00:00Z'))).notified).toBe(0)
    expect((await runAt(new Date('2026-11-02T14:00:00Z'))).notified).toBe(0)
    expect(sendPushNotification).not.toHaveBeenCalled()
    expect(userReads).toBe(0)
  })

  it('sends nothing for a day switched off remotely', async () => {
    seedUsers()
    expect((await runAt(NOV18_0900_HAITI_AND_MIAMI, { disabled: ['vertieres'] })).notified).toBe(0)
    expect((await runAt(NOV18_0900_HAITI_AND_MIAMI, { overrides: { vertieres: { push: false } } })).notified).toBe(0)
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('is once per occurrence: a three-day Kanaval pushes on its first day only', async () => {
    seedUsers()
    expect((await runAt(new Date('2027-02-07T14:00:00Z'))).notified).toBe(3)
    expect(caps.has('pap__national_day:kanaval:2027')).toBe(true)
    sendPushNotification.mockClear()
    expect((await runAt(new Date('2027-02-08T14:00:00Z'))).notified).toBe(0)
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('comes back next year', async () => {
    seedUsers()
    await runAt(NOV18_0900_HAITI_AND_MIAMI)
    sendPushNotification.mockClear()
    expect((await runAt(new Date('2027-11-18T14:00:00Z'))).notified).toBe(3)
  })

  it('pages through more users than fit in one read', async () => {
    for (let i = 0; i < 1203; i++) users.set(`u${String(i).padStart(4, '0')}`, { last_seen_country: 'HT' })
    const res = await runAt(NOV18_0900_HAITI_AND_MIAMI)
    expect(res).toMatchObject({ notified: 1203, scanned: 1203 })
    expect(new Set(pushedTo()).size).toBe(1203)
  })
})

describe('GET /api/cron/national-day-push', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    process.env = { ...OLD_ENV, CRON_SECRET: 'test-secret' }
  })
  afterAll(() => {
    process.env = OLD_ENV
  })

  const call = (auth?: string) =>
    GET(new Request('http://localhost/api/cron/national-day-push', { headers: auth ? { authorization: auth } : {} }))

  it('refuses a call without the cron secret', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
  })

  it('reads the remote config and honours it', async () => {
    seedUsers()
    jest.useFakeTimers().setSystemTime(NOV18_0900_HAITI_AND_MIAMI)
    configDoc = { overrides: { vertieres: { push: false } } }
    const res = await call('Bearer test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ notified: 0, reason: 'push disabled for this day' })
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('skips the run when the config cannot be read, rather than assume the built-in calendar', async () => {
    seedUsers()
    jest.useFakeTimers().setSystemTime(NOV18_0900_HAITI_AND_MIAMI)
    configReadFails = true
    const res = await call('Bearer test-secret')
    expect(res.status).toBe(503)
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('sends when the day is on', async () => {
    seedUsers()
    jest.useFakeTimers().setSystemTime(NOV18_0900_HAITI_AND_MIAMI)
    const res = await call('Bearer test-secret')
    expect(await res.json()).toMatchObject({ day: 'vertieres', notified: 3 })
  })
})
