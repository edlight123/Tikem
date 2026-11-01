/**
 * The hosts event posters are actually stored on. Anything that fetches a
 * poster from the server (the share card, the poster tone) checks this first:
 * banner_image_url is organizer-supplied, so an open fetch would be an SSRF
 * primitive (internal metadata endpoints, localhost). https only, no
 * credentials or ports, and callers fetch with `redirect: 'error'` so an
 * allowed host cannot bounce elsewhere.
 */
export const POSTER_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'images.unsplash.com',
])

export function isAllowedPosterUrl(url: string | undefined | null): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && POSTER_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}
