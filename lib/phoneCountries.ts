/**
 * Dialling codes for the phone field, ordered for this audience.
 *
 * Haiti, the United States, Canada and France sit at the top (owner ask) —
 * between them they are almost every number this platform will ever collect.
 * Everything after `PRIORITY` is alphabetical by country name.
 *
 * Two things worth knowing before editing:
 *
 * 1. Several entries SHARE a dialling code — +1 covers the US, Canada and most
 *    of the Anglophone Caribbean; +590 covers Guadeloupe and Saint-Martin. So
 *    the ISO code, not the dial code, is the identity of a row. A `value` on a
 *    <select> must therefore be `iso`, or picking "Canada" would silently
 *    select "United States".
 * 2. The list is deliberately curated rather than exhaustive: the Americas,
 *    Europe and the Caribbean in full, plus the larger countries elsewhere.
 *    The field is optional everywhere it appears, so somebody in an omitted
 *    country can leave it blank rather than be blocked — but if a real user
 *    turns up from one, add the row.
 */

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2. The row's identity — dial codes are not unique. */
  iso: string
  name: string
  /** International dialling code, digits only, no plus. */
  dial: string
  flag: string
}

/** Pinned to the top of the list, in this order. */
export const PRIORITY_ISO = ['HT', 'US', 'CA', 'FR'] as const

/** Sensible starting selection: this is a Haitian platform. */
export const DEFAULT_PHONE_ISO = 'HT'

const REST: PhoneCountry[] = [
  { iso: 'AR', name: 'Argentina', dial: '54', flag: '🇦🇷' },
  { iso: 'AW', name: 'Aruba', dial: '297', flag: '🇦🇼' },
  { iso: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺' },
  { iso: 'AT', name: 'Austria', dial: '43', flag: '🇦🇹' },
  { iso: 'BS', name: 'Bahamas', dial: '1', flag: '🇧🇸' },
  { iso: 'BB', name: 'Barbados', dial: '1', flag: '🇧🇧' },
  { iso: 'BE', name: 'Belgium', dial: '32', flag: '🇧🇪' },
  { iso: 'BZ', name: 'Belize', dial: '501', flag: '🇧🇿' },
  { iso: 'BJ', name: 'Benin', dial: '229', flag: '🇧🇯' },
  { iso: 'BO', name: 'Bolivia', dial: '591', flag: '🇧🇴' },
  { iso: 'BR', name: 'Brazil', dial: '55', flag: '🇧🇷' },
  { iso: 'BF', name: 'Burkina Faso', dial: '226', flag: '🇧🇫' },
  { iso: 'CM', name: 'Cameroon', dial: '237', flag: '🇨🇲' },
  { iso: 'KY', name: 'Cayman Islands', dial: '1', flag: '🇰🇾' },
  { iso: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱' },
  { iso: 'CN', name: 'China', dial: '86', flag: '🇨🇳' },
  { iso: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴' },
  { iso: 'CG', name: 'Congo', dial: '242', flag: '🇨🇬' },
  { iso: 'CD', name: 'Congo (DRC)', dial: '243', flag: '🇨🇩' },
  { iso: 'CR', name: 'Costa Rica', dial: '506', flag: '🇨🇷' },
  { iso: 'CI', name: 'Côte d’Ivoire', dial: '225', flag: '🇨🇮' },
  { iso: 'CU', name: 'Cuba', dial: '53', flag: '🇨🇺' },
  { iso: 'CW', name: 'Curaçao', dial: '599', flag: '🇨🇼' },
  { iso: 'DK', name: 'Denmark', dial: '45', flag: '🇩🇰' },
  { iso: 'DM', name: 'Dominica', dial: '1', flag: '🇩🇲' },
  { iso: 'DO', name: 'Dominican Republic', dial: '1', flag: '🇩🇴' },
  { iso: 'EC', name: 'Ecuador', dial: '593', flag: '🇪🇨' },
  { iso: 'EG', name: 'Egypt', dial: '20', flag: '🇪🇬' },
  { iso: 'SV', name: 'El Salvador', dial: '503', flag: '🇸🇻' },
  { iso: 'ET', name: 'Ethiopia', dial: '251', flag: '🇪🇹' },
  { iso: 'FI', name: 'Finland', dial: '358', flag: '🇫🇮' },
  { iso: 'GF', name: 'French Guiana', dial: '594', flag: '🇬🇫' },
  { iso: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪' },
  { iso: 'GH', name: 'Ghana', dial: '233', flag: '🇬🇭' },
  { iso: 'GR', name: 'Greece', dial: '30', flag: '🇬🇷' },
  { iso: 'GD', name: 'Grenada', dial: '1', flag: '🇬🇩' },
  { iso: 'GP', name: 'Guadeloupe', dial: '590', flag: '🇬🇵' },
  { iso: 'GT', name: 'Guatemala', dial: '502', flag: '🇬🇹' },
  { iso: 'GN', name: 'Guinea', dial: '224', flag: '🇬🇳' },
  { iso: 'GY', name: 'Guyana', dial: '592', flag: '🇬🇾' },
  { iso: 'HN', name: 'Honduras', dial: '504', flag: '🇭🇳' },
  { iso: 'IN', name: 'India', dial: '91', flag: '🇮🇳' },
  { iso: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩' },
  { iso: 'IE', name: 'Ireland', dial: '353', flag: '🇮🇪' },
  { iso: 'IL', name: 'Israel', dial: '972', flag: '🇮🇱' },
  { iso: 'IT', name: 'Italy', dial: '39', flag: '🇮🇹' },
  { iso: 'JM', name: 'Jamaica', dial: '1', flag: '🇯🇲' },
  { iso: 'JP', name: 'Japan', dial: '81', flag: '🇯🇵' },
  { iso: 'KE', name: 'Kenya', dial: '254', flag: '🇰🇪' },
  { iso: 'LB', name: 'Lebanon', dial: '961', flag: '🇱🇧' },
  { iso: 'LU', name: 'Luxembourg', dial: '352', flag: '🇱🇺' },
  { iso: 'MG', name: 'Madagascar', dial: '261', flag: '🇲🇬' },
  { iso: 'ML', name: 'Mali', dial: '223', flag: '🇲🇱' },
  { iso: 'MQ', name: 'Martinique', dial: '596', flag: '🇲🇶' },
  { iso: 'MX', name: 'Mexico', dial: '52', flag: '🇲🇽' },
  { iso: 'MA', name: 'Morocco', dial: '212', flag: '🇲🇦' },
  { iso: 'NL', name: 'Netherlands', dial: '31', flag: '🇳🇱' },
  { iso: 'NZ', name: 'New Zealand', dial: '64', flag: '🇳🇿' },
  { iso: 'NI', name: 'Nicaragua', dial: '505', flag: '🇳🇮' },
  { iso: 'NG', name: 'Nigeria', dial: '234', flag: '🇳🇬' },
  { iso: 'NO', name: 'Norway', dial: '47', flag: '🇳🇴' },
  { iso: 'PA', name: 'Panama', dial: '507', flag: '🇵🇦' },
  { iso: 'PY', name: 'Paraguay', dial: '595', flag: '🇵🇾' },
  { iso: 'PE', name: 'Peru', dial: '51', flag: '🇵🇪' },
  { iso: 'PH', name: 'Philippines', dial: '63', flag: '🇵🇭' },
  { iso: 'PL', name: 'Poland', dial: '48', flag: '🇵🇱' },
  { iso: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { iso: 'PR', name: 'Puerto Rico', dial: '1', flag: '🇵🇷' },
  { iso: 'RO', name: 'Romania', dial: '40', flag: '🇷🇴' },
  { iso: 'SN', name: 'Senegal', dial: '221', flag: '🇸🇳' },
  { iso: 'SG', name: 'Singapore', dial: '65', flag: '🇸🇬' },
  { iso: 'ZA', name: 'South Africa', dial: '27', flag: '🇿🇦' },
  { iso: 'ES', name: 'Spain', dial: '34', flag: '🇪🇸' },
  { iso: 'LC', name: 'St. Lucia', dial: '1', flag: '🇱🇨' },
  { iso: 'MF', name: 'St. Martin', dial: '590', flag: '🇲🇫' },
  { iso: 'VC', name: 'St. Vincent & Grenadines', dial: '1', flag: '🇻🇨' },
  { iso: 'SR', name: 'Suriname', dial: '597', flag: '🇸🇷' },
  { iso: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪' },
  { iso: 'CH', name: 'Switzerland', dial: '41', flag: '🇨🇭' },
  { iso: 'TZ', name: 'Tanzania', dial: '255', flag: '🇹🇿' },
  { iso: 'TG', name: 'Togo', dial: '228', flag: '🇹🇬' },
  { iso: 'TT', name: 'Trinidad & Tobago', dial: '1', flag: '🇹🇹' },
  { iso: 'TR', name: 'Türkiye', dial: '90', flag: '🇹🇷' },
  { iso: 'TC', name: 'Turks & Caicos', dial: '1', flag: '🇹🇨' },
  { iso: 'UG', name: 'Uganda', dial: '256', flag: '🇺🇬' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪' },
  { iso: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧' },
  { iso: 'UY', name: 'Uruguay', dial: '598', flag: '🇺🇾' },
  { iso: 'VE', name: 'Venezuela', dial: '58', flag: '🇻🇪' },
  { iso: 'VN', name: 'Vietnam', dial: '84', flag: '🇻🇳' },
]

const TOP: PhoneCountry[] = [
  { iso: 'HT', name: 'Haiti', dial: '509', flag: '🇭🇹' },
  { iso: 'US', name: 'United States', dial: '1', flag: '🇺🇸' },
  { iso: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦' },
  { iso: 'FR', name: 'France', dial: '33', flag: '🇫🇷' },
]

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  ...TOP,
  ...[...REST].sort((a, b) => a.name.localeCompare(b.name, 'en')),
]

export const countryByIso = (iso: string): PhoneCountry | undefined =>
  PHONE_COUNTRIES.find((c) => c.iso === iso)

/** Digits only, so paste-with-formatting ("(509) 34-12" ) still works. */
export const digitsOnly = (s: string) => (s || '').replace(/\D+/g, '')

/**
 * Compose the stored value: E.164, `+<dial><national>`.
 *
 * Returns '' for an empty national part, so an untouched optional field stores
 * nothing rather than a bare country code — `+509` on its own is not a phone
 * number and would be worse than null for anyone later trying to call it.
 */
export function toE164(iso: string, national: string): string {
  const c = countryByIso(iso)
  const n = digitsOnly(national)
  if (!c || !n) return ''
  return `+${c.dial}${n}`
}

/**
 * Split a stored E.164 value back into (iso, national) for editing.
 *
 * Longest dial code first, so +590 (Guadeloupe) is not read as +59 followed by
 * a stray zero. Ambiguous codes resolve to the first match in list order,
 * which is why the priority four are at the top: a +1 number comes back as US
 * rather than as, say, Dominica.
 */
export function fromE164(value: string | null | undefined): { iso: string; national: string } {
  const raw = (value || '').trim()
  if (!raw.startsWith('+')) {
    // Legacy free-text values (everything stored before this field existed)
    // are left in the national box, so an organizer sees what they typed
    // rather than an empty field. The country is read from the number's SHAPE
    // before defaulting to Haiti: a Haitian national number is exactly 8
    // digits, a NANP one 10 (11 with its leading 1). Defaulting a bare US
    // number to +509 is how "7654076400" ended up under the Haiti code and
    // then saved as +5097654076400.
    const d = digitsOnly(raw)
    if (d.length === 11 && d.startsWith('509')) return { iso: 'HT', national: d.slice(3) }
    if (d.length === 10 && /^[2-9]/.test(d)) return { iso: 'US', national: d }
    if (d.length === 11 && d.startsWith('1')) return { iso: 'US', national: d.slice(1) }
    return { iso: DEFAULT_PHONE_ISO, national: d }
  }
  const digits = digitsOnly(raw)
  const byLength = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
  for (const c of byLength) {
    if (digits.startsWith(c.dial)) {
      const match = PHONE_COUNTRIES.find((x) => x.dial === c.dial)!
      return { iso: match.iso, national: digits.slice(c.dial.length) }
    }
  }
  return { iso: DEFAULT_PHONE_ISO, national: digits }
}

/**
 * Interpret whatever a person just typed or pasted into the national box.
 *
 * People paste whole numbers — "+509 3412 5678", "509 3412 5678",
 * "(509) 34-12-56-78" — into a field that already has a country picker beside
 * it, and the naive read ("digits only, prepend the dial code") turns the first
 * of those into +50950934125678. So:
 *
 *  - a leading `+` means the paste is authoritative: re-derive BOTH the country
 *    and the national part from it, and move the picker.
 *  - without a `+`, a leading copy of the CURRENT country's dial code is
 *    stripped, but only when what remains is still long enough to be a real
 *    number. The length guard is what makes this safe rather than clever: a
 *    Haitian national number is 8 digits and cannot begin with 509, and no NANP
 *    national number begins with 1, so the codes that matter here are
 *    unambiguous — while a short value like "5093" is left exactly as typed.
 */
export function normalizeTyped(raw: string, currentIso: string): { iso: string; national: string } {
  const text = (raw || '').trim()
  if (text.includes('+')) {
    const parsed = fromE164('+' + digitsOnly(text))
    if (parsed.national) return parsed
  }
  const digits = digitsOnly(text)
  const c = countryByIso(currentIso)
  if (c && digits.startsWith(c.dial) && digits.length > c.dial.length + 5) {
    return { iso: currentIso, national: digits.slice(c.dial.length) }
  }
  return { iso: currentIso, national: digits }
}
