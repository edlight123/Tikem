import fs from 'node:fs'
import path from 'node:path'
import {
  NATIONAL_DAYS,
  activeNationalDay,
  calendarDay,
  easterSunday,
  eventMatchesNationalDay,
  nationalDayArtKey,
  nationalDayForEventDate,
  nationalDayText,
  resolveNationalDays,
} from '@/lib/nationalDays'
import * as mobile from '../mobile/lib/nationalDays'
import { artByKey } from '../mobile/lib/artLibrary'
import { NATIONAL_DAY_ART, nationalDayArt } from '@/lib/nationalDayArt'

const key = (d: string, cfg?: any) => activeNationalDay(d, cfg)?.day.key ?? null
const phase = (d: string, cfg?: any) => activeNationalDay(d, cfg)?.phase ?? null

describe('national days: the two copies', () => {
  it('web and mobile files are byte-identical', () => {
    const web = fs.readFileSync(path.join(process.cwd(), 'lib/nationalDays.ts'), 'utf8')
    const mob = fs.readFileSync(path.join(process.cwd(), 'mobile/lib/nationalDays.ts'), 'utf8')
    expect(mob).toBe(web)
    expect(mobile.activeNationalDay('2026-11-18')?.day.key).toBe('vertieres')
  })
})

describe('the calendar itself', () => {
  it('has unique keys and tags, copy in every language, no em dashes', () => {
    expect(new Set(NATIONAL_DAYS.map((d) => d.key)).size).toBe(NATIONAL_DAYS.length)
    expect(new Set(NATIONAL_DAYS.map((d) => d.eventTag)).size).toBe(NATIONAL_DAYS.length)
    for (const d of NATIONAL_DAYS) {
      for (const l of ['en', 'fr', 'ht'] as const) {
        expect(d.title[l].trim()).not.toBe('')
        expect(d.message[l].trim()).not.toBe('')
        expect(d.title[l] + d.message[l]).not.toMatch(/—/)
      }
    }
  })

  it('every art key and fallback exists in the mobile art library', () => {
    for (const d of NATIONAL_DAYS) {
      expect(artByKey(d.fallbackArtKey)).toBeDefined()
      if (d.artKey) expect(artByKey(d.artKey)).toBeDefined()
      expect(artByKey(nationalDayArtKey(d, (k) => !!artByKey(k)))).toBeDefined()
    }
  })

  it('days without dedicated art fall back to an existing piece', () => {
    const noel = NATIONAL_DAYS.find((d) => d.key === 'noel')!
    expect(noel.artKey).toBeUndefined()
    expect(nationalDayArtKey(noel, () => true)).toBe('lakou')
    const vert = NATIONAL_DAYS.find((d) => d.key === 'vertieres')!
    expect(nationalDayArtKey(vert, () => true)).toBe('vertieres')
    expect(nationalDayArtKey({ ...vert, fallbackArtKey: 'citadelle' }, () => false)).toBe('citadelle')
  })

  it('movable tables agree with the Easter computus', () => {
    // Known Easter Sundays.
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(easterSunday(2028)).toBe('2028-04-16')
    const shift = (iso: string, n: number) =>
      new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
    const easter = NATIONAL_DAYS.find((d) => d.key === 'easter')!
    const kanaval = NATIONAL_DAYS.find((d) => d.key === 'kanaval')!
    for (const [y, r] of Object.entries(easter.movable!)) {
      const e = easterSunday(Number(y))
      expect(r).toEqual({ start: shift(e, -2), end: e })
    }
    for (const [y, r] of Object.entries(kanaval.movable!)) {
      const e = easterSunday(Number(y))
      expect(r).toEqual({ start: shift(e, -49), end: shift(e, -47) })
    }
    // The 2027 dates the owner asked for: Mardi Gras is Tuesday 9 February.
    expect(kanaval.movable![2027]).toEqual({ start: '2027-02-07', end: '2027-02-09' })
    expect(new Date('2027-02-09T12:00:00Z').getUTCDay()).toBe(2)
    expect(easter.movable![2027]).toEqual({ start: '2027-03-26', end: '2027-03-28' })
    expect(new Date('2027-03-26T12:00:00Z').getUTCDay()).toBe(5)
  })
})

describe('activeNationalDay: window edges', () => {
  it('Vertières: three lead days, then the day, then nothing', () => {
    expect(key('2026-11-14')).toBeNull()
    expect(activeNationalDay('2026-11-15')).toMatchObject({ phase: 'upcoming', daysUntil: 3, start: '2026-11-18' })
    expect(activeNationalDay('2026-11-17')).toMatchObject({ phase: 'upcoming', daysUntil: 1 })
    expect(activeNationalDay('2026-11-18')).toMatchObject({
      day: expect.objectContaining({ key: 'vertieres' }),
      phase: 'today',
      daysUntil: 0,
    })
    expect(key('2026-11-19')).toBeNull()
  })

  it('a quiet stretch has no day', () => {
    expect(key('2026-10-05')).toBeNull()
    expect(key('2026-07-01')).toBeNull()
  })

  it('leadDays 0 shows the day only', () => {
    expect(key('2026-04-30')).toBeNull()
    expect(activeNationalDay('2026-05-01')).toMatchObject({ phase: 'today', day: expect.objectContaining({ key: 'labour', lowKey: true }) })
    expect(key('2026-12-04')).toBeNull()
    expect(key('2026-12-05')).toBe('discovery')
  })

  it('Noël has a seven-day lead', () => {
    expect(key('2026-12-17')).toBeNull()
    expect(activeNationalDay('2026-12-18')).toMatchObject({ phase: 'upcoming', daysUntil: 7, day: expect.objectContaining({ key: 'noel' }) })
    expect(phase('2026-12-25')).toBe('today')
    expect(key('2026-12-26')).toBeNull()
  })
})

describe('activeNationalDay: year wrap and overlaps', () => {
  it('Jan 1 lead days start on Dec 29 of the year before', () => {
    expect(key('2026-12-28')).toBeNull()
    expect(activeNationalDay('2026-12-29')).toMatchObject({
      day: expect.objectContaining({ key: 'independence' }),
      phase: 'upcoming',
      daysUntil: 3,
      start: '2027-01-01',
    })
    // Ancestors' lead overlaps from the 30th; the sooner day wins.
    expect(key('2026-12-30')).toBe('independence')
    expect(key('2026-12-31')).toBe('independence')
  })

  it('on Jan 1 independence is today; on Jan 2 the ancestors are', () => {
    expect(activeNationalDay('2027-01-01')).toMatchObject({ phase: 'today', day: expect.objectContaining({ key: 'independence' }) })
    expect(activeNationalDay('2027-01-02')).toMatchObject({ phase: 'today', day: expect.objectContaining({ key: 'ancestors' }) })
    expect(key('2027-01-03')).toBeNull()
  })

  it('All Saints then the Day of the Dead', () => {
    expect(activeNationalDay('2026-10-30')).toMatchObject({ phase: 'upcoming', day: expect.objectContaining({ key: 'allsaints' }) })
    expect(key('2026-11-01')).toBe('allsaints')
    expect(key('2026-11-02')).toBe('morts')
    expect(key('2026-11-03')).toBeNull()
  })
})

describe('activeNationalDay: movable days', () => {
  it('Kanaval 2027 runs Sunday 7 to Tuesday 9 February, lead from the 4th', () => {
    expect(key('2027-02-03')).toBeNull()
    expect(activeNationalDay('2027-02-04')).toMatchObject({ phase: 'upcoming', daysUntil: 3, end: '2027-02-09' })
    expect(phase('2027-02-07')).toBe('today')
    expect(phase('2027-02-09')).toBe('today')
    expect(key('2027-02-10')).toBeNull()
  })

  it('Easter 2027 is Good Friday 26 to Sunday 28 March', () => {
    expect(activeNationalDay('2027-03-23')).toMatchObject({ phase: 'upcoming', day: expect.objectContaining({ key: 'easter' }) })
    expect(phase('2027-03-26')).toBe('today')
    expect(phase('2027-03-28')).toBe('today')
    expect(key('2027-03-29')).toBeNull()
  })

  it('a year missing from the table is computed', () => {
    // 2031: Easter is 13 April.
    expect(easterSunday(2031)).toBe('2031-04-13')
    expect(phase('2031-04-11')).toBe('today')
    expect(key('2031-04-14')).toBeNull()
  })

  it('remote movable ranges replace the table', () => {
    const cfg = { movable: { kanaval: { 2027: { start: '2027-02-06', end: '2027-02-09' } } } }
    expect(phase('2027-02-06', cfg)).toBe('today')
    expect(phase('2027-02-06')).toBe('upcoming')
  })

  it('a malformed remote range is ignored', () => {
    const cfg = { movable: { kanaval: { 2027: { start: '2027-02-30', end: 'x' } } } }
    expect(phase('2027-02-07', cfg)).toBe('today')
  })
})

describe('activeNationalDay: remote config', () => {
  it('a disabled day never shows', () => {
    expect(key('2026-11-18', { disabled: ['vertieres'] })).toBeNull()
    expect(key('2026-11-18', { disabled: ['kanaval'] })).toBe('vertieres')
  })

  it('disabling one overlapping day lets the other through', () => {
    expect(key('2026-12-30', { disabled: ['independence'] })).toBe('ancestors')
  })

  it('overrides change copy and lead without touching the rest', () => {
    const cfg = { overrides: { vertieres: { leadDays: 5, title: { en: 'Vertières' }, message: { fr: 42 } } } }
    expect(phase('2026-11-13', cfg)).toBe('upcoming')
    const day = activeNationalDay('2026-11-18', cfg)!.day
    expect(day.title.en).toBe('Vertières')
    expect(day.title.ht).toBe('Vertières · 18 Nov')
    expect(day.message.fr).toBe(NATIONAL_DAYS.find((d) => d.key === 'vertieres')!.message.fr)
  })

  it('garbage config falls back to the built-in calendar', () => {
    for (const cfg of [null, undefined, 'x', 42, [], { disabled: 'vertieres', overrides: [] }]) {
      expect(key('2026-11-18', cfg as any)).toBe('vertieres')
    }
    expect(resolveNationalDays({ overrides: { flag: { leadDays: -4, month: 13 } } }).find((d) => d.key === 'flag')).toMatchObject({ leadDays: 3, month: 5 })
  })

  it('force (dev preview) activates a day out of season', () => {
    expect(activeNationalDay('2026-10-05', null, { force: 'vertieres' })).toMatchObject({
      phase: 'today',
      day: expect.objectContaining({ key: 'vertieres' }),
    })
    expect(activeNationalDay('2026-10-05', { disabled: ['vertieres'] }, { force: 'vertieres' })).toBeNull()
    expect(activeNationalDay('2026-10-05', null, { force: 'nope' })).toBeNull()
  })
})

describe('calendarDay: the day turns over in Haiti', () => {
  it('reads Port-au-Prince time, not UTC', () => {
    // 02:00 UTC on 18 Nov is still 17 Nov, 21:00 in Port-au-Prince (UTC-5).
    expect(calendarDay(new Date('2026-11-18T02:00:00Z'))).toBe('2026-11-17')
    expect(calendarDay(new Date('2026-11-18T06:00:00Z'))).toBe('2026-11-18')
    expect(activeNationalDay(new Date('2026-11-18T02:00:00Z'))).toMatchObject({ phase: 'upcoming', daysUntil: 1 })
  })
})

describe('nationalDayForEventDate', () => {
  it('offers the day for events inside its window or within a week', () => {
    expect(nationalDayForEventDate('2026-11-18')?.key).toBe('vertieres')
    expect(nationalDayForEventDate('2026-11-10')?.key).toBe('vertieres') // inside 15th - lead - 7
    expect(nationalDayForEventDate('2026-11-25')?.key).toBe('vertieres')
    expect(nationalDayForEventDate('2026-11-26')).toBeNull()
    expect(nationalDayForEventDate('2026-07-01')).toBeNull()
  })

  it('picks the nearest day when windows meet', () => {
    expect(nationalDayForEventDate('2026-11-02')?.key).toBe('morts')
    expect(nationalDayForEventDate('2026-11-04')?.key).toBe('allsaints') // low-key: day only
    expect(nationalDayForEventDate('2026-12-31')?.key).toBe('independence')
    expect(nationalDayForEventDate('2027-01-02')?.key).toBe('ancestors')
  })

  it('takes a Date and skips bad input', () => {
    expect(nationalDayForEventDate(new Date('2026-11-18T23:00:00-05:00'))?.key).toBe('vertieres')
    expect(nationalDayForEventDate(new Date('nope'))).toBeNull()
    expect(nationalDayForEventDate(null)).toBeNull()
  })

  it('respects disabled days', () => {
    expect(nationalDayForEventDate('2026-11-18', { disabled: ['vertieres'] })).toBeNull()
  })
})

describe('helpers', () => {
  it('matches the national_day field or a tags array', () => {
    const day = { eventTag: 'vertieres' }
    expect(eventMatchesNationalDay({ national_day: 'vertieres' }, day)).toBe(true)
    expect(eventMatchesNationalDay({ tags: ['x', 'vertieres'] }, day)).toBe(true)
    expect(eventMatchesNationalDay({ national_day: 'flag' }, day)).toBe(false)
    expect(eventMatchesNationalDay(null, day)).toBe(false)
  })

  it('picks copy by language with English as the fallback', () => {
    const v = NATIONAL_DAYS.find((d) => d.key === 'independence')!
    expect(nationalDayText(v, 'ht').message).toBe('Bòn fèt endepandans! Yon bòl soup joumou pou tout moun.')
    expect(nationalDayText(v, 'de').title).toBe('Independence Day')
  })
})

describe('web banner art', () => {
  it('captions every piece exactly as the mobile art library does', () => {
    for (const [k, art] of Object.entries(NATIONAL_DAY_ART)) {
      const piece = artByKey(k)!
      expect(piece).toBeDefined()
      expect(art.alt).toBe(piece.alt)
      expect(art.place).toBe(piece.place)
      expect(fs.existsSync(path.join(process.cwd(), 'public', art.src))).toBe(true)
    }
  })

  it('has art for every day, own or fallback', () => {
    for (const d of NATIONAL_DAYS) {
      const own = d.artKey ? NATIONAL_DAY_ART[d.artKey] : undefined
      expect(own || NATIONAL_DAY_ART[d.fallbackArtKey]).toBeTruthy()
      expect(nationalDayArt(d).src).toMatch(/^\/art\/national-days\//)
    }
  })
})
