/**
 * Pure org-page helpers (no Firebase or Expo imports, so the root Jest suite
 * tests them): the app's copy of the web's lib/gallery.ts read + reorder rules
 * and lib/organizer/cover.ts template keys.
 *
 * The page's banner and photos live on public_profiles/{orgId}
 * (coverTemplate | coverImageUrl, gallery), written only by the server. The
 * app reads that doc directly, so it re-checks what it shows: a known
 * template key, or a file under org-pages/{orgId}/ in a Firebase Storage
 * download link.
 */

export interface GalleryPhoto {
  url: string;
  caption: string | null;
}

export const MAX_GALLERY_PHOTOS = 12;
export const MAX_GALLERY_CAPTION = 140;

/** Same keys and order as the web's COVER_TEMPLATES (the world photos). */
export const COVER_TEMPLATES = [
  'mizik',
  'lavi-lannwit',
  'kilti',
  'espo',
  'gastronomi',
  'biznis',
  'fanmi',
  'eksperyans',
] as const;
export type CoverTemplate = (typeof COVER_TEMPLATES)[number];

export function isCoverTemplate(v: unknown): v is CoverTemplate {
  return typeof v === 'string' && (COVER_TEMPLATES as readonly string[]).includes(v);
}

/** True for a download link to a file under org-pages/{orgId}/ (any bucket host form we hand out). */
export function isOrgPageUrl(url: unknown, orgId: string): url is string {
  if (typeof url !== 'string' || !url.startsWith('https://') || !orgId) return false;
  if (url.includes('..') || /%2e%2e/i.test(url)) return false;
  const encoded = `/o/${encodeURIComponent(`org-pages/${orgId}/`)}`;
  if (url.startsWith('https://firebasestorage.googleapis.com/v0/b/') && url.includes(encoded)) return true;
  return url.startsWith('https://storage.googleapis.com/') && url.includes(`/org-pages/${orgId}/`);
}

export type OrgCoverSource = { kind: 'template'; key: CoverTemplate } | { kind: 'upload'; url: string } | null;

/** The banner to show from a public_profiles doc, or null. */
export function readOrgCover(orgId: string, doc: Record<string, any> | null | undefined): OrgCoverSource {
  if (!doc) return null;
  if (isCoverTemplate(doc.coverTemplate)) return { kind: 'template', key: doc.coverTemplate };
  if (isOrgPageUrl(doc.coverImageUrl, orgId)) return { kind: 'upload', url: doc.coverImageUrl };
  return null;
}

/** A stored gallery, read defensively: this org's uploads only, max 12, no duplicates. */
export function readGallery(v: unknown, orgId?: string): GalleryPhoto[] {
  if (!Array.isArray(v)) return [];
  const out: GalleryPhoto[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const url = typeof item === 'string' ? item : (item as any)?.url;
    if (typeof url !== 'string' || !url.startsWith('https://') || seen.has(url)) continue;
    if (orgId && !isOrgPageUrl(url, orgId)) continue;
    seen.add(url);
    const c = typeof item === 'string' ? '' : String((item as any)?.caption ?? '').replace(/\s+/g, ' ').trim();
    out.push({ url, caption: c ? c.slice(0, MAX_GALLERY_CAPTION) : null });
    if (out.length >= MAX_GALLERY_PHOTOS) break;
  }
  return out;
}

export type GalleryMove = 'first' | 'up' | 'down' | 'last';

/** The list with item `index` moved; unchanged when the move goes nowhere. */
export function moveGalleryPhoto<T>(list: readonly T[], index: number, move: GalleryMove): T[] {
  const out = list.slice();
  if (!Number.isInteger(index) || index < 0 || index >= out.length) return out;
  const target = move === 'first' ? 0 : move === 'last' ? out.length - 1 : move === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= out.length || target === index) return out;
  const [item] = out.splice(index, 1);
  out.splice(target, 0, item);
  return out;
}

/** The moves that make sense for the photo at `index` of `count`. */
export function availableMoves(index: number, count: number): GalleryMove[] {
  if (count < 2 || index < 0 || index >= count) return [];
  const moves: GalleryMove[] = [];
  if (index > 0) moves.push('first', 'up');
  if (index < count - 1) moves.push('down', 'last');
  return moves;
}
