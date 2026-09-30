import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

/**
 * The mobile payout screens (settings + event earnings) must define the same
 * keys in en/fr/ht. A missing key renders as the raw key path on the device,
 * which on a money screen reads as broken.
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

const SECTIONS = ['organizerPayoutSettings', 'organizerEarnings'] as const

describe.each(SECTIONS)('mobile %s locale parity', (section) => {
  const base = flatten((en as any)[section])

  it.each([
    ['fr', fr],
    ['ht', ht],
  ])('%s has exactly the English keys, none empty', (_lang, locale) => {
    const other = flatten((locale as any)[section])
    expect(Object.keys(base).filter((k) => !(k in other))).toEqual([])
    expect(Object.keys(other).filter((k) => !(k in base))).toEqual([])
    expect(Object.entries(other).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([])
  })

  it('keeps every {placeholder} in every language', () => {
    for (const locale of [fr, ht]) {
      const other = flatten((locale as any)[section])
      for (const [k, v] of Object.entries(base)) {
        const want = (v.match(/\{\w+\}/g) || []).sort()
        const got = (String(other[k] ?? '').match(/\{\w+\}/g) || []).sort()
        expect({ k, got }).toEqual({ k, got: want })
      }
    }
  })
})
