/**
 * One guard for every organizer-supplied link the app renders.
 *
 * Anything typed into the composer — a lineup member's Instagram, a promo
 * video — is arbitrary text that ends up in an `href`. A bare `javascript:` or
 * `data:` URL in an anchor is an XSS vector, and a custom scheme
 * (`myapp://…`) is a deep link out of the browser. So nothing reaches an href
 * without passing through here.
 *
 * Extracted from lib/lineup.ts (which had the only copy) when the promo video
 * needed the same rule. Two implementations of a security check drift; one
 * does not.
 */

/**
 * Normalise a user-typed link, or reject it.
 *
 * - A bare domain gets `https://` (people type "instagram.com/x").
 * - Only http/https survive; every other scheme is rejected outright.
 * - A hostname with no dot is rejected, which is what stops
 *   `https://javascript:alert(1)` and similar from looking like a host.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** How a link reads as text: host plus path, no scheme, no www. */
export function externalUrlLabel(href: string): string {
  try {
    const u = new URL(href)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return href
  }
}

/**
 * A post-login redirect target reduced to a same-origin path, or '/'.
 *
 * Resolved against `origin` with the URL parser, so every trick a browser would
 * honour is judged the way the browser will judge it: `//evil.com`,
 * `/\evil.com` (backslash is a slash in http URLs), `https://evil.com`,
 * `javascript:alert(1)`. Anything that does not land on `origin` is refused.
 * Returns pathname + search + hash, never an absolute URL.
 */
export function safeSameOriginPath(raw: string | null | undefined, origin: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return '/'
  try {
    const base = new URL(origin)
    const url = new URL(raw.trim(), base.origin)
    if (url.origin !== base.origin) return '/'
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '/'
    return `${url.pathname}${url.search}${url.hash}` || '/'
  } catch {
    return '/'
  }
}
