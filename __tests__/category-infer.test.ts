/**
 * Imported events get a real category (lib/events/categoryInfer), so they show
 * in the home category rails without the organizer setting each by hand
 * (tester 2026-11-25), and imported events missing what Tikèm needs are
 * flagged on the organizer's list (lib/events/needsAttention).
 */
import {
  categoryBackfillFor,
  foldText,
  importCategoryFields,
  inferEventCategory,
} from '@/lib/events/categoryInfer'
import { CATEGORIES } from '@/lib/filters/config'
import { mapEventbriteEvent } from '@/lib/import/eventbrite'
import { ebCategoryHints, planEventbriteDoc } from '@/lib/import/eventbrite-sync'
import * as web from '@/lib/events/needsAttention'
import * as mobile from '../mobile/lib/needsAttention'

const cat = (input: Parameters<typeof inferEventCategory>[0]) => inferEventCategory(input).category

describe('inferEventCategory', () => {
  it('reads the title keywords', () => {
    expect(cat({ title: 'Kompa Night Live with Carimi' })).toBe('Concert')
    expect(cat({ title: 'Haitian Flag Day Festival' })).toBe('Festival')
    expect(cat({ title: 'Youth Basketball Tournament' })).toBe('Sports')
    expect(cat({ title: 'Grant writing workshop' })).toBe('Workshop')
    expect(cat({ title: 'Women in Tech Summit 2027' })).toBe('Conference')
    expect(cat({ title: 'Stand-up comedy night' })).toBe('Theater')
    expect(cat({ title: 'Sunday brunch & wine tasting' })).toBe('Food & Drink')
    expect(cat({ title: 'Family picnic in the park' })).toBe('Family')
    expect(cat({ title: 'All White Party' })).toBe('Party')
    expect(cat({ title: 'First aid certification course' })).toBe('Workshop')
  })

  it('reads French and Creole, accents or not', () => {
    expect(cat({ title: 'Soirée Konpa au Plateau' })).toBe('Concert')
    expect(cat({ title: 'Atelier de cuisine haïtienne' })).toBe('Workshop')
    expect(cat({ title: 'Conférence sur l’entrepreneuriat' })).toBe('Conference')
    expect(cat({ title: 'Kanaval Montréal' })).toBe('Festival')
    expect(foldText('Soirée Konpa!')).toBe('soiree konpa')
  })

  it('trusts the source format and category over a stray word', () => {
    expect(cat({ title: 'An evening with friends', sourceFormat: 'Concert or Performance' })).toBe('Concert')
    expect(cat({ title: 'Meet & greet', sourceCategory: '103' })).toBe('Concert') // Eventbrite id: Music
    expect(cat({ title: 'Meet & greet', sourceFormat: '9' })).toBe('Workshop') // Class, Training, or Workshop
    expect(cat({ title: 'Launch', sourceFormat: 'MusicEvent' })).toBe('Concert')
    expect(cat({ title: 'Launch', sourceFormat: 'SportsEvent' })).toBe('Sports')
    // A dinner gala filed under Music on Eventbrite: the format wins.
    expect(cat({ title: 'Annual gala', sourceCategory: 'Music', sourceFormat: 'Dinner or Gala' })).toBe('Food & Drink')
  })

  it('does not let a long description outvote the title', () => {
    const description = 'food food dinner brunch lunch tasting wine beer cocktail chef restaurant '.repeat(20)
    expect(cat({ title: 'Kompa concert', description })).toBe('Concert')
  })

  it('falls back to the general category, flagged as a guess', () => {
    expect(inferEventCategory({ title: 'Saturday' })).toEqual({ category: 'Other', confident: false })
    expect(inferEventCategory({ title: '', description: '' })).toEqual({ category: 'Other', confident: false })
    expect(inferEventCategory({ title: 'Bus outing', sourceCategory: 'Travel & Outdoor' }).confident).toBe(false)
    expect(inferEventCategory({ title: 'Kompa concert' }).confident).toBe(true)
  })

  it('always answers with a canonical category', () => {
    for (const title of ['x', 'Concert', 'gala dinner', 'yoga', 'expo', 'prayer', 'brunch party', 'kids camp']) {
      expect(CATEGORIES).toContain(cat({ title }))
    }
  })
})

describe('importCategoryFields', () => {
  const input = { title: 'Kompa concert' }
  it('infers for a new import and marks it as ours', () => {
    expect(importCategoryFields(null, input)).toEqual({ category: 'Concert', category_auto: true })
  })
  it('redoes the old blanket Other and our own guesses', () => {
    expect(importCategoryFields({ category: 'Other' }, input)).toEqual({ category: 'Concert', category_auto: true })
    expect(importCategoryFields({ category: 'Party', category_auto: true }, input)).toEqual({ category: 'Concert', category_auto: true })
    expect(importCategoryFields({ category: '' }, input)).toEqual({ category: 'Concert', category_auto: true })
  })
  it('never replaces the organizer’s pick', () => {
    expect(importCategoryFields({ category: 'Sports' }, input)).toEqual({})
    expect(importCategoryFields({ category: 'Sports', category_auto: false }, input)).toEqual({})
    expect(importCategoryFields({ category: 'Other', category_auto: false }, input)).toEqual({})
  })
})

describe('categoryBackfillFor', () => {
  it('fills events with no category and imports still on Other', () => {
    expect(categoryBackfillFor({ title: 'Kompa concert' })).toEqual({ category: 'Concert', category_auto: true })
    expect(categoryBackfillFor({ title: 'Kompa concert', category: 'Other', imported: { source: 'eventbrite' } })).toEqual({
      category: 'Concert',
      category_auto: true,
    })
    expect(categoryBackfillFor({ title: 'Kompa concert', category: 'Other', imported_from: { source: 'lu.ma' } })?.category).toBe('Concert')
  })
  it('leaves organizer picks, Tikèm-made events and no-ops alone', () => {
    expect(categoryBackfillFor({ title: 'Kompa concert', category: 'Other' })).toBeNull()
    expect(categoryBackfillFor({ title: 'Kompa concert', category: 'Party', imported: { source: 'eventbrite' } })).toBeNull()
    expect(categoryBackfillFor({ title: 'Kompa concert', category: 'Other', category_auto: false, imported: {} })).toBeNull()
    expect(categoryBackfillFor({ title: 'Saturday', category: 'Other', imported: { source: 'eventbrite' } })).toBeNull()
    expect(categoryBackfillFor(null)).toBeNull()
  })
})

describe('importers write the inferred category', () => {
  const ev = {
    id: '123',
    name: { text: 'Summer kickoff' },
    start: { utc: '2099-06-01T22:00:00Z', timezone: 'America/Toronto' },
    end: { utc: '2099-06-02T02:00:00Z' },
    status: 'live',
    category: { name: 'Music' },
    format: { name: 'Concert or Performance' },
    venue: { name: 'Hall', address: { city: 'Toronto', country: 'CA' } },
    ticket_classes: [{ free: true, quantity_total: 50 }],
  }

  it('Eventbrite hints come from names, else ids', () => {
    expect(ebCategoryHints(ev)).toEqual({ sourceCategory: 'Music', sourceSubcategory: null, sourceFormat: 'Concert or Performance' })
    expect(ebCategoryHints({ category_id: '114', format_id: '2' })).toEqual({ sourceCategory: '114', sourceSubcategory: null, sourceFormat: '2' })
  })

  it('the Eventbrite draft import carries them', () => {
    const d = mapEventbriteEvent(ev)!
    expect(d.sourceCategory).toBe('Music')
    expect(d.sourceFormat).toBe('Concert or Performance')
  })

  it('the Eventbrite sync writes a category on a new copy, and keeps an organizer pick', () => {
    const now = Date.parse('2099-01-01T00:00:00Z')
    const fresh = planEventbriteDoc({ ev, prev: null, orgId: 'org1', orgName: 'Org', now })
    expect(fresh.kind).toBe('write')
    if (fresh.kind === 'write') expect(fresh.data).toMatchObject({ category: 'Concert', category_auto: true })
    const kept = planEventbriteDoc({
      ev,
      prev: { organizer_id: 'org1', category: 'Party', category_auto: false, is_published: true, imported: { source: 'eventbrite' } },
      orgId: 'org1',
      orgName: 'Org',
      now,
    })
    if (kept.kind === 'write') expect(kept.data.category).toBeUndefined()
  })

})

describe('eventNeedsAttention', () => {
  const now = Date.parse('2099-01-01T00:00:00Z')
  const base = {
    imported: { source: 'eventbrite' },
    title: 'Kompa concert',
    category: 'Concert',
    banner_image_url: 'https://x/y.jpg',
    start_datetime: '2099-06-01T22:00:00Z',
    venue_name: 'Hall',
    description: 'A long enough description of the evening, with the lineup and the doors time.',
  }

  it('is empty for a complete import and for events made on Tikèm', () => {
    expect(web.eventNeedsAttention(base, now)).toEqual([])
    expect(web.eventNeedsAttention({ ...base, imported: undefined, category: '' }, now)).toEqual([])
  })

  it('lists what an import still misses, in order', () => {
    expect(
      web.eventNeedsAttention({ ...base, category: 'Other', banner_image_url: null, description: 'Short.' }, now),
    ).toEqual(['category', 'image', 'description'])
    expect(web.eventNeedsAttention({ ...base, category: '' }, now)).toEqual(['category'])
    expect(web.eventNeedsAttention({ ...base, venue_name: '', is_online: false }, now)).toEqual(['location'])
  })

  it('accepts an organizer-chosen Other and a cached description length', () => {
    expect(web.eventNeedsAttention({ ...base, category: 'Other', category_auto: false }, now)).toEqual([])
    const { description: _d, ...noText } = base
    expect(web.eventNeedsAttention({ ...noText, description_len: 120 }, now)).toEqual([])
  })

  it('skips past and cancelled events', () => {
    expect(web.eventNeedsAttention({ ...base, category: '', start_datetime: '2000-01-01T00:00:00Z' }, now)).toEqual([])
    expect(web.eventNeedsAttention({ ...base, category: '', status: 'cancelled' }, now)).toEqual([])
  })

  it('the app copy agrees with the web', () => {
    const cases = [
      base,
      { ...base, category: 'Other', banner_image_url: null, description: '' },
      { ...base, imported: undefined },
      { ...base, category: '', venue_name: '', is_online: true },
    ]
    for (const c of cases) expect(mobile.eventNeedsAttention(c, now)).toEqual(web.eventNeedsAttention(c, now))
    expect(mobile.ATTENTION_ITEMS).toEqual(web.ATTENTION_ITEMS)
  })
})

describe('fitness classes read as Sports', () => {
  const { inferEventCategory } = require('@/lib/events/categoryInfer')
  it.each([
    'Women Only Spin Class', 'Women Only Strength Class', 'Women Only TRX Class', 'Women Only Aerobic Step Class',
    'Ukhuwwah Women\'s Rowing', 'Laser Tag', 'Women\'s Running Practice', 'Women Only Fencing Lessons',
    'Women Only Axe Throwing', 'Women Only Aerials Class', 'Women Only Golf Lesson',
  ])('%s', (title) => {
    expect(inferEventCategory({ title, description: 'A fun social evening, come play with us at the club.' }).category).toBe('Sports')
  })
  it('a plain class stays a Workshop', () => {
    expect(inferEventCategory({ title: 'Arabic Calligraphy Class' }).category).toBe('Workshop')
  })
})
