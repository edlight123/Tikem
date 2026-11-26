/**
 * Event language (ported from Tikra, 2026-11-25): the language(s) an event is
 * held in. Kreyòl, Français, English, Español; several allowed. Validation,
 * the Discover filter (web + app), the event page's line and JSON-LD,
 * firestore.rules, and web/app parity of the shared module.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as web from '@/lib/event-languages'
import * as app from '../mobile/lib/eventLanguages'
import { filterEvents } from '@/lib/filters/apply'
import { DEFAULT_FILTERS } from '@/lib/filters/types'
import { countActiveFilters, filtersEqual, parseFiltersFromURL, serializeFilters } from '@/lib/filters/utils'
import { applyFilters, countActiveFilters as appCount } from '../mobile/utils/filterUtils'
import { DEFAULT_FILTERS as APP_DEFAULT_FILTERS } from '../mobile/types/filters'
import { buildEventJsonLd } from '@/app/events/[id]/eventJsonLd'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const {
  EVENT_LANGUAGES,
  MAX_EVENT_LANGUAGES,
  cleanEventLanguages,
  eventInLanguage,
  eventLanguageLabel,
  eventLanguagesLine,
  isValidLanguagesField,
  languageName,
  matchesEventLanguage,
  parseLanguageParam,
} = web

describe('the language list', () => {
  it('is Kreyòl, French, English and Spanish, in that order, each with its own name', () => {
    expect(EVENT_LANGUAGES.map((l) => l.code)).toEqual(['ht', 'fr', 'en', 'es'])
    expect(EVENT_LANGUAGES.map((l) => l.native)).toEqual(['Kreyòl', 'Français', 'English', 'Español'])
    // "Multiple": every language can be picked at once.
    expect(MAX_EVENT_LANGUAGES).toBe(EVENT_LANGUAGES.length)
  })

  it('labels a language by its own name, and names it in the reader’s language', () => {
    expect(eventLanguageLabel('ht')).toBe('Kreyòl')
    expect(eventLanguageLabel('xx')).toBe('xx')
    expect(languageName('ht', 'en')).toBe('Haitian Creole')
    expect(languageName('en', 'fr')).toBe('Anglais')
    expect(languageName('es', 'ht')).toBe('Panyòl')
    expect(eventLanguagesLine(['ht', 'en'])).toBe('Kreyòl, English')
    expect(eventLanguagesLine(undefined)).toBe('')
  })
})

describe('validation', () => {
  it('keeps known codes, lower-cased, once each, in the order picked', () => {
    expect(cleanEventLanguages(['EN', 'ht', 'en', 'xx', 7, 'es'])).toEqual(['en', 'ht', 'es'])
    expect(cleanEventLanguages(['ht', 'fr', 'en', 'es'])).toEqual(['ht', 'fr', 'en', 'es'])
    expect(cleanEventLanguages('ht')).toEqual([])
    expect(cleanEventLanguages(null)).toEqual([])
    expect(cleanEventLanguages([])).toEqual([])
  })

  it('matches the shape the rules accept: known codes only, at most four', () => {
    expect(isValidLanguagesField([])).toBe(true)
    expect(isValidLanguagesField(['ht', 'en'])).toBe(true)
    expect(isValidLanguagesField(['ht', 'fr', 'en', 'es'])).toBe(true)
    expect(isValidLanguagesField(['ht', 'fr', 'en', 'es', 'ht'])).toBe(false)
    expect(isValidLanguagesField(['ar'])).toBe(false)
    expect(isValidLanguagesField(['HT'])).toBe(false)
    expect(isValidLanguagesField([1])).toBe(false)
    expect(isValidLanguagesField('ht')).toBe(false)
  })
})

describe('firestore.rules validates the field', () => {
  const rules = read('firestore.rules')
  const fn = rules.slice(rules.indexOf('function validEventLanguages'), rules.indexOf('function validOccasion'))
  const events = rules.slice(rules.indexOf('match /events/{eventId}'), rules.indexOf('// If country/currency changes'))

  it('allows exactly the helper codes, each once, and nothing bigger', () => {
    expect(fn).toContain('function validEventLanguages(d)')
    expect(fn).toContain(`langs.hasOnly([${EVENT_LANGUAGES.map((l) => `'${l.code}'`).join(', ')}])`)
    expect(fn).toContain(`langs.size() <= ${MAX_EVENT_LANGUAGES}`)
    expect(fn).toContain('langs.toSet().size() == langs.size()')
    expect(fn).toContain('langs is list')
  })

  it('reads the field with a .get() default, so events without it stay writable', () => {
    expect(fn).toContain("d.get('languages', [])")
    expect(fn).not.toMatch(/\bd\.languages\b/)
  })

  it('is checked on create and on the organizer update', () => {
    expect(events.match(/validEventLanguages\(request\.resource\.data\)/g)).toHaveLength(2)
  })

  it('and the publish route cleans it to known codes', () => {
    expect(read('app/api/events/[id]/publish/route.ts')).toMatch(/cleanEventLanguages\(\(eventData as any\)\.languages\)/)
  })
})

describe('the composers write it', () => {
  it('web composer: picks several, saves the cleaned list', () => {
    const src = read('app/organizer/events/EventComposer.tsx')
    expect(src).toMatch(/languages: cleanEventLanguages\(eventLanguages\)/)
    expect(src).toMatch(/setEventLanguages\(cleanEventLanguages\(d\.languages\)\)/)
  })

  it('app create/edit flow: reads it back on edit and saves the cleaned list', () => {
    const src = read('mobile/screens/organizer/CreateEventFlowRefactored.tsx')
    expect(src).toMatch(/languages: cleanEventLanguages\(\(event as any\)\.languages\)/)
    expect(src).toMatch(/languages: cleanEventLanguages\(draft\.languages\)/)
    expect(read('mobile/lib/api/events.ts')).toMatch(/languages: cleanEventLanguages\(eventData\.languages\)/)
  })

  it('the web data layer passes it to the event page and Discover', () => {
    const src = read('lib/data/events.ts')
    expect(src.match(/languages: cleanEventLanguages\(data\??\.languages\)/g)).toHaveLength(2)
  })
})

describe('the language filter (Discover, web + app)', () => {
  const events: any[] = [
    { id: 'a', languages: ['ht'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'b', languages: ['en', 'ht'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'c', languages: ['fr'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'd', start_datetime: '2026-12-01T20:00:00Z' },
  ]

  it('"Any language" matches everything; a language matches only events held in it', () => {
    expect(events.filter((e) => matchesEventLanguage(e, '')).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(events.filter((e) => matchesEventLanguage(e, 'ht')).map((e) => e.id)).toEqual(['a', 'b'])
    expect(events.filter((e) => matchesEventLanguage(e, 'zz')).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('parses ?language=', () => {
    expect(parseLanguageParam('HT')).toBe('ht')
    expect(parseLanguageParam(['fr'])).toBe('fr')
    expect(parseLanguageParam('klingon')).toBe('')
    expect(parseLanguageParam(undefined)).toBe('')
  })

  it('web: filters, counts as one, and round-trips through the URL', () => {
    const f = parseFiltersFromURL(new URLSearchParams('language=ht'))
    expect(f.language).toBe('ht')
    expect(filterEvents(events, f).map((e: any) => e.id)).toEqual(['a', 'b'])
    expect(filterEvents(events, DEFAULT_FILTERS)).toHaveLength(4)
    expect(countActiveFilters(f)).toBe(countActiveFilters(DEFAULT_FILTERS) + 1)
    expect(serializeFilters(f).get('language')).toBe('ht')
    expect(filtersEqual(parseFiltersFromURL(serializeFilters(f)), f)).toBe(true)
    expect(filtersEqual(f, DEFAULT_FILTERS)).toBe(false)
    // An unknown code is dropped, so a stale link lands on the normal feed.
    expect(parseFiltersFromURL(new URLSearchParams('language=xx')).language).toBeUndefined()
  })

  it('app: filters the Discover list and counts as one filter', () => {
    const appEvents = events.map((e) => ({ ...e, start_datetime: new Date(e.start_datetime) }))
    const f = { ...APP_DEFAULT_FILTERS, country: '', language: 'ht' }
    expect(applyFilters(appEvents as any, f).map((e: any) => e.id).sort()).toEqual(['a', 'b'])
    expect(applyFilters(appEvents as any, { ...APP_DEFAULT_FILTERS, country: '' })).toHaveLength(4)
    expect(appCount(f)).toBe(appCount(APP_DEFAULT_FILTERS) + 1)
  })
})

describe('the event page', () => {
  const base = { id: 'e1', title: 'Konpa night', start_datetime: '2026-12-01T20:00:00Z', venue_name: 'Club', city: 'Pétion-Ville', country: 'HT' }

  it('emits schema.org inLanguage only when the organizer said', () => {
    expect(eventInLanguage(['ht'])).toBe('ht')
    expect(eventInLanguage(['ht', 'en'])).toEqual(['ht', 'en'])
    expect(eventInLanguage([])).toBeUndefined()
    expect(buildEventJsonLd({ ...base, languages: ['ht', 'en'] }, 'https://www.tikem.co')!.inLanguage).toEqual(['ht', 'en'])
    expect(buildEventJsonLd({ ...base, languages: ['fr'] }, 'https://www.tikem.co')!.inLanguage).toBe('fr')
    expect(buildEventJsonLd(base, 'https://www.tikem.co')!).not.toHaveProperty('inLanguage')
  })
})

describe('strings in every locale (web + app)', () => {
  it('web: en/fr/ht carry the same event_languages keys', () => {
    const keys = ['title', 'composer_hint', 'filter', 'any', 'held_in']
    for (const lang of ['en', 'fr', 'ht']) {
      const c = JSON.parse(read(`public/locales/${lang}/common.json`))
      for (const k of keys) expect(typeof c.event_languages?.[k]).toBe('string')
    }
  })

  it('app: en/fr/ht carry the same eventLanguages keys', () => {
    for (const lang of ['en', 'fr', 'ht']) {
      const src = read(`mobile/locales/${lang}.ts`)
      const block = src.slice(src.indexOf('  eventLanguages: {'), src.indexOf('  venueDetails: {'))
      for (const k of ['title', 'filter', 'any', 'heldIn']) expect(block).toMatch(new RegExp(`\\n    ${k}: "`))
    }
  })
})

describe('web and app share one module', () => {
  it('has the same list and the same answers', () => {
    expect(app.EVENT_LANGUAGES).toEqual(web.EVENT_LANGUAGES)
    expect(app.MAX_EVENT_LANGUAGES).toBe(web.MAX_EVENT_LANGUAGES)
    for (const l of web.EVENT_LANGUAGES) {
      expect(app.eventLanguageLabel(l.code)).toBe(web.eventLanguageLabel(l.code))
      for (const ui of ['en', 'fr', 'ht']) expect(app.languageName(l.code, ui)).toBe(web.languageName(l.code, ui))
    }
    const raw = ['EN', 'ht', 'xx', 'en']
    expect(app.cleanEventLanguages(raw)).toEqual(web.cleanEventLanguages(raw))
    expect(app.eventLanguagesLine(raw)).toBe(web.eventLanguagesLine(raw))
  })

  it('is the same file apart from the header line naming its twin', () => {
    const strip = (s: string) => s.replace(/^ \* Pure and shared: the (app|website) keeps an identical copy.*$/m, '')
    expect(strip(read('mobile/lib/eventLanguages.ts'))).toBe(strip(read('lib/event-languages.ts')))
  })
})
