/**
 * Store one image for an organization's public page (banner or gallery photo)
 * under org-pages/{orgId}/ with the Admin SDK. Only the server writes there
 * (storage.rules: org-pages is read-only to clients), and only after the
 * calling route has checked the caller may edit this org's page
 * (requireOrg('manage_settings'): the owner or a team admin).
 *
 * The bytes decide the type (JPEG/PNG/WebP/GIF only, never SVG), the link is
 * a Firebase download-token URL (lib/firebase/downloadUrl: the bucket is
 * uniform-access, so makePublic would throw).
 */
import { randomUUID } from 'node:crypto'
import { adminStorage } from '@/lib/firebase/admin'
import { downloadUrl } from '@/lib/firebase/downloadUrl'
import { sniffRasterImage } from '@/lib/security/sniffImage'
import { orgPagePrefix } from '@/lib/gallery'

/** Under Vercel's ~4.5MB body limit, so our message is the one people see. */
export const MAX_ORG_PAGE_IMAGE_BYTES = 4 * 1024 * 1024

export type OrgPageUploadResult =
  | { ok: true; url: string; path: string }
  | { ok: false; status: number; error: string }

export async function readUploadFile(request: Request): Promise<File | null> {
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return null
  return file as File
}

export async function storeOrgPageImage(
  orgId: string,
  kind: 'cover' | 'gallery',
  file: File
): Promise<OrgPageUploadResult> {
  if (file.size > MAX_ORG_PAGE_IMAGE_BYTES) {
    return { ok: false, status: 413, error: 'Photos must be under 4 MB.' }
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const sniffed = sniffRasterImage(buffer)
  if (!sniffed) return { ok: false, status: 400, error: 'Use a JPEG, PNG, WebP or GIF photo.' }
  const path = `${orgPagePrefix(orgId)}${kind}_${Date.now()}_${randomUUID().slice(0, 8)}.${sniffed.ext}`
  const ref = adminStorage.bucket().file(path)
  await ref.save(buffer, { metadata: { contentType: sniffed.mime, cacheControl: 'public, max-age=31536000' } })
  return { ok: true, url: await downloadUrl(ref), path }
}
