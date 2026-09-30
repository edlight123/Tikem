/**
 * App Store guideline 1.2 moderation: reports and blocks.
 *
 * Runs the REAL lib/moderation code and the REAL route handlers against an
 * in-memory Firestore, covering: auth, validation, one-open-report-per-
 * (reporter, target) dedupe, the atomic reports_count increment, the per-user
 * rate limit, auto-hide at AUTO_HIDE_THRESHOLD distinct reporters, admin
 * resolution, and block filtering / follow removal.
 *
 * @jest-environment node
 */

// ── In-memory Firestore ──────────────────────────────────────────────────────
type Doc = Record<string, any>
const store = new Map<string, Doc>() // full path → data
let autoId = 0

const INC = Symbol('inc')
function applyWrite(prev: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge && prev ? { ...prev } : {}
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && (v as any)[INC] !== undefined) {
      base[k] = (Number(prev?.[k]) || 0) + (v as any)[INC]
    } else {
      base[k] = v
    }
  }
  return base
}

function docRef(path: string): any {
  const id = path.split('/').pop()!
  return {
    id,
    path,
    get: async () => snap(path),
    set: async (data: Doc, opts?: { merge?: boolean }) => {
      store.set(path, applyWrite(store.get(path), data, !!opts?.merge))
    },
    update: async (data: Doc) => {
      if (!store.has(path)) throw new Error(`no doc ${path}`)
      store.set(path, applyWrite(store.get(path), data, true))
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function snap(path: string) {
  const data = store.get(path)
  return { id: path.split('/').pop()!, exists: data !== undefined, data: () => data, ref: docRef(path) }
}

function collectionRef(path: string, filters: Array<[string, any]> = [], max = Infinity): any {
  const run = () => {
    const prefix = `${path}/`
    const docs = Array.from(store.keys())
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => snap(k))
      .filter((s) => filters.every(([f, v]) => s.data()?.[f] === v))
      .slice(0, max)
    return { empty: docs.length === 0, size: docs.length, docs }
  }
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    where: (f: string, _op: string, v: any) => collectionRef(path, [...filters, [f, v]], max),
    limit: (n: number) => collectionRef(path, filters, n),
    get: async () => run(),
  }
}

function batch() {
  const ops: Array<() => Promise<void>> = []
  return {
    update: (ref: any, data: Doc) => ops.push(() => ref.update(data)),
    set: (ref: any, data: Doc, opts?: any) => ops.push(() => ref.set(data, opts)),
    delete: (ref: any) => ops.push(() => ref.delete()),
    commit: async () => {
      for (const op of ops) await op()
    },
  }
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ [INC]: n }), serverTimestamp: () => new Date() },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => collectionRef(name),
    batch: () => batch(),
    getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
    // Serialised, so a transaction sees a consistent store — enough to exercise
    // the read-then-write logic (Firestore gives the real isolation).
    runTransaction: async (fn: any) => {
      const writes: Array<() => Promise<void>> = []
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Doc, opts?: any) => writes.push(() => ref.set(data, opts)),
        update: (ref: any, data: Doc) => writes.push(() => ref.update(data)),
      }
      const out = await fn(tx)
      for (const w of writes) await w()
      return out
    },
  },
}))

let currentUser: any = { id: 'u1', email: 'u1@x.com' }
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => currentUser) }))

const notifyCalls: any[] = []
jest.mock('@/lib/moderation/notify-admins', () => {
  const actual = jest.requireActual('@/lib/moderation/notify-admins')
  return {
    ...actual,
    notifyAdminsOfReport: jest.fn(async (p: any) => {
      if (actual.shouldNotifyAdmins(p.openCount, p.autoHidden)) notifyCalls.push(p)
    }),
  }
})

import {
  AUTO_HIDE_THRESHOLD,
  REPORTS_PER_HOUR,
  fileReport,
  parseReportBody,
  resolveReports,
} from '@/lib/moderation/reports'
import { blockOrganizer, filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { POST as reportEvent } from '@/app/api/events/[id]/report/route'
import { POST as reportOrganizer } from '@/app/api/organizers/[id]/report/route'
import { POST as blockRoute, DELETE as unblockRoute } from '@/app/api/users/me/blocks/[organizerId]/route'
import { POST as followRoute } from '@/app/api/organizers/follow/route'

const req = (body: unknown) =>
  new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function seed() {
  store.clear()
  notifyCalls.length = 0
  store.set('events/e1', { title: 'Konpa Night', organizer_id: 'org1', is_published: true, rejected: false, reports_count: 0 })
  store.set('events/draft', { title: 'Draft', organizer_id: 'org1', is_published: false, rejected: false, reports_count: 0 })
  store.set('users/org1', { full_name: 'DJ Org', role: 'organizer' })
  store.set('users/u1', { full_name: 'Attendee', role: 'attendee' })
}

const event = () => store.get('events/e1')!
const openEventReports = () =>
  Array.from(store.entries()).filter(([k, v]) => k.startsWith('event_reports/') && v.status === 'open')

beforeEach(() => {
  seed()
  currentUser = { id: 'u1', email: 'u1@x.com' }
})

describe('parseReportBody', () => {
  it('accepts a known reason and trims details', () => {
    expect(parseReportBody({ reason: 'spam', details: '  hi  ' })).toEqual({ ok: true, reason: 'spam', details: 'hi' })
  })
  it('rejects unknown reasons and over-long details', () => {
    expect(parseReportBody({ reason: 'meh' })).toMatchObject({ ok: false, code: 'invalid_reason' })
    expect(parseReportBody({ reason: 'other', details: 'x'.repeat(1001) })).toMatchObject({ ok: false, code: 'details_too_long' })
    expect(parseReportBody(null)).toMatchObject({ ok: false, code: 'bad_request' })
  })
})

describe('POST /api/events/[id]/report', () => {
  it('requires sign-in', async () => {
    currentUser = null
    const res = await reportEvent(req({ reason: 'spam' }), params('e1'))
    expect(res.status).toBe(401)
    expect(openEventReports()).toHaveLength(0)
  })

  it('writes an open report, increments reports_count and pages admins on the first', async () => {
    const res = await reportEvent(req({ reason: 'scam_or_fraud', details: 'fake venue' }), params('e1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const [[, report]] = openEventReports()
    expect(report).toMatchObject({
      event_id: 'e1',
      organizer_id: 'org1',
      reporter_uid: 'u1',
      reason: 'scam_or_fraud',
      details: 'fake venue',
      status: 'open',
    })
    expect(report.created_at).toBeInstanceOf(Date)
    expect(event().reports_count).toBe(1)
    expect(notifyCalls).toHaveLength(1)
  })

  it('dedupes: a second report from the same user is an idempotent 200 with no increment', async () => {
    await reportEvent(req({ reason: 'spam' }), params('e1'))
    const res = await reportEvent(req({ reason: 'offensive' }), params('e1'))
    expect(res.status).toBe(200)
    expect((await res.json()).duplicate).toBe(true)
    expect(openEventReports()).toHaveLength(1)
    expect(event().reports_count).toBe(1)
  })

  it('rejects invalid reasons, drafts, and self-reports', async () => {
    expect((await reportEvent(req({ reason: 'nope' }), params('e1'))).status).toBe(400)
    expect((await reportEvent(req({ reason: 'spam' }), params('draft'))).status).toBe(404)
    expect((await reportEvent(req({ reason: 'spam' }), params('missing'))).status).toBe(404)
    currentUser = { id: 'org1' }
    const self = await reportEvent(req({ reason: 'spam' }), params('e1'))
    expect(self.status).toBe(400)
    expect((await self.json()).code).toBe('self_report')
    expect(event().reports_count).toBe(0)
  })

  it('rate-limits a user after REPORTS_PER_HOUR new reports', async () => {
    for (let i = 0; i < REPORTS_PER_HOUR; i++) {
      store.set(`events/r${i}`, { title: `E${i}`, organizer_id: 'org1', is_published: true, reports_count: 0 })
      expect((await reportEvent(req({ reason: 'spam' }), params(`r${i}`))).status).toBe(200)
    }
    const res = await reportEvent(req({ reason: 'spam' }), params('e1'))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('rate_limited')
    expect(event().reports_count).toBe(0)
  })

  it(`auto-hides from discovery at ${AUTO_HIDE_THRESHOLD} distinct reporters, without unpublishing`, async () => {
    for (let i = 1; i <= AUTO_HIDE_THRESHOLD; i++) {
      currentUser = { id: `reporter${i}` }
      await reportEvent(req({ reason: 'offensive' }), params('e1'))
      expect(event().hidden_pending_review === true).toBe(i >= AUTO_HIDE_THRESHOLD)
    }
    expect(event().reports_count).toBe(AUTO_HIDE_THRESHOLD)
    expect(event().is_published).toBe(true)
    // First report + the auto-hide one page admins; the ones between do not.
    expect(notifyCalls.map((c) => c.openCount)).toEqual([1, AUTO_HIDE_THRESHOLD])
    expect(notifyCalls[1].autoHidden).toBe(true)
  })
})

describe('resolveReports', () => {
  it('closes open reports, zeroes the count, un-hides, and lets the same user report again', async () => {
    for (let i = 1; i <= AUTO_HIDE_THRESHOLD; i++) {
      await fileReport({ kind: 'event', targetId: 'e1', reporterUid: `r${i}`, reason: 'spam', details: '' })
    }
    expect(event().hidden_pending_review).toBe(true)

    const { resolved } = await resolveReports({ kind: 'event', targetId: 'e1', resolution: 'dismissed', adminId: 'admin1' })
    expect(resolved).toBe(AUTO_HIDE_THRESHOLD)
    expect(openEventReports()).toHaveLength(0)
    expect(event().reports_count).toBe(0)
    expect(event().hidden_pending_review).toBe(false)

    const again = await fileReport({ kind: 'event', targetId: 'e1', reporterUid: 'r1', reason: 'spam', details: '' })
    expect(again.status).toBe('created')
    expect(event().reports_count).toBe(1)
  })
})

describe('POST /api/organizers/[id]/report', () => {
  it('writes organizer_reports and counts them outside the owner-writable user doc', async () => {
    const res = await reportOrganizer(req({ reason: 'scam_or_fraud' }), params('org1'))
    expect(res.status).toBe(200)
    const reports = Array.from(store.entries()).filter(([k]) => k.startsWith('organizer_reports/'))
    expect(reports).toHaveLength(1)
    expect(reports[0][1]).toMatchObject({ organizer_id: 'org1', reporter_uid: 'u1', status: 'open' })
    expect(store.get('organizer_moderation/org1')?.open_reports_count).toBe(1)
    expect(store.get('users/org1')?.reports_count).toBeUndefined()

    const dup = await reportOrganizer(req({ reason: 'spam' }), params('org1'))
    expect((await dup.json()).duplicate).toBe(true)
    expect(store.get('organizer_moderation/org1')?.open_reports_count).toBe(1)
  })
})

describe('blocking', () => {
  it('filterBlockedEvents drops only the blocked organizers', () => {
    const events = [
      { id: 'a', organizer_id: 'org1' },
      { id: 'b', organizer_id: 'org2' },
      { id: 'c', organizer_id: null },
    ]
    expect(filterBlockedEvents(events, new Set(['org1'])).map((e) => e.id)).toEqual(['b', 'c'])
    expect(filterBlockedEvents(events, new Set())).toBe(events)
  })

  it('block stores the doc and removes the follow; unblock removes the doc', async () => {
    store.set('organizer_follows/f1', { follower_id: 'u1', organizer_id: 'org1' })
    store.set('organizer_follows/f2', { follower_id: 'someone', organizer_id: 'org1' })

    const res = await blockRoute(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ organizerId: 'org1' }) })
    expect(res.status).toBe(200)
    expect(store.has('users/u1/blocked_organizers/org1')).toBe(true)
    expect(store.has('organizer_follows/f1')).toBe(false)
    expect(store.has('organizer_follows/f2')).toBe(true)
    expect(Array.from(await getBlockedOrganizerIds('u1'))).toEqual(['org1'])

    const un = await unblockRoute(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ organizerId: 'org1' }) })
    expect(un.status).toBe(200)
    expect(store.has('users/u1/blocked_organizers/org1')).toBe(false)
  })

  it('refuses self-blocks and unauthenticated blocks', async () => {
    const ctx = { params: Promise.resolve({ organizerId: 'u1' }) }
    expect((await blockRoute(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(400)
    currentUser = null
    expect((await blockRoute(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ organizerId: 'org1' }) })).status).toBe(401)
  })

  it('the follow API will not re-follow a blocked organizer', async () => {
    await blockOrganizer('u1', 'org1')
    const res = await followRoute(req({ organizerId: 'org1' }))
    expect(res.status).toBe(409)
    expect(Array.from(store.keys()).some((k) => k.startsWith('organizer_follows/'))).toBe(false)
  })
})
