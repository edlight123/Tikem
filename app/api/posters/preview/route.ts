import { NextResponse } from 'next/server'
import { cleanInput, renderPoster } from '@/lib/posters/render'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'

// satori + sharp + fonts off disk: nodejs runtime.
export const runtime = 'nodejs'

/**
 * GET /api/posters/preview?template=&title=&start=YYYY-MM-DDTHH:mm&venue=&city=
 *   &lineup=a|b|c&presenter=&locale=ht|fr|en&palette=0-2&seed=&photo=[&full=1]
 *
 * A template drawn with the event's own facts, for the composer's picker. The
 * same query always draws the same poster, so the CDN caches it; the per-IP
 * limit only meets cache misses. Saving a poster to an event goes through the
 * authenticated POST /api/posters/create instead.
 */
const HOUR = 60 * 60 * 1000

export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries())
  const input = cleanInput(params)
  if (!input) return NextResponse.json({ error: 'invalid poster' }, { status: 400 })

  // failOpen: the picker loads ~18 previews at once from one IP, and parallel
  // transactions on one counter abort under contention. This limit only
  // guards server time (the CDN absorbs repeats), so a count that can't be
  // written lets the preview through rather than blanking the picker.
  const { limited } = await consumeRateLimit({ key: `poster-preview:ip:${clientIp(req)}`, limit: 300, windowMs: HOUR, failOpen: true })
  if (limited) return NextResponse.json({ error: 'rate limited' }, { status: 429 })

  try {
    const jpeg = await renderPoster(input)
    const { default: sharp } = await import('sharp')
    // Previews are thumbnails in a picker: half size is plenty. `full=1`
    // (the showcase seeding script) gets the 1080x1350 original.
    const full = new URL(req.url).searchParams.get('full') === '1'
    const out = full ? jpeg : await sharp(jpeg).resize(540, 675).jpeg({ quality: 80 }).toBuffer()
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600, s-maxage=604800',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    console.error('[posters/preview]', (e as Error)?.message)
    return NextResponse.json({ error: 'render failed' }, { status: 500 })
  }
}
