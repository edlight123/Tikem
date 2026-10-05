/**
 * Phone number normalisation for one-time-code sign-in.
 *
 * Everything that reaches the OTP service is first reduced to strict E.164
 * ("+50937123456") and checked against a country allowlist. Two reasons:
 *
 * 1. Identity. A Firebase phone user is keyed by E.164, so "509 3712 3456",
 *    "+509-37-12-34-56" and "0037123456" with HT selected must all become the
 *    same string, or one person gets two accounts.
 * 2. Cost. SMS/WhatsApp pumping fraud sends codes to premium or exotic ranges
 *    the attacker earns a cut from. Only allowlisted countries are ever
 *    messaged, and premium/shared-cost/toll-free ranges are refused outright.
 *
 * The `max` metadata build is used on purpose: the default build cannot tell
 * a Canadian or Dominican +1 number from a US one (or from Jamaica, Barbados
 * and the other +1 Caribbean ranges pumpers love), and it has no number types.
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'

/** Countries we will send a code to when PHONE_OTP_ALLOWED_COUNTRIES is unset. */
export const DEFAULT_ALLOWED_COUNTRIES = ['HT', 'US', 'CA', 'FR', 'DO'] as const

/** Number types never messaged: someone else earns money when they receive one. */
const BLOCKED_TYPES = new Set([
  'PREMIUM_RATE',
  'SHARED_COST',
  'TOLL_FREE',
  'UAN',
  'VOICEMAIL',
  'PAGER',
  'PERSONAL_NUMBER',
])

export function allowedCountries(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.PHONE_OTP_ALLOWED_COUNTRIES
  if (!raw || !raw.trim()) return [...DEFAULT_ALLOWED_COUNTRIES]
  return raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
}

export type NormalizedPhone =
  | { ok: true; e164: string; country: string }
  | { ok: false; code: 'invalid_phone' | 'unsupported_country' }

/**
 * Parse and validate. `defaultCountry` lets a bare national number ("3712 3456")
 * be read in the picker's country; an input starting with + or 00 ignores it.
 */
export function normalizePhone(
  input: unknown,
  opts: { defaultCountry?: string; allowed?: string[] } = {}
): NormalizedPhone {
  if (typeof input !== 'string') return { ok: false, code: 'invalid_phone' }
  let raw = input.trim()
  if (!raw || raw.length > 32) return { ok: false, code: 'invalid_phone' }
  // Only digits, spaces and the usual separators. Letters (vanity numbers,
  // "ext.") are refused rather than guessed at.
  if (!/^[+\d\s().-]+$/.test(raw)) return { ok: false, code: 'invalid_phone' }
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`

  const def = opts.defaultCountry && /^[A-Z]{2}$/i.test(opts.defaultCountry)
    ? (opts.defaultCountry.toUpperCase() as CountryCode)
    : undefined

  const parsed = parsePhoneNumberFromString(raw, def)
  if (!parsed || !parsed.isValid()) return { ok: false, code: 'invalid_phone' }

  const type = parsed.getType()
  if (type && BLOCKED_TYPES.has(type)) return { ok: false, code: 'unsupported_country' }

  const country = parsed.country
  const allowed = opts.allowed ?? allowedCountries()
  if (!country || !allowed.includes(country)) return { ok: false, code: 'unsupported_country' }

  return { ok: true, e164: parsed.number, country }
}

/** "+50937123456" -> "+509 •••• 3456", for logs. Never log a full number. */
export function maskPhone(e164: string): string {
  if (e164.length < 7) return '•••'
  return `${e164.slice(0, 4)} •••• ${e164.slice(-4)}`
}
