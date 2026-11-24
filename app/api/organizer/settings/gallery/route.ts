/**
 * /api/organizer/settings/gallery: the photo gallery on the ACTING org's
 * public page (lib/gallery.ts). The owner, or a team admin (manage_settings);
 * the app sends X-Tikem-Org for the org it is editing.
 *
 *   GET                       → { gallery: GalleryPhoto[] }
 *   POST multipart "file"     → upload one photo and add it at the end
 *   PUT  { gallery }          → the whole ordered list (reorder, delete,
 *                               captions): every URL must already be one of
 *                               this org's uploads (org-pages/{orgId}/)
 *
 * Up to MAX_GALLERY_PHOTOS. Written to public_profiles/{orgId}.gallery with
 * the Admin SDK; firestore.rules keep the field server-owned. A photo dropped
 * from the list is deleted from Storage too (best effort).
 */
import { NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { requireOrg } from '@/lib/organizer/context'
import {
  MAX_GALLERY_PHOTOS,
  orgPagePrefix,
  ownStorageUrl,
  readGallery,
  sanitizeGallery,
  storageBucketName,
  type GalleryPhoto,
} from '@/lib/gallery'
import { storagePathFromUrl } from '@/lib/firebase/downloadUrl'
import { readUploadFile, storeOrgPageImage } from '@/lib/organizer/orgPageUpload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function checkerFor(orgId: string) {
  const bucket = storageBucketName()
  const prefix = orgPagePrefix(orgId)
  return (u: unknown) => ownStorageUrl(u, bucket, prefix)
}

async function readOrgGallery(orgId: string): Promise<GalleryPhoto[]> {
  const snap = await adminDb.collection('public_profiles').doc(orgId).get()
  return readGallery(snap.exists ? snap.data()?.gallery : null, checkerFor(orgId))
}

async function writeOrgGallery(orgId: string, gallery: GalleryPhoto[]) {
  await adminDb
    .collection('public_profiles')
    .doc(orgId)
    .set({ gallery, gallery_updated_at: new Date().toISOString() }, { merge: true })
}

/** Delete the Storage files of photos that left the gallery. Never throws. */
async function deleteDropped(orgId: string, before: GalleryPhoto[], after: GalleryPhoto[]) {
  const kept = new Set(after.map((p) => p.url))
  const dropped = before.filter((p) => !kept.has(p.url))
  if (!dropped.length) return
  try {
    const bucket = adminStorage.bucket()
    const prefix = orgPagePrefix(orgId)
    await Promise.all(
      dropped.map(async (p) => {
        const path = storagePathFromUrl(p.url, bucket.name)
        if (!path || !path.startsWith(prefix)) return
        await bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined)
      })
    )
  } catch {
    // Storage cleanup is housekeeping; the gallery itself is already saved.
  }
}

export async function GET() {
  const org = await requireOrg('manage_settings')
  if (!org.ok) return org.response
  return NextResponse.json({ gallery: await readOrgGallery(org.value.orgId) })
}

export async function PUT(request: Request) {
  const org = await requireOrg('manage_settings')
  if (!org.ok) return org.response
  const orgId = org.value.orgId
  const body = await request.json().catch(() => null)
  const r = sanitizeGallery(body?.gallery, { checkUrl: checkerFor(orgId) })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  const before = await readOrgGallery(orgId)
  await writeOrgGallery(orgId, r.gallery)
  await deleteDropped(orgId, before, r.gallery)
  return NextResponse.json({ ok: true, gallery: r.gallery })
}

export async function POST(request: Request) {
  const org = await requireOrg('manage_settings')
  if (!org.ok) return org.response
  const orgId = org.value.orgId
  const before = await readOrgGallery(orgId)
  if (before.length >= MAX_GALLERY_PHOTOS) {
    return NextResponse.json({ error: `Up to ${MAX_GALLERY_PHOTOS} photos.`, code: 'gallery_full' }, { status: 409 })
  }
  const file = await readUploadFile(request)
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  try {
    const stored = await storeOrgPageImage(orgId, 'gallery', file)
    if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: stored.status })
    // Re-read: another upload may have landed while this one was stored.
    const current = await readOrgGallery(orgId)
    const gallery = [...current, { url: stored.url, caption: null }].slice(0, MAX_GALLERY_PHOTOS)
    await writeOrgGallery(orgId, gallery)
    return NextResponse.json({ ok: true, gallery })
  } catch (err) {
    console.error('[org-gallery] upload failed', (err as any)?.message)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
