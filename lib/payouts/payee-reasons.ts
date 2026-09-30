/**
 * What an admin tells a payee when a withdrawal is rejected or marked failed.
 *
 * Kept apart from the admin's internal note on purpose: the payee reason is
 * sent in the notification and email and shown in the payout history, while
 * the internal note (`adminNote`) is only ever read by admins. Presets are
 * translated; "other" carries the admin's own words verbatim.
 *
 * Pure module — the admin console imports it for the picker labels.
 */

export type PayeeReasonLang = 'en' | 'fr' | 'ht'

export const PAYEE_REASON_CODES = [
  'details_mismatch',
  'verification_required',
  'account_unreachable',
  'under_review',
  'other',
] as const

export type PayeeReasonCode = (typeof PAYEE_REASON_CODES)[number]

const PRESETS: Record<Exclude<PayeeReasonCode, 'other'>, Record<PayeeReasonLang, string>> = {
  details_mismatch: {
    en: "The payout details don't match your verified identity.",
    fr: "Les coordonnées de paiement ne correspondent pas à votre identité vérifiée.",
    ht: 'Enfòmasyon peman yo pa matche ak idantite ou verifye a.',
  },
  verification_required: {
    en: 'We need to verify your identity before paying out.',
    fr: 'Nous devons vérifier votre identité avant le paiement.',
    ht: 'Nou bezwen verifye idantite ou anvan nou peye.',
  },
  account_unreachable: {
    en: "The account or MonCash number couldn't receive the payment. Please check it.",
    fr: "Le compte ou le numéro MonCash n'a pas pu recevoir le paiement. Veuillez le vérifier.",
    ht: 'Kont lan oswa nimewo MonCash la pa t ka resevwa peman an. Tanpri verifye l.',
  },
  under_review: {
    en: "This event's sales are under review. We'll be in touch.",
    fr: 'Les ventes de cet événement sont en cours de vérification. Nous vous contacterons.',
    ht: 'Nou ap revize lavant evènman sa a. N ap kontakte w.',
  },
}

/** English labels for the admin picker. */
export const PAYEE_REASON_LABELS: Record<PayeeReasonCode, string> = {
  details_mismatch: 'Payout details don’t match verified identity',
  verification_required: 'Identity verification required',
  account_unreachable: 'Account / MonCash number couldn’t receive payment',
  under_review: 'Event sales under review',
  other: 'Other (write the message the payee will see)',
}

export function isPayeeReasonCode(v: unknown): v is PayeeReasonCode {
  return typeof v === 'string' && (PAYEE_REASON_CODES as readonly string[]).includes(v)
}

/**
 * The payee-facing sentence in `lang`, or null when the admin gave none.
 * An "other" reason is the admin's text as written (not translated).
 */
export function resolvePayeeReason(
  code: unknown,
  text: unknown,
  lang: PayeeReasonLang = 'en'
): string | null {
  if (isPayeeReasonCode(code) && code !== 'other') return PRESETS[code][lang] || PRESETS[code].en
  const t = typeof text === 'string' ? text.trim() : ''
  return t ? t.slice(0, 500) : null
}
