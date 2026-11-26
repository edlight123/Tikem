import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { adminStorage } from '@/lib/firebase/admin'
import { downloadUrl } from '@/lib/firebase/downloadUrl'
import { sniffRasterImage } from '@/lib/security/sniffImage'
import { consumeRateLimit } from '@/lib/rate-limit'
import { printedUploadPrefix } from '@/lib/physical/design/assets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Under Vercel's ~4.5MB body limit, so our message is the one people see. */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * POST /api/organizer/events/:id/physical-batches/upload (multipart: file, kind=photo|logo)
 *
 * Art for a printed batch: the main artist photo or a logo, stored under the
 * event's folder (event-photos/{eventId}/printed/, server-written, public
 * read) with a download-token link (the bucket is uniform-access: never
 * makePublic). The bytes decide the type: JPEG / PNG / WebP / GIF only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = String((await params)?.id || '')
  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response

  const limit = await consumeRateLimit({ key: `physical:upload:${gate.value.user.id}`, limit: 60, windowMs: 60 * 60 * 1000 })
  if (limit.limited) return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const kind = form?.get('kind') === 'logo' ? 'logo' : 'photo'
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose an image', code: 'no_file' }, { status: 400 })
  if ((file as File).size > MAX_BYTES) return NextResponse.json({ error: 'Images must be under 4 MB.', code: 'too_large' }, { status: 413 })
  const buffer = Buffer.from(await (file as File).arrayBuffer())
  const sniffed = sniffRasterImage(buffer)
  if (!sniffed) return NextResponse.json({ error: 'Use a JPEG, PNG, WebP or GIF image.', code: 'bad_type' }, { status: 400 })

  try {
    const path = `${printedUploadPrefix(eventId)}${kind}_${Date.now()}_${randomUUID().slice(0, 8)}.${sniffed.ext}`
    const ref = adminStorage.bucket().file(path)
    await ref.save(buffer, { metadata: { contentType: sniffed.mime, cacheControl: 'public, max-age=31536000' } })
    return NextResponse.json({ url: await downloadUrl(ref), kind })
  } catch (err: any) {
    console.error('[physical] upload failed', { eventId, message: err?.message })
    return NextResponse.json({ error: 'The upload failed. Try again.' }, { status: 500 })
  }
}
