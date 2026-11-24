/**
 * /api/organizer/settings/cover: the banner across the top of the ACTING
 * org's public page (lib/organizer/cover.ts). The owner, or a team admin
 * (manage_settings); the app sends X-Tikem-Org for the org it is editing.
 *
 *   GET                         → { coverTemplate, coverImageUrl }
 *   PUT  { template: key }      → one of our world photos
 *   PUT  { template: null }     → no banner (the page's own black)
 *   PUT  { coverImageUrl }      → an earlier upload of this org's (org-pages/{orgId}/)
 *   POST multipart "file"       → upload a photo and make it the banner
 *
 * Written to public_profiles/{orgId} (the public page and the app read it
 * there) with the Admin SDK; firestore.rules keep these fields server-owned.
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireOrg } from '@/lib/organizer/context'
import { isCoverTemplate, resolveOrgCover } from '@/lib/organizer/cover'
import { orgPagePrefix, ownStorageUrl, storageBucketName } from '@/lib/gallery'
import { readUploadFile, storeOrgPageImage } from '@/lib/organizer/orgPageUpload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CoverFields = { coverTemplate: string | null; coverImageUrl: string | null }

async function saveCover(orgId: string, fields: CoverFields) {
  await adminDb
    .collection('public_profiles')
    .doc(orgId)
    .set({ ...fields, cover_updated_at: new Date().toISOString() }, { merge: true })
}

function answer(orgId: string, fields: CoverFields) {
  const cover = resolveOrgCover(orgId, fields)
  return NextResponse.json({
    ok: true,
    coverTemplate: cover?.kind === 'template' ? cover.key : null,
    coverImageUrl: cover?.kind === 'upload' ? cover.src : null,
  })
}

export async function GET() {
  const org = await requireOrg('manage_settings')
  if (!org.ok) return org.response
  const orgId = org.value.orgId
  const snap = await adminDb.collection('public_profiles').doc(orgId).get()
  const d = snap.exists ? snap.data() || {} : {}
  return answer(orgId, { coverTemplate: d.coverTemplate ?? null, coverImageUrl: d.coverImageUrl ?? null })
}

export async function PUT(request: Request) {
  const org = await requireOrg('manage_settings')
  if (!org.ok) return org.response
  const orgId = org.value.orgId
  const body = (await request.json().catch(() => null)) || {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  let fields: CoverFields
  if (has('template')) {
    if (body.template == null || body.template === '') {
      fields = { coverTemplate: null, coverImageUrl: null }
    } else if (isCoverTemplate(body.template)) {
      fields = { coverTemplate: body.template, coverImageUrl: null }
    } else {
      return NextResponse.json({ error: 'Unknown banner.' }, { status: 400 })
    }
  } else if (has('coverImageUrl')) {
    if (body.coverImageUrl == null || body.coverImageUrl === '') {
      fields = { coverTemplate: null, coverImageUrl: null }
    } else {
      const url = ownStorageUrl(body.coverImageUrl, storageBucketName(), orgPagePrefix(orgId))
      if (!url) return NextResponse.json({ error: 'The banner must be an uploaded image.' }, { status: 400 })
      fields = { coverTemplate: null, coverImageUrl: url }
    }
  } else {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  await saveCover(orgId, fields)
  return answer(orgId, fields)
}

export async function POST(request: Request) {
  const org = await requireOrg('manage_settings')
  if (!org.ok) return org.response
  const orgId = org.value.orgId
  const file = await readUploadFile(request)
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  try {
    const stored = await storeOrgPageImage(orgId, 'cover', file)
    if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: stored.status })
    const fields = { coverTemplate: null, coverImageUrl: stored.url }
    await saveCover(orgId, fields)
    return answer(orgId, fields)
  } catch (err) {
    console.error('[org-cover] upload failed', (err as any)?.message)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
