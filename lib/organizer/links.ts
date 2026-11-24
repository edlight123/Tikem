/**
 * An organization's website and social links, stored as https URLs only.
 *
 * Organizers type these however they like: "kompanights.com", "@kompanights",
 * "instagram.com/kompanights", "http://facebook.com/kompa". What we keep is
 * always an absolute https URL (or nothing), so every reader can drop it in an
 * href as is, and a link labelled "Instagram" can only ever open Instagram.
 *
 * Used by every writer of organizers/{orgId}.website and .social_media:
 * the web "create your organization" step (app/organizer/actions.ts), the
 * app's twin (POST /api/account/become-organizer) and organization settings
 * (PUT/PATCH /api/organizer/settings/organization). Readers still accept the
 * older bare handles through lib/profile/public-details.ts socialHref.
 */

export type SocialNetwork = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'tiktok'

export const MAX_LINK_LENGTH = 500

/** A bare handle: no scheme, no slash. Dots are allowed (john.doe on Instagram). */
const HANDLE_RE = /^@?[A-Za-z0-9._-]{1,100}$/

/** The hosts a network's link may point at (any subdomain of them too). */
const NETWORK_HOSTS: Record<SocialNetwork, string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  twitter: ['x.com', 'twitter.com'],
  linkedin: ['linkedin.com'],
  tiktok: ['tiktok.com'],
}

/** Where a bare handle lives on each network. */
const HANDLE_URL: Record<SocialNetwork, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}`,
  facebook: (h) => `https://www.facebook.com/${h}`,
  twitter: (h) => `https://x.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/in/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
}

/**
 * A typed link as an https URL. '' for empty input, null when it is not a
 * usable web address (another scheme, credentials, no dotted host, too long).
 * http is upgraded to https.
 */
export function toHttpsUrl(raw: unknown): string | null {
  if (raw == null) return ''
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return ''
  if (s.length > MAX_LINK_LENGTH) return null
  // Anything with a scheme other than http(s) is refused, not "fixed".
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    // "localhost:3000" style host:port reads as a scheme; still not a web address we keep.
    return null
  }
  const withScheme = scheme ? s : `https://${s.replace(/^\/+/, '')}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null
  // Raw IP addresses are not anybody's website.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null
  u.protocol = 'https:'
  u.port = ''
  return u.toString()
}

function hostMatches(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase()
  return allowed.some((a) => h === a || h.endsWith(`.${a}`))
}

/**
 * A typed social value (handle or link) as an https URL on that network.
 * '' for empty, null when it is neither a handle nor a link to that network.
 */
export function socialToHttpsUrl(network: SocialNetwork, raw: unknown): string | null {
  if (raw == null) return ''
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return ''
  if (s.length > MAX_LINK_LENGTH) return null
  // A bare handle, unless it is really a domain on that network ("instagram.com").
  if (HANDLE_RE.test(s) && !hostMatches(s.replace(/^@+/, ''), NETWORK_HOSTS[network])) {
    const handle = s.replace(/^@+/, '')
    if (!handle || /^[.]+$/.test(handle)) return null
    return HANDLE_URL[network](handle)
  }
  const url = toHttpsUrl(s)
  if (!url) return null
  const u = new URL(url)
  if (!hostMatches(u.hostname, NETWORK_HOSTS[network])) return null
  // The network's home page alone is not a profile.
  if (u.pathname === '/' && !u.search) return null
  return url
}

/**
 * Clean a set of optional org links in one go (all optional). Returns the
 * cleaned values for the keys present, or the first invalid key.
 */
export function cleanOrgLinks(input: {
  website?: unknown
  instagram?: unknown
  facebook?: unknown
  twitter?: unknown
  linkedin?: unknown
  tiktok?: unknown
}): { ok: true; website?: string; social: Partial<Record<SocialNetwork, string>> } | { ok: false; field: string } {
  const out: { ok: true; website?: string; social: Partial<Record<SocialNetwork, string>> } = { ok: true, social: {} }
  if ('website' in input && input.website !== undefined) {
    const w = toHttpsUrl(input.website)
    if (w === null) return { ok: false, field: 'website' }
    out.website = w
  }
  for (const network of Object.keys(NETWORK_HOSTS) as SocialNetwork[]) {
    if (!(network in input) || input[network] === undefined) continue
    const v = socialToHttpsUrl(network, input[network])
    if (v === null) return { ok: false, field: network }
    out.social[network] = v
  }
  return out
}
