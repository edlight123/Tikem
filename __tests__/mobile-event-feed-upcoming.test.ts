/**
 * mobile/lib/api/eventFeed — the Home/Discover/Search fetch reads the UPCOMING
 * window soonest-first, once per stored type of start_datetime (Timestamp and
 * ISO string), and falls back to the old unordered country read while the
 * ordered index is not deployed.
 */

jest.mock('../mobile/config/firebase', () => ({ db: { __db: true } }))

const getDocs = jest.fn()
// The mobile app resolves its own copy of the SDK (mobile/node_modules).
jest.mock('../mobile/node_modules/firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ collection: name }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir: string) => ({ kind: 'orderBy', field, dir }),
  limit: (n: number) => ({ kind: 'limit', n }),
  query: (_col: unknown, ...clauses: any[]) => ({ clauses }),
  getDocs: (...args: unknown[]) => getDocs(...args),
}))

import {
  fetchPublishedEventsForCountryWithMeta,
  isMissingIndexError,
  mergeUpcomingEvents,
  UPCOMING_LOOKBACK_MS,
} from '../mobile/lib/api/eventFeed'

const NOW = new Date('2026-11-23T12:00:00Z')
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * 86_400_000).toISOString()
const ts = (offsetDays: number) => {
  const d = new Date(NOW.getTime() + offsetDays * 86_400_000)
  return { toDate: () => d, seconds: Math.floor(d.getTime() / 1000) }
}
const doc = (id: string, data: Record<string, any>) => ({ id, data: () => data })
const snap = (docs: any[], fromCache = false) => ({ docs, metadata: { fromCache } })

/** Which typed read a mocked getDocs call is: 'ts' | 'iso' | 'base'. */
function readKind(q: any): 'ts' | 'iso' | 'base' {
  const range = q.clauses.find((c: any) => c.kind === 'where' && c.field === 'start_datetime')
  if (!range) return 'base'
  return typeof range.value === 'string' ? 'iso' : 'ts'
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW)
  getDocs.mockReset()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  ;(console.warn as jest.Mock).mockRestore?.()
})

describe('mergeUpcomingEvents', () => {
  const since = new Date(NOW.getTime() - UPCOMING_LOOKBACK_MS)

  it('merges Timestamp- and string-dated lists into one soonest-first order', () => {
    const out = mergeUpcomingEvents(
      [
        [doc('t1', { start_datetime: ts(1) }), doc('t3', { start_datetime: ts(3) })],
        [doc('s2', { start_datetime: iso(2) }), doc('s4', { start_datetime: iso(4) })],
      ],
      since
    )
    expect(out.map((e) => e.id)).toEqual(['t1', 's2', 't3', 's4'])
    expect(out.every((e) => e.start_datetime instanceof Date)).toBe(true)
  })

  it('de-dupes by id (first copy wins)', () => {
    const out = mergeUpcomingEvents(
      [[doc('a', { start_datetime: ts(1), title: 'first' })], [doc('a', { start_datetime: iso(1), title: 'second' })]],
      since
    )
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('first')
  })

  it('drops undated events and events that started before the window', () => {
    const out = mergeUpcomingEvents(
      [[doc('old', { start_datetime: iso(-30) }), doc('none', {}), doc('ongoing', { start_datetime: iso(-2) })]],
      since
    )
    expect(out.map((e) => e.id)).toEqual(['ongoing'])
  })

  it('caps at max AFTER sorting so the overall soonest survive', () => {
    const out = mergeUpcomingEvents(
      [
        [doc('t5', { start_datetime: ts(5) }), doc('t6', { start_datetime: ts(6) })],
        [doc('s1', { start_datetime: iso(1) }), doc('s2', { start_datetime: iso(2) })],
      ],
      since,
      3
    )
    expect(out.map((e) => e.id)).toEqual(['s1', 's2', 't5'])
  })

  it('converts end_datetime too', () => {
    const [e] = mergeUpcomingEvents([[doc('x', { start_datetime: iso(1), end_datetime: ts(2) })]], since)
    expect(e.end_datetime).toBeInstanceOf(Date)
  })
})

describe('isMissingIndexError', () => {
  it('recognises failed-precondition and the index message', () => {
    expect(isMissingIndexError({ code: 'failed-precondition' })).toBe(true)
    expect(isMissingIndexError({ message: 'The query requires an index. You can create it here: …' })).toBe(true)
    expect(isMissingIndexError({ code: 'permission-denied' })).toBe(false)
    expect(isMissingIndexError(null)).toBe(false)
  })
})

describe('fetchPublishedEventsForCountryWithMeta', () => {
  it('runs one ordered upcoming read per start_datetime type and merges them', async () => {
    getDocs.mockImplementation(async (q: any) => {
      const kind = readKind(q)
      if (kind === 'ts') return snap([doc('t2', { start_datetime: ts(2) })])
      if (kind === 'iso') return snap([doc('s1', { start_datetime: iso(1) })])
      throw new Error('unexpected base read')
    })

    const { events, fromCache } = await fetchPublishedEventsForCountryWithMeta('ht')

    expect(events.map((e) => e.id)).toEqual(['s1', 't2'])
    expect(fromCache).toBe(false)
    expect(getDocs).toHaveBeenCalledTimes(2)
    for (const [q] of getDocs.mock.calls) {
      expect(q.clauses).toEqual(
        expect.arrayContaining([
          { kind: 'where', field: 'is_published', op: '==', value: true },
          { kind: 'where', field: 'country', op: '==', value: 'HT' },
          { kind: 'orderBy', field: 'start_datetime', dir: 'asc' },
          { kind: 'limit', n: 50 },
        ])
      )
    }
    const bounds = getDocs.mock.calls.map(([q]: any) => q.clauses.find((c: any) => c.field === 'start_datetime').value)
    expect(bounds.some((b: unknown) => b instanceof Date)).toBe(true)
    expect(bounds.some((b: unknown) => typeof b === 'string')).toBe(true)
  })

  it('reports fromCache when either read came from the local cache (offline)', async () => {
    getDocs.mockImplementation(async (q: any) => snap([], readKind(q) === 'iso'))
    const { events, fromCache } = await fetchPublishedEventsForCountryWithMeta('HT')
    expect(events).toEqual([])
    expect(fromCache).toBe(true)
  })

  it('falls back to the unordered country read, filtered and sorted, when the index is missing', async () => {
    getDocs.mockImplementation(async (q: any) => {
      if (readKind(q) !== 'base') {
        throw Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' })
      }
      return snap(
        [
          doc('later', { start_datetime: ts(9) }),
          doc('past', { start_datetime: iso(-60) }),
          doc('soon', { start_datetime: iso(1) }),
        ],
        true
      )
    })

    const { events, fromCache } = await fetchPublishedEventsForCountryWithMeta('HT')

    expect(events.map((e) => e.id)).toEqual(['soon', 'later'])
    expect(fromCache).toBe(true)
    const base = getDocs.mock.calls.map(([q]: any) => q).find((q: any) => readKind(q) === 'base')
    expect(base.clauses.some((c: any) => c.kind === 'orderBy')).toBe(false)
  })

  it('does NOT swallow other errors', async () => {
    getDocs.mockRejectedValue(Object.assign(new Error('nope'), { code: 'permission-denied' }))
    await expect(fetchPublishedEventsForCountryWithMeta('HT')).rejects.toThrow('nope')
  })

  it('still refuses a blank country', async () => {
    await expect(fetchPublishedEventsForCountryWithMeta('  ')).rejects.toThrow(/country code is required/)
    expect(getDocs).not.toHaveBeenCalled()
  })
})
