/**
 * Pure pieces of phone (WhatsApp code) sign-in on the app: the on/off
 * decision, the country list and number composition. No React Native imports,
 * so the root jest suite tests it directly (__tests__/phone-auth-mobile-gate).
 */

export interface PhoneAuthGateInput {
  /** `config/auth.phone_whatsapp === true`, read from Firestore. */
  remoteSwitch: boolean
  /** GET /api/auth/phone/status answered 200 { enabled: true }. */
  serverEnabled: boolean
  /** EXPO_PUBLIC_FORCE_PHONE_AUTH === 'true'. */
  forceFlag: boolean
  /** __DEV__. The force flag is ignored in release builds. */
  isDev: boolean
}

/**
 * Offer phone sign-in only when the remote switch is on (or a dev build forces
 * it) AND the server says the routes are live. Anything else, including any
 * failure upstream, is OFF.
 */
export function shouldOfferPhoneAuth(i: PhoneAuthGateInput): boolean {
  const switchOn = i.remoteSwitch === true || (i.isDev === true && i.forceFlag === true)
  return switchOn && i.serverEnabled === true
}

export interface PhoneAuthCountry {
  iso: 'HT' | 'US' | 'CA' | 'FR' | 'DO'
  dial: string
  flag: string
}

/** Matches the server's default allowlist, Haiti first. */
export const PHONE_AUTH_COUNTRIES: PhoneAuthCountry[] = [
  { iso: 'HT', dial: '509', flag: '🇭🇹' },
  { iso: 'US', dial: '1', flag: '🇺🇸' },
  { iso: 'CA', dial: '1', flag: '🇨🇦' },
  { iso: 'FR', dial: '33', flag: '🇫🇷' },
  { iso: 'DO', dial: '1', flag: '🇩🇴' },
]

/** The picker's starting country: the device region when supported, else Haiti. */
export function defaultPhoneCountry(region?: string | null): PhoneAuthCountry {
  const r = (region || '').toUpperCase()
  return PHONE_AUTH_COUNTRIES.find((c) => c.iso === r) ?? PHONE_AUTH_COUNTRIES[0]
}

/**
 * What to send the server. A number typed with its own + or 00 prefix wins;
 * otherwise the picker's dial code is prepended to the digits (a French
 * trunk 0 is dropped). The server does the real validation.
 */
export function composePhone(country: PhoneAuthCountry, input: string): string {
  const trimmed = (input || '').trim()
  if (trimmed.startsWith('+')) return `+${trimmed.replace(/\D/g, '')}`
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2).replace(/\D/g, '')}`
  let digits = trimmed.replace(/\D/g, '')
  if (country.iso === 'FR' && digits.startsWith('0')) digits = digits.slice(1)
  if (country.dial === '1' && digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return `+${country.dial}${digits}`
}

/** Enough digits to bother the server with. */
export function looksDialable(input: string): boolean {
  return (input || '').replace(/\D/g, '').length >= 7
}

/** "+50937123456" -> "+509 3712 3456" (readable, not authoritative). */
export function prettyPhone(e164: string): string {
  if (e164.startsWith('+509') && e164.length === 12) {
    return `+509 ${e164.slice(4, 8)} ${e164.slice(8)}`
  }
  if (e164.startsWith('+1') && e164.length === 12) {
    return `+1 ${e164.slice(2, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`
  }
  if (e164.startsWith('+33') && e164.length === 12) {
    return `+33 ${e164.slice(3, 4)} ${e164.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ')}`
  }
  return e164
}

const KNOWN_ERRORS = new Set([
  'invalid_phone',
  'unsupported_country',
  'cooldown',
  'rate_limited',
  'send_failed',
  'not_on_whatsapp',
  'unavailable',
  'invalid_code',
  'too_many_attempts',
  'account_disabled',
  'phone_in_use',
  'phone_already_set',
  'unauthorized',
])

/** Locale key for a server error code; unknown codes get the generic line. */
export function phoneErrorKey(code?: string | null): string {
  return code && KNOWN_ERRORS.has(code) ? `auth.phone.errors.${code}` : 'auth.phone.errors.generic'
}
