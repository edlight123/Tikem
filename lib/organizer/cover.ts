/**
 * The banner across the top of an organization's public page.
 *
 * Two kinds, stored on public_profiles/{orgId} by
 * /api/organizer/settings/cover (owner or team admin):
 *   coverTemplate   one of our world photos (the same real photographs as the
 *                   world tiles: public/art/world-photos on the web, bundled
 *                   in the app as mobile/assets/photos), by key
 *   coverImageUrl   an uploaded photo under org-pages/{orgId}/ in our bucket
 * At most one is set. Neither = no banner (the page's own black).
 *
 * The app keeps a copy of the template keys in mobile/lib/orgCover.ts.
 */
import { orgPagePrefix, ownStorageUrl, storageBucketName } from '@/lib/gallery'

export const COVER_TEMPLATES = [
  'mizik',
  'lavi-lannwit',
  'kilti',
  'espo',
  'gastronomi',
  'biznis',
  'fanmi',
  'eksperyans',
] as const

export type CoverTemplate = (typeof COVER_TEMPLATES)[number]

export function isCoverTemplate(v: unknown): v is CoverTemplate {
  return typeof v === 'string' && (COVER_TEMPLATES as readonly string[]).includes(v)
}

/** The site path of a template banner. */
export function coverTemplatePath(key: CoverTemplate): string {
  return `/art/world-photos/${key}.jpg`
}

export type OrgCover =
  | { kind: 'template'; key: CoverTemplate; src: string }
  | { kind: 'upload'; src: string }

/**
 * The banner to show, read defensively from a public_profiles doc: a known
 * template key, or an upload in our bucket under the org's own prefix. Any
 * other value (a hand edit, a stray link) shows no banner.
 */
export function resolveOrgCover(
  orgId: string,
  doc: Record<string, any> | null | undefined,
  bucket: string = storageBucketName()
): OrgCover | null {
  if (!doc) return null
  if (isCoverTemplate(doc.coverTemplate)) {
    return { kind: 'template', key: doc.coverTemplate, src: coverTemplatePath(doc.coverTemplate) }
  }
  const url = ownStorageUrl(doc.coverImageUrl, bucket, orgPagePrefix(orgId))
  return url ? { kind: 'upload', src: url } : null
}
