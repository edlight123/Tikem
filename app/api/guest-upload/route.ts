import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { adminStorage } from '@/lib/firebase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Signed-out poster upload for the /create composer. Files land under
 * guest-uploads/ (admin SDK — storage rules stay untouched) with an
 * uploaded_at stamp; the cleanup cron deletes unreferenced ones after 7
 * days. When the visitor finishes sign-up and creates the event,
 * /api/guest-upload/promote copies the file into event-images/.
 *
 * Abuse posture: bytes are sniffed against the declared type (no
 * content-type spoofing), size is capped under the platform body limit, and
 * a best-effort per-IP throttle runs per warm instance. For real flood
 * protection add a WAF rate-limit rule on this path.
 */
const MAX_BYTES = 4 * 1024 * 1024 // stay under Vercel's ~4.5MB body cap so OUR error message is the one users see
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** The declared MIME must match the file's magic bytes. */
function sniffMatches(type: string, buf: Buffer): boolean {
  if (buf.length < 12) return false
  switch (type) {
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    case 'image/png':
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'image/webp':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP'
    case 'image/gif':
      return buf.subarray(0, 4).toString('ascii') === 'GIF8'
    default:
      return false
  }
}

// Best-effort per-IP throttle (per warm serverless instance): 10 uploads / 10 min.
const hits = new Map<string, number[]>()
function throttled(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - 10 * 60_000
  const list = (hits.get(ip) || []).filter((t) => t > windowStart)
  if (list.length >= 10) {
    hits.set(ip, list)
    return true
  }
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) hits.clear() // crude memory bound
  return false
}

export async function POST(request: Request) {
  try {
    const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
    if (throttled(ip)) {
      return NextResponse.json({ error: 'Too many uploads. Try again in a few minutes.' }, { status: 429 })
    }

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP or GIF images are allowed' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be less than 4MB' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    if (!sniffMatches(file.type, buf)) {
      return NextResponse.json({ error: 'That file does not look like a valid image.' }, { status: 400 })
    }

    const bucket = adminStorage.bucket()
    const token = randomUUID()
    const dest = `guest-uploads/${randomUUID()}.${EXT[file.type]}`

    await bucket.file(dest).save(buf, {
      contentType: file.type,
      metadata: {
        cacheControl: 'public, max-age=3600',
        metadata: {
          firebaseStorageDownloadTokens: token,
          guest_upload: '1',
          uploaded_at: new Date().toISOString(),
        },
      },
    })

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`
    return NextResponse.json({ url })
  } catch (err: any) {
    console.error('guest-upload failed:', err)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
