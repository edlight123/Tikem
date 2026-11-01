import { NextResponse } from 'next/server'
import { isAllowedPosterUrl } from '@/lib/posters/hosts'

// sharp is a native module: nodejs runtime.
export const runtime = 'nodejs'

/**
 * GET /api/posters/tone?url=<poster url> → { tone: '#rrggbb' }
 *
 * The matte colour behind a flyer that doesn't match the 4:5 frame (square
 * Instagram or 9:16 Stories art, shown whole). A blurred copy of the flyer
 * left uneven patches of colour above and below it; one even tone taken from
 * the flyer reads as a deliberate mount. The app has no way to read pixels
 * without a native module, so both the app and the website ask here.
 *
 * The tone is the flyer's average colour, kept in its hue but pushed down to
 * a deep shade so it sits on the near-black canvas and never competes with
 * the art. Cached for a year at the CDN: a URL's pixels don't change.
 */

const FALLBACK = '#141414'

// Unauthenticated and server-side, so it reads only our own posters and caps
// the work: our storage bucket or an Unsplash photo (the flyer library), an
// image content type, at most 15MB read as a stream, and a decode pixel cap.
const MAX_BYTES = 15 * 1024 * 1024
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || ''

function isOwnPoster(raw: string): boolean {
  const u = new URL(raw)
  if (u.hostname === 'images.unsplash.com') return u.pathname.startsWith('/photo-')
  if (!BUCKET) return false
  if (u.hostname === 'firebasestorage.googleapis.com') return u.pathname.startsWith(`/v0/b/${BUCKET}/`)
  if (u.hostname === 'storage.googleapis.com') return u.pathname.startsWith(`/${BUCKET}/`)
  return false
}

async function readCapped(res: Response): Promise<Buffer> {
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

// A poster's colour is public; any origin may read it (the app's web build
// and previews call from another origin).
const CORS = { 'Access-Control-Allow-Origin': '*' }

function toneFrom(r: number, g: number, b: number): string {
  // RGB → HSL
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
    h /= 6
  }
  // Deep and quiet: 10–18% lightness, saturation capped so neon art doesn't
  // turn the mount into a coloured slab.
  const L = Math.min(0.18, Math.max(0.1, l * 0.4))
  const S = Math.min(0.55, s * 1.1)
  // HSL → RGB
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S
  const p = 2 * L - q
  const ch = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${ch(h + 1 / 3)}${ch(h)}${ch(h - 1 / 3)}`
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url')
  if (!isAllowedPosterUrl(url) || !isOwnPoster(url)) {
    return NextResponse.json({ tone: FALLBACK }, { status: 400, headers: CORS })
  }
  try {
    const res = await fetch(url, { redirect: 'error' })
    if (!res.ok) throw new Error(String(res.status))
    if (!/^image\//i.test(res.headers.get('content-type') || '')) throw new Error('not an image')
    const { default: sharp } = await import('sharp')
    const { data } = await sharp(await readCapped(res), { limitInputPixels: 50_000_000, failOn: 'error' })
      .resize(1, 1, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return NextResponse.json(
      { tone: toneFrom(data[0], data[1], data[2]) },
      { headers: { ...CORS, 'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable' } }
    )
  } catch {
    // Short cache: a transient fetch failure shouldn't pin the fallback.
    return NextResponse.json({ tone: FALLBACK }, { headers: { ...CORS, 'Cache-Control': 'public, s-maxage=300' } })
  }
}
