/**
 * Visit → purchase attribution: tracking links (`?t=` + utm_*) and promoter refs.
 *
 * Pure helpers only — no Firestore, no DOM — so the browser capture, the click
 * endpoint, every checkout route and the tests share one definition of what a
 * valid attribution is. The Firestore side lives in lib/tracking-links.ts.
 *
 * Trust model: everything here arrives from the buyer's browser, so it is
 * shape-checked and truncated, never trusted. A tracking link id is re-resolved
 * against the event server-side before anything is counted, exactly like a
 * promoter ref; junk silently becomes "unattributed" and NEVER blocks a sale.
 *
 * The mobile app keeps a mirror of the client-side subset in
 * mobile/lib/attribution.ts (separate package, no shared imports).
 */

export interface Attribution {
  tracking_link_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  promoter_ref: string | null
}

/** Firestore auto-ids are 20 chars of [A-Za-z0-9]; allow a little slack, nothing else. */
export const TRACKING_LINK_ID_PATTERN = /^[A-Za-z0-9]{8,40}$/

/** Mirrors PROMOTER_CODE_PATTERN in lib/promoters.ts (that module is server-only). */
const PROMOTER_REF_PATTERN = /^[A-Z0-9_-]{2,24}$/

const UTM_MAX_LENGTH = 100

/** One click per browser/device per link per this window. */
export const CLICK_DEDUPE_WINDOW_MS = 30 * 60 * 1000

export function normalizeTrackingLinkId(raw: unknown): string | null {
  const id = String(raw ?? '').trim()
  return TRACKING_LINK_ID_PATTERN.test(id) ? id : null
}

export function normalizePromoterRef(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toUpperCase()
  return PROMOTER_REF_PATTERN.test(code) ? code : null
}

/** Trim, drop control characters, cap length. Empty → null. */
export function cleanUtmValue(raw: unknown): string | null {
  if (raw == null) return null
  // eslint-disable-next-line no-control-regex
  const value = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, UTM_MAX_LENGTH)
  return value || null
}

function isEmpty(a: Attribution): boolean {
  return !a.tracking_link_id && !a.utm_source && !a.utm_medium && !a.utm_campaign && !a.promoter_ref
}

/**
 * Coerce an untrusted value (request body, storage, metadata) into an
 * Attribution, or null when it carries nothing usable. Accepts both the
 * snake_case stored shape and the camelCase a client might send.
 */
export function sanitizeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const a: Attribution = {
    tracking_link_id: normalizeTrackingLinkId(r.tracking_link_id ?? r.trackingLinkId ?? r.t),
    utm_source: cleanUtmValue(r.utm_source ?? r.utmSource),
    utm_medium: cleanUtmValue(r.utm_medium ?? r.utmMedium),
    utm_campaign: cleanUtmValue(r.utm_campaign ?? r.utmCampaign),
    promoter_ref: normalizePromoterRef(r.promoter_ref ?? r.promoterRef ?? r.ref),
  }
  return isEmpty(a) ? null : a
}

/** Read `t`, `ref` and `utm_*` off an event-page URL's query string. */
export function attributionFromSearchParams(params: URLSearchParams): Attribution | null {
  return sanitizeAttribution({
    t: params.get('t'),
    ref: params.get('ref'),
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
  })
}

/**
 * Merge the order's attribution with the promoter the server actually
 * resolved. A resolved promoter's code wins over whatever ref the client sent;
 * an unresolvable ref is still kept as plain attribution data.
 */
export function withResolvedPromoter(
  attribution: Attribution | null,
  promoterCode: string | null | undefined
): Attribution | null {
  const code = normalizePromoterRef(promoterCode)
  if (!attribution && !code) return null
  const base: Attribution = attribution || {
    tracking_link_id: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    promoter_ref: null,
  }
  const merged = { ...base, promoter_ref: code || base.promoter_ref }
  return isEmpty(merged) ? null : merged
}

// ── Stripe metadata (string values only, 500 chars each) ─────────────────────

export function attributionToStripeMetadata(a: Attribution | null): Record<string, string> {
  return {
    trackingLinkId: a?.tracking_link_id || '',
    utmSource: a?.utm_source || '',
    utmMedium: a?.utm_medium || '',
    utmCampaign: a?.utm_campaign || '',
  }
}

/**
 * Rebuild the order's attribution from PaymentIntent / Checkout Session
 * metadata. `promoterCode` is the RESOLVED promoter code create-payment-intent
 * already stamped, so it is the authoritative promoter_ref.
 */
export function attributionFromStripeMetadata(md: Record<string, any> | null | undefined): Attribution | null {
  if (!md) return null
  return sanitizeAttribution({
    tracking_link_id: md.trackingLinkId,
    utm_source: md.utmSource,
    utm_medium: md.utmMedium,
    utm_campaign: md.utmCampaign,
    promoter_ref: md.promoterCode,
  })
}

/** Spread onto a ticket write: `{ attribution }` when there is any, else nothing. */
export function ticketAttributionFields(a: Attribution | null): { attribution?: Attribution } {
  return a ? { attribution: a } : {}
}

// ── Link building ─────────────────────────────────────────────────────────────

/**
 * Tracking-link URL: utm params (kept for Google Analytics and the like) plus
 * the short `t=` id that our own counters key on. Same param order everywhere.
 */
export function buildTrackingUrl(
  base: string,
  parts: { source?: string | null; medium?: string | null; campaign?: string | null; id?: string | null }
): string {
  const params = new URLSearchParams()
  const source = (parts.source || '').trim()
  const medium = (parts.medium || '').trim()
  const campaign = (parts.campaign || '').trim()
  if (source) params.set('utm_source', source)
  if (medium) params.set('utm_medium', medium)
  if (campaign) params.set('utm_campaign', campaign)
  if (parts.id) params.set('t', parts.id)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

// ── Click hygiene ─────────────────────────────────────────────────────────────

/** Stable per-link key for client-side dedupe storage and the server cookie. */
export function clickDedupeKey(eventId: string, target: { t?: string | null; ref?: string | null }): string | null {
  const id = normalizeTrackingLinkId(target.t)
  if (id) return `t_${id}`
  const ref = normalizePromoterRef(target.ref)
  if (ref && eventId) return `r_${String(eventId).replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}_${ref}`
  return null
}

/** True when no click for this link was sent inside the dedupe window. */
export function shouldSendClick(
  lastSentAt: number | null | undefined,
  now: number = Date.now(),
  windowMs: number = CLICK_DEDUPE_WINDOW_MS
): boolean {
  const last = Number(lastSentAt)
  if (!Number.isFinite(last) || last <= 0) return true
  // A clock that moved backwards must not suppress clicks forever.
  if (last > now) return true
  return now - last >= windowMs
}

/**
 * Obvious non-humans: crawlers, link unfurlers (WhatsApp, Facebook, Slack…
 * fetch every shared URL), headless browsers and HTTP libraries. A missing UA
 * is treated as a bot too — every real browser and the app send one.
 */
const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|embedly|pinterest|vkshare|skypeuripreview|bitlybot|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|curl|wget|python-requests|python-urllib|aiohttp|httpclient|go-http-client|java\/|node-fetch|axios|postman|insomnia|monitor|uptime|pingdom/i

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent || '').trim()
  if (!ua) return true
  return BOT_UA_PATTERN.test(ua)
}

/**
 * Fixed-window in-memory IP limiter. Per serverless instance, so it is a
 * backstop against one client hammering the endpoint, not a global quota —
 * the same trade-off as the guest-upload limiter. Generous on purpose: Haitian
 * mobile carriers put many buyers behind one carrier-grade NAT address.
 */
export function createIpRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, { windowStart: number; count: number }>()
  const maxKeys = opts.maxKeys ?? 5000
  return {
    /** Records a hit; returns true when this request is OVER the limit. */
    hit(ip: string, now: number = Date.now()): boolean {
      const key = ip || 'unknown'
      const entry = hits.get(key)
      if (!entry || now - entry.windowStart >= opts.windowMs) {
        if (hits.size >= maxKeys) hits.clear() // crude memory bound
        hits.set(key, { windowStart: now, count: 1 })
        return false
      }
      entry.count += 1
      return entry.count > opts.limit
    },
    reset() {
      hits.clear()
    },
  }
}

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Orders ÷ clicks as a 0–1 fraction, or null when there are no clicks to divide
 * by. Capped at 1: sales made before click counting existed (or from a shared
 * device that deduped) would otherwise show nonsense like 300%.
 */
export function conversionRate(orders: number, clicks: number): number | null {
  const o = Math.max(0, Number(orders) || 0)
  const c = Math.max(0, Number(clicks) || 0)
  if (c <= 0) return null
  return Math.min(1, o / c)
}

/** "12%" / "—". */
export function formatConversion(orders: number, clicks: number): string {
  const rate = conversionRate(orders, clicks)
  if (rate == null) return '—'
  const pct = rate * 100
  return `${pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`
}
