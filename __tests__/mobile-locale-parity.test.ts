import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

/**
 * The three mobile locale files must stay KEY-IDENTICAL. A key missing from
 * one language renders as its raw path on the device ("doorScanner.result…"),
 * which at an event door or on a settings screen reads as broken.
 */
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

const base = flatten(en)

// Optional per-language grammar variants ("au Québec", "en Haïti") that
// mobile/lib/locationCopy.ts reads with a fallback. Only French needs them.
const OPTIONAL_EXTRA = /^(countriesIn|regionsIn)\./

describe.each([
  ['fr', fr],
  ['ht', ht],
])('mobile %s locale', (_lang, locale) => {
  const other = flatten(locale)

  it('has exactly the English keys', () => {
    expect(Object.keys(base).filter((k) => !(k in other))).toEqual([])
    expect(Object.keys(other).filter((k) => !(k in base) && !OPTIONAL_EXTRA.test(k))).toEqual([])
  })

  it.each(['doorScanner', 'notificationSettings', 'organizerTicketScanner'])(
    'has no empty strings and keeps placeholders in %s',
    (section) => {
      const keys = Object.keys(base).filter((k) => k.startsWith(`${section}.`))
      expect(keys.length).toBeGreaterThan(0)
      for (const k of keys) {
        expect({ k, empty: !String(other[k] ?? '').trim() }).toEqual({ k, empty: false })
        const want = (base[k].match(/\{\w+\}/g) || []).sort()
        const got = (String(other[k] ?? '').match(/\{\w+\}/g) || []).sort()
        expect({ k, got }).toEqual({ k, got: want })
      }
    }
  )
})
