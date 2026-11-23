/**
 * Venue details (parking, step-free, accessible washrooms, coat check,
 * indoor/outdoor, age policy, dress code): the web and app helpers agree, the
 * Discover filters use them, the app's flyer fill only touches empty fields,
 * and firestore.rules validates the same shapes the helpers write.
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

const samples: unknown[] = [
  {},
  null,
  { amenities: ['step_free', 'parking', 'wudu', 3], venue_setting: 'outdoor', age_policy: '21+', dress_code: '  All   white  ' },
  { amenities: 'parking', venue_setting: 'roof', age_policy: '16+', dress_code: 42 },
  { amenities: ['coat_check', 'accessible_washrooms'], venue_setting: 'mixed', dress_code: 'x'.repeat(90) },
]

describe('venue details: web and app agree', () => {
  it('the mirror carries the same keys', () => {
    expect(app.VENUE_AMENITIES).toEqual(web.VENUE_AMENITIES)
    expect(app.VENUE_SETTINGS).toEqual(web.VENUE_SETTINGS)
    expect(app.AGE_POLICIES).toEqual(web.AGE_POLICIES)
    expect(app.DRESS_CODE_MAX).toBe(web.DRESS_CODE_MAX)
    expect(app.VENUE_DETAIL_ICONS).toEqual(web.VENUE_DETAIL_ICONS)
  })

  it.each(samples.map((s, i) => [i, s]))('sample %i reads the same on both', (_i, sample) => {
    const w = web.venueDetailsOf(sample)
    expect(app.venueDetailsOf(sample)).toEqual(w)
    expect(app.venueDetailLines(w)).toEqual(web.venueDetailLines(w))
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

  it('lists access first, then setting, then the rules', () => {
    const lines = web.venueDetailLines(web.venueDetailsOf(samples[2]))
    expect(lines.map((l) => l.key)).toEqual(['step_free', 'parking', 'outdoor', 'age_21', 'dress_code'])
    expect(lines[lines.length - 1].value).toBe('All white')
  })
})

describe('the Step-free filter', () => {
  const events: any[] = [
    { id: 'a', amenities: ['step_free'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'b', amenities: ['parking'], start_datetime: '2026-12-01T20:00:00Z' },
    { id: 'c', start_datetime: '2026-12-01T20:00:00Z' },
  ]

  it('web: keeps only step-free events, round-trips the URL and counts as a filter', () => {
    const f = { ...DEFAULT_FILTERS, stepFree: true }
    expect(filterEvents(events, f).map((e: any) => e.id)).toEqual(['a'])
    expect(filterEvents(events, DEFAULT_FILTERS)).toHaveLength(3)
    const params = serializeFilters(f)
    expect(params.get('stepFree')).toBe('1')
    expect(filtersEqual(parseFiltersFromURL(params), f)).toBe(true)
    expect(parseFiltersFromURL(new URLSearchParams()).stepFree).toBeUndefined()
    expect(countActiveFilters(f)).toBe(countActiveFilters(DEFAULT_FILTERS) + 1)
  })

  it('app: keeps only step-free events and counts as a filter', () => {
    const appEvents = events.map((e) => ({ ...e, start_datetime: new Date(e.start_datetime) }))
    const f = { ...APP_DEFAULT_FILTERS, country: '', stepFree: true }
    expect(applyFilters(appEvents as any, f).map((e: any) => e.id)).toEqual(['a'])
    expect(appCount(f)).toBe(appCount(APP_DEFAULT_FILTERS) + 1)
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
    })
    expect(patch.ticket_tiers?.[0].price).toBe('1500')
    expect(filled).toEqual(['title', 'date', 'start_time', 'end_time', 'venue_name', 'price', 'age_policy'])
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

  it('leaves the price when the flyer currency is not sold in the event country', () => {
    const { patch, currencyNote } = flyerDraftPatch(read, { ...draft, currency: 'USD' }, ['USD'])
    expect(patch.ticket_tiers).toBeUndefined()
    expect(currencyNote).toBe('HTG')
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
