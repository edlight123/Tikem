/**
 * The app side of phone sign-in: the on/off gate (mobile/lib/phoneAuthGate.ts)
 * and the strings. There is no React Native renderer in this repo, so "the
 * login screen is unchanged while off" is pinned through the gate the screen
 * branches on: every input combination short of (switch on AND server on)
 * must be OFF, and the dev override must not work in a release build.
 */

import {
  shouldOfferPhoneAuth,
  composePhone,
  defaultPhoneCountry,
  phoneErrorKey,
  prettyPhone,
  looksDialable,
  PHONE_AUTH_COUNTRIES,
} from '../mobile/lib/phoneAuthGate'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'
import webEn from '../public/locales/en/auth.json'
import webFr from '../public/locales/fr/auth.json'
import webHt from '../public/locales/ht/auth.json'

describe('shouldOfferPhoneAuth', () => {
  const bools = [false, true]
  const cases: Array<[boolean, boolean, boolean, boolean]> = []
  for (const remoteSwitch of bools)
    for (const serverEnabled of bools)
      for (const forceFlag of bools)
        for (const isDev of bools) cases.push([remoteSwitch, serverEnabled, forceFlag, isDev])

  it.each(cases)('remote=%s server=%s force=%s dev=%s', (remoteSwitch, serverEnabled, forceFlag, isDev) => {
    const expected = serverEnabled && (remoteSwitch || (forceFlag && isDev))
    expect(shouldOfferPhoneAuth({ remoteSwitch, serverEnabled, forceFlag, isDev })).toBe(expected)
  })

  it('defaults (everything off) render the existing login', () => {
    expect(shouldOfferPhoneAuth({ remoteSwitch: false, serverEnabled: false, forceFlag: false, isDev: false })).toBe(false)
  })

  it('the force flag is ignored in release builds', () => {
    expect(shouldOfferPhoneAuth({ remoteSwitch: false, serverEnabled: true, forceFlag: true, isDev: false })).toBe(false)
  })

  it('a truthy non-boolean never counts as on', () => {
    expect(shouldOfferPhoneAuth({ remoteSwitch: 'true' as any, serverEnabled: true, forceFlag: false, isDev: false })).toBe(false)
  })
})

describe('phone composition', () => {
  const by = (iso: string) => PHONE_AUTH_COUNTRIES.find((c) => c.iso === iso)!

  it('lists Haiti first and defaults to it', () => {
    expect(PHONE_AUTH_COUNTRIES.map((c) => c.iso)).toEqual(['HT', 'US', 'CA', 'FR', 'DO'])
    expect(defaultPhoneCountry(null).iso).toBe('HT')
    expect(defaultPhoneCountry('JM').iso).toBe('HT')
    expect(defaultPhoneCountry('ca').iso).toBe('CA')
  })

  it.each([
    ['HT', '3712 3456', '+50937123456'],
    ['HT', '+1 212 555 0123', '+12125550123'],
    ['HT', '00 33 6 12 34 56 78', '+33612345678'],
    ['FR', '06 12 34 56 78', '+33612345678'],
    ['US', '1 (212) 555-0123', '+12125550123'],
    ['US', '212-555-0123', '+12125550123'],
  ])('%s %s -> %s', (iso, input, out) => {
    expect(composePhone(by(iso), input)).toBe(out)
  })

  it('formats and sanity-checks', () => {
    expect(prettyPhone('+50937123456')).toBe('+509 3712 3456')
    expect(prettyPhone('+12125550123')).toBe('+1 212 555 0123')
    expect(looksDialable('123')).toBe(false)
    expect(looksDialable('3712 3456')).toBe(true)
  })
})

function flatten(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k))
    }
  } else {
    out[prefix] = String(value)
  }
  return out
}

describe('phone sign-in strings', () => {
  const mobile = { en: flatten(en), fr: flatten(fr), ht: flatten(ht) }

  it('every error code the app can show has a string in en/fr/ht', () => {
    for (const code of [
      'invalid_phone', 'unsupported_country', 'cooldown', 'rate_limited', 'send_failed', 'unavailable',
      'invalid_code', 'too_many_attempts', 'account_disabled', 'phone_in_use', 'phone_already_set',
      'unauthorized', 'nope',
    ]) {
      const key = phoneErrorKey(code)
      for (const lang of ['en', 'fr', 'ht'] as const) {
        expect({ lang, key, has: Boolean(mobile[lang][key]) }).toEqual({ lang, key, has: true })
      }
    }
    expect(phoneErrorKey(undefined)).toBe('auth.phone.errors.generic')
  })

  it('mobile phone strings: key-identical, non-empty, placeholders kept, no em dashes', () => {
    const keys = Object.keys(mobile.en).filter((k) => k.startsWith('auth.phone.'))
    expect(keys.length).toBeGreaterThan(20)
    for (const lang of ['fr', 'ht'] as const) {
      const other = Object.keys(mobile[lang]).filter((k) => k.startsWith('auth.phone.'))
      expect(other.sort()).toEqual([...keys].sort())
    }
    for (const lang of ['en', 'fr', 'ht'] as const) {
      for (const k of keys) {
        const v = mobile[lang][k]
        expect({ k, lang, empty: !v.trim() }).toEqual({ k, lang, empty: false })
        expect({ k, lang, dash: v.includes('—') }).toEqual({ k, lang, dash: false })
        const want = (mobile.en[k].match(/\{\w+\}/g) || []).sort()
        expect({ k, lang, got: (v.match(/\{\w+\}/g) || []).sort() }).toEqual({ k, lang, got: want })
      }
    }
  })

  it('web phone strings: key-identical across en/fr/ht, no em dashes', () => {
    const w = { en: flatten((webEn as any).phone), fr: flatten((webFr as any).phone), ht: flatten((webHt as any).phone) }
    const keys = Object.keys(w.en).sort()
    expect(keys.length).toBeGreaterThan(10)
    expect(Object.keys(w.fr).sort()).toEqual(keys)
    expect(Object.keys(w.ht).sort()).toEqual(keys)
    for (const lang of ['en', 'fr', 'ht'] as const) {
      for (const k of keys) expect(w[lang][k].includes('—')).toBe(false)
    }
  })
})
