/**
 * Eventbrite → Tikèm sync, the pure half (lib/import/eventbrite-sync-server
 * does the fetching and writing). An organizer who connected Eventbrite and
 * left "Keep my Eventbrite events on Tikèm" on gets their live events listed
 * on Tikèm, one doc per Eventbrite event (`eb_<id>`). Tickets stay on
 * Eventbrite: the event carries `external_url` and the event page links out
 * instead of selling, so no ticket_tiers are written.
 *
 * Rules the planner enforces:
 *   - never delete; a cancelled, deleted, back-to-draft or ended-early event
 *     is unpublished (imported.unpublished_by_sync marks that it was us);
 *   - an event the organizer edited on Tikèm (imported.locally_edited) only
 *     has its time, link, publication and stats refreshed;
 *   - an event the organizer unpublished themselves, one moderation closed,
 *     or a banned organizer's, is never (re)published by a sync
 *     (lib/events/publishGuard, the publish button's own gate);
 *   - an event outside Tikèm's markets, or priced in a currency its market
 *     does not take, is kept as a flagged draft, never listed (lib/import/market);
 *   - a doc owned by another account (two orgs on one Eventbrite) is left alone;
 *   - stats keep only the counts visitors may see (no capacity), and both
 *     `stats` and `imported` are written by the server only (firestore.rules).
 */
import { publishBlockReason } from '@/lib/events/publishGuard'
import { timezoneForEvent } from '@/lib/events/composer-country'
import { isPublicHttpsUrl } from '@/lib/import/url'
import { resolveImportMarket, type ImportFlag } from '@/lib/import/market'
import { firstPublishStamp } from '@/lib/events/publishedAt'
import { importCategoryFields } from '@/lib/events/categoryInfer'

export const EB_SOURCE = 'eventbrite'

/** Past events further back than this are not mirrored. */
export const EB_PAST_MONTHS = 24

export interface EbStats {
  attended: number | null
  tickets_sold: number | null
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
/** Plain text with paragraph breaks kept (Eventbrite's description.text). */
const plain = (s: unknown, n: number) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n\n')
    .trim()
    .slice(0, n)
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/** The Tikèm doc id for an Eventbrite event: deterministic, so a resync updates in place. */
export function ebEventDocId(id: unknown): string {
  return `eb_${String(id ?? '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40)}`
}

function validZone(z: unknown): string | null {
  if (typeof z !== 'string' || !z) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return z
  } catch {
    return null
  }
}

const isoOf = (v: unknown): string | null => (typeof v === 'string' && Date.parse(v) ? new Date(v).toISOString() : null)

/**
 * The fields of a Tikèm event that come from one Eventbrite event (expanded
 * with venue, ticket_classes and logo), plus the market flags. Null when it
 * has no id, title or start. Times are UTC instants (start.utc).
 */
export function mapEventbriteToEventFields(
  ev: any,
  fallbackCountry: string = 'HT',
): (Record<string, any> & { _image_src: string | null; _flags: ImportFlag[] }) | null {
  const title = clip(ev?.name?.text, 120)
  const start = isoOf(ev?.start?.utc)
  if (!title || !start || !ev?.id) return null
  const online = ev?.online_event === true
  const v = online ? null : ev?.venue || null
  const a = v?.address || {}
  const city = clip(a.city, 60)
  const endRaw = isoOf(ev?.end?.utc)
  const end = endRaw && Date.parse(endRaw) > Date.parse(start) ? endRaw : new Date(Date.parse(start) + 2 * 3_600_000).toISOString()
  const classes = (Array.isArray(ev?.ticket_classes) ? ev.ticket_classes : []).filter((t: any) => t && t.hidden !== true && t.donation !== true)
  const prices: number[] = classes.map((t: any) => (t.free ? 0 : Math.max(0, Number(t?.cost?.major_value) || 0)))
  const paid = prices.filter((p) => p > 0)
  const market = resolveImportMarket({
    country: online ? null : clip(a.country, 60) || null,
    currency: clip(ev?.currency || classes.find((t: any) => t?.cost?.currency)?.cost?.currency || '', 3) || null,
    prices,
    fallbackCountry,
  })
  const url = typeof ev?.url === 'string' && isPublicHttpsUrl(ev.url) ? ev.url : null
  const image = ev?.logo?.original?.url || ev?.logo?.url || null
  return {
    title,
    description: plain(ev?.description?.text ?? ev?.summary, 4000),
    start_datetime: start,
    end_datetime: end,
    timezone: validZone(ev?.start?.timezone) || timezoneForEvent(market.country, city),
    is_online: online,
    venue_name: clip(v?.name, 120),
    address: clip(a.localized_address_display || [a.address_1, a.city].filter(Boolean).join(', '), 200),
    city,
    country: market.country,
    currency: market.currency,
    // Prices only for the card ("from 15"); tickets are sold on Eventbrite.
    ticket_price: paid.length ? Math.min(...paid) : 0,
    has_paid_tiers: paid.length > 0,
    is_rsvp: paid.length === 0,
    external_url: url,
    _image_src: typeof image === 'string' && image.startsWith('https://') ? image : null,
    // A low price only matters for tickets sold here; these sell on Eventbrite.
    _flags: market.flags.filter((f) => f !== 'price_below_minimum'),
  }
}

/**
 * Eventbrite's own counts for an event: tickets sold (sum of quantity_sold)
 * and attendees still attending (counted by the server, null when the
 * account didn't allow it). Only the counts visitors may see: no capacity.
 */
export function ebStatsFrom(ev: any, attended: number | null | undefined): EbStats | null {
  const classes = Array.isArray(ev?.ticket_classes) ? ev.ticket_classes.filter((t: any) => t && t.donation !== true) : []
  const soldList = classes.map((t: any) => num(t.quantity_sold)).filter((n: number | null): n is number => n !== null)
  const tickets_sold = soldList.length ? soldList.reduce((s: number, n: number) => s + n, 0) : null
  const a = attended === undefined ? null : num(attended)
  if (a === null && tickets_sold === null) return null
  return { attended: a, tickets_sold }
}

export type EbPublication = 'publish' | 'unpublish'

/** What Eventbrite's status says the Tikèm copy should be, and why. */
export function ebPublication(ev: any, now: number): { want: EbPublication; past: boolean; reason: string } {
  const status = String(ev?.status || '').toLowerCase()
  const end = Date.parse(ev?.end?.utc) || Date.parse(ev?.start?.utc) || 0
  const past = end > 0 && end <= now
  if (status === 'canceled' || status === 'cancelled' || status === 'deleted') return { want: 'unpublish', past, reason: 'cancelled' }
  if (status === 'draft') return { want: 'unpublish', past, reason: 'draft' }
  // Over on Eventbrite while its time hasn't ended: ended early (or never held).
  if ((status === 'ended' || status === 'completed') && !past) return { want: 'unpublish', past, reason: 'ended_early' }
  if (status === 'live' || status === 'started' || status === 'ended' || status === 'completed') return { want: 'publish', past, reason: status }
  return { want: 'unpublish', past, reason: status || 'unknown' }
}

export interface EbPlanInput {
  ev: any
  prev: Record<string, any> | null
  orgId: string
  orgName: string
  now: number
  /** The org's starting country, for events with no venue country (lib/import/drafts orgStartingCountry). */
  fallbackCountry?: string
  /** The organizer's user doc, for the ban check (lib/events/publishGuard). */
  organizer?: Record<string, any> | null
  /** Past events: Eventbrite's counts, when fetched this run (undefined = keep what is stored). */
  stats?: EbStats | null
  /** The photo copied into our bucket this run (undefined = keep what is stored). */
  banner?: string | null
}

export type EbPlan =
  | { kind: 'skip'; reason: 'invalid' | 'conflict' | 'not_ours' | 'not_live' }
  | { kind: 'write'; id: string; data: Record<string, any>; published: boolean; unpublished: boolean; past: boolean; created: boolean; flags: ImportFlag[] }

/** The write (merge) a sync makes for one Eventbrite event, or why it makes none. */
/**
 * What Eventbrite files an event under: its category, subcategory and format
 * (names when expanded, else the ids every event carries), for the category a
 * Tikèm copy starts with (lib/events/categoryInfer). From Tikra b3b32279.
 */
export function ebCategoryHints(ev: any): { sourceCategory: string | null; sourceSubcategory: string | null; sourceFormat: string | null } {
  const pick = (named: any, id: any) => {
    const n = typeof named?.name === 'string' ? named.name : typeof named?.short_name === 'string' ? named.short_name : ''
    const v = String(n || id || '').trim().slice(0, 80)
    return v || null
  }
  return {
    sourceCategory: pick(ev?.category, ev?.category_id),
    sourceSubcategory: pick(ev?.subcategory, ev?.subcategory_id),
    sourceFormat: pick(ev?.format, ev?.format_id),
  }
}

export function planEventbriteDoc(input: EbPlanInput): EbPlan {
  const { ev, prev, orgId, orgName, now } = input
  const fields = mapEventbriteToEventFields(ev, input.fallbackCountry)
  if (!fields) return { kind: 'skip', reason: 'invalid' }
  const id = ebEventDocId(ev.id)
  if (prev && prev.organizer_id && prev.organizer_id !== orgId) return { kind: 'skip', reason: 'conflict' }
  if (prev && prev.imported?.source && prev.imported.source !== EB_SOURCE) return { kind: 'skip', reason: 'not_ours' }

  const nowIso = new Date(now).toISOString()
  const { want, past, reason } = ebPublication(ev, now)
  const pastCutoff = now - EB_PAST_MONTHS * 30.44 * 86_400_000
  const tooOld = past && Date.parse(fields.start_datetime) < pastCutoff
  const edited = prev?.imported?.locally_edited === true
  const wasLive = prev?.is_published === true
  const { _image_src, _flags, ...base } = fields
  // Ours to (re)publish: a new doc, one live now, or one a sync took down.
  // Never one the organizer unpublished, moderation closed, or a banned account's.
  const syncOwnsPublication = !prev || wasLive || prev.imported?.unpublished_by_sync === true
  const blocked = !!(prev && publishBlockReason(prev, input.organizer)) || !!publishBlockReason({}, input.organizer)
  // Outside Tikèm's markets or in a currency its market doesn't take: a flagged
  // draft. Once the organizer has edited it here, it is theirs to judge.
  const flagged = _flags.length > 0 && !edited
  const publish = want === 'publish' && (!tooOld || !!prev) && syncOwnsPublication && !blocked && !flagged
  // Nothing to list: a cancelled, draft or too-old event we never listed. A
  // live but flagged one is kept as a draft so the organizer sees why.
  if (!prev && !publish && !(want === 'publish' && flagged && !past && !blocked)) return { kind: 'skip', reason: 'not_live' }

  const data: Record<string, any> = edited
    ? {
        start_datetime: base.start_datetime,
        end_datetime: base.end_datetime,
        timezone: base.timezone,
        external_url: base.external_url,
      }
    : { ...base, organizer_name: orgName || prev?.organizer_name || '' }
  if (!edited) {
    if (input.banner) data.banner_image_url = input.banner
    else if (!prev?.banner_image_url) data.banner_image_url = null
  }

  let published = wasLive
  let unpublished = false
  if (publish) {
    data.is_published = true
    data.status = 'published'
    // The first time it goes public (lib/events/publishedAt): Home's "Recently added".
    Object.assign(data, firstPublishStamp(prev, nowIso))
    published = true
  } else if (wasLive) {
    // Take it down: unpublished, never deleted.
    data.is_published = false
    data.status = 'draft'
    unpublished = true
    published = false
  } else if (!prev) {
    data.is_published = false
    data.status = 'draft'
  }

  data.imported = {
    source: EB_SOURCE,
    source_event_id: String(ev.id),
    synced_at: nowIso,
    eventbrite_status: String(ev?.status || '').toLowerCase() || null,
    locally_edited: edited,
    review: edited ? [] : _flags,
    // Ours when we took it down; an organizer's own unpublish stays theirs.
    unpublished_by_sync: publish ? false : unpublished || prev?.imported?.unpublished_by_sync === true || (!prev && flagged),
    unpublish_reason: publish ? null : unpublished ? reason : flagged ? 'needs_review' : prev?.imported?.unpublish_reason ?? null,
    // The photo it came from; a failed copy keeps the old value so the next run retries.
    image_src: input.banner !== undefined && (input.banner || !_image_src) ? _image_src : prev?.imported?.image_src ?? null,
    ...(past && input.stats !== undefined ? { stats_fetched_at: nowIso } : prev?.imported?.stats_fetched_at ? { stats_fetched_at: prev.imported.stats_fetched_at } : {}),
  }
  if (past && input.stats !== undefined) data.stats = input.stats

  if (!prev) {
    // The moderation defaults the admin Events tabs filter on: a doc missing
    // one of these is invisible there (lib/admin/event-moderation).
    data.organizer_id = orgId
    // Inferred from Eventbrite's own category, format and the text (never a
    // blanket 'Other', which kept imports out of the home category rails).
    Object.assign(data, importCategoryFields(null, { title: fields.title, description: fields.description, ...ebCategoryHints(ev) }))
    data.show_on_explore = true
    data.rejected = false
    data.reports_count = 0
    data.tags = []
    data.created_by = orgId
    data.created_at = nowIso
  }
  data.updated_at = nowIso
  return { kind: 'write', id, data, published, unpublished, past, created: !prev, flags: edited ? [] : _flags }
}

/** For a Tikèm copy Eventbrite no longer lists (deleted there): unpublish, never delete. */
export function planMissingEventbriteDoc(prev: Record<string, any>, now: number): Record<string, any> | null {
  if (prev?.is_published !== true) return null
  const end = Date.parse(prev.end_datetime) || Date.parse(prev.start_datetime) || 0
  if (end <= now) return null // a past event isn't in the upcoming list by design
  const nowIso = new Date(now).toISOString()
  return {
    is_published: false,
    status: 'draft',
    imported: { ...(prev.imported || {}), source: EB_SOURCE, unpublished_by_sync: true, eventbrite_status: 'missing', synced_at: nowIso },
    updated_at: nowIso,
  }
}

export interface EbSyncResult {
  ok: boolean
  reason?: 'not_connected' | 'expired' | 'unavailable'
  created: number
  updated: number
  unpublished: number
  past: number
  stats: number
  skipped: number
  /** Kept as drafts: outside Tikèm's markets or in a currency they don't take. */
  needs_review: number
  rate_limited: boolean
}

export const emptySyncResult = (): EbSyncResult => ({ ok: true, created: 0, updated: 0, unpublished: 0, past: 0, stats: 0, skipped: 0, needs_review: 0, rate_limited: false })
