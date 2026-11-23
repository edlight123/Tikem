/** @jest-environment node */
import {
  eventViewTimezone,
  isViewableEvent,
  normalizeDeviceId,
  recordEventView,
  viewDayKey,
  viewDedupeId,
  viewerKey,
  VIEW_SEEN_TTL_MS,
  type RecordViewDeps,
} from '@/lib/events/views'

const DEVICE = 'a1b2c3d4e5f6a7b8c9d0e1f2'
const published = { is_published: true, organizer_id: 'org1', timezone: 'America/Port-au-Prince' }

function makeDeps(event: Record<string, any> | null = published, opts: { team?: string[] } = {}) {
  const seen = new Set<string>()
  const increments: Array<{ eventId: string; day: string }> = []
  const claims: Array<{ id: string; expiresAt: Date }> = []
  const deps: RecordViewDeps = {
    loadEvent: jest.fn(async () => event),
    isTeamMember: jest.fn(async (_org: string, uid: string) => (opts.team || []).includes(uid)),
    claimDedupe: jest.fn(async (id: string, expiresAt: Date) => {
      claims.push({ id, expiresAt })
      if (seen.has(id)) return false
      seen.add(id)
      return true
    }),
    increment: jest.fn(async (eventId: string, day: string) => {
      increments.push({ eventId, day })
    }),
    now: () => new Date('2026-11-22T15:00:00Z'),
  }
  return { deps, increments, claims }
}

describe('viewer key', () => {
  it('prefers the uid, then the app device id, then the web cookie', () => {
    expect(viewerKey({ uid: 'u1', deviceId: DEVICE, cookieId: DEVICE })).toBe('u:u1')
    expect(viewerKey({ deviceId: DEVICE, cookieId: 'b'.repeat(32) })).toBe(`d:${DEVICE}`)
    expect(viewerKey({ cookieId: 'b'.repeat(32) })).toBe(`c:${'b'.repeat(32)}`)
    expect(viewerKey({})).toBeNull()
  })

  it('rejects junk device ids', () => {
    expect(normalizeDeviceId('short')).toBeNull()
    expect(normalizeDeviceId('has spaces in it here ok')).toBeNull()
    expect(normalizeDeviceId('x'.repeat(65))).toBeNull()
    expect(normalizeDeviceId(42)).toBeNull()
    expect(normalizeDeviceId(DEVICE)).toBe(DEVICE)
  })
})

describe('dedupe id', () => {
  it('is a stable hash that never contains the viewer id', () => {
    const id = viewDedupeId('ev1', 'u:alice', '2026-11-22')
    expect(id).toMatch(/^[0-9a-f]{40}$/)
    expect(id).toBe(viewDedupeId('ev1', 'u:alice', '2026-11-22'))
    expect(id).not.toContain('alice')
  })

  it('differs per event, per viewer and per day', () => {
    const base = viewDedupeId('ev1', 'u:alice', '2026-11-22')
    expect(viewDedupeId('ev2', 'u:alice', '2026-11-22')).not.toBe(base)
    expect(viewDedupeId('ev1', 'u:bob', '2026-11-22')).not.toBe(base)
    expect(viewDedupeId('ev1', 'u:alice', '2026-11-23')).not.toBe(base)
  })
})

describe('day key and timezone', () => {
  it('uses the event timezone for the day boundary', () => {
    const lateEvening = new Date('2026-11-23T02:00:00Z') // 21:00 on the 22nd in Port-au-Prince
    expect(viewDayKey(lateEvening, 'America/Port-au-Prince')).toBe('2026-11-22')
    expect(viewDayKey(lateEvening, 'UTC')).toBe('2026-11-23')
  })

  it('falls back to the market timezone, then Eastern, on missing or bad zones', () => {
    expect(eventViewTimezone({ timezone: 'Europe/Paris' })).toBe('Europe/Paris')
    expect(eventViewTimezone({ timezone: 'Not/AZone', country: 'HT' }, (c) => (c === 'HT' ? 'America/Port-au-Prince' : null))).toBe(
      'America/Port-au-Prince',
    )
    expect(eventViewTimezone({})).toBe('America/New_York')
  })
})

describe('viewable events', () => {
  it('counts published events only', () => {
    expect(isViewableEvent({ is_published: true })).toBe(true)
    expect(isViewableEvent({ status: 'published' })).toBe(true)
    expect(isViewableEvent({ is_published: false, status: 'draft' })).toBe(false)
    expect(isViewableEvent({ is_published: true, rejected: true })).toBe(false)
    expect(isViewableEvent({ is_published: true, hidden_pending_review: true })).toBe(false)
    expect(isViewableEvent(null)).toBe(false)
  })
})

describe('recordEventView', () => {
  it('counts a first view and dedupes the same viewer the same day', async () => {
    const { deps, increments, claims } = makeDeps()
    expect(await recordEventView({ eventId: 'ev1', deviceId: DEVICE }, deps)).toBe('counted')
    expect(await recordEventView({ eventId: 'ev1', deviceId: DEVICE }, deps)).toBe('deduped')
    expect(increments).toEqual([{ eventId: 'ev1', day: '2026-11-22' }])
    expect(claims[0].expiresAt.getTime() - new Date('2026-11-22T15:00:00Z').getTime()).toBe(VIEW_SEEN_TTL_MS)
  })

  it('counts different viewers separately', async () => {
    const { deps, increments } = makeDeps()
    await recordEventView({ eventId: 'ev1', deviceId: DEVICE }, deps)
    await recordEventView({ eventId: 'ev1', uid: 'fan1' }, deps)
    await recordEventView({ eventId: 'ev1', cookieId: 'c'.repeat(32) }, deps)
    expect(increments).toHaveLength(3)
  })

  it('counts the same viewer again on a new day', async () => {
    const { deps, increments } = makeDeps()
    await recordEventView({ eventId: 'ev1', uid: 'fan1' }, deps)
    deps.now = () => new Date('2026-11-23T15:00:00Z')
    expect(await recordEventView({ eventId: 'ev1', uid: 'fan1' }, deps)).toBe('counted')
    expect(increments.map((i) => i.day)).toEqual(['2026-11-22', '2026-11-23'])
  })

  it("never counts the organizer's or their team's own views", async () => {
    const { deps, increments } = makeDeps(published, { team: ['staff1'] })
    expect(await recordEventView({ eventId: 'ev1', uid: 'org1' }, deps)).toBe('own')
    expect(await recordEventView({ eventId: 'ev1', uid: 'staff1', deviceId: DEVICE }, deps)).toBe('own')
    expect(increments).toHaveLength(0)
    expect(deps.claimDedupe).not.toHaveBeenCalled()
  })

  it('ignores drafts, missing events, bad ids and anonymous callers with no id', async () => {
    expect(await recordEventView({ eventId: 'ev1', deviceId: DEVICE }, makeDeps({ is_published: false }).deps)).toBe('not_public')
    expect(await recordEventView({ eventId: 'ev1', deviceId: DEVICE }, makeDeps(null).deps)).toBe('not_public')
    const { deps } = makeDeps()
    expect(await recordEventView({ eventId: '../etc', deviceId: DEVICE }, deps)).toBe('invalid')
    expect(await recordEventView({ eventId: 'ev1' }, deps)).toBe('no_viewer')
    expect(deps.loadEvent).not.toHaveBeenCalled()
  })
})
