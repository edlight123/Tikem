import { NextResponse } from 'next/server'
import { itunesSearchUrl, parseSpotifyEmbedHtml, pickItunesMatch, type SongPreview } from '@/lib/songPreview'

export const runtime = 'nodejs'

/**
 * GET /api/spotify/preview?id=<spotify track id>
 *
 * A 30-second clip of an event's song for the app's background player; see
 * lib/songPreview.ts for why it comes from iTunes. Public (the event page is
 * public) and cached at the CDN per track for a day, so each song costs two
 * upstream calls a day, not two per viewer. `{ preview: null }` when there is
 * no confident match: the app then shows its tap-to-play card only.
 */

const cache = new Map<string, { at: number; value: SongPreview | null }>()
const CACHE_MS = 6 * 60 * 60_000

async function resolve(id: string): Promise<SongPreview | null> {
  const embed = await fetch(`https://open.spotify.com/embed/track/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Tikem/1.0)' },
    signal: AbortSignal.timeout(5000),
  })
  if (!embed.ok) return null
  const track = parseSpotifyEmbedHtml(await embed.text())
  if (!track) return null
  const search = await fetch(itunesSearchUrl(track), { signal: AbortSignal.timeout(5000) })
  if (!search.ok) return null
  const body = await search.json().catch(() => null)
  return pickItunesMatch(track, body?.results || [])
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') || ''
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) {
    return NextResponse.json({ error: 'bad_id' }, { status: 400 })
  }

  const hit = cache.get(id)
  let preview: SongPreview | null
  if (hit && Date.now() - hit.at < CACHE_MS) {
    preview = hit.value
  } else {
    try {
      preview = await resolve(id)
    } catch {
      // Upstream hiccup: answer "none" without caching it anywhere.
      return NextResponse.json({ preview: null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    cache.set(id, { at: Date.now(), value: preview })
    if (cache.size > 2000) cache.clear()
  }

  return NextResponse.json(
    { preview },
    { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } },
  )
}
