/**
 * The photo gallery on an organization's public page (web + app).
 *
 * Stored as an ordered array on public_profiles/{orgId}.gallery, written only
 * by /api/organizer/settings/gallery (owner or team admin), which runs every
 * write through sanitizeGallery. The files live under org-pages/{orgId}/ in
 * our Storage bucket, uploaded by that same route with the Admin SDK, so the
 * gallery can only ever hold the org's own uploads.
 *
 * The app keeps a copy of the read + reorder rules in mobile/lib/galleryRules.ts.
 */

export interface GalleryPhoto {
  url: string
  /** Optional, one short line. */
  caption: string | null
}

export const MAX_GALLERY_PHOTOS = 12
export const MAX_GALLERY_CAPTION = 140

/** Where an org's page images live in Storage (banner + gallery). */
export function orgPagePrefix(orgId: string): string {
  return `org-pages/${orgId}/`
}

const clip = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/** Any https URL without credentials (no data:, javascript: or http:). */
export function httpsImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Only a file in our own Firebase Storage bucket, and (with `prefix`) only
 * under that path: what the upload routes produce.
 */
export function ownStorageUrl(raw: unknown, bucket: string, prefix?: string): string | null {
  const s = httpsImageUrl(raw)
  if (!s || !bucket) return null
  const u = new URL(s)
  let objectPath: string | null = null
  if (u.hostname === 'firebasestorage.googleapis.com' && u.pathname.startsWith(`/v0/b/${bucket}/o/`)) {
    try {
      objectPath = decodeURIComponent(u.pathname.slice(`/v0/b/${bucket}/o/`.length))
    } catch {
      return null
    }
  } else if (u.hostname === 'storage.googleapis.com' && u.pathname.startsWith(`/${bucket}/`)) {
    try {
      objectPath = decodeURIComponent(u.pathname.slice(`/${bucket}/`.length))
    } catch {
      return null
    }
  }
  if (!objectPath || objectPath.includes('..')) return null
  if (prefix && !objectPath.startsWith(prefix)) return null
  return s
}

/**
 * Clean a whole gallery (the editors always send the full ordered list).
 * Accepts { url, caption } objects or bare URL strings. Drops duplicates;
 * refuses a bad URL, more than MAX_GALLERY_PHOTOS, or a non-array.
 */
export function sanitizeGallery(
  input: unknown,
  opts: { checkUrl?: (u: unknown) => string | null } = {}
): { ok: true; gallery: GalleryPhoto[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, gallery: [] }
  if (!Array.isArray(input)) return { ok: false, error: 'Gallery must be a list of photos.' }
  if (input.length > MAX_GALLERY_PHOTOS) return { ok: false, error: `Up to ${MAX_GALLERY_PHOTOS} photos.` }
  const check = opts.checkUrl ?? httpsImageUrl
  const out: GalleryPhoto[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const rawUrl = typeof item === 'string' ? item : (item as any)?.url
    const url = check(rawUrl)
    if (!url) return { ok: false, error: 'Photos must be uploaded images.' }
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, caption: typeof item === 'string' ? null : clip((item as any)?.caption, MAX_GALLERY_CAPTION) })
  }
  return { ok: true, gallery: out }
}

/** Read a stored gallery defensively (old docs, hand edits). Never throws. */
export function readGallery(v: unknown, checkUrl: (u: unknown) => string | null = httpsImageUrl): GalleryPhoto[] {
  if (!Array.isArray(v)) return []
  const out: GalleryPhoto[] = []
  const seen = new Set<string>()
  for (const item of v) {
    const url = checkUrl(typeof item === 'string' ? item : (item as any)?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, caption: typeof item === 'string' ? null : clip((item as any)?.caption, MAX_GALLERY_CAPTION) })
    if (out.length >= MAX_GALLERY_PHOTOS) break
  }
  return out
}

export type GalleryMove = 'first' | 'up' | 'down' | 'last'

/**
 * The gallery with photo `index` moved (the editor's reorder menu). Returns
 * the same order when the move goes nowhere or the index is out of range.
 */
export function moveGalleryPhoto<T>(list: readonly T[], index: number, move: GalleryMove): T[] {
  const out = list.slice()
  if (!Number.isInteger(index) || index < 0 || index >= out.length) return out
  const target =
    move === 'first' ? 0 : move === 'last' ? out.length - 1 : move === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= out.length || target === index) return out
  const [item] = out.splice(index, 1)
  out.splice(target, 0, item)
  return out
}

/** Which moves make sense for the photo at `index` of `count` (menu items). */
export function availableMoves(index: number, count: number): GalleryMove[] {
  if (count < 2 || index < 0 || index >= count) return []
  const moves: GalleryMove[] = []
  if (index > 0) moves.push('first', 'up')
  if (index < count - 1) moves.push('down', 'last')
  return moves
}

/** The Storage bucket name the server validates uploads against. */
export function storageBucketName(): string {
  const raw = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || ''
  return raw.startsWith('gs://') ? raw.slice('gs://'.length) : raw
}
