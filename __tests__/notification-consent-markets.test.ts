/** @jest-environment node */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

/**
 * "Events near you" and the weekend digest are opt-in in Canada and France
 * (CASL / CNIL), and stay default-on in Haiti and the US. An explicit choice
 * always wins, so no existing user's setting moves.
 */
import { decideSend, isCategoryEnabled } from '@/lib/notifications/policy'
import { inConsentMarket, readUserNotifyPref, readUserNotifyPrefs } from '@/lib/notifications/userPreferences'
import { planThursdaySend } from '@/lib/notifications/weekly-digest'
import * as mobileDefaults from '../mobile/lib/notifyDefaults'

// Thursday 2026-11-26, 18:00 in Montréal / Port-au-Prince / New York (UTC-5).
const THU_EVENING = new Date('2026-11-26T23:00:00Z')
// 10:00 local in every market: outside quiet hours.
const MIDDAY = new Date('2026-11-26T15:00:00Z')

describe('discovery default by market', () => {
  it.each(['HT', 'US'])('%s: unset discovery and weekend digest stay on', (country) => {
    const user = { last_seen_country: country, default_country: country }
    expect(isCategoryEnabled(user, 'discovery')).toBe(true)
    expect(isCategoryEnabled(user, 'weekend_digest')).toBe(true)
  })

  it.each(['CA', 'FR', 'ca', ' fr '])('%s: unset discovery and weekend digest are off', (country) => {
    const user = { last_seen_country: country }
    expect(isCategoryEnabled(user, 'discovery')).toBe(false)
    expect(isCategoryEnabled(user, 'weekend_digest')).toBe(false)
    expect(decideSend({ user, category: 'discovery', now: MIDDAY })).toEqual({
      send: false,
      reason: 'category_disabled',
    })
  })

  it('either country signal puts a person in a consent market', () => {
    expect(inConsentMarket({ default_country: 'CA', last_seen_country: 'HT' })).toBe(true)
    expect(inConsentMarket({ default_country: 'HT', last_seen_country: 'FR' })).toBe(true)
    expect(inConsentMarket({ defaultCountry: 'FR' })).toBe(true)
    expect(inConsentMarket({ default_country: 'HT', last_seen_country: 'US' })).toBe(false)
    expect(inConsentMarket({})).toBe(false)
    expect(inConsentMarket(null)).toBe(false)
  })

  it('unknown market keeps the old default (on)', () => {
    expect(isCategoryEnabled({}, 'discovery')).toBe(true)
    expect(isCategoryEnabled(null, 'weekend_digest')).toBe(true)
  })

  it('an explicit choice wins in every market', () => {
    expect(isCategoryEnabled({ last_seen_country: 'CA', notify_discovery: true }, 'discovery')).toBe(true)
    expect(isCategoryEnabled({ last_seen_country: 'FR', notify_weekend_digest: true }, 'weekend_digest')).toBe(true)
    expect(isCategoryEnabled({ last_seen_country: 'HT', notify_discovery: false }, 'discovery')).toBe(false)
  })

  it('only the two discovery switches change; everything else stays on in CA/FR', () => {
    const prefs = readUserNotifyPrefs({ last_seen_country: 'CA' })
    expect(prefs).toEqual({
      notify_reminders: true,
      notify_discovery: false,
      notify_filling_fast: true,
      notify_national_day: true,
      notify_weekend_digest: false,
      notify_friend_invites: true,
      notify_followed_organizers: true,
    })
    expect(isCategoryEnabled({ last_seen_country: 'FR' }, 'filling_fast')).toBe(true)
    expect(isCategoryEnabled({ last_seen_country: 'FR' }, 'reminder')).toBe(true)
  })

  it('the Thursday push skips an unset Montréal user and reaches one who opted in', () => {
    const upcoming = [
      { id: 'e1', title: 'Kompa Night', city: 'Montréal', start: new Date('2026-11-28T01:00:00Z') },
    ]
    const base = { last_seen_city: 'Montréal', last_seen_country: 'CA' }
    expect(planThursdaySend(base, upcoming as any, THU_EVENING)).toBeNull()
    const optedIn = planThursdaySend({ ...base, notify_weekend_digest: true }, upcoming as any, THU_EVENING)
    expect(optedIn?.category).toBe('weekend_digest')
  })

  it('the app reads the same defaults as the server', () => {
    const cases: Record<string, any>[] = [
      {},
      { last_seen_country: 'HT' },
      { last_seen_country: 'US', default_country: 'US' },
      { last_seen_country: 'CA' },
      { default_country: 'FR' },
      { last_seen_country: 'CA', notify_discovery: true },
      { last_seen_country: 'HT', notify_weekend_digest: false },
    ]
    for (const data of cases) {
      for (const field of ['notify_discovery', 'notify_weekend_digest', 'notify_filling_fast']) {
        expect(mobileDefaults.readNotifyPref(data, field)).toBe(readUserNotifyPref(data, field))
      }
    }
  })
})
