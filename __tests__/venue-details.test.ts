/**
 * Venue details (what the place has, accessibility, indoor/outdoor, age
 * policy, dress code): the web and app helpers agree, the Discover filters
 * use them (`?amenities=` and the older `?stepFree=1`), the flyer reader
 * spots venue facts, the app's flyer fill only adds to what is set, and
 * firestore.rules validates the same shapes the helpers write.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as web from '@/lib/events/venue-details'
import * as app from '../mobile/lib/venueDetails'
import { filterEvents } from '@/lib/filters/apply'
import { DEFAULT_FILTERS } from '@/lib/filters/types'
import { countActiveFilters, filtersEqual, parseFiltersFromURL, serializeFilters } from '@/lib/filters/utils'
import { applyFilters, countActiveFilters as appCount } from '../mobile/utils/filterUtils'
import { DEFAULT_FILTERS as APP_DEFAULT_FILTERS } from '../mobile/types/filters'
import { flyerDraftPatch, to12h, type FlyerFillDraft, type FlyerRead } from '../mobile/lib/flyerFill'
import { parseFlyerText } from '@/lib/flyer/parse'

const samples: unknown[] = [
  {},
  null,
  { amenities: ['step_free', 'parking', 'wudu', 3], venue_setting: 'outdoor', age_policy: '21+', dress_code: '  All   white  ' },
  { amenities: 'parking', venue_setting: 'roof', age_policy: '16+', dress_code: 42 },
  { amenities: ['coat_check', 'accessible_washrooms'], venue_setting: 'mixed', dress_code: 'x'.repeat(90) },
  { amenities: ['quiet_room', 'backup_power', 'wheelchair', 'air_conditioning', 'backup_power', 'hearing_loop'], venue_setting: 'indoor' },
]

describe('venue details: web and app agree', () => {
  it('the mirror carries the same keys', () => {
    expect(app.VENUE_AMENITIES).toEqual(web.VENUE_AMENITIES)
    expect(app.VENUE_FACILITIES).toEqual(web.VENUE_FACILITIES)
    expect(app.VENUE_ACCESSIBILITY).toEqual(web.VENUE_ACCESSIBILITY)
    expect(app.VENUE_SETTINGS).toEqual(web.VENUE_SETTINGS)
    expect(app.AGE_POLICIES).toEqual(web.AGE_POLICIES)
    expect(app.DRESS_CODE_MAX).toBe(web.DRESS_CODE_MAX)
    expect(app.VENUE_DETAIL_ICONS).toEqual(web.VENUE_DETAIL_ICONS)
  })

  it.each(samples.map((s, i) => [i, s]))('sample %i reads the same on both', (_i, sample) => {
    const w = web.venueDetailsOf(sample)
    expect(app.venueDetailsOf(sample)).toEqual(w)
    expect(app.venueDetailLines(w)).toEqual(web.venueDetailLines(w))
    expect(app.venueAccessLines(w)).toEqual(web.venueAccessLines(w))
    expect(app.venueDetailsCount(w)).toBe(web.venueDetailsCount(w))
    expect(app.venueDetailsFields(w, true)).toEqual(web.venueDetailsFields(w, true))
  })

  it('drops anything malformed and keeps display order', () => {
    expect(web.venueDetailsOf(samples[2])).toEqual({
      amenities: ['parking', 'step_free'],
      venue_setting: 'outdoor',
      age_policy: '21+',
      dress_code: 'All white',
    })
    expect(web.venueDetailsOf(samples[3])).toEqual(web.EMPTY_VENUE_DETAILS)
    expect(web.venueDetailsOf(samples[4]).dress_code).toHaveLength(60)
  })

  it('an online event writes no amenities or setting, but keeps age and dress code', () => {
    const d = web.venueDetailsOf(samples[2])
    expect(web.venueDetailsFields(d, true)).toEqual({ amenities: [], venue_setting: null, age_policy: '21+', dress_code: 'All white' })
  })

  it('lists what the place has, then setting, then the rules; accessibility apart', () => {
    const d = web.venueDetailsOf(samples[2])
    const lines = web.venueDetailLines(d)
    expect(lines.map((l) => l.key)).toEqual(['parking', 'outdoor', 'age_21', 'dress_code'])
    expect(lines[lines.length - 1].value).toBe('All white')
    expect(web.venueAccessLines(d).map((l) => l.key)).toEqual(['step_free'])
  })

  it('splits the keys into two groups, with one icon each', () => {
    expect([...web.VENUE_AMENITIES]).toEqual([...web.VENUE_FACILITIES, ...web.VENUE_ACCESSIBILITY])
    for (const k of web.VENUE_FACILITIES) expect(web.isAccessibilityKey(k)).toBe(false)
    for (const k of web.VENUE_ACCESSIBILITY) expect(web.isFacilityKey(k)).toBe(false)
    for (const k of web.VENUE_AMENITIES) expect(web.VENUE_DETAIL_ICONS[k]).toBeTruthy()
    const icons = Object.values(web.VENUE_DETAIL_ICONS)
    expect(new Set(icons).size).toBe(icons.length)
    // Outdoor seating would repeat venue_setting.
    expect(web.VENUE_AMENITIES as readonly string[]).not.toContain('outdoor_seating')
  })

  it('keeps the keys events already carry', () => {
    for (const k of ['parking', 'step_free', 'accessible_washrooms', 'coat_check']) {
      expect(web.VENUE_AMENITIES as readonly string[]).toContain(k)
    }
  })

  it('reads the new keys in group order, de-duplicated, unknown ones dropped', () => {
    const d = web.venueDetailsOf(samples[5])
    expect(d.amenities).toEqual(['backup_power', 'air_conditioning', 'wheelchair', 'quiet_room'])
    expect(web.venueDetailLines(d).map((l) => l.key)).toEqual(['backup_power', 'air_conditioning', 'indoor'])
    expect(web.venueAccessLines(d).map((l) => l.key)).toEqual(['wheelchair', 'quiet_room'])
    expect(web.venueDetailsCount(d)).toBe(5)
  })

  it('every key has a chip label, an event-page line and a filter label in en/fr/ht', () => {
    for (const lang of ['en', 'fr', 'ht']) {
      const c = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'locales', lang, 'common.json'), 'utf8'))
      for (const k of web.VENUE_AMENITIES) {
        expect(c.composer.venueDetails.amenities[k]).toBeTruthy()
        expect(c.venue_details[k]).toBeTruthy()
        expect(c.filters.amenities[k]).toBeTruthy()
      }
    }
  })
})

describe('the venue filters', () => {
  const events: any[] = [
    { id: 'a', amenities: ['step_free'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'b', amenities: ['parking'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'c', start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'd', amenities: ['parking', 'air_conditioning', 'step_free', 'wheelchair'], start_datetime: '2026-12-01T20:00:00Z' },
  ]

  it('web: the older Step-free switch and ?stepFree=1 still work', () => {
    const f = { ...DEFAULT_FILTERS, stepFree: true }
    expect(filterEvents(events, f).map((e: any) => e.id)).toEqual(['a', 'd'])
    expect(filterEvents(events, DEFAULT_FILTERS)).toHaveLength(4)
    const parsed = parseFiltersFromURL(new URLSearchParams('stepFree=1'))
    expect(parsed.amenities).toEqual(['step_free'])
    expect(filtersEqual(parsed, f)).toBe(true)
    expect(serializeFilters(f).get('amenities')).toBe('step_free')
    expect(parseFiltersFromURL(new URLSearchParams()).amenities).toBeUndefined()
    expect(countActiveFilters(f)).toBe(countActiveFilters(DEFAULT_FILTERS) + 1)
  })

  it('web: ?amenities= keeps events with ALL chosen facts and round-trips', () => {
    const f = parseFiltersFromURL(new URLSearchParams('amenities=step_free,parking,bogus'))
    expect(f.amenities).toEqual(['parking', 'step_free'])
    expect(filterEvents(events, f).map((e: any) => e.id)).toEqual(['d'])
    const again = parseFiltersFromURL(serializeFilters(f))
    expect(again.amenities).toEqual(['parking', 'step_free'])
    expect(filtersEqual(again, f)).toBe(true)
    expect(countActiveFilters(f)).toBe(countActiveFilters(DEFAULT_FILTERS) + 2)
    // ?stepFree=1 alongside amenities folds in once.
    expect(parseFiltersFromURL(new URLSearchParams('amenities=step_free&stepFree=1')).amenities).toEqual(['step_free'])
  })

  it('helpers: all-of match, empty keeps everything', () => {
    expect(web.hasAllAmenities(events[3], ['air_conditioning', 'wheelchair'])).toBe(true)
    expect(web.hasAllAmenities(events[1], ['parking', 'step_free'])).toBe(false)
    expect(web.hasAllAmenities(events[2], [])).toBe(true)
    expect(web.wantedAmenities({ amenities: ['wheelchair'], stepFree: true })).toEqual(['step_free', 'wheelchair'])
    expect(app.wantedAmenities({ amenities: ['wheelchair'], stepFree: true })).toEqual(['step_free', 'wheelchair'])
  })

  it('app: the older Step-free switch and the new multi-select both filter and count', () => {
    const appEvents = events.map((e) => ({ ...e, start_datetime: new Date(e.start_datetime) }))
    const f = { ...APP_DEFAULT_FILTERS, country: '', stepFree: true }
    expect(applyFilters(appEvents as any, f).map((e: any) => e.id).sort()).toEqual(['a', 'd'])
    expect(appCount(f)).toBe(appCount(APP_DEFAULT_FILTERS) + 1)
    const g = { ...APP_DEFAULT_FILTERS, country: '', amenities: ['air_conditioning', 'parking'] }
    expect(applyFilters(appEvents as any, g).map((e: any) => e.id)).toEqual(['d'])
    expect(appCount(g)).toBe(appCount(APP_DEFAULT_FILTERS) + 2)
  })
})

describe('the app flyer fill', () => {
  const read: FlyerRead = {
    title: 'Konpa Lakay',
    description: null,
    date: '2026-12-12',
    start_time: '21:00',
    end_time: '03:00',
    venue_name: 'Hotel Montana',
    address: null,
    city: 'Pétion-Ville',
    price_type: 'paid',
    price: 1500,
    currency: 'HTG',
    age_policy: '18+',
    dress_code: null,
    amenities: ['backup_power', 'air_conditioning'],
    uncertain: ['start_time'],
    personal_details: [],
  }
  const draft: FlyerFillDraft = {
    title: '',
    description: '',
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    venue_name: '',
    address: '',
    is_online: false,
    is_rsvp: false,
    currency: 'HTG',
    ticket_tiers: [{ name: 'General Admission', price: '0', quantity: '100' }],
    age_policy: null,
    dress_code: null,
    amenities: [],
  }

  it('writes times the way the composer does', () => {
    expect(to12h('21:00')).toBe('9:00 PM')
    expect(to12h('00:30')).toBe('12:30 AM')
    expect(to12h('12:00')).toBe('12:00 PM')
  })

  it('fills an empty draft, with the end on the next morning', () => {
    const { patch, filled, check } = flyerDraftPatch(read, draft, ['HTG', 'USD'])
    expect(patch).toMatchObject({
      title: 'Konpa Lakay',
      start_date: '2026-12-12',
      start_time: '9:00 PM',
      end_time: '3:00 AM',
      end_date: '2026-12-13',
      venue_name: 'Hotel Montana',
      currency: 'HTG',
      age_policy: '18+',
      amenities: ['backup_power', 'air_conditioning'],
    })
    expect(patch.ticket_tiers?.[0].price).toBe('1500')
    expect(filled).toEqual(['title', 'date', 'start_time', 'end_time', 'venue_name', 'price', 'age_policy', 'amenities'])
    expect(check).toEqual(['start_time'])
  })

  it('never overwrites what the organizer typed, or a ticket they set up', () => {
    const typed = { ...draft, title: 'Mine', start_time: '8:00 PM', ticket_tiers: [{ name: 'VIP', price: '50', quantity: '10' }] }
    const { patch, filled } = flyerDraftPatch(read, typed, ['HTG', 'USD'])
    expect(patch.title).toBeUndefined()
    expect(patch.start_time).toBeUndefined()
    expect(patch.ticket_tiers).toBeUndefined()
    expect(filled).not.toContain('title')
  })

  it('adds venue facts to what is ticked, never removes, and skips online events', () => {
    const { patch } = flyerDraftPatch(read, { ...draft, amenities: ['parking', 'air_conditioning'] }, ['HTG'])
    expect(patch.amenities).toEqual(['parking', 'backup_power', 'air_conditioning'])
    const same = flyerDraftPatch({ ...read, venue_name: null }, { ...draft, amenities: ['backup_power', 'air_conditioning'] }, ['HTG'])
    expect(same.filled).not.toContain('amenities')
    const online = flyerDraftPatch({ ...read, venue_name: null }, { ...draft, is_online: true }, ['HTG'])
    expect(online.patch.amenities).toBeUndefined()
    // An older server sends no amenities at all.
    const { amenities: _drop, ...older } = read
    expect(flyerDraftPatch(older as FlyerRead, draft, ['HTG']).patch.amenities).toBeUndefined()
  })

  it('leaves the price when the flyer currency is not sold in the event country', () => {
    const { patch, currencyNote } = flyerDraftPatch(read, { ...draft, currency: 'USD' }, ['USD'])
    expect(patch.ticket_tiers).toBeUndefined()
    expect(currencyNote).toBe('HTG')
  })
})

describe('the flyer reader spots venue facts', () => {
  const read = (...texts: string[]) =>
    parseFlyerText(
      texts.map((text) => ({ text, height: 20, confidence: 90 })),
      new Date('2026-11-01T12:00:00Z')
    ).amenities

  it('maps the words flyers print, in Kreyòl, French and English', () => {
    expect(read('KONPA LAKAY', 'Dèlko 24/24 · Parking gratuit', 'Sécurité assurée')).toEqual(['parking', 'backup_power', 'security'])
    expect(read('Salle climatisée', 'Tables VIP disponibles', 'Open bar')).toEqual(['air_conditioning', 'table_service', 'bar'])
    expect(read('FULL AC', 'Manje sou plas')).toEqual(['air_conditioning', 'food'])
    expect(read('Wheelchair accessible', 'ASL interpreter')).toEqual(['wheelchair', 'sign_language'])
  })

  it('is cautious: a bar in the venue name or an "ac" fragment is not a fact', () => {
    expect(read('Sunset Bar Live', 'Rue Pacot')).toEqual([])
    expect(read('Lakay Lounge', 'Delmas 75, Pétion-ville')).toEqual([])
  })

  it('only ever returns venue-details keys', () => {
    for (const k of read('Generator, AC, parking, security, VIP tables, food, open bar, wheelchair, sign language')) {
      expect(web.VENUE_AMENITIES as readonly string[]).toContain(k)
    }
  })
})

describe('firestore.rules validates venue details', () => {
  const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
  const fn = rules.slice(rules.indexOf('function validVenueDetails'), rules.indexOf('function isCurrencyAllowedForCountry'))
  const events = rules.slice(rules.indexOf('match /events/{eventId}'), rules.indexOf('// If country/currency changes'))

  it('allows exactly the helper keys', () => {
    for (const k of web.VENUE_AMENITIES) expect(fn).toContain(`'${k}'`)
    for (const k of web.VENUE_SETTINGS) expect(fn).toContain(`'${k}'`)
    for (const k of web.AGE_POLICIES) expect(fn).toContain(`'${k}'`)
    expect(fn).toContain(`dress.size() <= ${web.DRESS_CODE_MAX}`)
    expect(fn).toContain(`amenities.size() <= ${web.VENUE_AMENITIES.length}`)
    // .get() defaults, so events written before these fields stay writable.
    expect(fn).not.toMatch(/d\.(amenities|venue_setting|age_policy|dress_code)\b/)
  })

  it('is checked on create and on the organizer update', () => {
    expect(events.match(/validVenueDetails\(request\.resource\.data\)/g)).toHaveLength(2)
  })
})
