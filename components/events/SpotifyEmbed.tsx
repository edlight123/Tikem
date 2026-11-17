'use client'

// The composer's "Add song from Spotify" field, finally audible: renders the
// official Spotify embed for a track/album/playlist/artist/episode URL on the
// event page. Anything unparseable renders nothing — a bad link never breaks
// the page.

import { useEffect, useRef, useState } from 'react'

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
  const compact = parsed ? parsed.type === 'track' || parsed.type === 'episode' : true
  const height = compact ? 152 : 352
  // Mount the player only when its slot comes near the screen (2026-11-17
  // speed pass: two Spotify players — one in the hidden desktop/mobile twin —
  // loaded from the first paint and pushed the poster's paint to ~3s on a
  // phone). A slot inside a display:none layout never intersects, so the
  // hidden twin never loads at all. Same-size box until then: no jump.
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (near || !parsed) return
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near, parsed])

  if (!parsed) return null
  return (
    <div className={className}>
      {/* color-scheme: normal — the page is `color-scheme: dark`, and an
          iframe whose scheme differs from its document's gets an opaque
          canvas: white showed in the corners outside Spotify's own rounded
          player. The 4px clip is the house radius. */}
      <div ref={box} className="overflow-hidden rounded bg-white/[0.06]" style={{ height }}>
        {near ? (
          <iframe
            src={`https://open.spotify.com/embed/${parsed.type}/${parsed.id}?theme=0`}
            width="100%"
            height={height}
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="block"
            style={{ colorScheme: 'normal' }}
            title="Spotify player"
          />
        ) : null}
      </div>
    </div>
  )
}
