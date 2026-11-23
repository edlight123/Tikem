/** @jest-environment node */
/**
 * Editable event reminders: validation, what is due when, the claim keys, and
 * the cron run end to end against an in-memory claim with real transaction
 * semantics (the same fake as reminder-claim.test.ts), so dedupe is proven
 * through the real claimReminder rather than assumed.
 */

class FakeFirestore {
  store = new Map<string, { data: Record<string, any> }>()
  private queue: Promise<unknown> = Promise.resolve()

  collection(name: string) {
    const self = this
    return {
      doc(id: string) {
        const k = `${name}/${id}`
        return {
          _key: k,
          delete: async () => {
            self.store.delete(k)
          },
        }
      },
    }
  }

  async runTransaction(fn: (tx: any) => Promise<any>) {
    const run = this.queue.then(() => {
      const self = this
      return fn({
        get: async (ref: any) => ({ exists: self.store.has(ref._key), data: () => self.store.get(ref._key)?.data }),
        set: (ref: any, data: Record<string, any>) => {
          self.store.set(ref._key, { data })
        },
      })
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}

const fakeDb = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return fakeDb
  },
}))
// event-reminder-send pulls in the push/notification modules; the run takes
// its senders as deps, so they are never called here.
jest.mock('@/lib/notification-triggers', () => ({}))
jest.mock('@/lib/notifications/helpers', () => ({}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }))

import { claimReminder, releaseReminderClaim } from '@/lib/notifications/reminder-claim'
import {
  CRON_PERIOD_MINUTES,
  MIN_REMINDER_OFFSET_MINUTES,
  reminderWindowForOffset,
  reminderWindows,
} from '@/lib/notifications/reminder-windows'
import {
  DEFAULT_EVENT_REMINDERS,
  MIN_MINUTES_BEFORE,
  dueReminders,
  isStockReminder,
  reminderClaimKey,
  resolveEventReminders,
  validateReminders,
  type EventReminder,
} from '@/lib/notifications/event-reminder-settings'
import { runEventReminders, type ReminderRunDeps } from '@/lib/notifications/event-reminder-run'
import { customReminderCopy } from '@/lib/notifications/event-reminder-send'

const MINUTE = 60_000
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE)
const NOW = new Date('2026-11-23T12:00:00.000Z')

describe('validation', () => {
  it('accepts a full custom list and cleans messages', () => {
    const v = validateReminders([
      { id: 'event_reminder_24h', minutes_before: 2880, enabled: true, message: '  Bring <b>ID</b>\n\nplease ' },
      { id: 'r_abc', minutes_before: 60, enabled: false },
    ])
    expect(v).toEqual({
      ok: true,
      reminders: [
        { id: 'event_reminder_24h', minutes_before: 2880, enabled: true, message: 'Bring ID please' },
        { id: 'r_abc', minutes_before: 60, enabled: false },
      ],
    })
  })

  it('refuses times the hourly cron cannot honour, duplicates and junk', () => {
    expect(validateReminders([{ id: 'a', minutes_before: MIN_MINUTES_BEFORE - 1 }]).ok).toBe(false)
    expect(validateReminders([{ id: 'a', minutes_before: 7 * 1440 + 1 }]).ok).toBe(false)
    expect(validateReminders([{ id: 'a', minutes_before: 60 }, { id: 'b', minutes_before: 60 }]).ok).toBe(false)
    expect(validateReminders([{ id: 'a', minutes_before: 60 }, { id: 'a', minutes_before: 120 }]).ok).toBe(false)
    expect(validateReminders([{ id: 'Bad Id', minutes_before: 60 }]).ok).toBe(false)
    expect(validateReminders([{ id: 'a', minutes_before: 60.5 }]).ok).toBe(false)
    expect(validateReminders(Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, minutes_before: 60 + i }))).ok).toBe(false)
    expect(validateReminders('nope').ok).toBe(false)
  })

  it('no settings = the stock three; an empty list = none', () => {
    expect(resolveEventReminders({})).toEqual(DEFAULT_EVENT_REMINDERS)
    expect(resolveEventReminders({ reminders: [] })).toEqual([])
  })

  it('drops only the stored entries that no longer validate', () => {
    expect(
      resolveEventReminders({ reminders: [{ id: 'r1', minutes_before: 5 }, { id: 'r2', minutes_before: 120, enabled: true }] })
    ).toEqual([{ id: 'r2', minutes_before: 120, enabled: true }])
  })
})

describe('windows invariant covers custom times', () => {
  it('the minimum offset is at least half a cron period, so a due reminder is never after the start', () => {
    expect(MIN_REMINDER_OFFSET_MINUTES).toBeGreaterThanOrEqual(CRON_PERIOD_MINUTES / 2)
    expect(MIN_MINUTES_BEFORE).toBeGreaterThanOrEqual(MIN_REMINDER_OFFSET_MINUTES)
  })

  it('every allowed offset gets a window one full period wide that never starts before now', () => {
    for (const m of [30, 45, 60, 90, 180, 1440, 2880, 10080]) {
      const w = reminderWindowForOffset(m, NOW)
      expect((w.windowEnd.getTime() - w.windowStart.getTime()) / MINUTE).toBe(CRON_PERIOD_MINUTES)
      expect(w.windowStart.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
    }
  })

  it('consecutive hourly runs catch every start minute exactly once per reminder', () => {
    for (const m of [30, 45, 120, 2880]) {
      const reminders = [{ id: 'r', minutes_before: m, enabled: true }]
      for (let minute = 0; minute < 180; minute += 7) {
        const event = { reminders, start_datetime: at(NOW, m + 90 + minute).toISOString() }
        const hits = [0, 1, 2, 3, 4, 5].filter((h) => dueReminders(event, at(NOW, h * 60)).length > 0)
        // Inclusive bounds (like the Firestore range) can bracket a boundary
        // start on two runs; the claim makes the second a no-op.
        expect(hits.length).toBeGreaterThanOrEqual(1)
        expect(hits.length).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('default behaviour is unchanged', () => {
  it('an event with no settings is due exactly when the old per-tier windows said', () => {
    for (let minute = -10; minute < 26 * 60; minute += 11) {
      const start = at(NOW, minute)
      const old = reminderWindows(NOW)
        .filter((w) => start >= w.windowStart && start <= w.windowEnd)
        .map((w) => w.type)
      const now = dueReminders({ start_datetime: start.toISOString() }, NOW).map((r) => r.id)
      expect(now).toEqual(old)
    }
  })

  it('stock reminders keep their historic claim keys and copy path', () => {
    for (const r of DEFAULT_EVENT_REMINDERS) {
      expect(reminderClaimKey(r)).toBe(r.id)
      expect(isStockReminder(r)).toBe(true)
    }
  })

  it('a reworded stock reminder keeps its key; a moved or added one gets a time-bound key', () => {
    const reworded: EventReminder = { id: 'event_reminder_24h', minutes_before: 1440, enabled: true, message: 'Doors at 8' }
    expect(reminderClaimKey(reworded)).toBe('event_reminder_24h')
    expect(isStockReminder(reworded)).toBe(false)
    expect(reminderClaimKey({ id: 'event_reminder_24h', minutes_before: 2880, enabled: true })).toBe('event_reminder_24h_at_2880')
    expect(reminderClaimKey({ id: 'r_new', minutes_before: 60, enabled: true })).toBe('r_new_at_60')
  })

  it('never sends a reminder for an event that has started', () => {
    expect(dueReminders({ start_datetime: at(NOW, -1).toISOString() }, NOW)).toEqual([])
  })

  it('reads Timestamp-shaped starts too', () => {
    const start = at(NOW, 3 * 60)
    expect(dueReminders({ start_datetime: { toDate: () => start } }, NOW).map((r) => r.id)).toEqual(['event_reminder_3h'])
  })
})

describe('custom copy', () => {
  it('uses the organizer words, else a plain "starts in"', () => {
    expect(customReminderCopy('Kompa Night', { id: 'r', minutes_before: 2880, enabled: true })).toEqual({
      title: 'Reminder: Kompa Night',
      body: '"Kompa Night" starts in 2 days!',
    })
    expect(customReminderCopy('Kompa Night', { id: 'r', minutes_before: 60, enabled: true, message: 'Gates at 8' }).body).toBe(
      'Gates at 8'
    )
  })
})

describe('cron run with claims (dedupe)', () => {
  beforeEach(() => fakeDb.store.clear())

  function deps(events: Record<string, any>[], opts: { failStockOnce?: boolean } = {}) {
    const calls: Array<{ kind: string; eventId: string; id: string; key: string; attendees: string[] }> = []
    let failed = false
    const d: ReminderRunDeps = {
      loadEvents: jest.fn(async () => events),
      loadTickets: jest.fn(async (eventId: string) => [
        { id: `${eventId}-t1`, attendee_id: 'u1', attendee: { email: 'a@x.co' } },
        { id: `${eventId}-t2`, attendee_id: 'u2', attendee: { email: 'b@x.co', phone: '+509' } },
        { id: `${eventId}-t3`, attendee_id: 'u1', attendee: { email: 'a@x.co' } },
      ]),
      claim: claimReminder,
      release: releaseReminderClaim,
      sendStock: jest.fn(async (event, attendees, r) => {
        if (opts.failStockOnce && !failed) {
          failed = true
          throw new Error('push down')
        }
        calls.push({ kind: 'stock', eventId: event.id, id: r.id, key: reminderClaimKey(r), attendees })
      }),
      sendCustom: jest.fn(async (event, attendees, r) => {
        calls.push({ kind: 'custom', eventId: event.id, id: r.id, key: reminderClaimKey(r), attendees })
      }),
      sendDayBefore: jest.fn(async (_event, tickets) => ({ emailsSent: tickets.length, whatsappSent: 1 })),
    }
    return { d, calls }
  }

  it('default event: the 24h reminder goes once across overlapping runs, with email + WhatsApp', async () => {
    const event = { id: 'ev1', title: 'Fête', start_datetime: at(NOW, 24 * 60).toISOString() }
    const { d, calls } = deps([event])
    const first = await runEventReminders(NOW, d)
    await runEventReminders(NOW, d) // a retry / overlapping run
    await runEventReminders(at(NOW, 30), d) // next window edge
    expect(calls).toEqual([{ kind: 'stock', eventId: 'ev1', id: 'event_reminder_24h', key: 'event_reminder_24h', attendees: ['u1', 'u2'] }])
    expect(d.sendDayBefore).toHaveBeenCalledTimes(1)
    expect(first.totalEmailsSent).toBe(3)
    expect(first.results.map((r) => r.type)).toEqual(['event_reminder_24h', 'event_reminder_3h', 'event_reminder_30min'])
    expect(fakeDb.store.has('reminderClaims/ev1__event_reminder_24h')).toBe(true)
  })

  it('custom offsets each send once, at their own time, through the custom sender', async () => {
    const event = {
      id: 'ev2',
      title: 'Rara',
      start_datetime: at(NOW, 48 * 60).toISOString(),
      reminders: [
        { id: 'event_reminder_24h', minutes_before: 2880, enabled: true }, // moved to 2 days
        { id: 'r_hour', minutes_before: 60, enabled: true, message: 'Gates open' },
        { id: 'event_reminder_3h', minutes_before: 180, enabled: false }, // switched off
      ],
    }
    const { d, calls } = deps([event])
    // Walk every hour up to the start, twice per hour (retries).
    for (let h = 0; h <= 48; h++) {
      await runEventReminders(at(NOW, h * 60), d)
      await runEventReminders(at(NOW, h * 60 + 1), d)
    }
    expect(calls.map((c) => `${c.kind}:${c.key}`)).toEqual(['custom:event_reminder_24h_at_2880', 'custom:r_hour_at_60'])
    // The moved day-before reminder is no longer exactly one day out: no email.
    expect(d.sendDayBefore).not.toHaveBeenCalled()
  })

  it('a reminder moved after it went out sends again at its new time, never twice at one time', async () => {
    const start = at(NOW, 24 * 60)
    const { d, calls } = deps([{ id: 'ev3', title: 'Bal', start_datetime: start.toISOString() }])
    await runEventReminders(NOW, d) // stock 24h goes out
    const moved = {
      id: 'ev3',
      title: 'Bal',
      start_datetime: start.toISOString(),
      reminders: [{ id: 'event_reminder_24h', minutes_before: 120, enabled: true }],
    }
    const again = deps([moved])
    again.d.claim = claimReminder
    await runEventReminders(at(NOW, 22 * 60), again.d)
    await runEventReminders(at(NOW, 22 * 60), again.d)
    expect(calls.map((c) => c.key)).toEqual(['event_reminder_24h'])
    expect(again.calls.map((c) => c.key)).toEqual(['event_reminder_24h_at_120'])
  })

  it('removing every reminder sends nothing', async () => {
    const { d, calls } = deps([{ id: 'ev4', title: 'X', start_datetime: at(NOW, 24 * 60).toISOString(), reminders: [] }])
    await runEventReminders(NOW, d)
    expect(calls).toEqual([])
    expect(d.loadTickets).not.toHaveBeenCalled()
  })

  it('a failed send hands the claim back, skips the email, and the next run retries', async () => {
    const event = { id: 'ev5', title: 'Y', start_datetime: at(NOW, 24 * 60).toISOString() }
    const { d, calls } = deps([event], { failStockOnce: true })
    await runEventReminders(NOW, d)
    expect(fakeDb.store.has('reminderClaims/ev5__event_reminder_24h')).toBe(false)
    expect(d.sendDayBefore).not.toHaveBeenCalled()
    await runEventReminders(NOW, d)
    expect(calls.map((c) => c.key)).toEqual(['event_reminder_24h'])
    expect(d.sendDayBefore).toHaveBeenCalledTimes(1)
  })

  it('takes no claim for an event with no live tickets', async () => {
    const { d } = deps([{ id: 'ev6', title: 'Z', start_datetime: at(NOW, 3 * 60).toISOString() }])
    d.loadTickets = jest.fn(async () => [])
    await runEventReminders(NOW, d)
    expect(fakeDb.store.size).toBe(0)
  })

  it('looks a week ahead for events', async () => {
    const { d } = deps([])
    await runEventReminders(NOW, d)
    const [from, to] = (d.loadEvents as jest.Mock).mock.calls[0]
    expect(from).toEqual(NOW)
    expect(to.getTime()).toBe(at(NOW, 7 * 1440 + 30).getTime())
  })
})
