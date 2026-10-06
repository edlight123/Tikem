/**
 * A push notification's click target, reduced to a same-origin relative path.
 *
 * The service worker opens `data.url` on click, so an absolute or
 * protocol-relative URL here turns an admin push into a one-tap phishing link
 * on the user's lock screen. Only `/path?query#hash` is accepted; `//host`,
 * `/\host`, schemes and control characters are refused (returns null).
 * An empty value means "home" ('/').
 */
export function safePushPath(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '/'
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return '/'
  if (s.length > 2048) return null
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(s)) return null
  try {
    const base = 'https://push.invalid'
    const u = new URL(s, base)
    if (u.origin !== base) return null
    const path = u.pathname.replace(/^\/+/, '/')
    return `${path}${u.search}${u.hash}`
  } catch {
    return null
  }
}
