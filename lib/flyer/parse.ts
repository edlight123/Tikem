/**
 * Read an event flyer's text into composer fields, with plain rules. No AI,
 * no per-read cost: Tesseract (lib/flyer/ocr-server, run by
 * /api/flyers/read) reads the words off the image, this file decides what
 * they mean.
 *
 * It reads text, it does not understand the flyer, so it is cautious: a field
 * it cannot find stays empty, a field it had to guess is listed in
 * `uncertain`, and nothing is published from a read. The organizer reviews
 * the filled form.
 *
 * Tikem flyers are written in English, French and Haitian Kreyòl, often all
 * three on one poster, so every rule below knows the three:
 *  - dates: "Samdi 14 Desanm 2026", "samedi 14 décembre", "Saturday, Dec 14",
 *    "14/12/2026" (day first unless the flyer reads as English);
 *  - times: "a 9è", "9è diswa", "21h", "21h30", "9PM", "9:30 pm", "22:00",
 *    with ranges ("10PM - 4AM", "de 21h à 3h", "9è rive 3è");
 *  - prices: "Gratis", "1,500 HTG", "1500 gdes", "500 goud", "$20", "20 US",
 *    "20€"; the lowest price is the one that fills the ticket;
 *  - where: "Lieu:" / "Kote:" / "Venue:" lines, venue words (hotel, club,
 *    plaj…), street patterns ("Rue Lamarre", "Delmas 75") and a list of
 *    Haitian and diaspora cities.
 * Phone numbers and emails are pointed out and kept out of the description.
 */

export interface OcrLine {
  text: string
  /** Line height in pixels: headlines are set tallest. */
  height: number
  /** Tesseract's 0-100 confidence. */
  confidence: number
}

export const FLYER_FIELDS = [
  'title',
  'date',
  'start_time',
  'end_time',
  'venue_name',
  'address',
  'city',
  'price',
] as const
export type FlyerField = (typeof FLYER_FIELDS)[number]

export type FlyerCurrency = 'HTG' | 'USD' | 'EUR' | 'CAD'

export interface FlyerRead {
  title: string | null
  description: string | null
  /** YYYY-MM-DD */
  date: string | null
  /** HH:MM, 24-hour */
  start_time: string | null
  /** HH:MM, 24-hour; earlier than start_time means it ends after midnight. */
  end_time: string | null
  venue_name: string | null
  address: string | null
  city: string | null
  price_type: 'free' | 'paid' | 'unknown'
  /** The lowest price printed, in `currency`. */
  price: number | null
  currency: FlyerCurrency | null
  /** "18+" / "21+" when the flyer says so. */
  age_policy: '18+' | '21+' | null
  dress_code: string | null
  /** Fields that were filled from a guess (a weekday only, a time with no am/pm…). */
  uncertain: FlyerField[]
  /** Phone numbers and emails printed on the flyer, for the organizer to decide on. */
  personal_details: string[]
}

const CONFIDENT = 60

/** Lowercase, accents off, curly quotes straightened: what every rule matches against. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, '-')
}

const pad = (n: number) => String(n).padStart(2, '0')
const letters = (s: string) => (s.match(/[A-Za-zÀ-ÿ]/g) || []).length
/** Collapse spaces and trim the stray punctuation OCR leaves at line ends. */
const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[^\wÀ-ÿ$€#@"'(]+|[^\wÀ-ÿ$€!?)+"'.]+$/g, '')
    .trim()

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Month words (folded), English, French and Kreyòl, to 1-12. */
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, janv: 1, janvye: 1,
  february: 2, feb: 2, fevrier: 2, fevr: 2, fev: 2, fevriye: 2,
  march: 3, mar: 3, mars: 3, mas: 3,
  april: 4, apr: 4, avril: 4, avr: 4,
  may: 5, mai: 5, me: 5,
  june: 6, jun: 6, juin: 6, jen: 6,
  july: 7, jul: 7, juillet: 7, juil: 7, jiye: 7, jiyet: 7,
  august: 8, aug: 8, aout: 8, out: 8, dawou: 8,
  september: 9, sep: 9, sept: 9, septembre: 9, septanm: 9,
  october: 10, oct: 10, octobre: 10, oktob: 10, okt: 10,
  november: 11, nov: 11, novembre: 11, novanm: 11,
  december: 12, dec: 12, decembre: 12, desanm: 12,
}
/**
 * Month words that are also everyday words ("me", "out", "mas", "des", "jen"):
 * only read as a month right after a day number ("14 me"), never before one.
 */
const AMBIGUOUS_MONTHS = new Set(['me', 'out', 'mas', 'jen', 'mar', 'may', 'jan'])
/** Of those, the ones that never read as a month BEFORE a day ("me 14" is not a date; "May 14" is). */
const DAY_FIRST_ONLY = new Set(['me', 'out', 'mas', 'jen'])

/** Weekday words (folded) to 0 (Sunday) - 6. */
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, dimanche: 0, dimanch: 0, dim: 0,
  monday: 1, mon: 1, lundi: 1, lendi: 1,
  tuesday: 2, tue: 2, tues: 2, mardi: 2, madi: 2,
  wednesday: 3, wed: 3, mercredi: 3, mekredi: 3, mekrdi: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, jeudi: 4, jedi: 4,
  friday: 5, fri: 5, vendredi: 5, vandredi: 5, vandrdi: 5,
  saturday: 6, sat: 6, samedi: 6, samdi: 6,
}
// Short forms that collide with words ("sun", "sat", "mon", "dim", "wed") only count with a date beside them.
const SHORT_WEEKDAYS = new Set(['sun', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'dim'])
const STRONG_WEEKDAYS = Object.keys(WEEKDAYS).filter((w) => !SHORT_WEEKDAYS.has(w))

const MONTH_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
const ENGLISH_HINT = /\b(?:january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tickets?|doors|free|admission|presents)\b|\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b/

interface DateHit {
  year: number | null
  month: number
  day: number
  weekday: number | null
  /** Higher is more specific: a day and month beat a bare weekday. */
  score: number
  /** Both numbers could have been the month (03/04). */
  ambiguous?: boolean
}

function validDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

function weekdayBefore(folded: string, index: number): number | null {
  const before = folded.slice(Math.max(0, index - 16), index)
  const m = before.match(/([a-z]+)[\s,.-]*$/)
  return m && m[1] in WEEKDAYS ? WEEKDAYS[m[1]] : null
}

function fourDigitYear(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  if (raw.length === 2) return 2000 + n
  return n >= 2000 && n <= 2100 ? n : null
}

function findDates(folded: string): DateHit[] {
  const hits: DateHit[] = []
  const english = ENGLISH_HINT.test(folded)

  // "14 desanm 2026", "14 de diciembre"-style "14 de mars", "1er mai", "14th December"
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:er|e|st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(${MONTH_WORD})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'g')
  for (const m of folded.matchAll(dayFirst)) {
    const day = Number(m[1])
    const month = MONTHS[m[2]]
    if (day < 1 || day > 31) continue
    // "10 out of 10", "2 me the": a word, not a month.
    if (AMBIGUOUS_MONTHS.has(m[2]) && /^\s+(?:of|the|to|and|a|for)\b/.test(folded.slice(m.index! + m[0].length))) continue
    hits.push({ year: fourDigitYear(m[3]), month, day, weekday: weekdayBefore(folded, m.index!), score: 6 + (m[3] ? 1 : 0) })
  }

  // "december 14, 2026", "dec. 14th"
  const monthFirst = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:h|e|:|[ap]\\.?m))(?:,?\\s+(\\d{4}))?`, 'g')
  for (const m of folded.matchAll(monthFirst)) {
    if (DAY_FIRST_ONLY.has(m[1])) continue
    const day = Number(m[2])
    if (day < 1 || day > 31) continue
    hits.push({ year: fourDigitYear(m[3]), month: MONTHS[m[1]], day, weekday: weekdayBefore(folded, m.index!), score: 6 + (m[3] ? 1 : 0) })
  }

  // "14/12/2026", "14.12", "12-14-26": day first unless the flyer reads as English.
  for (const m of folded.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?\b(?![.,:]\d)/g)) {
    const a = Number(m[1])
    const b = Number(m[2])
    // "9.30" or "21.00" with no year is a time, not a date.
    if (!m[3] && m[0].includes('.') && b >= 13) continue
    let day: number
    let month: number
    let ambiguous = false
    if (a > 12 && b <= 12) [day, month] = [a, b]
    else if (b > 12 && a <= 12) [day, month] = [b, a]
    else if (a <= 12 && b <= 12) {
      ;[day, month] = english ? [b, a] : [a, b]
      ambiguous = a !== b
    } else continue
    if (!m[3] && !m[0].includes('/')) continue // "14-12" alone is too often a score or a range
    hits.push({ year: fourDigitYear(m[3]), month, day, weekday: weekdayBefore(folded, m.index!), score: 5 + (m[3] ? 1 : 0), ambiguous })
  }

  return hits
}

function resolveYear(hit: DateHit, ref: Date): { year: number; guessed: boolean } {
  if (hit.year) return { year: hit.year, guessed: false }
  const today = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate())
  let year = ref.getFullYear()
  // A date that has already passed (by more than a day) is next year's.
  if (Date.UTC(year, hit.month - 1, hit.day) < today - 86400000) year += 1
  // The weekday printed beside it settles the year when the two disagree.
  if (hit.weekday !== null && new Date(Date.UTC(year, hit.month - 1, hit.day)).getUTCDay() !== hit.weekday) {
    for (const y of [year + 1, year - 1]) {
      if (validDay(y, hit.month, hit.day) && new Date(Date.UTC(y, hit.month - 1, hit.day)).getUTCDay() === hit.weekday && Date.UTC(y, hit.month - 1, hit.day) >= today - 86400000) {
        return { year: y, guessed: false }
      }
    }
  }
  return { year, guessed: false }
}

function nextWeekday(weekday: number, ref: Date): string {
  const d = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()))
  const add = (weekday - d.getUTCDay() + 7) % 7
  d.setUTCDate(d.getUTCDate() + add)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

interface TimeHit {
  index: number
  end: number
  hour: number
  minute: number
  /** am/pm or a 24-hour clock settled it; false = "9è" with nothing to say day or night. */
  certain: boolean
  /** The hour as printed, before an assumed evening was added. */
  printed?: number
}

const PM_WORDS = /^\s*(?:di\s?swa|nan\s+aswe|aswe|du\s+soir|le\s+soir|ce\s+soir|apremidi|apre\s?midi|de\s+l'apres[\s-]midi|in\s+the\s+evening|at\s+night|tonight)\b/
const AM_WORDS = /^\s*(?:di\s?maten|nan\s+maten|du\s+matin|le\s+matin|in\s+the\s+morning)\b/

/**
 * Every clock time in one folded line, in order. `rawLine` is the same line
 * lowercased with accents kept, to tell Kreyòl "9è" from a French ordinal "5e".
 */
function findTimes(folded: string, rawLine: string): TimeHit[] {
  const hits: TimeHit[] = []
  const taken = (i: number) => hits.some((h) => i >= h.index && i < h.end)
  const push = (h: TimeHit) => {
    if (h.hour > 23 || h.minute > 59 || taken(h.index)) return
    hits.push(h)
  }

  // 9pm, 9 pm, 9:30pm, 9.30 p.m., 9h30pm
  for (const m of folded.matchAll(/\b(\d{1,2})(?:[:h.](\d{2}))?\s?([ap])\.?\s?m\b\.?/g)) {
    let hour = Number(m[1])
    if (hour < 1 || hour > 12) continue
    if (m[3] === 'p' && hour !== 12) hour += 12
    if (m[3] === 'a' && hour === 12) hour = 0
    push({ index: m.index!, end: m.index! + m[0].length, hour, minute: Number(m[2] || 0), certain: true })
  }

  // 22:00, 9:30 (a 24-hour clock; a morning hour with no am/pm is read as written)
  for (const m of folded.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    const hour = Number(m[1])
    const after = folded.slice(m.index! + m[0].length)
    const pm = PM_WORDS.test(after)
    push({ index: m.index!, end: m.index! + m[0].length, hour: pm && hour < 12 ? hour + 12 : hour, minute: Number(m[2]), certain: hour >= 12 || hour === 0 || pm || AM_WORDS.test(after) })
  }

  // 21h, 21h30, 9h (French clock: 9h is 09:00 unless "du soir" follows)
  for (const m of folded.matchAll(/\b(\d{1,2})\s?h\s?(\d{2})?(?![a-z0-9])/g)) {
    let hour = Number(m[1])
    const after = folded.slice(m.index! + m[0].length)
    const pm = PM_WORDS.test(after)
    if (pm && hour < 12) hour += 12
    push({ index: m.index!, end: m.index! + m[0].length, hour, minute: Number(m[2] || 0), certain: hour >= 12 || hour === 0 || pm || AM_WORDS.test(after) })
  }

  // Kreyòl: "a 9è", "9è diswa", "10è30". The grave accent tells it from a
  // French ordinal ("5e édition"); without it, a leading "a"/"à" or a
  // day/night word after has to vouch for it.
  for (const m of folded.matchAll(/\b(\d{1,2})\s?e(?:\s?(\d{2}))?(?![a-z0-9])/g)) {
    const hour = Number(m[1])
    if (hour < 1 || hour > 23) continue
    const rawSlice = rawLine.slice(m.index!, m.index! + m[0].length)
    const after = folded.slice(m.index! + m[0].length)
    const before = folded.slice(Math.max(0, m.index! - 8), m.index!)
    const accented = /\d\s?[èé]/.test(rawSlice)
    const pm = PM_WORDS.test(after)
    const am = AM_WORDS.test(after)
    const lead = /(?:^|\s)(?:a|apati|depi|rive|jiska|jis|-)\s*$/.test(before)
    if (!accented && !pm && !am && !lead) continue
    let h = hour
    let certain = pm || am || hour >= 12
    // A bare "9è" on an event flyer is almost always the evening: read it so, and say it was a guess.
    if (pm && hour < 12) h = hour + 12
    else if (!am && hour < 12) {
      h = hour + 12
      certain = false
    }
    push({ index: m.index!, end: m.index! + m[0].length, hour: h, minute: Number(m[2] || 0), certain, printed: hour })
  }

  return hits.sort((a, b) => a.index - b.index)
}

/** "9PM - 3AM", "de 21h à 3h", "9è rive 3è", "10pm to 4am": the second time ends the event. */
const RANGE_JOIN = /^\s*(?:-|to|till|until|a|jusqu'a|jusqu'au|jiska|jis|rive|->|>)\s*$/

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

const FREE = /\b(?:gratis|gratuit|gratuite|free|entree libre|antre lib|no cover|admission free|entree gratuite)\b/
const AMOUNT = String.raw`(?<![\d.,])(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d{1,2})?)`
const CURRENCY_AFTER = new RegExp(`${AMOUNT}\\s?(htg|gdes|gde|gds|goud|gourdes?|g|usd|us\\$|us|\\$|€|eur|euros?|cad|ca\\$)(?![a-z])`, 'g')
const CURRENCY_BEFORE = new RegExp(`(htg|usd|us\\$|\\$|€|eur|cad|ca\\$)\\s?${AMOUNT}`, 'g')

function currencyOf(token: string): FlyerCurrency {
  if (/^(?:htg|gdes|gde|gds|goud|gourdes?|g)$/.test(token)) return 'HTG'
  if (/^(?:€|eur|euros?)$/.test(token)) return 'EUR'
  if (/^(?:cad|ca\$)$/.test(token)) return 'CAD'
  return 'USD'
}

function amountOf(raw: string): number {
  // "1,500" / "1.500" / "1 500" are thousands; "20.50" / "20,50" are cents.
  if (/^\d{1,3}(?:[ ,.]\d{3})+$/.test(raw)) return Number(raw.replace(/[ ,.]/g, ''))
  return Number(raw.replace(',', '.'))
}

// ---------------------------------------------------------------------------
// Where
// ---------------------------------------------------------------------------

/** Cities Tikem flyers name, folded → how the composer writes them. */
const CITIES: Array<[RegExp, string]> = [
  [/\bpetion[\s-]?ville\b|\bpetyonvil\b/, 'Pétion-Ville'],
  [/\bport[\s-]au[\s-]prince\b|\bpotoprens\b|\bp-a-p\b/, 'Port-au-Prince'],
  [/\bcap[\s-]haitien\b|\bokap\b/, 'Cap-Haïtien'],
  [/\bcroix[\s-]des[\s-]bouquets\b|\bkwadebouke\b/, 'Croix-des-Bouquets'],
  [/\btabarre\b|\btaba\b/, 'Tabarre'],
  [/\bdelmas\b(?!\s*\d)/, 'Delmas'],
  [/\bkenscoff\b|\bkenskof\b/, 'Kenscoff'],
  [/\bcarrefour\b|\bkafou\b/, 'Carrefour'],
  [/\bjacmel\b|\bjakmel\b/, 'Jacmel'],
  [/\bles\s+cayes\b|\bokay\b/, 'Les Cayes'],
  [/\bgonaives\b|\bgonayiv\b/, 'Gonaïves'],
  [/\bsaint[\s-]marc\b|\bsenmak\b/, 'Saint-Marc'],
  [/\bleogane\b|\bleyogann\b/, 'Léogâne'],
  [/\bhinche\b|\benche\b/, 'Hinche'],
  [/\bjeremie\b|\bjeremi\b/, 'Jérémie'],
  [/\bport[\s-]de[\s-]paix\b|\bpodepe\b/, 'Port-de-Paix'],
  [/\bouanaminthe\b|\bwanament\b/, 'Ouanaminthe'],
  [/\barcahaie\b|\blakayi\b/, 'Arcahaie'],
  [/\bmirebalais\b|\bmibale\b/, 'Mirebalais'],
  [/\bnorth\s+miami\b/, 'North Miami'],
  [/\bmiami\b/, 'Miami'],
  [/\bfort\s+lauderdale\b/, 'Fort Lauderdale'],
  [/\borlando\b/, 'Orlando'],
  [/\bbrooklyn\b/, 'Brooklyn'],
  [/\bnew\s+york\b|\bnyc\b/, 'New York'],
  [/\bboston\b/, 'Boston'],
  [/\bnewark\b/, 'Newark'],
  [/\bmontreal\b/, 'Montréal'],
  [/\blaval\b/, 'Laval'],
  [/\bparis\b/, 'Paris'],
]

const LABELLED_PLACE = /^(?:lieu|location|venue|adresse|address|adres|kote|lokal|where|place|ou)\s*[:\-]\s*(.+)$/
const VENUE_WORDS =
  /\b(?:hotel|otel|club|klib|lounge|bar|resto|restaurant|plaza|park|parc|pak|beach|plage|plaj|centre|center|sant|salle|sal|hall|bistro|terrasse|terrace|rooftop|galerie|gallery|theatre|teyat|stade|stadium|estad|ballroom|casino|marina|resort|villa|jardin|garden|kay|lakou|ranch|rancho|cafe|kafe)\b/
const STREET =
  /\b(?:\d{1,5},?\s+)?(?:rue|ri|route|wout|avenue|av\.?|boulevard|blvd|impasse|enpas|ruelle|chemin|angle)\s+[a-z0-9'. -]{2,40}|\b\d{1,5}\s+[a-z0-9'. -]{2,30}?\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl)\b\.?|\bdelmas\s+\d{1,3}\b/

/** "DJ Maky prezante", "X presents", "X vous invite": the organizer, never the title or venue. */
const PRESENTS = /^(.{2,60}?)\s+(?:presents?|presente(?:nt)?|prezante|pwezante|envite\s+w|vous\s+invite(?:nt)?|invites?\s+you)\b/

// ---------------------------------------------------------------------------
// Personal details, age, dress code
// ---------------------------------------------------------------------------

const PHONE = /(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{3}\)?[ .-]?)?\b\d{3,4}[ .-]\d{4}\b/g
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g
const AGE = /\b(18|21)\s?\+|\b(18|21)\s?(?:ans|years?|lane)\s?(?:\+|et plus|and up|and over|oswa plis)/
const DRESS = /^(?:dress\s?code|tenue|tenue exigee|kod abiman|abiman)\s*[:\-]?\s*(.{2,60})$/

function titleCase(s: string): string {
  const letterChars = s.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (!letterChars || letterChars !== letterChars.toUpperCase()) return s
  const KEEP = new Set(['DJ', 'MC', 'VIP', 'BBQ', 'NYE', 'NYC', 'USA', 'II', 'III', 'IV', 'HT', 'R&B', 'EDM'])
  const SMALL = new Set(['de', 'la', 'le', 'les', 'du', 'des', 'a', 'an', 'nan', 'ak', 'et', 'and', 'of', 'the', 'pou', 'en', 'au'])
  return s
    .split(/(\s+)/)
    .map((w, i) => {
      if (/^\s+$/.test(w)) return w
      if (KEEP.has(w)) return w
      const lower = w.toLowerCase()
      if (i > 0 && SMALL.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

/** A line that is a date, a time, a price or contact details: never a title or description. */
/**
 * `test` on a /g pattern moves its lastIndex, and matchAll starts from it:
 * reset before and after so one rule never skips the start of the next line.
 */
function has(re: RegExp, s: string): boolean {
  re.lastIndex = 0
  const hit = re.test(s)
  re.lastIndex = 0
  return hit
}

function isFactLine(text: string): boolean {
  const f = fold(text)
  return (
    has(PHONE, text) ||
    has(EMAIL, text) ||
    has(CURRENCY_AFTER, f) ||
    has(CURRENCY_BEFORE, f) ||
    FREE.test(f) ||
    findDates(f).length > 0 ||
    findTimes(f, text.toLowerCase()).length > 0 ||
    STRONG_WEEKDAYS.some((w) => new RegExp(`^${w}\\b`).test(f)) ||
    AGE.test(f) ||
    DRESS.test(f) ||
    LABELLED_PLACE.test(f)
  )
}

// ---------------------------------------------------------------------------

export function parseFlyerText(input: OcrLine[], ref: Date = new Date()): FlyerRead {
  const lines = input
    .flatMap((l) => String(l.text || '').split(/\n+/).map((text) => ({ ...l, text: clean(text) })))
    .filter((l) => letters(l.text) >= 2 || /\d/.test(l.text))
  const folded = lines.map((l) => fold(l.text))
  const all = folded.join('\n')
  const uncertain = new Set<FlyerField>()
  const shaky = (i: number) => lines[i].confidence < 75

  // ── Presenter line (kept out of title/venue/description) ──
  const presenterIdx = folded.findIndex((f) => PRESENTS.test(f))

  // ── Title: the tallest confident line that isn't a fact, plus the next if nearly as tall ──
  let title: string | null = null
  const titleIdx: number[] = []
  const candidates = lines
    .map((l, i) => i)
    .filter((i) => i !== presenterIdx && lines[i].confidence >= CONFIDENT && letters(lines[i].text) >= 3 && !isFactLine(lines[i].text))
  if (candidates.length) {
    const top = Math.max(...candidates.map((i) => lines[i].height))
    const i = candidates.find((c) => lines[c].height === top)!
    titleIdx.push(i)
    let t = lines[i].text
    const next = i + 1
    if (candidates.includes(next) && lines[next].height >= top * 0.75 && `${t} ${lines[next].text}`.length <= 80) {
      t = `${t} ${lines[next].text}`
      titleIdx.push(next)
    }
    title = titleCase(t).slice(0, 120)
    if (shaky(i)) uncertain.add('title')
  }

  // ── Date ──
  let date: string | null = null
  const dates = folded.flatMap((f) => findDates(f))
  const best = dates.sort((a, b) => b.score - a.score)[0]
  if (best) {
    const { year } = resolveYear(best, ref)
    if (validDay(year, best.month, best.day)) {
      date = `${year}-${pad(best.month)}-${pad(best.day)}`
      if (best.ambiguous) uncertain.add('date')
      if (best.weekday !== null && new Date(Date.UTC(year, best.month - 1, best.day)).getUTCDay() !== best.weekday) uncertain.add('date')
    }
  }
  if (!date) {
    // A weekday alone ("Samdi sa a", "this Friday"): the next one, flagged.
    for (const f of folded) {
      const w = STRONG_WEEKDAYS.find((k) => new RegExp(`\\b${k}\\b`).test(f))
      if (w) {
        date = nextWeekday(WEEKDAYS[w], ref)
        uncertain.add('date')
        break
      }
    }
  }

  // ── Times: the first line with a time gives the start, and an end when it is a range ──
  let start_time: string | null = null
  let end_time: string | null = null
  for (let i = 0; i < folded.length && !start_time; i++) {
    const times = findTimes(folded[i], lines[i].text.toLowerCase())
    if (!times.length) continue
    const [a, b] = times
    start_time = `${pad(a.hour)}:${pad(a.minute)}`
    if (!a.certain) uncertain.add('start_time')
    const between = folded[i]
      .slice(a.end, b?.index ?? a.end)
      .replace(/\b(?:de|di\s?swa|di\s?maten|du\s+soir|du\s+matin|aswe|nan\s+aswe)\b/g, '')
    if (b && RANGE_JOIN.test(between)) {
      let endHour = b.hour
      // "9è rive 3è": an end with no am/pm of its own is whichever reading comes soonest after the start.
      if (!b.certain && b.printed !== undefined) {
        const later = (h: number) => (h * 60 + b.minute - (a.hour * 60 + a.minute) + 1440) % 1440
        endHour = later(b.printed) < later(b.printed + 12) ? b.printed : b.printed + 12
      }
      end_time = `${pad(endHour)}:${pad(b.minute)}`
    }
  }

  // ── Price: the lowest printed amount, in the currency it is printed in ──
  let price_type: FlyerRead['price_type'] = 'unknown'
  let price: number | null = null
  let currency: FlyerCurrency | null = null
  const amounts: Array<{ value: number; currency: FlyerCurrency; at: number }> = []
  for (const f of folded) {
    for (const m of f.matchAll(CURRENCY_AFTER)) amounts.push({ value: amountOf(m[1]), currency: currencyOf(m[2]), at: amounts.length })
    for (const m of f.matchAll(CURRENCY_BEFORE)) amounts.push({ value: amountOf(m[2]), currency: currencyOf(m[1]), at: amounts.length })
  }
  const priced = amounts.filter((a) => Number.isFinite(a.value) && a.value > 0 && a.value < 1_000_000)
  if (priced.length) {
    price_type = 'paid'
    currency = priced[0].currency
    price = Math.min(...priced.filter((a) => a.currency === currency).map((a) => a.value))
    // "Ladies free before 11" next to a price: paid, but say the price may not be the whole story.
    if (FREE.test(all)) uncertain.add('price')
  } else if (FREE.test(all)) {
    price_type = 'free'
  }

  // ── Where ──
  let venue_name: string | null = null
  let address: string | null = null
  let city: string | null = null
  const placeIdx: number[] = []
  for (const [re, name] of CITIES) {
    const i = folded.findIndex((f) => re.test(f))
    if (i >= 0) {
      city = name
      // A line that is only the city is a place line, not description.
      if (letters(folded[i].replace(re, '')) < 3) placeIdx.push(i)
      break
    }
  }
  const streetIdx = folded.findIndex((f, i) => STREET.test(f) && !titleIdx.includes(i))
  if (streetIdx >= 0) {
    address = clean(lines[streetIdx].text).slice(0, 200)
    placeIdx.push(streetIdx)
    if (shaky(streetIdx)) uncertain.add('address')
  }
  const labelled = folded.findIndex((f) => LABELLED_PLACE.test(f))
  const venueIdx =
    labelled >= 0
      ? labelled
      : folded.findIndex(
          (f, i) => VENUE_WORDS.test(f) && !titleIdx.includes(i) && i !== presenterIdx && i !== streetIdx && f.length <= 80 && !isFactLine(lines[i].text)
        )
  // No venue word ("Le Bataclan"): the short line right above the street is the venue's name, flagged.
  const aboveStreet = streetIdx - 1
  const guessedVenue =
    venueIdx < 0 &&
    aboveStreet >= 0 &&
    !titleIdx.includes(aboveStreet) &&
    aboveStreet !== presenterIdx &&
    !placeIdx.includes(aboveStreet) &&
    letters(lines[aboveStreet].text) >= 3 &&
    lines[aboveStreet].text.length <= 60 &&
    !isFactLine(lines[aboveStreet].text)
  if (guessedVenue) {
    venue_name = titleCase(clean(lines[aboveStreet].text)).slice(0, 120)
    placeIdx.push(aboveStreet)
    uncertain.add('venue_name')
  }
  if (venueIdx >= 0) {
    let v = lines[venueIdx].text
    if (venueIdx === labelled) v = v.replace(/^[^:\-]+[:\-]\s*/, '')
    // "Hotel Montana, Pétion-Ville": the venue is the part before the city.
    const parts = v.split(/\s*[,|·•]\s*/)
    if (parts.length > 1 && CITIES.some(([re]) => re.test(fold(parts[parts.length - 1])))) parts.pop()
    v = clean(parts.join(', '))
    if (venueIdx === streetIdx) {
      // A labelled line holding a street ("Kote: 12 Rue Lamarre") is the address, not a venue name.
      v = ''
    }
    if (v && letters(v) >= 3) {
      venue_name = titleCase(v).slice(0, 120)
      placeIdx.push(venueIdx)
      if (shaky(venueIdx)) uncertain.add('venue_name')
    }
  }

  // ── Age, dress code ──
  const ageMatch = all.match(AGE)
  const age_policy = ageMatch ? ((ageMatch[1] || ageMatch[2]) === '21' ? '21+' : '18+') : null
  let dress_code: string | null = null
  for (const f of folded) {
    const m = f.match(DRESS)
    if (m) {
      const i = folded.indexOf(f)
      dress_code = clean(lines[i].text.replace(/^[^:\-]*?(?:code|tenue|exigee|abiman)\s*[:\-]?\s*/i, '')).slice(0, 60) || null
      break
    }
  }

  // ── Personal details ──
  const personal_details = [
    ...new Set(lines.flatMap((l) => [...(l.text.match(PHONE) || []), ...(l.text.match(EMAIL) || [])]).map((s) => s.trim())),
  ].slice(0, 10)

  // ── Description: the confident sentences left over ──
  const body = lines
    .filter(
      (l, i) =>
        l.confidence >= CONFIDENT &&
        !titleIdx.includes(i) &&
        !placeIdx.includes(i) &&
        i !== presenterIdx &&
        !isFactLine(l.text) &&
        letters(l.text) >= 8
    )
    .map((l) => l.text)
  const description =
    body.join(' ').replace(PHONE, '').replace(EMAIL, '').replace(/\s+/g, ' ').trim().slice(0, 400) || null

  return {
    title,
    description,
    date,
    start_time,
    end_time,
    venue_name,
    address,
    city,
    price_type,
    price,
    currency,
    age_policy,
    dress_code,
    uncertain: FLYER_FIELDS.filter((f) => uncertain.has(f)),
    personal_details,
  }
}
