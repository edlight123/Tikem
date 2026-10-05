/**
 * GET  /api/flyers/search?q=<query>&page=<n>
 * POST /api/flyers/search  { downloadLocation }
 *
 * Thin proxy over the Unsplash Search Photos API that backs the mobile
 * "Select a flyer" library. The proxy exists so UNSPLASH_ACCESS_KEY stays
 * server-side — the app never sees it — and so we can degrade gracefully:
 * when the key is not configured we answer 200 with `configured: false`
 * and the client falls back to upload-only.
 *
 * The POST leg fires Unsplash's REQUIRED download event: their API terms
 * say the `links.download_location` URL must be hit whenever a photo is
 * actually used (i.e. the organizer picked it as their flyer), not merely
 * displayed in the grid.
 *
 * Both legs require a signed-in user (cookie session or the mobile app's
 * Bearer token): open to the internet, anyone could burn the Unsplash quota
 * the composer depends on.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos'

/** Event-flyer-flavoured default so an empty search box still shows usable art. */
const DEFAULT_QUERY = 'concert party event'
const PER_PAGE = 24

function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

interface FlyerResult {
  id: string
  thumbUrl: string
  fullUrl: string
  width: number
  height: number
  photographer: string
  photographerUrl: string
  downloadLocation: string
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail('Sign in to search images.', 'unauthorized', 401)

  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) {
    // Not an error from the client's point of view: the library is simply
    // unavailable and the sheet shows only the upload path.
    return NextResponse.json({ configured: false, results: [] })
  }

  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim() || DEFAULT_QUERY
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

    const upstream = new URL(UNSPLASH_SEARCH_URL)
    upstream.searchParams.set('query', q)
    upstream.searchParams.set('page', String(page))
    upstream.searchParams.set('per_page', String(PER_PAGE))
    // Flyers render in a 4:5 tile and become event posters — portrait only.
    upstream.searchParams.set('orientation', 'portrait')

    const res = await fetch(upstream.toString(), {
      headers: { Authorization: `Client-ID ${accessKey}` },
    })

    if (!res.ok) {
      console.error('flyers/search: Unsplash responded', res.status)
      return fail('Image search is unavailable right now.', 'upstream_error', 502)
    }

    const data = await res.json()
    const results: FlyerResult[] = (Array.isArray(data?.results) ? data.results : [])
      .map((photo: any): FlyerResult | null => {
        const thumbUrl = String(photo?.urls?.small || '')
        const fullUrl = String(photo?.urls?.regular || '')
        const downloadLocation = String(photo?.links?.download_location || '')
        // A tile without an image or the mandatory download hook is useless.
        if (!photo?.id || !thumbUrl || !fullUrl || !downloadLocation) return null
        return {
          id: String(photo.id),
          thumbUrl,
          fullUrl,
          width: Number(photo?.width) || 0,
          height: Number(photo?.height) || 0,
          photographer: String(photo?.user?.name || ''),
          photographerUrl: String(photo?.user?.links?.html || ''),
          downloadLocation,
        }
      })
      .filter((r: FlyerResult | null): r is FlyerResult => r !== null)

    return NextResponse.json(
      { configured: true, results, total: Number(data?.total) || results.length },
      // Same query = same grid; 5 minutes keeps us well inside Unsplash's
      // demo-tier rate limit without the grid feeling stale. `private`: the
      // response sits behind auth now, so a shared CDN copy would hand it to
      // unauthenticated callers.
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    )
  } catch (error) {
    console.error('flyers/search failed', error)
    return fail('Image search is unavailable right now.', 'internal_error', 500)
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail('Sign in to use images.', 'unauthorized', 401)

  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) {
    // Nothing to report to; treat as done so the client never blocks on this.
    return NextResponse.json({ ok: true })
  }

  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return fail('Malformed request body.', 'bad_request')
    }

    const downloadLocation =
      typeof body?.downloadLocation === 'string' ? body.downloadLocation.trim() : ''
    if (!downloadLocation) return fail('downloadLocation is required.', 'missing_download_location')

    // Only ever call back into the Unsplash API with our key — refuse anything
    // that would turn this endpoint into an authenticated open proxy.
    if (!downloadLocation.startsWith('https://api.unsplash.com/')) {
      return fail('Invalid download location.', 'invalid_download_location')
    }

    const res = await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    })

    if (!res.ok) {
      console.error('flyers/search: download event failed', res.status)
      // The client fires this fire-and-forget; a failed attribution ping must
      // not surface as a user-facing error.
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('flyers/search download event failed', error)
    return NextResponse.json({ ok: true })
  }
}
