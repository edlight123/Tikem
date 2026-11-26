// "new on Tikèm" (ported from Tikra's "new on tikra" rail): the website's
// lib/home/new-on-tikem and the app's mobile/lib/newOnTikem must pick the same
// events, so every rule runs against both.
import { addedAtMs, isPubliclyListed, selectNewOnTikem, NEW_MIN } from '@/lib/home/new-on-tikem'
import { selectNewOnTikem as appSelect, addedAtMs as appAddedAtMs } from '@/mobile/lib/newOnTikem'

const now = Date.parse('2026-11-25T18:00:00.000Z')
const day = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

function ev(id: string, over: Record<string, any> = {}) {
  return {
    id,
    title: `Event ${id}`,
    organizer_id: `org-${id}`,
    is_published: true,
    country: 'HT',
    city: 'Port-au-Prince',
    start_datetime: iso(now + 20 * day),
    created_at: iso(now - day),
    ...over,
  }
}

describe.each([
  ['web', selectNewOnTikem],
  ['app', appSelect],
])('%s selectNewOnTikem', (_label, select) => {
  const pick = (events: any[], opts: Record<string, any> = {}) =>
    select(events, { now, country: 'HT', min: 1, ...opts }).map((e: any) => e.id)

  it('orders by when the event was added, newest first, not by its date', () => {
    const list = [
      ev('older', { created_at: iso(now - 5 * day), start_datetime: iso(now + 2 * day) }),
      ev('newest', { created_at: iso(now - 60_000), start_datetime: iso(now + 60 * day) }),
      ev('middle', { created_at: iso(now - 2 * day) }),
    ]
    expect(pick(list)).toEqual(['newest', 'middle', 'older'])
  })

  it('reads a Firestore Timestamp, {seconds}, a Date, and prefers published_at', () => {
    const list = [
      ev('ts', { created_at: { toDate: () => new Date(now - 3 * day) } }),
      ev('secs', { created_at: { seconds: Math.floor((now - 4 * day) / 1000) } }),
      ev('date', { created_at: new Date(now - 5 * day), start_datetime: new Date(now + 9 * day) }),
      ev('published', { created_at: iso(now - 30 * day), published_at: iso(now - 2 * day) }),
    ]
    expect(pick(list)).toEqual(['published', 'ts', 'secs', 'date'])
  })

  it('keeps events not over, newest-added window first', () => {
    const list = [
      ev('stale', { created_at: iso(now - 15 * day) }),
      ev('future-stamp', { created_at: iso(now + day) }),
      ev('over', { start_datetime: iso(now - 5 * 3600_000), end_datetime: iso(now - 3600_000) }),
      ev('running', { start_datetime: iso(now - 3600_000), end_datetime: iso(now + 3600_000) }),
      ev('undated', { start_datetime: null }),
      ev('fresh'),
    ]
    // Added at the same time: the sooner one first. The rail is thin, so it
    // widens past two weeks and the 15-day-old event joins, after the new ones.
    expect(pick(list)).toEqual(['running', 'fresh', 'stale'])
    // With a fixed two-week window, only the last two weeks.
    expect(pick(list, { windowMs: 14 * day })).toEqual(['running', 'fresh'])
  })

  it('widens 14 → 30 → 60 days → any age while under eight, and stops once full', () => {
    const old = (n: number, ageDays: number) =>
      Array.from({ length: n }, (_, i) => ev(`d${ageDays}-${i}`, { created_at: iso(now - ageDays * day - i * 60_000) }))
    // Two this fortnight, three at 20 days, four at 45: widens to 60 days.
    const thin = [...old(2, 1), ...old(3, 20), ...old(4, 45)]
    expect(pick(thin)).toHaveLength(9)
    // Nine this fortnight: no widening, the 20-day-old ones stay out.
    const full = [...old(9, 1), ...old(3, 20)]
    expect(pick(full).every((id) => id.startsWith('d1-'))).toBe(true)
    // Only very old events: any age.
    expect(pick(old(3, 200))).toHaveLength(3)
  })

  it('never shows a draft, rejected, held, unlisted, cancelled or sample event', () => {
    const list = [
      ev('draft', { is_published: false }),
      ev('rejected', { rejected: true }),
      ev('held', { hidden_pending_review: true }),
      ev('unlisted', { show_on_explore: false }),
      ev('cancelled', { status: 'cancelled' }),
      ev('template', { is_template: true }),
      ev('tagged', { tags: ['Template'] }),
      ev('seeded', { seed_batch: 'free-templates-ht' }),
      ev('ok', { status: 'published' }),
    ]
    expect(pick(list)).toEqual(['ok'])
  })

  it('stays in the browsed country (missing reads as Haiti) and the given area', () => {
    const list = [
      ev('pap'),
      ev('cap', { city: 'Cap-Haïtien' }),
      ev('miami', { country: 'US', city: 'Miami' }),
      ev('legacy', { country: undefined }),
    ]
    expect(pick(list).sort()).toEqual(['cap', 'legacy', 'pap'])
    expect(pick(list, { country: 'us' })).toEqual(['miami'])
    expect(pick(list, { inArea: (e: any) => e.city === 'Port-au-Prince' }).sort()).toEqual(['legacy', 'pap'])
  })

  it('shows a recurring series once, at its next date, ranked by its newest addition', () => {
    const series = [3, 10, 17].map((d) =>
      ev(`s${d}`, { series_id: 'weekly', organizer_id: 'o', start_datetime: iso(now + d * day), created_at: iso(now - d * 3600_000) })
    )
    expect(pick([...series, ev('solo', { created_at: iso(now - 5 * 3600_000) })])).toEqual(['s3', 'solo'])
    // Another organizer's copy of the series id is not merged into it.
    expect(pick([...series, ev('copy', { series_id: 'weekly', organizer_id: 'x' })]).sort()).toEqual(['copy', 's3'])
  })

  it('caps the rail and hides it under the minimum', () => {
    const many = Array.from({ length: 20 }, (_, i) => ev(`e${i}`, { created_at: iso(now - i * 3600_000) }))
    expect(pick(many, { max: 5 })).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    expect(select(many, { now, country: 'HT' })).toHaveLength(12)
    expect(NEW_MIN).toBe(2)
    expect(select(many.slice(0, 1), { now, country: 'HT' })).toEqual([])
    expect(select(many.slice(0, 2), { now, country: 'HT' })).toHaveLength(2)
  })

  it('skips duplicates and rows without an id', () => {
    expect(pick([ev('a'), ev('a', { title: 'again' }), { ...ev(''), id: '' }])).toEqual(['a'])
  })
})

describe('helpers', () => {
  it('addedAtMs prefers published_at, falls back to created_at, else NaN (web and app)', () => {
    for (const f of [addedAtMs, appAddedAtMs]) {
      expect(f({ created_at: iso(now) })).toBe(now)
      expect(f({ published_at: iso(now - day), created_at: iso(now - 9 * day) })).toBe(now - day)
      expect(Number.isNaN(f({}))).toBe(true)
    }
  })
  it('isPubliclyListed needs is_published === true', () => {
    expect(isPubliclyListed({ is_published: true })).toBe(true)
    expect(isPubliclyListed({ is_published: 'true' })).toBe(false)
    expect(isPubliclyListed({})).toBe(false)
    expect(isPubliclyListed(null)).toBe(false)
  })
})
