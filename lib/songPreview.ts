/**
 * A 30-second preview clip for an event's Spotify song, so the app can play it
 * quietly in the background on the event page (owner feedback 2026-10-25).
 *
 * Spotify only lets its embed play while the embed is on screen, so the clip
 * comes from Apple's public iTunes Search API instead (no key; previews exist
 * to promote the track). We read the track's title and artists from Spotify's
 * public embed page, search iTunes for the same song and keep a result only
 * when the artist matches: no clip is better than the wrong song.
 */

export type SongPreview = {
  previewUrl: string
  trackName: string
  artistName: string
  /** The track on Apple Music, for attribution. */
  trackViewUrl: string | null
}

export type SpotifyTrackInfo = { name: string; artists: string[] }

/** Lowercase, accents and bracketed suffixes ("(Remastered)", "[Live]") and "feat." tails stripped. */
export function normalizeSongText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The track entity inside Spotify's embed page (`__NEXT_DATA__`). */
export function parseSpotifyEmbedHtml(html: string): SpotifyTrackInfo | null {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try {
    const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity
    const name = typeof entity?.name === 'string' ? entity.name.trim() : ''
    const artists = Array.isArray(entity?.artists)
      ? entity.artists.map((a: any) => (typeof a?.name === 'string' ? a.name.trim() : '')).filter(Boolean)
      : []
    if (!name || artists.length === 0) return null
    return { name, artists }
  } catch {
    return null
  }
}

/** The best iTunes result for the Spotify track, or null when nothing clearly matches. */
export function pickItunesMatch(track: SpotifyTrackInfo, results: any[]): SongPreview | null {
  const wantName = normalizeSongText(track.name)
  const wantArtists = track.artists.map(normalizeSongText).filter(Boolean)
  let best: { score: number; r: any } | null = null
  for (const r of results || []) {
    if (typeof r?.previewUrl !== 'string' || !r.previewUrl.startsWith('https://')) continue
    const artist = normalizeSongText(String(r.artistName || ''))
    const artistOk = wantArtists.some((a) => artist.includes(a) || a.includes(artist))
    if (!artistOk || !artist) continue
    const raw = String(r.trackName || '')
    const name = normalizeSongText(raw)
    // The verbatim title beats a version that only matches once "(Remix)" is stripped.
    const score =
      raw.trim().toLowerCase() === track.name.trim().toLowerCase()
        ? 3
        : name === wantName
          ? 2
          : name.includes(wantName) || wantName.includes(name)
            ? 1
            : 0
    if (score === 0) continue
    if (!best || score > best.score) best = { score, r }
  }
  if (!best) return null
  return {
    previewUrl: best.r.previewUrl,
    trackName: String(best.r.trackName),
    artistName: String(best.r.artistName),
    trackViewUrl: typeof best.r.trackViewUrl === 'string' ? best.r.trackViewUrl : null,
  }
}

export function itunesSearchUrl(track: SpotifyTrackInfo): string {
  const term = `${normalizeSongText(track.name)} ${normalizeSongText(track.artists[0])}`
  return `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(term)}`
}
