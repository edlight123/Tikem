/**
 * Publish-right-away safety checks for community submissions (Tikèm owner,
 * 2026-11-26: "straight away like tikra"; ported from Tikra 245c6830/32981148). A shared flyer goes live at once unless ANY of these holds,
 * in which case it waits for an admin (status 'pending', as before) with the
 * reasons stored on the submission (`hold_reasons`) for /admin/community:
 *
 *   new_account    the Firebase Auth account is under 24h old (Auth's
 *                  creationTime, never the client-writable profile created_at)
 *   past_removals  a previous submission was rejected, or its event removed
 *   rate_limit     already 3 submissions in the last 24h
 *   bad_link       a link in the note / ticket link / source fails linkIssue
 *   bad_date       in the past, or more than a year ahead
 *   spam_text      many links, or crypto / casino / loan style wording
 *   incomplete     not enough to publish (title, date, start, organizer, place)
 *   paid_no_link   paid, with no ticket link to send people to
 *   not_signed_in  (not reachable today: /api/community/submissions requires sign-in)
 *
 * Links are judged by the URL alone: nothing is fetched (SSRF policy).
 * Pure: no Firestore, no Auth; lib/community/publish gathers the inputs.
 */
import { zonedIso, parseSubmitterDetails, parseSubmissionFields } from '@/lib/community/submissions'

/** "Online", "Zoom", "Virtual"…: an event with no physical place. */
export function isOnlineVenue(venue: unknown, address: unknown): boolean {
  return /\b(online|zoom|virtual|livestream|live stream|google meet|teams|en ligne|anliy)\b/i.test(`${venue ?? ''} ${address ?? ''}`)
}

export const HOLD_REASONS = [
  'new_account',
  'past_removals',
  'rate_limit',
  'bad_link',
  'bad_date',
  'spam_text',
  'incomplete',
  'paid_no_link',
  'not_signed_in',
] as const
export type HoldReason = (typeof HOLD_REASONS)[number]

/** What the admin sees for each reason. */
export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  new_account: 'New account (under 24h)',
  past_removals: 'Had a submission rejected or removed',
  rate_limit: 'More than 3 shares in 24h',
  bad_link: 'Suspicious link',
  bad_date: 'Date in the past or over a year ahead',
  spam_text: 'Looks like spam',
  incomplete: 'Missing details',
  paid_no_link: 'Paid, no ticket link',
  not_signed_in: 'Not signed in',
}

export const NEW_ACCOUNT_MS = 24 * 3600_000
export const RATE_WINDOW_MS = 24 * 3600_000
/** Submissions already made in the window before the next one is held. */
export const MAX_SUBMISSIONS_PER_DAY = 3
/** Beyond this many in the window a share is refused outright (429), not stored. */
export const HARD_SUBMISSIONS_PER_DAY = 10
export const MAX_DAYS_AHEAD = 365

/** Link shorteners hide where they go. forms.gle (Google Forms) is the one we allow. */
const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly',
  'shorturl.at', 'tiny.cc', 'rb.gy', 's.id', 'v.gd', 't.ly', 'shorte.st', 'adf.ly', 'bl.ink', 'lnkd.in', 'tiny.one',
  'short.io', 'soo.gd', 'clck.ru', 'qr.ae', 'trib.al', 'snip.ly', 'urlz.fr', 'x.co', 'po.st', 'mcaf.ee', 'shor.by',
])
const ALLOWED_SHORT = new Set(['forms.gle'])
/** Hosts whose job is to bounce you elsewhere. */
const REDIRECTORS = new Set(['l.facebook.com', 'lm.facebook.com', 'l.instagram.com', 'out.reddit.com', 'href.li', 'l.messenger.com'])
/** TLDs overwhelmingly used for spam and phishing. */
const BAD_TLDS = new Set([
  'zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'click', 'country', 'kim', 'work', 'loan', 'men', 'date',
  'racing', 'win', 'bid', 'stream', 'download', 'review', 'party', 'trade', 'accountant', 'science', 'cricket', 'faith',
  'buzz', 'rest', 'cam', 'monster', 'icu', 'cyou', 'sbs', 'cfd', 'lol', 'casino', 'bet', 'poker',
])

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')

export type LinkIssue = 'not_https' | 'invalid' | 'shortener' | 'ip_host' | 'bad_tld' | 'redirect' | 'credentials' | 'punycode' | 'port'

/** Why a link is not safe to publish, or null. Judged by the URL alone. */
export function linkIssue(raw: string): LinkIssue | null {
  const s = String(raw || '').trim()
  if (!s) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return 'invalid'
  }
  if (u.protocol !== 'https:') return 'not_https'
  if (u.username || u.password) return 'credentials'
  if (u.port) return 'port'
  const host = bare(u.hostname)
  if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.startsWith('[')) return 'ip_host'
  if (host.split('.').some((l) => l.startsWith('xn--'))) return 'punycode'
  if (SHORTENERS.has(host) && !ALLOWED_SHORT.has(host)) return 'shortener'
  if (REDIRECTORS.has(host)) return 'redirect'
  if ((host === 'google.com' || host.endsWith('.google.com')) && u.pathname === '/url' && host !== 'docs.google.com') return 'redirect'
  const tld = host.split('.').pop() || ''
  if (BAD_TLDS.has(tld)) return 'bad_tld'
  // A parameter that carries another site's address (?url=https://elsewhere).
  for (const v of Array.from(u.searchParams.values())) {
    if (!/^(https?:)?\/\//i.test(v.trim())) continue
    try {
      const inner = new URL(v.trim().startsWith('//') ? `https:${v.trim()}` : v.trim())
      if (bare(inner.hostname) !== host) return 'redirect'
    } catch {
      /* not a URL */
    }
  }
  return null
}

/** Links written in free text (bare domains with a path count too). */
export function extractUrls(text: string): string[] {
  const out = String(text || '').match(/\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"')\]]*/gi) || []
  return out.map((u) => u.replace(/[.,;:!?]+$/, '')).map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
}

const SPAM_WORDS = [
  /\bcrypto(currency|currencies)?\b/i,
  /\bbitcoin\b/i,
  /\bbtc\b/i,
  /\bethereum\b/i,
  /\busdt\b/i,
  /\bforex\b/i,
  /\bbinary options?\b/i,
  /\bnft\b/i,
  /\bairdrop\b/i,
  /\bcasino\b/i,
  /\bsports?\s?betting\b/i,
  /\bbetting\b/i,
  /\bjackpot\b/i,
  /\bslots?\s+(machine|game)s?\b/i,
  /\bpayday\b/i,
  /\bloans?\b/i,
  /\bcredit repair\b/i,
  /\bviagra\b|\bcialis\b/i,
  /\bonlyfans\b/i,
  /\bescorts?\b/i,
  /\bmake money (fast|online|from home)\b/i,
  /\bwork from home\b/i,
  /\bdouble your (money|income|investment)\b/i,
  /\bguaranteed (returns?|profit|income)\b/i,
  /\binvestment opportunit(y|ies)\b/i,
]

/** The spam wording found in the text (empty when none), plus 'links' for 3+ links. */
export function spamSignals(text: string): string[] {
  const s = String(text || '')
  const hits = SPAM_WORDS.filter((re) => re.test(s)).map((re) => (s.match(re)?.[0] || '').toLowerCase())
  if (extractUrls(s).length >= 3) hits.push('links')
  return hits
}

/** Past, or more than a year ahead (start of the event, in its zone). */
export function dateIssue(date: string, start: string, zone: string, now: Date): 'past' | 'too_far' | null {
  if (!date) return null
  const iso = zonedIso(date, start || '23:59', zone)
  if (!iso) return null
  const t = Date.parse(iso)
  if (t < now.getTime()) return 'past'
  if (t > now.getTime() + MAX_DAYS_AHEAD * 86400_000) return 'too_far'
  return null
}

export interface TrustInput {
  signedIn: boolean
  /** Firebase Auth metadata.creationTime, in ms; null when unknown (treated as new). */
  authCreatedAtMs: number | null
  /**
   * A previous submission was rejected or removed, or an event made from one
   * was taken down (lib/community/publish).
   */
  hasPastRemoval: boolean
  /** Shares this account made in the rolling 24h window BEFORE this one (the atomic counter). */
  recentCount: number
  now: Date
  zone: string
  /** The raw request body: links are judged as typed, before sanitizing. */
  body: { note?: unknown; source_url?: unknown; organizer_name?: unknown; details?: any }
}

export function holdReasons(input: TrustInput): HoldReason[] {
  const reasons = new Set<HoldReason>()
  const { body, now } = input
  if (!input.signedIn) reasons.add('not_signed_in')

  if (input.authCreatedAtMs == null || !Number.isFinite(input.authCreatedAtMs) || now.getTime() - input.authCreatedAtMs < NEW_ACCOUNT_MS) {
    reasons.add('new_account')
  }

  if (input.hasPastRemoval) reasons.add('past_removals')

  if (input.recentCount >= MAX_SUBMISSIONS_PER_DAY) reasons.add('rate_limit')

  const note = String(body?.note ?? '')
  const links = [...extractUrls(note), String(body?.details?.ticket_url ?? ''), String(body?.source_url ?? '')].filter((u) => u.trim())
  if (links.some((u) => linkIssue(u))) reasons.add('bad_link')

  const details = parseSubmitterDetails(body?.details)
  if (dateIssue(details.date, details.start_time, input.zone, now)) reasons.add('bad_date')

  const text = [details.title, String(body?.organizer_name ?? ''), note].join('\n')
  if (spamSignals(text).length) reasons.add('spam_text')

  const fields = parseSubmissionFields({
    title: details.title,
    date: details.date,
    start_time: details.start_time,
    end_time: details.end_time,
    venue_name: details.venue_name,
    address: details.address,
    city: details.city,
    organizer_name: String(body?.organizer_name ?? ''),
  })
  const online = isOnlineVenue(details.venue_name, details.address)
  if (!fields.ok || !details.category || (!online && !details.venue_name && !details.address && !details.city)) reasons.add('incomplete')

  if (details.free === false && !details.ticket_url) reasons.add('paid_no_link')

  return HOLD_REASONS.filter((r) => reasons.has(r))
}
