/**
 * The language(s) an event is HELD in (ported from Tikra, 2026-11-25). A
 * konpa night in Kreyòl, a conference in French, a bilingual Kreyòl + English
 * service in Miami: people want to know before they buy.
 *
 * Stored on events/{id} as `languages`: a list of the codes below (several
 * allowed, e.g. ['ht', 'en']), empty or absent when the organizer did not
 * say. Nothing guesses it.
 *
 * Pure and shared: the website keeps an identical copy (lib/event-languages.ts,
 * kept in step by __tests__/event-languages.test.ts). firestore.rules
 * (validEventLanguages) accepts only these codes.
 */

/** Every language an organizer can pick: its own name, then English / French / Kreyòl names. */
export const EVENT_LANGUAGES = [
  { code: 'ht', native: 'Kreyòl', en: 'Haitian Creole', fr: 'Créole haïtien', ht: 'Kreyòl' },
  { code: 'fr', native: 'Français', en: 'French', fr: 'Français', ht: 'Fransè' },
  { code: 'en', native: 'English', en: 'English', fr: 'Anglais', ht: 'Anglè' },
  { code: 'es', native: 'Español', en: 'Spanish', fr: 'Espagnol', ht: 'Panyòl' },
] as const

export type EventLanguage = (typeof EVENT_LANGUAGES)[number]['code']

export const EVENT_LANGUAGE_CODES: readonly EventLanguage[] = EVENT_LANGUAGES.map((l) => l.code)

/** Every language can be picked at once ("multiple"). */
export const MAX_EVENT_LANGUAGES = EVENT_LANGUAGES.length

export function isEventLanguage(v: unknown): v is EventLanguage {
  return typeof v === 'string' && (EVENT_LANGUAGE_CODES as readonly string[]).includes(v)
}

/**
 * A stored or submitted `languages` value, cleaned: known codes only,
 * lower-cased, no repeats, in the order given. Anything else becomes []
 * ("not specified").
 */
export function cleanEventLanguages(raw: unknown): EventLanguage[] {
  if (!Array.isArray(raw)) return []
  const out: EventLanguage[] = []
  for (const v of raw) {
    const code = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (isEventLanguage(code) && !out.includes(code)) out.push(code)
  }
  return out.slice(0, MAX_EVENT_LANGUAGES)
}

/** The shape firestore.rules accepts from a client: a list of known codes, each once at most. */
export function isValidLanguagesField(raw: unknown): boolean {
  return (
    Array.isArray(raw) &&
    raw.length <= MAX_EVENT_LANGUAGES &&
    raw.every((v) => isEventLanguage(v))
  )
}

/** A language's own name ("Kreyòl", "Français"): what the chips and the event page show. */
export function eventLanguageLabel(code: string): string {
  return EVENT_LANGUAGES.find((l) => l.code === code)?.native ?? code
}

/** The language's name in the reader's UI language (for screen readers and the filter hint). */
export function languageName(code: string, uiLang = 'en'): string {
  const row = EVENT_LANGUAGES.find((l) => l.code === code)
  if (!row) return code
  const ui = String(uiLang || 'en').slice(0, 2).toLowerCase()
  return ui === 'fr' ? row.fr : ui === 'ht' ? row.ht : row.en
}

/** The quiet line an event page shows: the languages' own names ("Kreyòl, English"), or ''. */
export function eventLanguagesLine(raw: unknown): string {
  return cleanEventLanguages(raw).map(eventLanguageLabel).join(', ')
}

/** BCP 47 tags for schema.org `inLanguage` (one string for one language, a list for several). */
export function eventInLanguage(raw: unknown): string | string[] | undefined {
  const codes = cleanEventLanguages(raw)
  if (!codes.length) return undefined
  return codes.length === 1 ? codes[0] : codes
}

/** The Discover filter: no language chosen matches everything. */
export function matchesEventLanguage(
  event: { languages?: unknown } | null | undefined,
  filter: string | null | undefined,
): boolean {
  if (!filter || !isEventLanguage(filter)) return true
  return cleanEventLanguages(event?.languages).includes(filter)
}

/** A ?language= value, or '' for "any language". */
export function parseLanguageParam(v: unknown): EventLanguage | '' {
  const s = (Array.isArray(v) ? v[0] : v) as unknown
  const code = typeof s === 'string' ? s.trim().toLowerCase() : ''
  return isEventLanguage(code) ? code : ''
}
