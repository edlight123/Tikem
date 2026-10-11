import {
  COMPOSER_COUNTRIES,
  composerCurrencyOptions,
  currencyAfterCountryChange,
  defaultCityForCountry,
  defaultComposerCurrency,
  defaultPassFeesToBuyer,
  editorBlocksPaidPublish,
  exampleCityForCountry,
  isDefaultCity,
  missingPublishStep,
  pickDefaultComposerCountry,
  resolveComposerCountry,
  timezoneForEvent,
} from '@/lib/events/composer-country'
import { getAllowedEventCurrencies, isEventCurrencyAllowedForCountry } from '@/lib/currency-policy'
import { currenciesForCountry } from '@/lib/country-support'

describe('web composer: country → currency', () => {
  it('offers exactly the countries the web composer supports', () => {
    expect([...COMPOSER_COUNTRIES]).toEqual(['HT', 'US', 'CA', 'FR'])
  })

  it.each([
    ['HT', ['USD', 'HTG'], 'HTG'],
    ['US', ['USD'], 'USD'],
    ['CA', ['CAD'], 'CAD'],
    ['FR', ['EUR'], 'EUR'],
  ])('%s offers %j and defaults to %s', (country, options, def) => {
    expect(composerCurrencyOptions(country)).toEqual(options)
    expect(defaultComposerCurrency(country)).toBe(def)
  })

  it('agrees with country-support on the set of allowed currencies', () => {
    for (const c of COMPOSER_COUNTRIES) {
      expect([...getAllowedEventCurrencies(c)].sort()).toEqual([...currenciesForCountry(c)].sort())
    }
  })

  it('accepts FR → EUR (firestore.rules already did; currency-policy used to say USD)', () => {
    expect(isEventCurrencyAllowedForCountry('FR', 'EUR')).toBe(true)
    expect(isEventCurrencyAllowedForCountry('France', 'eur')).toBe(true)
    expect(isEventCurrencyAllowedForCountry('FR', 'USD')).toBe(false)
  })

  it('never carries a currency the new country refuses', () => {
    expect(currencyAfterCountryChange('US', 'HTG')).toBe('USD')
    expect(currencyAfterCountryChange('CA', 'USD')).toBe('CAD')
    expect(currencyAfterCountryChange('FR', 'USD')).toBe('EUR')
    // ...but keeps one it allows.
    expect(currencyAfterCountryChange('HT', 'USD')).toBe('USD')
    expect(currencyAfterCountryChange('HT', 'EUR')).toBe('HTG')
  })

  it('defaults the fee: Haiti absorbs, US/CA/FR pass it on', () => {
    expect(defaultPassFeesToBuyer('HT')).toBe(false)
    expect(defaultPassFeesToBuyer('US')).toBe(true)
    expect(defaultPassFeesToBuyer('CA')).toBe(true)
    expect(defaultPassFeesToBuyer('FR')).toBe(true)
  })
})

describe('web composer: starting country, city and timezone', () => {
  it('picks the first resolvable composer country, else Haiti', () => {
    expect(pickDefaultComposerCountry(undefined, 'United States')).toBe('US')
    expect(pickDefaultComposerCountry('DO', 'Canada')).toBe('CA') // DO is not offered on web
    expect(pickDefaultComposerCountry('', null)).toBe('HT')
    expect(resolveComposerCountry('France')).toBe('FR')
    expect(resolveComposerCountry('Narnia')).toBe('HT')
  })

  it('only Haiti prefills a city; elsewhere the placeholder gives a local example', () => {
    expect(defaultCityForCountry('HT')).toBe('Port-au-Prince')
    expect(defaultCityForCountry('US')).toBe('')
    expect(exampleCityForCountry('US')).toBe('New York')
    expect(exampleCityForCountry('FR')).toBe('Paris')
    expect(isDefaultCity('Port-au-Prince')).toBe(true)
    expect(isDefaultCity('')).toBe(true)
    expect(isDefaultCity('Miami')).toBe(false)
  })

  it('derives the event timezone from city, then country', () => {
    expect(timezoneForEvent('HT', 'Port-au-Prince')).toBe('America/Port-au-Prince')
    expect(timezoneForEvent('US', 'Miami')).toBe('America/New_York')
    expect(timezoneForEvent('US', 'Los Angeles')).toBe('America/Los_Angeles')
    expect(timezoneForEvent('CA', '')).toBe('America/Toronto')
    expect(timezoneForEvent('FR', 'Paris')).toBe('Europe/Paris')
  })
})

describe('web composer: paid publish mirrors the server gate', () => {
  it('Haiti: an unverified organizer may publish a paid event (publish now, verify before withdrawing)', () => {
    // Whatever the verdict, the editor never blocks Haiti — the server has no
    // publish-time gate there.
    expect(editorBlocksPaidPublish({ country: 'HT', isPaid: true, verdict: null })).toBe(false)
    expect(
      editorBlocksPaidPublish({
        country: 'HT',
        isPaid: true,
        verdict: { allowed: false, code: 'verification_required' },
      })
    ).toBe(false)
  })

  it('US/CA/FR: blocks on a definite server "no" and names the missing step', () => {
    for (const country of ['US', 'CA', 'FR']) {
      const identity = { allowed: false as const, code: 'verification_required' }
      expect(editorBlocksPaidPublish({ country, isPaid: true, verdict: identity })).toBe(true)
      expect(missingPublishStep(identity)).toBe('identity')
    }
    expect(missingPublishStep({ allowed: false, code: 'stripe_connect_required' })).toBe('stripe_connect')
    expect(missingPublishStep({ allowed: false, code: 'stripe_onboarding_incomplete' })).toBe('stripe_onboarding')
    expect(missingPublishStep({ allowed: false, code: 'stripe_account_unavailable' })).toBe('stripe_reconnect')
  })

  it('never blocks on a pending check, an allowed verdict, a retryable outage, or a free event', () => {
    expect(editorBlocksPaidPublish({ country: 'US', isPaid: true, verdict: null })).toBe(false)
    expect(editorBlocksPaidPublish({ country: 'US', isPaid: true, verdict: { allowed: true } })).toBe(false)
    expect(
      editorBlocksPaidPublish({
        country: 'US',
        isPaid: true,
        verdict: { allowed: false, code: 'stripe_unreachable', retryable: true },
      })
    ).toBe(false)
    expect(
      editorBlocksPaidPublish({
        country: 'US',
        isPaid: false,
        verdict: { allowed: false, code: 'verification_required' },
      })
    ).toBe(false)
  })
})
