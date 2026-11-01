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

// Anything unauthenticated that fetches a poster server-side reads only OUR
// posters and caps the work: our storage bucket or an Unsplash photo (the
// flyer library), an image content type, at most 15MB read as a stream.
const MAX_BYTES = 15 * 1024 * 1024
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || ''

export function isOwnPoster(raw: string | null | undefined): raw is string {
  if (!isAllowedPosterUrl(raw)) return false
  const u = new URL(raw)
  if (u.hostname === 'images.unsplash.com') return u.pathname.startsWith('/photo-')
  if (!BUCKET) return false
  if (u.hostname === 'firebasestorage.googleapis.com') return u.pathname.startsWith(`/v0/b/${BUCKET}/`)
  if (u.hostname === 'storage.googleapis.com') return u.pathname.startsWith(`/${BUCKET}/`)
  return false
}

/**
 * The bytes of one of our posters, or null when the URL isn't ours. Throws on
 * a failed fetch, a non-image, or more than 15MB.
 */
export async function fetchOwnPoster(url: string | null | undefined): Promise<Buffer | null> {
  if (!isOwnPoster(url)) return null
  const res = await fetch(url, { redirect: 'error' })
  if (!res.ok) throw new Error(String(res.status))
  if (!/^image\//i.test(res.headers.get('content-type') || '')) throw new Error('not an image')
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_BYTES) throw new Error('too large')
  if (!res.body) throw new Error('no body')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new Error('too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
