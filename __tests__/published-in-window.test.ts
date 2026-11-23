import { mergeWindowRows, readPublishedEventsInWindow } from '@/lib/events/published-in-window'

const FROM = new Date('2026-11-23T00:00:00Z')
const TO = new Date('2026-12-07T00:00:00Z')
const at = (d: string) => new Date(d)
const ts = (d: string) => ({ toDate: () => new Date(d) })
const doc = (id: string, data: Record<string, any>) => ({ id, data: () => data })

/** A tiny adminDb stand-in recording each query's clauses. */
function fakeDb(handler: (clauses: any[]) => Promise<{ docs: any[]; size: number }>) {
  const calls: any[][] = []
  const make = (clauses: any[]): any => ({
    where: (f: string, op: string, v: unknown) => make([...clauses, ['where', f, op, v]]),
    orderBy: (f: string, dir: string) => make([...clauses, ['orderBy', f, dir]]),
    limit: (n: number) => make([...clauses, ['limit', n]]),
    get: () => {
      calls.push(clauses)
      return handler(clauses)
    },
  })
  return { db: { collection: () => make([]) }, calls }
}
const kind = (clauses: any[]) => {
  const lo = clauses.find((c) => c[0] === 'where' && c[1] === 'start_datetime' && c[2] === '>=')
  return !lo ? 'base' : typeof lo[3] === 'string' ? 'iso' : 'ts'
}

describe('mergeWindowRows', () => {
  it('merges both types, de-dupes, keeps the window and sorts soonest first', () => {
    const out = mergeWindowRows(
      [
        [doc('t2', { start_datetime: ts('2026-11-26T00:00:00Z') }), doc('dup', { start_datetime: ts('2026-11-24T00:00:00Z') })],
        [
          doc('s1', { start_datetime: '2026-11-25T00:00:00Z' }),
          doc('dup', { start_datetime: '2026-11-24T00:00:00Z' }),
          doc('past', { start_datetime: '2026-10-01T00:00:00Z' }),
          doc('far', { start_datetime: '2027-01-01T00:00:00Z' }),
          doc('undated', {}),
        ],
      ],
      FROM,
      TO
    )
    expect(out.map((e) => e.id)).toEqual(['dup', 's1', 't2'])
  })
})

describe('readPublishedEventsInWindow', () => {
  it('reads the window once per start_datetime type, ordered and limited', async () => {
    const { db, calls } = fakeDb(async (clauses) => {
      const k = kind(clauses)
      if (k === 'ts') return { docs: [doc('t', { start_datetime: ts('2026-11-30T00:00:00Z') })], size: 1 }
      if (k === 'iso') return { docs: [doc('s', { start_datetime: '2026-11-24T00:00:00Z' })], size: 1 }
      throw new Error('base read not expected')
    })
    const res = await readPublishedEventsInWindow(db, FROM, TO, 100)
    expect(res.events.map((e) => e.id)).toEqual(['s', 't'])
    expect(res.truncated).toBe(false)
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c).toEqual(expect.arrayContaining([['orderBy', 'start_datetime', 'asc'], ['limit', 100]]))
    }
    expect(calls.map(kind).sort()).toEqual(['iso', 'ts'])
    const tsLo = calls.find((c) => kind(c) === 'ts')!.find((x: any) => x[2] === '>=')[3]
    expect(tsLo).toBeInstanceOf(Date)
    expect((tsLo as Date).getTime()).toBe(at('2026-11-23T00:00:00Z').getTime())
  })

  it('reports truncated when a typed read hits max', async () => {
    const { db } = fakeDb(async () => ({ docs: [], size: 5 }))
    expect((await readPublishedEventsInWindow(db, FROM, TO, 5)).truncated).toBe(true)
  })

  it('falls back to the unordered read filtered in memory when a typed read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = fakeDb(async (clauses) => {
      if (kind(clauses) !== 'base') throw Object.assign(new Error('needs index'), { code: 9 })
      return {
        docs: [
          doc('late', { start_datetime: '2026-12-01T00:00:00Z' }),
          doc('old', { start_datetime: ts('2025-01-01T00:00:00Z') }),
          doc('early', { start_datetime: ts('2026-11-24T00:00:00Z') }),
        ],
        size: 3,
      }
    })
    const res = await readPublishedEventsInWindow(db, FROM, TO, 100)
    expect(res.events.map((e) => e.id)).toEqual(['early', 'late'])
    expect(calls.some((c) => kind(c) === 'base')).toBe(true)
    warn.mockRestore()
  })
})
