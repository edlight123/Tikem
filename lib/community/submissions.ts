/**
 * Community-shared events (ported from Tikra af25378e / 9ad22663 / 0de427c0).
 *
 * Anyone signed in shares an event they saw (a flyer on Instagram, a poster on
 * a wall) with where it was posted. Nothing is published from a share: it
 * waits in event_submissions for an admin (/admin/community), who checks,
 * edits and publishes it. The published event belongs to the Tikèm Community
 * account (lib/community/org.ts), never to the real organizer, and the event
 * page says "Shared by the community" with a link to the source. It sells no
 * tickets on Tikèm (lib/tickets/purchasable refuses community_shared events);
 * a ticket link the member gave is shown as a link out.
 *
 * The organizer can claim it (event_claims, app/api/events/[id]/claim). An
 * admin approves and the event moves to their organization: organizer_id
 * changes and the community credit goes, so they can edit it and sell.
 *
 * The credit and claim fields on events are Admin SDK only (firestore.rules,
 * COMMUNITY_LOCKED_FIELDS below); event_submissions and event_claims take no
 * client reads or writes at all.
 *
 * Pure helpers only (no Firestore), so the rules are unit tested directly.
 */
import { CATEGORIES, normalizeEventCategory } from '@/lib/filters/config'
import { isPublicHttpsUrl } from '@/lib/import/url'
import { normalizeEventCurrencyForCountry, type EventCurrency } from '@/lib/currency-policy'
import { eventZone } from '@/lib/home/feed'

/** The organizer account community events belong to until claimed. */
export const COMMUNITY_ORG_ID = process.env.COMMUNITY_ORGANIZER_ID || 'tikem-community'
export const COMMUNITY_ORG_NAME = 'Tikèm Community'

/** Event fields only the server writes (firestore.rules create + update). */
export const COMMUNITY_LOCKED_FIELDS = [
  'community_shared',
  'claimable',
  'source_name',
  'source_handle',
  'source_url',
  'submission_id',
  'claimed_at',
  'claimed_by',
  'community_free',
] as const

export const SUBMISSION_COUNTRIES = ['HT', 'US', 'CA', 'FR'] as const
export type SubmissionCountry = (typeof SUBMISSION_COUNTRIES)[number]
export const SUBMISSION_CURRENCIES: readonly EventCurrency[] = ['HTG', 'USD', 'CAD', 'EUR']

/** Submission rate limits (per signed-in account and per IP, each a day). */
export const SUBMIT_LIMIT_PER_USER = 8
export const SUBMIT_LIMIT_PER_IP = 20
/** Claim rate limit per account, a day. */
export const CLAIM_LIMIT_PER_USER = 6

/** A banned or suspended account shares and claims nothing. */
export function isBannedProfile(d: Record<string, any> | null | undefined): boolean {
  return d?.status === 'banned' || d?.banned === true || d?.account_status === 'banned' || d?.account_status === 'suspended'
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * A link back to where the event was posted, or a ticket link: http(s) only,
 * a real host, no credentials. Anything else (javascript:, data:, a bare
 * word) is null, never stored and never rendered.
 */
export function parseSourceUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 500) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname.includes('.') || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** "@Kompa.Night", "instagram.com/kompa.night/" → "kompa.night". Empty when it is not a handle. */
export function parseHandle(raw: unknown): string {
  let s = String(raw ?? '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com\/@?|facebook\.com|x\.com|twitter\.com)\//, '')
  s = s.replace(/^@+/, '').split(/[/?#\s]/)[0] || ''
  return /^[a-z0-9._]{1,40}$/.test(s) ? s : ''
}

/**
 * What the member who shared it added (all optional: the flyer alone is
 * enough). Stored as `details` on the submission so the moderator starts from
 * it. Invalid values are dropped, never refused, so a half-filled form sends.
 */
export interface SubmitterDetails {
  title: string
  date: string
  start_time: string
  end_time: string
  venue_name: string
  address: string
  city: string
  /** '' when not said. */
  country: SubmissionCountry | ''
  /** null: not said. */
  free: boolean | null
  price: number | null
  currency: EventCurrency | ''
  ticket_url: string
  /** A canonical category, or ''. */
  category: string
}

export function parseSubmitterDetails(raw: any): SubmitterDetails {
  const s = (k: string, max: number) => String(raw?.[k] ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  const date = s('date', 10)
  const start = s('start_time', 5)
  const end = s('end_time', 5)
  const free = raw?.free === true ? true : raw?.free === false ? false : null
  const priceNum = Number(String(raw?.price ?? '').replace(',', '.'))
  const price =
    free === false && raw?.price !== '' && raw?.price != null && Number.isFinite(priceNum) && priceNum > 0 && priceNum <= 1_000_000
      ? Math.round(priceNum * 100) / 100
      : null
  const country = (SUBMISSION_COUNTRIES as readonly string[]).includes(String(raw?.country)) ? (raw.country as SubmissionCountry) : ''
  const currency = SUBMISSION_CURRENCIES.includes(raw?.currency) ? (raw.currency as EventCurrency) : ''
  const cat = s('category', 40)
  return {
    title: s('title', 120),
    date: DATE_RE.test(date) ? date : '',
    start_time: TIME_RE.test(start) ? start : '',
    end_time: TIME_RE.test(end) ? end : '',
    venue_name: s('venue_name', 120),
    address: s('address', 200),
    city: s('city', 80),
    country,
    free,
    price,
    currency,
    ticket_url: parseSourceUrl(raw?.ticket_url) || '',
    category: cat && CATEGORIES.includes(cat) ? cat : '',
  }
}

/** What arrives at POST /api/community/submissions, cleaned. */
export interface SubmissionInput {
  image_url: string
  source_url: string | null
  organizer_name: string
  organizer_handle: string
  note: string
  details: SubmitterDetails
}

export function parseSubmissionInput(raw: any): Omit<SubmissionInput, 'image_url'> {
  return {
    source_url: parseSourceUrl(raw?.source_url),
    organizer_name: String(raw?.organizer_name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    organizer_handle: parseHandle(raw?.organizer_handle),
    note: String(raw?.note ?? '').trim().slice(0, 500),
    details: parseSubmitterDetails(raw?.details),
  }
}

/** 'YYYY-MM-DD' + 'HH:MM' as wall-clock time in `zone`, to an ISO instant. */
export function zonedIso(date: string, time: string, zone: string): string | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null
  const guess = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(guess)) return null
  // The zone's offset at that moment, read back through Intl; twice so a DST edge settles.
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(t))
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - t
  }
  let t = guess - offsetAt(guess)
  t = guess - offsetAt(t)
  return new Date(t).toISOString()
}

/** What the admin publishes (the moderator's edited copy). */
export interface SubmissionFields {
  title: string
  description: string
  date: string
  start_time: string
  end_time: string
  venue_name: string
  address: string
  city: string
  country: SubmissionCountry
  category: string
  /** The real organizer, as credited ("From …"). Optional: unknown is fine. */
  organizer_name: string
  organizer_handle: string
  source_url: string
  ticket_url: string
  free: boolean | null
  price: number | null
  currency: EventCurrency
}

export function parseSubmissionFields(raw: any): { ok: true; value: SubmissionFields } | { ok: false; error: string; field: string } {
  const s = (k: string, max: number) => String(raw?.[k] ?? '').trim().slice(0, max)
  const country = (SUBMISSION_COUNTRIES as readonly string[]).includes(String(raw?.country)) ? (raw.country as SubmissionCountry) : 'HT'
  const free = raw?.free === true ? true : raw?.free === false ? false : null
  const priceNum = Number(String(raw?.price ?? '').replace(',', '.'))
  const value: SubmissionFields = {
    title: s('title', 120),
    description: s('description', 4000),
    date: s('date', 10),
    start_time: s('start_time', 5),
    end_time: s('end_time', 5),
    venue_name: s('venue_name', 120),
    address: s('address', 200),
    city: s('city', 80),
    country,
    category: normalizeEventCategory(s('category', 40)),
    organizer_name: s('organizer_name', 120),
    organizer_handle: parseHandle(raw?.organizer_handle),
    source_url: parseSourceUrl(raw?.source_url) || '',
    ticket_url: parseSourceUrl(raw?.ticket_url) || '',
    free,
    price: free === false && Number.isFinite(priceNum) && priceNum > 0 && priceNum <= 1_000_000 ? Math.round(priceNum * 100) / 100 : null,
    currency: normalizeEventCurrencyForCountry(country, raw?.currency),
  }
  if (!value.title) return { ok: false, error: 'Add a title.', field: 'title' }
  if (!DATE_RE.test(value.date) || !TIME_RE.test(value.start_time)) {
    return { ok: false, error: 'Add a date and start time (HH:MM).', field: 'date' }
  }
  if (value.end_time && !TIME_RE.test(value.end_time)) return { ok: false, error: 'Use HH:MM for the end time.', field: 'end_time' }
  if (!value.city && !value.venue_name) return { ok: false, error: 'Add where it happens.', field: 'city' }
  return { ok: true, value }
}

/**
 * The moderator's starting copy: what the member typed, else the flyer read
 * they accepted, plus the credit. Pure, for the admin form.
 */
export function fieldsFromSubmission(sub: Record<string, any>): Record<string, any> {
  const d = parseSubmitterDetails(sub?.details)
  return {
    title: d.title,
    description: String(sub?.note || ''),
    date: d.date,
    start_time: d.start_time,
    end_time: d.end_time,
    venue_name: d.venue_name,
    address: d.address,
    city: d.city,
    country: d.country || 'HT',
    category: d.category || 'Other',
    organizer_name: String(sub?.organizer_name || ''),
    organizer_handle: String(sub?.organizer_handle || ''),
    source_url: String(sub?.source_url || ''),
    ticket_url: d.ticket_url,
    free: d.free,
    price: d.price,
    currency: normalizeEventCurrencyForCountry(d.country || 'HT', d.currency),
  }
}

/**
 * The event an approved submission becomes: published, owned by the community
 * account, credited and claimable, selling nothing on Tikèm. Null when the
 * date and time do not make an instant.
 */
export function submissionToEvent(
  f: SubmissionFields,
  opts: { submissionId: string; bannerUrl: string | null; communityOrgId?: string; now?: string }
): Record<string, any> | null {
  const zone = eventZone({ country: f.country, city: f.city })
  const start = zonedIso(f.date, f.start_time, zone)
  if (!start) return null
  let end = f.end_time ? zonedIso(f.date, f.end_time, zone) : null
  // An end earlier than the start runs past midnight; none at all gets two hours.
  if (end && Date.parse(end) <= Date.parse(start)) end = new Date(Date.parse(end) + 24 * 3600_000).toISOString()
  if (!end) end = new Date(Date.parse(start) + 2 * 3600_000).toISOString()
  const now = opts.now || new Date().toISOString()
  const ticketLink = f.ticket_url && isPublicHttpsUrl(f.ticket_url) ? f.ticket_url : null
  return {
    title: f.title,
    description: f.description,
    summary: '',
    start_datetime: start,
    end_datetime: end,
    timezone: zone,
    venue_name: f.venue_name,
    address: f.address,
    city: f.city,
    commune: '',
    country: f.country,
    currency: f.currency,
    category: f.category || 'Other',
    tags: [],
    banner_image_url: opts.bannerUrl,
    organizer_id: opts.communityOrgId || COMMUNITY_ORG_ID,
    // The host shown is the community account, never the real organizer:
    // they did not post it. Their name is the credit (source_name).
    organizer_name: COMMUNITY_ORG_NAME,
    // Nothing is sold on Tikèm: no ticket tiers, no capacity. The price the
    // member saw is information only.
    is_rsvp: false,
    has_paid_tiers: false,
    ticket_price: f.free === false && f.price ? f.price : 0,
    community_free: f.free,
    total_tickets: 0,
    tickets_sold: 0,
    is_online: false,
    is_published: true,
    status: 'published',
    show_on_explore: true,
    // Moderation defaults the admin Events tabs filter on.
    rejected: false,
    reports_count: 0,
    ...(ticketLink ? { external_url: ticketLink } : {}),
    // Community credit and claims (Admin SDK only, firestore.rules).
    community_shared: true,
    claimable: true,
    source_name: f.organizer_name || null,
    source_handle: f.organizer_handle || null,
    source_url: f.source_url || null,
    submission_id: opts.submissionId,
    created_at: now,
    updated_at: now,
  }
}

/** True for an event shared by the community and not yet claimed. */
export function isCommunityEvent(event: Record<string, any> | null | undefined): boolean {
  return event?.community_shared === true
}

/** The link-out for a community event's tickets (server-written, re-checked). */
export function communityTicketsUrl(event: Record<string, any> | null | undefined): string | null {
  if (!isCommunityEvent(event)) return null
  const url = event?.external_url
  return typeof url === 'string' && isPublicHttpsUrl(url) ? url : null
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export const CLAIM_METHODS = ['instagram', 'link', 'upload'] as const
export type ClaimMethod = (typeof CLAIM_METHODS)[number]

export interface ClaimInput {
  method: ClaimMethod
  instagram_handle: string
  proof_url: string
  proof_path: string
  message: string
}

/**
 * What a claimant sends: at least one proof. `proof_path` must already have
 * been checked as the caller's own claim-proofs/{uid}/ file by the route.
 */
export function parseClaimInput(raw: any): { ok: true; value: ClaimInput } | { ok: false; error: string; code: string } {
  const method = (CLAIM_METHODS as readonly string[]).includes(String(raw?.method)) ? (raw.method as ClaimMethod) : null
  if (!method) return { ok: false, error: 'Choose how to prove it is yours.', code: 'invalid_method' }
  const value: ClaimInput = {
    method,
    instagram_handle: parseHandle(raw?.instagram_handle),
    proof_url: parseSourceUrl(raw?.proof_url) || '',
    proof_path: typeof raw?.proof_path === 'string' ? raw.proof_path.trim() : '',
    message: String(raw?.message ?? '').trim().slice(0, 500),
  }
  if (method === 'instagram' && !value.instagram_handle) return { ok: false, error: 'Add your Instagram handle.', code: 'invalid_proof' }
  if (method === 'link' && !value.proof_url) return { ok: false, error: 'Add a link (http or https).', code: 'invalid_proof' }
  if (method === 'upload' && !value.proof_path) return { ok: false, error: 'Upload a proof.', code: 'invalid_proof' }
  return { ok: true, value }
}

/** Whether the claimant's handle matches the handle credited on the event (a hint for the admin, not a decision). */
/** Self-reported: a typed handle equal to the credit is a hint for the admin, never proof of ownership. */
export function handleMatches(claimHandle: string, sourceHandle: unknown): boolean {
  const a = parseHandle(claimHandle)
  const b = parseHandle(sourceHandle)
  return !!a && a === b
}

/** The event fields an approved claim writes: the event moves to the claimant's org and the credit goes. */
export function claimTransferPatch(orgId: string, orgName: string, now: string, deleteValue: unknown): Record<string, unknown> {
  return {
    organizer_id: orgId,
    organizer_name: orgName,
    community_shared: false,
    claimable: false,
    source_name: deleteValue,
    source_handle: deleteValue,
    source_url: deleteValue,
    community_free: deleteValue,
    external_url: deleteValue,
    claimed_at: now,
    claimed_by: orgId,
    updated_at: now,
  }
}
