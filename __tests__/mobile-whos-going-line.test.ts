import { formatWhosGoingLine, goingCountKey, whosGoingLine } from '../mobile/lib/whosGoingLine'
import { whosGoingLineKey } from '../lib/whosGoingLine'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'
import webEn from '../public/locales/en/common.json'
import webFr from '../public/locales/fr/common.json'
import webHt from '../public/locales/ht/common.json'

/** The app's `t`: a dotted path, {name} interpolation (contexts/I18nContext). */
function makeT(dict: any) {
  return (key: string, params?: Record<string, string | number>) => {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)
    if (typeof v !== 'string') return key
    return v.replace(/\{(\w+)\}/g, (m, n) => (params && params[n] != null ? String(params[n]) : m))
  }
}

const line = (dict: any, input: Partial<Parameters<typeof formatWhosGoingLine>[1]>) =>
  formatWhosGoingLine(makeT(dict), {
    viewerIsGoing: false,
    leadName: '',
    secondName: '',
    totalGoing: 0,
    sayCount: true,
    ...input,
  })

describe("who's going sentence (app)", () => {
  it('French reads naturally in every variant (TestFlight 2026-11-21)', () => {
    expect(line(fr, { viewerIsGoing: true, totalGoing: 1 })).toBe('Vous y allez')
    expect(line(fr, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 2 })).toBe('Vous y allez avec Olivier')
    expect(line(fr, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 3 })).toBe(
      'Vous y allez avec Olivier et une autre personne'
    )
    expect(line(fr, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 95 })).toBe(
      'Vous y allez avec Olivier et 93 autres'
    )
    expect(line(fr, { viewerIsGoing: true, totalGoing: 2 })).toBe('Vous y allez avec une autre personne')
    expect(line(fr, { viewerIsGoing: true, totalGoing: 10 })).toBe('Vous y allez avec 9 autres personnes')
    expect(line(fr, { leadName: 'Olivier', totalGoing: 1 })).toBe('Olivier y va')
    expect(line(fr, { leadName: 'Olivier', totalGoing: 2 })).toBe('Olivier et une autre personne y vont')
    expect(line(fr, { leadName: 'Olivier', totalGoing: 94 })).toBe('Olivier et 93 autres y vont')
    expect(line(fr, { leadName: 'Olivier', secondName: 'Marie', totalGoing: 2 })).toBe('Olivier et Marie y vont')
    expect(line(fr, { leadName: 'Olivier', secondName: 'Marie', totalGoing: 3 })).toBe(
      'Olivier, Marie et une autre personne y vont'
    )
    expect(line(fr, { leadName: 'Olivier', totalGoing: 40, sayCount: false })).toBe("Olivier et d'autres y vont")
    expect(line(fr, { totalGoing: 1 })).toBe('1 participant')
    expect(line(fr, { totalGoing: 12 })).toBe('12 participants')
  })

  it('never builds the old "Vous, Olivier et 93 autres y allez"', () => {
    expect(line(fr, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 95 })).not.toMatch(/^Vous,/)
    for (const v of Object.values((fr as any).whosGoing.line) as string[]) {
      expect(v).not.toMatch(/\b1 autres?\b/)
    }
  })

  it('Kreyòl says "prale"', () => {
    expect(line(ht, { viewerIsGoing: true, totalGoing: 1 })).toBe('Ou prale')
    expect(line(ht, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 95 })).toBe('Ou prale ak Olivier ak 93 lòt moun')
    expect(line(ht, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 2 })).toBe('Ou prale ak Olivier')
    expect(line(ht, { leadName: 'Olivier', totalGoing: 94 })).toBe('Olivier ak 93 lòt moun prale')
    expect(line(ht, { leadName: 'Olivier', totalGoing: 1 })).toBe('Olivier prale')
    expect(line(ht, { leadName: 'Olivier', secondName: 'Mari', totalGoing: 2 })).toBe('Olivier ak Mari prale')
    expect(line(ht, { totalGoing: 12 })).toBe('12 moun prale')
  })

  it('English stays grammatical', () => {
    expect(line(en, { viewerIsGoing: true, totalGoing: 1 })).toBe('You are going')
    expect(line(en, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 95 })).toBe('You, Olivier and 93 others are going')
    expect(line(en, { viewerIsGoing: true, leadName: 'Olivier', totalGoing: 3 })).toBe('You, Olivier and 1 other are going')
    expect(line(en, { leadName: 'Olivier', totalGoing: 1 })).toBe('Olivier is going')
    expect(line(en, { leadName: 'Olivier', secondName: 'Marie', totalGoing: 2 })).toBe('Olivier and Marie are going')
    expect(line(en, { totalGoing: 1 })).toBe('1 going')
  })

  it('every key it can pick exists in all three languages', () => {
    const cases = [
      { viewerIsGoing: true, leadName: 'A', secondName: '', totalGoing: 1, sayCount: true },
      { viewerIsGoing: true, leadName: 'A', secondName: '', totalGoing: 3, sayCount: true },
      { viewerIsGoing: true, leadName: 'A', secondName: '', totalGoing: 9, sayCount: true },
      { viewerIsGoing: true, leadName: '', secondName: '', totalGoing: 2, sayCount: true },
      { viewerIsGoing: true, leadName: '', secondName: '', totalGoing: 9, sayCount: true },
      { viewerIsGoing: false, leadName: 'A', secondName: 'B', totalGoing: 2, sayCount: true },
      { viewerIsGoing: false, leadName: 'A', secondName: 'B', totalGoing: 3, sayCount: true },
      { viewerIsGoing: false, leadName: 'A', secondName: 'B', totalGoing: 9, sayCount: true },
      { viewerIsGoing: false, leadName: 'A', secondName: 'B', totalGoing: 9, sayCount: false },
      { viewerIsGoing: false, leadName: 'A', secondName: '', totalGoing: 2, sayCount: true },
      { viewerIsGoing: false, leadName: 'A', secondName: '', totalGoing: 9, sayCount: false },
      { viewerIsGoing: false, leadName: '', secondName: '', totalGoing: 1, sayCount: true },
      { viewerIsGoing: false, leadName: '', secondName: '', totalGoing: 9, sayCount: false },
    ]
    for (const dict of [en, fr, ht]) {
      const t = makeT(dict)
      for (const c of cases) {
        const { key } = whosGoingLine(c)
        expect(t(key)).not.toBe(key)
      }
      expect(t(goingCountKey(1))).not.toBe(goingCountKey(1))
    }
  })
})

/** i18next's lookup for these templates: plural suffix from `count`, French 0/1 = one. */
function webLine(dict: any, lang: 'en' | 'fr' | 'ht', input: Parameters<typeof whosGoingLineKey>[0]) {
  const { key, count } = whosGoingLineKey(input)
  const lines = dict.whos_going.line
  let tpl: string = lines[key]
  if (count !== undefined) {
    const one = lang === 'fr' ? count < 2 : count === 1
    tpl = (one && lines[`${key}_one`]) || tpl
  }
  return tpl
    .replace('{{you}}', dict.whos_going.you_badge)
    .replace('{{lead}}', input.leadName)
    .replace('{{second}}', input.secondName)
    .replace('{{count}}', String(count))
}

describe("who's going sentence (website)", () => {
  const base = { viewerIsGoing: false, leadName: '', secondName: '', totalGoing: 0, sayCount: true }
  it('French matches the app', () => {
    expect(webLine(webFr, 'fr', { ...base, viewerIsGoing: true, leadName: 'Olivier', totalGoing: 95 })).toBe(
      'Vous y allez avec Olivier et 93 autres'
    )
    // count 0 must not pick the "_one" form ("Vous, Olivier et 1 autre").
    expect(webLine(webFr, 'fr', { ...base, viewerIsGoing: true, leadName: 'Olivier', totalGoing: 2 })).toBe(
      'Vous y allez avec Olivier'
    )
    expect(webLine(webFr, 'fr', { ...base, leadName: 'Olivier', secondName: 'Marie', totalGoing: 2 })).toBe(
      'Olivier et Marie y vont'
    )
    expect(webLine(webFr, 'fr', { ...base, totalGoing: 1 })).toBe('1 participant')
    expect(whosGoingLineKey({ ...base, viewerIsGoing: true, leadName: 'O', totalGoing: 2 }).count).toBeUndefined()
  })
  it('Kreyòl and English', () => {
    expect(webLine(webHt, 'ht', { ...base, viewerIsGoing: true, leadName: 'Olivier', totalGoing: 95 })).toBe(
      'Ou prale ak Olivier ak 93 lòt moun'
    )
    expect(webLine(webHt, 'ht', { ...base, leadName: 'Olivier', totalGoing: 94 })).toBe('Olivier ak 93 lòt moun prale')
    expect(webLine(webEn, 'en', { ...base, leadName: 'Olivier', totalGoing: 94 })).toBe('Olivier and 93 others are going')
  })
})
