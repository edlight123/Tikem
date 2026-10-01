import {
  type HomeEvent,
  buildCityIndex,
  buildTickerSignals,
  buildWeek,
  buildWorlds,
  inCity,
  pickHeroEvents,
  resolveActiveCity,
  startingSoon,
  toHomeEvent,
  blurbFrom,
  validZone,
} from '@/lib/home/feed'
import { eventWhen } from '@/lib/home/format'
import { normalizeCountry, resolveCountry } from '@/lib/home/country'
import fs from 'node:fs'
import path from 'node:path'

const NOW = Date.parse('2026-10-01T03:00:00Z')
const H = 3_600_000

let seq = 0
function ev(over: Partial<HomeEvent> & { startIn?: number } = {}): HomeEvent {
  const { startIn = 24 * H, ...rest } = over
  seq += 1
  return {
    id: `e${seq}`,
    title: `EVENT ${seq}`,
    blurb: '',
    category: 'Party',
    venue_name: 'Venue',
    city: 'Port-au-Prince',
    country: 'HT',
    start_datetime: new Date(NOW + startIn).toISOString(),
    end_datetime: null,
    banner_image_url: 'https://example.com/p.jpg',
    ticket_price: 1000,
    currency: 'HTG',
    tickets_sold: 0,
    total_tickets: 0,
    featured: false,
    lineup: [],
    ...rest,
  }
}

describe('ticker signals are only ever true', () => {
  it('says nothing when nothing is happening', () => {
    expect(buildTickerSignals([ev(), ev({ tickets_sold: 3, total_tickets: 300 })], NOW)).toEqual([])
  })

  it('reports live, scarcity and momentum from stored numbers', () => {
    const live = ev({ startIn: -1 * H })
    const left = ev({ tickets_sold: 290, total_tickets: 300 })
    const fast = ev({ tickets_sold: 220, total_tickets: 300 })
    const going = ev({ tickets_sold: 40, total_tickets: 1000 })
    const soldOut = ev({ tickets_sold: 300, total_tickets: 300 })
    const s = buildTickerSignals([going, fast, left, live, soldOut], NOW)
    expect(s.map((x) => x.kind)).toEqual(['live', 'left', 'selling_fast', 'going'])
    expect(s[1]).toMatchObject({ n: 10 })
    expect(s[3]).toMatchObject({ n: 40 })
  })

  it('needs both a low count and a low share before "left"', () => {
    // 20 left of 5,000 is low in count and share; 20 left of 60 is a third of the room.
    expect(buildTickerSignals([ev({ tickets_sold: 4980, total_tickets: 5000 })], NOW)[0].kind).toBe('left')
    expect(buildTickerSignals([ev({ tickets_sold: 40, total_tickets: 60 })], NOW).map((s) => s.kind)).toEqual([
      'going',
    ])
  })

  it('ignores events far in the future', () => {
    expect(buildTickerSignals([ev({ startIn: 60 * 24 * H, tickets_sold: 500 })], NOW)).toEqual([])
  })
})

describe('cities', () => {
  it('rolls subdivisions up to their metro and folds accents', () => {
    const list = [
      ev({ city: 'Pétion-Ville' }),
      ev({ city: 'Port-au-Prince' }),
      ev({ city: 'Montreal', country: 'CA' }),
      ev({ city: 'Montréal', country: 'CA' }),
      ev({ city: 'Miami', country: 'US' }),
    ]
    const cities = buildCityIndex(list)
    expect(cities.map((c) => [c.name, c.count])).toEqual([
      ['Montréal', 2],
      ['Port-au-Prince', 2],
      ['Miami', 1],
    ])
    expect(list.filter((e) => inCity(e, 'port-au-prince'))).toHaveLength(2)
  })

  it('opens on ?city=, then saved, then detected — only cities that have events', () => {
    const cities = buildCityIndex([ev({ city: 'Miami', country: 'US' }), ev({ city: 'Paris', country: 'FR' })])
    expect(resolveActiveCity(cities, 'all', 'Miami')).toBeNull()
    expect(resolveActiveCity(cities, 'paris', 'Miami')?.name).toBe('Paris')
    expect(resolveActiveCity(cities, undefined, 'Jacmel', 'Miami, FL')?.name).toBe('Miami')
    expect(resolveActiveCity(cities, undefined, '', '')).toBeNull()
  })
})

describe('hero', () => {
  it('leads with admin picks, then the most-sold, and requires artwork', () => {
    const plain = ev({ startIn: 2 * H })
    const popular = ev({ startIn: 100 * H, tickets_sold: 80 })
    const pick = ev({ startIn: 200 * H, featured: true })
    const noArt = ev({ featured: true, banner_image_url: null })
    expect(pickHeroEvents([plain, popular, pick, noArt], NOW).map((e) => e.id)).toEqual([
      pick.id,
      popular.id,
      plain.id,
    ])
  })
})

describe('this week', () => {
  it('buckets on the reader’s calendar, not UTC, and marks today', () => {
    // 22:30 in Port-au-Prince on Oct 1 is 02:30 UTC on Oct 2 — still Oct 1 there.
    const late = ev({ start_datetime: '2026-10-02T02:30:00Z' })
    const sat = ev({ start_datetime: '2026-10-03T20:00:00Z' })
    const week = buildWeek([late, sat], NOW, 'America/Port-au-Prince')
    expect(week).toHaveLength(7)
    expect(week[0]).toMatchObject({ date: '2026-09-30', isToday: true, count: 0, top: null })
    expect(week.find((d) => d.date === '2026-10-01')?.count).toBe(1)
    expect(week.find((d) => d.date === '2026-10-03')?.top?.id).toBe(sat.id)
    // A reader in Paris is already on Oct 1.
    expect(buildWeek([late], NOW, 'Europe/Paris')[0].date).toBe('2026-10-01')
  })
})

describe('worlds and starting soon', () => {
  it('counts each world from canonical categories', () => {
    const worlds = buildWorlds([ev({ category: 'Party' }), ev({ category: 'Concert' }), ev({ category: 'Music' })])
    const byKey = Object.fromEntries(worlds.map((w) => [w.key, w.count]))
    expect(worlds).toHaveLength(8)
    expect(byKey['lavi-lannwit']).toBe(1)
    expect(byKey.espo).toBe(0)
  })

  it('keeps only the next 48 hours, soonest first, at most three', () => {
    const list = [ev({ startIn: 47 * H }), ev({ startIn: 49 * H }), ev({ startIn: 1 * H }), ev({ startIn: -1 * H })]
    expect(startingSoon(list, NOW).map((e) => e.start_datetime)).toEqual([
      list[2].start_datetime,
      list[0].start_datetime,
    ])
  })
})

describe('shaping', () => {
  it('reads the lineup and the featured star off the stored doc', () => {
    const e = toHomeEvent({
      id: 'x',
      title: ' T ',
      start_datetime: '2026-10-02T00:00:00Z',
      guestlist: ['Kai', { name: 'Tabou Combo' }, { name: '' }],
      is_featured: true,
    })
    expect(e).toMatchObject({ title: 'T', lineup: ['Kai', 'Tabou Combo'], featured: true, country: 'HT' })
    expect(toHomeEvent({ id: 'y' })).toBeNull()
  })

  it('keeps a description line only when it is one short sentence', () => {
    expect(blurbFrom('Konpa under the stars. Doors at 8.')).toBe('Konpa under the stars.')
    expect(blurbFrom('x'.repeat(200))).toBe('')
  })

  it('prints times in the zone it is given, whatever the machine', () => {
    expect(eventWhen('2026-10-03T20:00:00Z', 'Europe/Paris', 'en')).toBe('Sat Oct 3 · 10:00 PM')
    expect(eventWhen('2026-10-02T02:30:00Z', 'America/Port-au-Prince', 'en')).toBe('Thu Oct 1 · 10:30 PM')
    expect(validZone('America/Port-au-Prince')).toBe('America/Port-au-Prince')
    expect(validZone('Not/AZone')).toBeNull()
  })
})

describe('country scope', () => {
  it('takes the first usable answer, then Haiti', () => {
    expect(resolveCountry('us', 'FR', 'CA', 'HT')).toBe('US')
    expect(resolveCountry('abroad', null, undefined, 'fr')).toBe('FR')
    expect(resolveCountry('XX', 'DE', null, null)).toBe('HT')
    expect(normalizeCountry(' ca ')).toBe('CA')
  })
})

describe('homepage copy sets no em dashes', () => {
  // Owner rule: the homepage uses periods, commas, colons or a middle dot.
  // Covers every locale string this page renders.
  const flat = (o: any, p = ''): [string, string][] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, String(v)] as [string, string]]
    )
  it.each(['en', 'fr', 'ht'])('%s', (lang) => {
    const d = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/locales', lang, 'common.json'), 'utf8'))
    const rendered: [string, string][] = [
      ...flat(d.home, 'home.').filter(([k]) =>
        /^home\.(ticker|city|country|hero|week|worlds|soon|org|elsewhere|empty|see_all)/.test(k)
      ),
      ...flat(d.worlds, 'worlds.'),
      ['events.hero_tagline', d.events.hero_tagline],
      ['events.get_tickets', d.events.get_tickets],
    ]
    expect(rendered.filter(([, v]) => v.includes('—'))).toEqual([])
  })

  it('strips them from an organizer blurb too', () => {
    expect(blurbFrom('Rhum arrangé — and a live trio.')).toBe('Rhum arrangé, and a live trio.')
  })
})
