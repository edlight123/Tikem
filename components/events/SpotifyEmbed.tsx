'use client'

// The composer's "Add song from Spotify" field, finally audible: renders the
// official Spotify embed for a track/album/playlist/artist/episode URL on the
// event page. Anything unparseable renders nothing — a bad link never breaks
// the page.

const TYPES = new Set(['track', 'album', 'playlist', 'artist', 'episode', 'show'])

/** open.spotify.com/track/{id} (intl paths + query strings tolerated) → {type,id} */
export function parseSpotifyUrl(raw?: string | null): { type: string; id: string } | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    if (!/(^|\.)spotify\.com$/.test(u.hostname)) return null
    const parts = u.pathname.split('/').filter(Boolean) // drops intl-fr etc. below
    const i = parts.findIndex((p) => TYPES.has(p))
    const id = i >= 0 ? parts[i + 1] : ''
    if (i < 0 || !/^[A-Za-z0-9]{10,}$/.test(id || '')) return null
    return { type: parts[i], id }
  } catch {
    return null
  }
}

export default function SpotifyEmbed({ url, className = '' }: { url?: string | null; className?: string }) {
  const parsed = parseSpotifyUrl(url)
  if (!parsed) return null
  const compact = parsed.type === 'track' || parsed.type === 'episode'
  return (
    <div className={className}>
      {/* color-scheme: normal — the page is `color-scheme: dark`, and an
          iframe whose scheme differs from its document's gets an opaque
          canvas: white showed in the corners outside Spotify's own rounded
          player. The 4px clip is the house radius. */}
      <div className="overflow-hidden rounded">
      <iframe
        src={`https://open.spotify.com/embed/${parsed.type}/${parsed.id}?theme=0`}
        width="100%"
        height={compact ? 152 : 352}
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="block"
        style={{ colorScheme: 'normal' }}
        title="Spotify player"
      />
      </div>
    </div>
  )
}
