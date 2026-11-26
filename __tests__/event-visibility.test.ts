/**
 * Public / Unlisted (lib/events/visibility, mobile/lib/eventVisibility): the
 * rule, the app mirror, and that every public listing surface applies it.
 */
jest.mock('../mobile/config/firebase', () => ({ db: { __db: true } }))
jest.mock('../mobile/node_modules/firebase/firestore', () => ({}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eventVisibility, isListable, isPubliclyListed, isUnlisted, visibilityFields } from '@/lib/events/visibility'
import * as mobile from '../mobile/lib/eventVisibility'
import { mergeUpcomingEvents } from '../mobile/lib/api/eventFeed'

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')

describe('event visibility (web)', () => {
  it('only show_on_explore === false is unlisted; missing or true stays public', () => {
    expect(eventVisibility({ show_on_explore: false })).toBe('unlisted')
    expect(eventVisibility({ show_on_explore: true })).toBe('public')
    expect(eventVisibility({})).toBe('public')
    expect(eventVisibility(null)).toBe('public')
    expect(eventVisibility(undefined)).toBe('public')
    // Not a boolean false (a stray string) never hides an event.
    expect(eventVisibility({ show_on_explore: 'false' })).toBe('public')
    expect(eventVisibility({ show_on_explore: 0 })).toBe('public')
  })

  it('isUnlisted / isPubliclyListed are opposites', () => {
    for (const e of [{ show_on_explore: false }, { show_on_explore: true }, {}, null]) {
      expect(isPubliclyListed(e)).toBe(!isUnlisted(e))
    }
  })

  it('isListable also drops rejected and held-for-review events', () => {
    expect(isListable({})).toBe(true)
    expect(isListable({ show_on_explore: false })).toBe(false)
    expect(isListable({ rejected: true })).toBe(false)
    expect(isListable({ hidden_pending_review: true })).toBe(false)
    expect(isListable(null)).toBe(true)
  })

  it('visibilityFields maps the choice to the stored field', () => {
    expect(visibilityFields('public')).toEqual({ show_on_explore: true })
    expect(visibilityFields('unlisted')).toEqual({ show_on_explore: false })
    expect(eventVisibility(visibilityFields('unlisted'))).toBe('unlisted')
  })
})

describe('event visibility (app mirror)', () => {
  it('agrees with the web helper', () => {
    for (const e of [{ show_on_explore: false }, { show_on_explore: true }, {}, null, undefined, { show_on_explore: 'false' }]) {
      expect(mobile.eventVisibility(e as any)).toBe(eventVisibility(e as any))
      expect(mobile.isPubliclyListed(e as any)).toBe(isPubliclyListed(e as any))
    }
  })

  it("the app's country feed drops unlisted events before the cap", () => {
    const doc = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      data: () => ({ start_datetime: new Date(Date.now() + 86_400_000).toISOString(), ...extra }),
    })
    const out = mergeUpcomingEvents([[doc('a', { show_on_explore: false }), doc('b'), doc('c', { show_on_explore: true })]], new Date(), 2)
    expect(out.map((e) => e.id)).toEqual(['b', 'c'])
  })
})

describe('every public listing applies it', () => {
  it.each([
    ["lib/data/events.ts", /isUnlisted\((data|d\.data\(\))\)/],
    ['app/sitemap.ts', /isPubliclyListed\(/],
    ['app/categories/CategoriesContent.tsx', /isListable\(/],
    ['app/profile/organizer/[organizerId]/page.tsx', /isPubliclyListed\(/],
    ['app/profile/organizer/[organizerId]/opengraph-image.tsx', /isPubliclyListed\(/],
    ['app/events/[id]/page.tsx', /isListable\(/],
    ['app/api/events/[id]/publish/route.ts', /isPubliclyListed\(eventData\)/],
    ['lib/notifications/weekly-digest.ts', /isPubliclyListed\(/],
    ['mobile/lib/api/eventFeed.ts', /isUnlisted\(/],
    ['mobile/screens/OrganizerProfileScreen.tsx', /isPubliclyListed\(/],
  ])('%s', (file, pattern) => {
    expect(src(file)).toMatch(pattern)
  })

  it('the web event reader passes the flag on, and an unlisted page is noindex', () => {
    expect(src('lib/data/events.ts')).toMatch(/show_on_explore: data\?\.show_on_explore === false \? false : undefined/)
    expect(src('app/events/[id]/page.tsx')).toMatch(/isUnlisted\(event\) \? \{ robots: \{ index: false/)
  })
})
