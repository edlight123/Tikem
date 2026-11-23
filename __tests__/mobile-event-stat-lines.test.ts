import { eventStatLines, isSingular } from '../mobile/lib/eventStatLines'
import { posterFit } from '../mobile/lib/posterFit'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

function makeT(dict: any) {
  return (key: string, params?: Record<string, string | number>) => {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)
    if (typeof v !== 'string') return key
    return v.replace(/\{(\w+)\}/g, (m, n) => (params && params[n] != null ? String(params[n]) : m))
  }
}

const text = (lines: { value: string; label: string }[][]) =>
  lines.map((segs) => segs.map((s) => (s.value ? `${s.value} ${s.label}` : s.label)).join(' · '))

describe('organizer event stat lines', () => {
  const base = { sold: 0, capacity: 120, checkedIn: 0, sellThrough: 0, views: { total: 0, today: 0 } }

  it('French: two lines, singular for 0 and 1', () => {
    expect(text(eventStatLines(makeT(fr), 'fr', base))).toEqual([
      '0/120 vendu · 0 enregistré',
      '0 % vendu · 0 vue',
    ])
    expect(text(eventStatLines(makeT(fr), 'fr', { ...base, sold: 12, checkedIn: 4, sellThrough: 10, views: { total: 30, today: 3 } }))).toEqual([
      '12/120 vendus · 4 enregistrés',
      '10 % vendu · 30 vues · 3 aujourd’hui',
    ])
  })

  it('English and Kreyòl', () => {
    expect(text(eventStatLines(makeT(en), 'en', { ...base, views: { total: 1, today: 0 } }))).toEqual([
      '0/120 sold · 0 checked in',
      '0% sold · 1 view',
    ])
    expect(text(eventStatLines(makeT(ht), 'ht', { ...base, sold: 5 }))).toEqual(['5/120 vann · 0 antre', '0% vann · 0 vizit'])
  })

  it('one line when there is no cap and no views yet', () => {
    expect(text(eventStatLines(makeT(en), 'en', { ...base, capacity: 0, sellThrough: null, views: null }))).toEqual([
      '0 sold · 0 checked in',
    ])
  })

  it('plural rules', () => {
    expect(isSingular('fr', 0)).toBe(true)
    expect(isSingular('en', 0)).toBe(false)
    expect(isSingular('en', 1)).toBe(true)
  })
})

describe('poster fit', () => {
  it('fills with photos and near-frame images, shows square/Stories flyers whole', () => {
    expect(posterFit(undefined, 0.8)).toBe('cover')
    expect(posterFit(0.8, 0.8)).toBe('cover')
    expect(posterFit(4 / 3, 0.8)).toBe('cover') // landscape photo (TestFlight 2026-11-23)
    expect(posterFit(16 / 9, 0.8)).toBe('cover')
    expect(posterFit(1, 0.8)).toBe('contain') // Instagram square flyer
    expect(posterFit(9 / 16, 0.8)).toBe('contain') // Stories flyer
  })
})
