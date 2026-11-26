/**
 * Pick a Tikèm category for an IMPORTED event (Eventbrite, Luma or any page
 * read by lib/import/event-page), from what the source says about it.
 *
 * Imports used to be written as 'Other' every time, so an organizer's
 * Eventbrite events never showed in the home category rails until she set
 * each one by hand (tester, 2026-11-25). Pure and deterministic: the same
 * event always lands in the same category, and the result is always one of
 * the canonical CATEGORIES (lib/filters/config.ts).
 *
 * Signals, strongest first:
 *   1. the source's FORMAT ("Concert or Performance", "Class, Training, or
 *      Workshop", schema.org MusicEvent…): what kind of event it is;
 *   2. the source's CATEGORY ("Music", "Religion & Spirituality"…): its topic;
 *   3. keywords in the title (English, French, Haitian Creole), then the
 *      description (capped, so a long text cannot outvote the title).
 * Nothing at all: the closest general category, 'Other' (the "experiences"
 * world), flagged as not confident so the organizer is asked to check it.
 */
import { CATEGORIES, normalizeEventCategory } from '@/lib/filters/config'

export type CanonicalCategory = (typeof CATEGORIES)[number]

export interface CategoryInferInput {
  title?: string | null
  description?: string | null
  /** The source's topic: Eventbrite category name or id ("Music", "103"). */
  sourceCategory?: string | null
  /** The source's subcategory name, when it gives one ("Hip Hop / Rap"). */
  sourceSubcategory?: string | null
  /** The source's format: Eventbrite format name or id, or a schema.org @type. */
  sourceFormat?: string | null
}

export interface CategoryInferResult {
  category: string
  /** False when nothing pointed anywhere and the general fallback was used. */
  confident: boolean
}

export const FALLBACK_CATEGORY = 'Other'

/** Lowercase, accents stripped, punctuation to spaces: "Soirée Konpa!" → "soiree konpa". */
export function foldText(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()
}

/** Eventbrite formats, by id and by (folded) name. */
const EB_FORMAT_BY_ID: Record<string, string> = {
  '1': 'Conference', // Conference
  '2': 'Workshop', // Seminar or Talk
  '3': 'Conference', // Tradeshow, Consumer Show, or Expo
  '4': 'Conference', // Convention
  '5': 'Festival', // Festival or Fair
  '6': 'Concert', // Concert or Performance
  '7': 'Theater', // Screening
  '8': 'Food & Drink', // Dinner or Gala
  '9': 'Workshop', // Class, Training, or Workshop
  '10': 'Conference', // Meeting or Networking Event
  '11': 'Party', // Party or Social Gathering
  '12': 'Family', // Rally
  '13': 'Sports', // Tournament
  '14': 'Sports', // Game or Competition
  '15': 'Sports', // Race or Endurance Event
  '16': 'Other', // Tour
  '17': 'Other', // Attraction
  '18': 'Other', // Camp, Trip, or Retreat
  '19': 'Theater', // Appearance or Signing
}

/** Source formats by folded name (Eventbrite names, schema.org @types). */
const FORMAT_RULES: Array<[RegExp, string]> = [
  [/\b(class|training|course)\b/, 'Workshop'],
  [/\b(workshop|seminar|talk|educationevent|education event)\b/, 'Workshop'],
  [/\b(conference|convention|tradeshow|trade show|expo|networking|businessevent|business event)\b/, 'Conference'],
  [/\b(festival|fair)\b/, 'Festival'],
  [/\b(concert|musicevent|music event)\b/, 'Concert'],
  [/\b(performance|screening|screeningevent|theaterevent|theatre|theater|comedyevent|danceevent|exhibitionevent|literaryevent|visualartsevent|appearance|signing)\b/, 'Theater'],
  [/\b(dinner|gala|foodevent|food event)\b/, 'Food & Drink'],
  [/\b(party|social gathering|socialevent)\b/, 'Party'],
  [/\b(tournament|game|competition|race|endurance|sportsevent|sports event)\b/, 'Sports'],
  [/\b(childrensevent|childrens event|kids)\b/, 'Family'],
]

/** Eventbrite categories, by id. */
const EB_CATEGORY_BY_ID: Record<string, string> = {
  '101': 'Conference', // Business & Professional
  '102': 'Workshop', // Science & Technology
  '103': 'Concert', // Music
  '104': 'Theater', // Film, Media & Entertainment
  '105': 'Theater', // Performing & Visual Arts
  '106': 'Party', // Fashion & Beauty
  '107': 'Sports', // Health & Wellness
  '108': 'Sports', // Sports & Fitness
  '109': 'Other', // Travel & Outdoor
  '110': 'Food & Drink', // Food & Drink
  '111': 'Family', // Charity & Causes
  '112': 'Conference', // Government & Politics
  '113': 'Festival', // Community & Culture
  '114': 'Spiritual', // Religion & Spirituality
  '115': 'Family', // Family & Education
  '116': 'Festival', // Seasonal & Holiday
  '117': 'Workshop', // Home & Lifestyle
  '118': 'Other', // Auto, Boat & Air
  '119': 'Workshop', // Hobbies & Special Interest
  '120': 'Family', // School Activities
}

/** Source topics by folded name: the general category closest to each. */
const TOPIC_RULES: Array<[RegExp, string]> = [
  [/\b(religion|spiritual|spirituality|faith|church|islam|islamic|christian|worship)\b/, 'Spiritual'],
  [/\b(music|concert|hip hop|rap|jazz|gospel|kompa|konpa|afrobeat)\b/, 'Concert'],
  [/\b(nightlife|party|parties|fashion|beauty)\b/, 'Party'],
  [/\b(food|drink|dining|culinary)\b/, 'Food & Drink'],
  [/\b(sport|sports|fitness|health|wellness)\b/, 'Sports'],
  [/\b(film|media|entertainment|performing|visual arts|arts|art|theatre|theater|comedy)\b/, 'Theater'],
  [/\b(business|professional|government|politics|career)\b/, 'Conference'],
  [/\b(science|technology|tech|hobbies|hobby|home|lifestyle|education)\b/, 'Workshop'],
  [/\b(community|culture|cultural|seasonal|holiday|heritage)\b/, 'Festival'],
  [/\b(family|kids|children|charity|causes|school)\b/, 'Family'],
]

/**
 * Keywords per category, matched on folded text (no accents). English first,
 * then French and Haitian Creole. Whole words only.
 */
const KEYWORDS: Array<[string, RegExp]> = [
  [
    'Spiritual',
    /\b(prayer|prayers|pray|jumuah|jummah|jumma|khutbah|halaqa|halaqah|quran|tafsir|dhikr|ramadan|taraweeh|tarawih|masjid|mosque|islamic|sunnah|seerah|worship|church|gospel night|bible|sermon|revival|crusade|adoration|praise|spiritual|faith|ministry|priere|louange|culte|eglise|messe|veillee|lapriye|legliz|adorasyon)\b/,
  ],
  [
    // Tikèm has no separate Training category: courses are Workshops.
    'Workshop',
    /\b(training|trainings|course|courses|bootcamp|certification|certificate|certified|masterclass|master class|academy|curriculum|formation|cours|fomasyon)\b/,
  ],
  [
    'Workshop',
    /\b(workshop|workshops|atelier|ateliers|seminar|seminaire|webinar|webinaire|hands on|tutorial|info session|information session|clinic|class|classes|lesson|lessons|coaching|bootcamp)\b/,
  ],
  [
    'Conference',
    /\b(conference|conferences|summit|forum|symposium|convention|expo|networking|panel|panels|keynote|career fair|job fair|trade show|tradeshow|colloque|congres|meetup|entrepreneurs?|business|investors?|startup|startups|konferans)\b/,
  ],
  [
    'Concert',
    /\b(concert|concerts|live music|music|musique|band|gig|orchestra|choir|recital|album|singer|rapper|kompa|konpa|compas|zouk|rabodai|jazz|gospel|nasheed|afrobeats?|amapiano|reggae|dancehall|hip hop|rnb|r&b|konse|mizik|showcase)\b/,
  ],
  [
    'Party',
    /\b(party|parties|nightlife|club|nightclub|rave|dj|djs|afterparty|after party|soiree|day party|brunch party|mixer|lounge|bal|fet|fete|bash|celebration night|white party|all white|boat party|pool party|turn up)\b/,
  ],
  [
    'Festival',
    /\b(festival|festivals|fest|carnival|carnaval|kanaval|fair|heritage|cultural|culture|parade|flag day|independence|bicentennial|holiday market|christmas market|kermesse|festivites|block party|street festival|eid|diwali|lunar new year|juneteenth|pride)\b/,
  ],
  [
    'Sports',
    /\b(sport|sports|tournament|tournoi|match|soccer|football|futsal|basketball|volleyball|marathon|half marathon|5k|10k|fun run|yoga|pilates|fitness|workout|bootcamp fitness|hike|hiking|cycling|tennis|boxing|martial arts|karate|league|cricket|swim|swimming|zumba|golf|chess|esports|foutbol|basket|spin|spinning|cycle|strength|trx|aerobic|aerobics|step class|core|stretch|stretching|barre|fencing|axe throwing|archery|rowing|kayak|kayaking|paddle|paddleboard|climbing|bouldering|skating|skate|ski|skiing|snowboard|run|running|jog|jogging|walk|walking|laser tag|paintball|bowling|badminton|pickleball|squash|table tennis|ping pong|kickboxing|muay thai|jiu jitsu|bjj|judo|taekwondo|self defense|self defence|aerials|aerial|gymnastics|trampoline|hiit|crossfit|weightlifting|gym|athletics|track|softball|baseball|hockey|rugby|lacrosse|frisbee|dodgeball|horseback|riding|equestrian)\b/,
  ],
  [
    'Theater',
    /\b(theater|theatre|theatrical|play|comedy|comedian|stand up|standup|improv|ballet|dance show|film|movie|screening|cinema|art|arts|exhibition|exhibit|gallery|vernissage|poetry|spoken word|open mic|spectacle|musee|museum|book launch|book signing|reading|talent show|teyat|fashion show)\b/,
  ],
  [
    'Food & Drink',
    /\b(food|dinner|brunch|lunch|breakfast|tasting|tastings|wine|beer|cocktail|cocktails|cooking|bbq|barbecue|potluck|iftar|supper|culinary|chef|restaurant|souper|diner|dejeuner|degustation|manje|food truck|food festival|gala dinner)\b/,
  ],
  [
    'Family',
    /\b(family|families|kids|kid|children|child|youth|teen|teens|parents|parenting|baby|babies|picnic|storytime|story time|camp|summer camp|famille|enfants|enfant|jeunesse|fanmi|timoun|seniors|elders|community day|back to school)\b/,
  ],
]

const formatOf = (raw: string): string | null => {
  const id = raw.trim()
  if (EB_FORMAT_BY_ID[id]) return EB_FORMAT_BY_ID[id]
  const f = foldText(raw)
  if (!f) return null
  return FORMAT_RULES.find(([re]) => re.test(f))?.[1] ?? null
}

const topicOf = (raw: string): string | null => {
  const id = raw.trim()
  if (EB_CATEGORY_BY_ID[id]) return EB_CATEGORY_BY_ID[id]
  const f = foldText(raw)
  if (!f) return null
  // A Tikra category name, or one of its stored synonyms ("music", "arts").
  const direct = normalizeEventCategory(f)
  if (direct !== 'Other' || f === 'other') return f === 'other' ? null : direct
  return TOPIC_RULES.find(([re]) => re.test(f))?.[1] ?? null
}

/** How many distinct keywords of each category occur in the text. */
function keywordHits(text: string): Map<string, number> {
  const out = new Map<string, number>()
  if (!text) return out
  for (const [cat, re] of KEYWORDS) {
    const g = new RegExp(re.source, 'g')
    const seen = new Set<string>()
    for (const m of text.matchAll(g)) seen.add(m[0])
    if (seen.size) out.set(cat, seen.size)
  }
  return out
}

const W_FORMAT = 6
const W_TOPIC = 4
const W_SUBTOPIC = 3
const W_TITLE = 3
const W_DESCRIPTION = 1
/** A long description counts at most this many keywords per category. */
const DESCRIPTION_CAP = 3

/** The best canonical category for an imported event. Pure. */
export function inferEventCategory(input: CategoryInferInput): CategoryInferResult {
  const score = new Map<string, number>()
  const add = (cat: string | null, w: number) => {
    if (!cat || cat === FALLBACK_CATEGORY) return
    score.set(cat, (score.get(cat) || 0) + w)
  }
  if (input.sourceFormat) add(formatOf(String(input.sourceFormat)), W_FORMAT)
  if (input.sourceCategory) add(topicOf(String(input.sourceCategory)), W_TOPIC)
  if (input.sourceSubcategory) add(topicOf(String(input.sourceSubcategory)), W_SUBTOPIC)
  const titleHits = keywordHits(foldText(input.title))
  // "Spin Class", "Golf Lesson": an activity named in the title beats the
  // generic class/lesson wording that would otherwise read as a Workshop.
  if (titleHits.has('Sports')) titleHits.delete('Workshop')
  for (const [cat, n] of titleHits) add(cat, n * W_TITLE)
  const desc = foldText(String(input.description ?? '').slice(0, 4000))
  for (const [cat, n] of keywordHits(desc)) add(cat, Math.min(n, DESCRIPTION_CAP) * W_DESCRIPTION)

  let best: string | null = null
  let bestScore = 0
  // Ties go to the earlier category in CATEGORIES (a stable, documented order).
  for (const cat of CATEGORIES) {
    const s = score.get(cat) || 0
    if (s > bestScore) {
      best = cat
      bestScore = s
    }
  }
  if (best) return { category: best, confident: true }

  // Nothing pointed anywhere: a source category Tikèm does not split further
  // ("Travel & Outdoor", "Tour") or no signal at all.
  return { category: FALLBACK_CATEGORY, confident: false }
}

/** The category an import writes, keeping one the organizer already chose. */
export function importCategoryFields(
  prev: Record<string, any> | null | undefined,
  input: CategoryInferInput,
): { category: string; category_auto: boolean } | Record<string, never> {
  const had = String(prev?.category ?? '').trim()
  // The organizer's own pick (or any pick made before inference existed and
  // not marked as ours) stays. Only an empty one or our own guess is redone.
  if (prev && had && prev.category_auto !== true && had !== FALLBACK_CATEGORY) return {}
  if (prev && had && prev.category_auto === false) return {}
  const { category } = inferEventCategory(input)
  return { category, category_auto: true }
}

/**
 * The category write that fills in an existing event, or null to leave it
 * (app/api/admin/events/backfill-categories). Fills an event with NO category,
 * and redoes an import still on the old blanket 'Other' (or on our own guess);
 * never touches a category an organizer picked.
 */
export function categoryBackfillFor(doc: Record<string, any> | null | undefined): { category: string; category_auto: true } | null {
  if (!doc) return null
  const had = String(doc.category ?? '').trim()
  const imported = !!(doc.imported_from || doc.imported)
  const missing = !had
  const ours = imported && doc.category_auto !== false && (had === FALLBACK_CATEGORY || doc.category_auto === true)
  if (!missing && !ours) return null
  const { category } = inferEventCategory({ title: doc.title, description: doc.description })
  if (category === had) return null
  return { category, category_auto: true }
}
