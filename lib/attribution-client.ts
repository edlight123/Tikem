/**
 * Browser side of visit attribution: capture `t` / `ref` / `utm_*` when the
 * event page loads, keep it for checkout, and fire the click beacon.
 *
 * Storage: sessionStorage (survives in-app-browser reloads and the MonCash /
 * Sogepay round trip, like the promoter ref capture in BuyTicketButton) plus a
 * first-party cookie so a checkout finished in a new tab still carries it.
 * Last click wins. Every function swallows storage failures — attribution is
 * best-effort and must never block a page or a purchase.
 */

import {
  type Attribution,
  CLICK_DEDUPE_WINDOW_MS,
  attributionFromSearchParams,
  clickDedupeKey,
  sanitizeAttribution,
  shouldSendClick,
} from '@/lib/attribution'

const SESSION_PREFIX = 'tikem_attr:'
const COOKIE_PREFIX = 'tikem_attr_'
const CLICK_PREFIX = 'tikem_clk:'
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60

function cookieName(eventId: string): string {
  return `${COOKIE_PREFIX}${String(eventId).replace(/[^A-Za-z0-9_-]/g, '')}`
}

function readCookie(name: string): string | null {
  try {
    for (const part of document.cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=')
      if (k === name) return decodeURIComponent(rest.join('='))
    }
  } catch {
    // ignore
  }
  return null
}

export function storeAttribution(eventId: string, attribution: Attribution): void {
  const json = JSON.stringify(attribution)
  try {
    sessionStorage.setItem(`${SESSION_PREFIX}${eventId}`, json)
  } catch {
    // private mode
  }
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${cookieName(eventId)}=${encodeURIComponent(json)}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`
  } catch {
    // cookies disabled
  }
}

export function readStoredAttribution(eventId: string): Attribution | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${eventId}`)
    if (raw) {
      const parsed = sanitizeAttribution(JSON.parse(raw))
      if (parsed) return parsed
    }
  } catch {
    // fall through to the cookie
  }
  try {
    const raw = readCookie(cookieName(eventId))
    if (raw) return sanitizeAttribution(JSON.parse(raw))
  } catch {
    // malformed
  }
  return null
}

/**
 * Read the current URL; when it carries attribution, store it (last click
 * wins) and return it. Otherwise return what an earlier visit stored.
 */
export function captureAttribution(eventId: string): { attribution: Attribution | null; fromUrl: boolean } {
  try {
    const fromUrl = attributionFromSearchParams(new URLSearchParams(window.location.search))
    if (fromUrl) {
      storeAttribution(eventId, fromUrl)
      return { attribution: fromUrl, fromUrl: true }
    }
  } catch {
    // ignore
  }
  return { attribution: readStoredAttribution(eventId), fromUrl: false }
}

/**
 * Fire-and-forget click beacon. Deduped per browser per link for 30 minutes
 * (localStorage here; the server adds a cookie of its own). Same-origin `/api`,
 * so the enforcing CSP's `connect-src 'self'` already allows it.
 */
export function sendClickBeacon(eventId: string, attribution: Attribution | null): void {
  if (!attribution || (!attribution.tracking_link_id && !attribution.promoter_ref)) return
  const key = clickDedupeKey(eventId, { t: attribution.tracking_link_id, ref: attribution.promoter_ref })
  if (!key) return
  const storageKey = `${CLICK_PREFIX}${key}`
  const now = Date.now()
  try {
    const last = Number(localStorage.getItem(storageKey))
    if (!shouldSendClick(last, now, CLICK_DEDUPE_WINDOW_MS)) return
    localStorage.setItem(storageKey, String(now))
  } catch {
    // storage unavailable — the server cookie still dedupes
  }
  try {
    void fetch('/api/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        ...(attribution.tracking_link_id ? { t: attribution.tracking_link_id } : {}),
        ...(attribution.promoter_ref ? { ref: attribution.promoter_ref } : {}),
      }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined)
  } catch {
    // never surface
  }
}
