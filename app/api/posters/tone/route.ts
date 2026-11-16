import { NextResponse } from 'next/server'
import { fetchOwnPoster, isOwnPoster } from '@/lib/posters/hosts'
import { toneFrom } from '@/lib/posters/tone'

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

// A poster's colour is public; any origin may read it (the app's web build
// and previews call from another origin).
const CORS = { 'Access-Control-Allow-Origin': '*' }

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url')
  if (!isOwnPoster(url)) {
    return NextResponse.json({ tone: FALLBACK }, { status: 400, headers: CORS })
  }
  try {
    const buf = await fetchOwnPoster(url)
    if (!buf) throw new Error('unreadable')
    const { default: sharp } = await import('sharp')
    const { data } = await sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' })
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
