import fs from 'node:fs'
import path from 'node:path'
import {
  HOME_OCCASION_MIN_EVENTS,
  OCCASIONS,
  OCCASION_IDEAS,
  OCCASION_KEYS,
  eventTaggedFor,
  homeOccasion,
  ideaDate,
  occasionEvents,
  occasionRange,
  occasionWindow,
  occasionsOn,
  parseOccasion,
  suggestOccasion,
} from '@/lib/occasions'
import * as mobile from '../mobile/lib/occasions'
import { NATIONAL_DAYS } from '@/lib/nationalDays'

const root = process.cwd()

describe('occasions: the two copies', () => {
  it('web and mobile files are byte-identical', () => {
    const web = fs.readFileSync(path.join(root, 'lib/occasions.ts'), 'utf8')
    const mob = fs.readFileSync(path.join(root, 'mobile/lib/occasions.ts'), 'utf8')
    expect(mob).toBe(web)
    expect(mobile.suggestOccasion('2027-02-08')).toBe('kanaval')
  })
})

describe('the list', () => {
  it('has unique keys, names and blurbs in en/fr/ht, no em dashes', () => {
    expect(new Set(OCCASION_KEYS).size).toBe(OCCASIONS.length)
    for (const o of OCCASIONS) {
      for (const l of ['en', 'fr', 'ht'] as const) {
        expect(o.name[l].trim()).not.toBe('')
        expect(o.blurb[l].trim()).not.toBe('')
        expect(o.name[l] + o.blurb[l]).not.toMatch(/—/)
      }
    }
  })

  it('every web photo exists in public/, and is a real photo (not art)', () => {
    for (const o of OCCASIONS) {
      expect(fs.existsSync(path.join(root, 'public', o.webPhoto))).toBe(true)
      expect(o.photo.startsWith('photo-')).toBe(true)
    }
  })

  it('a linked national day is a real one', () => {
    const tags = new Set(NATIONAL_DAYS.map((d) => d.eventTag))
    for (const o of OCCASIONS) if (o.nationalDay) expect(tags.has(o.nationalDay)).toBe(true)
  })

  it('firestore.rules allow exactly these keys', () => {
    const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
    const m = /function validOccasion\(d\)[\s\S]*?in \[([^\]]*)\]/.exec(rules)
    expect(m).not.toBeNull()
    const keys = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
    expect(keys.sort()).toEqual([...OCCASION_KEYS].sort())
  })
})

describe('tagging validation', () => {
  it('parseOccasion is the allow-list', () => {
    expect(parseOccasion('kanaval')).toBe('kanaval')
    expect(parseOccasion('fet-manman')).toBe('fet-manman')
    expect(parseOccasion('Kanaval')).toBeNull()
    expect(parseOccasion('ramadan')).toBeNull()
    expect(parseOccasion('')).toBeNull()
    expect(parseOccasion(null)).toBeNull()
    expect(parseOccasion(42)).toBeNull()
    expect(parseOccasion({ key: 'kanaval' })).toBeNull()
  })

  it('an event tagged for the linked national day counts', () => {
    expect(eventTaggedFor({ occasion: 'kanaval' }, 'kanaval')).toBe(true)
    expect(eventTaggedFor({ national_day: 'kanaval' }, 'kanaval')).toBe(true)
    expect(eventTaggedFor({ national_day: 'flag' }, 'fet-drapo')).toBe(true)
    expect(eventTaggedFor({ national_day: 'flag' }, 'heritage-month')).toBe(false)
    expect(eventTaggedFor({ occasion: 'rara' }, 'kanaval')).toBe(false)
  })
})

describe('Kanaval follows Easter', () => {
  // Easter 2026-04-05, 2027-03-28, 2028-04-16, 2029-04-01, 2030-04-21.
  const cases: Record<number, [string, string, string]> = {
    2026: ['2026-02-15', '2026-02-17', '2026-01-11'],
    2027: ['2027-02-07', '2027-02-09', '2027-01-10'],
    2028: ['2028-02-27', '2028-02-29', '2028-01-09'],
    2029: ['2029-02-11', '2029-02-13', '2029-01-07'],
    2030: ['2030-03-03', '2030-03-05', '2030-01-06'],
  }
  it.each(Object.entries(cases))('%s: dimanch gra to madi gra, pre-kanaval from the first Sunday after the Epiphany', (y, [sun, tue, pre]) => {
    const r = occasionRange('kanaval', Number(y))
    expect(r.mainStart).toBe(sun)
    expect(r.mainEnd).toBe(tue)
    expect(r.end).toBe(tue)
    expect(r.start).toBe(pre)
    expect(new Date(`${sun}T12:00:00Z`).getUTCDay()).toBe(0)
    expect(new Date(`${tue}T12:00:00Z`).getUTCDay()).toBe(2)
    expect(new Date(`${pre}T12:00:00Z`).getUTCDay()).toBe(0)
  })

  it('Rara runs Ash Wednesday to Easter Sunday', () => {
    expect(occasionRange('rara', 2027)).toMatchObject({ start: '2027-02-10', end: '2027-03-28' })
    expect(occasionRange('rara', 2026)).toMatchObject({ start: '2026-02-18', end: '2026-04-05' })
  })
})

describe('the other windows', () => {
  it('Fèt Manman is the last Sunday of May (with its weekend)', () => {
    expect(occasionRange('fet-manman', 2026)).toEqual({ start: '2026-05-29', end: '2026-05-31', mainStart: '2026-05-31', mainEnd: '2026-05-31' })
    expect(occasionRange('fet-manman', 2027).mainStart).toBe('2027-05-30')
    expect(occasionRange('fet-manman', 2028).mainStart).toBe('2028-05-28')
    expect(occasionRange('fet-manman', 2030).mainStart).toBe('2030-05-26')
  })

  it('Fèt Papa is the last Sunday of June', () => {
    expect(occasionRange('fet-papa', 2026).mainStart).toBe('2026-06-28')
    expect(occasionRange('fet-papa', 2030).mainStart).toBe('2030-06-30')
  })

  it('fixed days', () => {
    expect(occasionRange('fet-drapo', 2027)).toMatchObject({ start: '2027-05-18', end: '2027-05-18' })
    expect(occasionRange('fet-gede', 2027)).toMatchObject({ start: '2027-11-01', end: '2027-11-02' })
    expect(occasionRange('vertieres', 2027)).toMatchObject({ start: '2027-11-18', end: '2027-11-18' })
    expect(occasionRange('nwel', 2027)).toMatchObject({ start: '2027-12-24', end: '2027-12-25' })
    expect(occasionRange('fen-ane', 2027)).toMatchObject({ start: '2027-12-31', end: '2027-12-31' })
    expect(occasionRange('fet-endepandans', 2027)).toMatchObject({ start: '2027-01-01', end: '2027-01-02' })
    expect(occasionRange('heritage-month', 2027)).toMatchObject({ start: '2027-05-01', end: '2027-05-31' })
  })

  it('the window is the one under way, else the next', () => {
    expect(occasionWindow('vertieres', '2026-11-18').start).toBe('2026-11-18')
    expect(occasionWindow('vertieres', '2026-11-19').start).toBe('2027-11-18')
    expect(occasionWindow('kanaval', '2026-11-23').mainStart).toBe('2027-02-07')
    expect(occasionWindow('fet-endepandans', '2026-12-31').start).toBe('2027-01-01')
  })
})

describe('suggesting an occasion from the event date', () => {
  it('picks the most specific window holding the day', () => {
    expect(suggestOccasion('2027-02-08')).toBe('kanaval')
    expect(suggestOccasion('2027-01-17')).toBe('kanaval') // a pre-kanaval Sunday
    expect(suggestOccasion('2027-03-20')).toBe('rara')
    expect(suggestOccasion('2027-05-18')).toBe('fet-drapo') // beats Heritage Month
    expect(suggestOccasion('2027-05-30')).toBe('fet-manman')
    expect(suggestOccasion('2027-05-10')).toBe('heritage-month')
    expect(suggestOccasion('2027-07-16')).toBe('fet-chanpet')
    expect(suggestOccasion('2027-12-24')).toBe('nwel')
    expect(suggestOccasion('2027-12-31')).toBe('fen-ane')
    expect(suggestOccasion('2027-01-01')).toBe('fet-endepandans')
    expect(suggestOccasion('2027-10-05')).toBeNull()
    expect(suggestOccasion(null)).toBeNull()
    expect(occasionsOn('2027-05-18')).toEqual(['fet-drapo', 'heritage-month'])
  })

  it('reads the day in the given zone', () => {
    // 03:00 UTC on 19 Nov is still the 18th in Port-au-Prince.
    expect(suggestOccasion(new Date('2026-11-19T03:00:00Z'))).toBe('vertieres')
  })
})

describe('the occasion page events', () => {
  const ev = (id: string, start: string, extra: object = {}) => ({ id, start_datetime: start, ...extra })
  it('tagged first, then untagged ones on the main days of a short occasion', () => {
    const range = occasionRange('kanaval', 2027)
    const list = occasionEvents(
      [
        ev('untagged-gras', '2027-02-08T20:00:00-05:00'),
        ev('tagged', '2027-01-24T20:00:00-05:00', { occasion: 'kanaval' }),
        ev('untagged-prekanaval', '2027-01-24T20:00:00-05:00'),
        ev('nd', '2027-02-07T20:00:00-05:00', { national_day: 'kanaval' }),
      ],
      'kanaval',
      range
    )
    expect(list.map((e) => e.id)).toEqual(['tagged', 'nd', 'untagged-gras'])
  })

  it('a long season does not sweep in every untagged event', () => {
    const range = occasionRange('fet-chanpet', 2027)
    expect(occasionEvents([ev('x', '2027-07-16T15:00:00-04:00')], 'fet-chanpet', range)).toEqual([])
  })
})

describe('the Home row', () => {
  const ev = (id: string, occasion: string, start = '2027-02-07T20:00:00-05:00') => ({ id, occasion, start_datetime: start })

  it(`needs at least ${HOME_OCCASION_MIN_EVENTS} tagged events`, () => {
    expect(homeOccasion([ev('a', 'kanaval')], '2027-01-20')).toBeNull()
    const h = homeOccasion([ev('a', 'kanaval'), ev('b', 'kanaval')], '2027-01-20')
    expect(h?.key).toBe('kanaval')
    expect(h?.events.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('only within 30 days of the start, or under way', () => {
    const two = [ev('a', 'vertieres', '2027-11-18T18:00:00-05:00'), ev('b', 'vertieres', '2027-11-18T20:00:00-05:00')]
    expect(homeOccasion(two, '2027-10-01')).toBeNull()
    expect(homeOccasion(two, '2027-10-19')?.key).toBe('vertieres')
    expect(homeOccasion(two, '2027-11-18')?.key).toBe('vertieres')
    expect(homeOccasion(two, '2027-11-19')).toBeNull()
  })

  it('the soonest qualifying occasion wins, and the national day already on Home is skipped', () => {
    const events = [
      ev('n1', 'nwel', '2027-12-24T20:00:00-05:00'),
      ev('n2', 'nwel', '2027-12-25T12:00:00-05:00'),
      ev('f1', 'fen-ane', '2027-12-31T21:00:00-05:00'),
      ev('f2', 'fen-ane', '2027-12-31T22:00:00-05:00'),
    ]
    expect(homeOccasion(events, '2027-12-10')?.key).toBe('nwel')
    expect(homeOccasion(events, '2027-12-10', { skipNationalDay: 'noel' })?.key).toBe('fen-ane')
  })
})

describe('wiring', () => {
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

  it('both composers save the occasion through the allow-list', () => {
    expect(read('app/organizer/events/EventComposer.tsx')).toMatch(/occasion: parseOccasion\(occasion\)/)
    expect(read('mobile/screens/organizer/CreateEventFlowRefactored.tsx')).toMatch(/occasion: parseOccasion\(draft\.occasion\)/)
    expect(read('mobile/lib/api/events.ts')).toMatch(/occasion: parseOccasion\(eventData\.occasion\)/)
  })

  it('occasion links open the app: AASA, Android intent filters and the linking config', () => {
    expect(read('app/api/well-known/aasa/route.ts')).toMatch(/'\/occasions\/\*'/)
    const app = JSON.parse(read('mobile/app.json'))
    const prefixes = app.expo.android.intentFilters.flatMap((f: any) => f.data.map((d: any) => `${d.host}${d.pathPrefix}`))
    expect(prefixes).toEqual(expect.arrayContaining(['www.tikem.co/occasions/', 'tikem.co/occasions/']))
    expect(read('mobile/navigation/linkingConfig.ts')).toMatch(/Occasion: 'occasions\/:key'/)
  })
})

describe('ideas', () => {
  it('are few, valid and land inside or near their occasion, never in the past', () => {
    expect(OCCASION_IDEAS.length).toBeLessThanOrEqual(OCCASIONS.length * 2)
    expect(new Set(OCCASION_IDEAS.map((i) => i.id)).size).toBe(OCCASION_IDEAS.length)
    for (const idea of OCCASION_IDEAS) {
      expect(parseOccasion(idea.occasion)).toBe(idea.occasion)
      expect(idea.time).toMatch(/^\d{2}:\d{2}$/)
      const d = ideaDate(idea, '2026-11-23')
      expect(d >= '2026-11-23').toBe(true)
      const r = occasionWindow(idea.occasion, d)
      expect(d >= r.start && d <= r.end).toBe(true)
      for (const l of ['en', 'fr', 'ht'] as const) expect(idea.title[l] + idea.description[l]).not.toMatch(/—/)
    }
  })
})
