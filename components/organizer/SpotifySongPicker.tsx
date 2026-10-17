'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Music2, X } from 'lucide-react'

import { parseSpotifyUrl } from '@/components/events/SpotifyEmbed'
import SpotifyLogo from '@/components/icons/SpotifyLogo'

/**
 * The composer's song field: a real Spotify typeahead instead of "paste a URL".
 *
 * Two modes, and the organizer never chooses between them:
 *  - `search`   — the default. Debounced typeahead against /api/spotify/search
 *                 (server-side Client Credentials; the secret never ships).
 *  - `fallback` — what the field used to be: a plain text input that accepts a
 *                 pasted open.spotify.com link. Entered automatically the first
 *                 time the route answers `not_configured` (no credentials set)
 *                 or otherwise fails, so a missing Spotify app degrades into
 *                 yesterday's behaviour rather than a dead end.
 *
 * Whatever path is taken, the value handed back is a plain
 * `https://open.spotify.com/track/{id}` URL — exactly the shape
 * SpotifyEmbed#parseSpotifyUrl accepts — so the event page is unchanged.
 */

type Track = {
  id: string
  name: string
  artists: string
  album: string
  albumArt: string | null
  url: string
  durationMs: number
}

const DEBOUNCE_MS = 250
const MIN_QUERY = 2

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function SpotifySongPicker({
  value,
  onChange,
}: {
  /** Current `spotify_url` (may be a hand-pasted link from an older edit). */
  value: string
  onChange: (url: string) => void
}) {
  const { t } = useTranslation('common')
  const listboxId = useId()

  const [mode, setMode] = useState<'search' | 'fallback'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  // Metadata for the track picked in this session, so the selected row can show
  // art + artist. Absent when `value` came from a saved event or a paste.
  const [picked, setPicked] = useState<Track | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const selected = value.trim()
  const parsed = useMemo(() => parseSpotifyUrl(selected), [selected])

  // ── Search ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'search') return
    const q = query.trim()

    if (q.length < MIN_QUERY) {
      abortRef.current?.abort()
      setResults([])
      setLoading(false)
      setOpen(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      abortRef.current = controller
      setLoading(true)
      try {
        const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        })

        if (!res.ok) {
          // 503 not_configured, 401, 5xx — all mean "searching isn't available
          // right now". Drop to the paste-a-URL field and keep what was typed.
          if (controller.signal.aborted) return
          setMode('fallback')
          setOpen(false)
          setResults([])
          return
        }

        const body = (await res.json()) as { tracks?: Track[] }
        if (controller.signal.aborted) return
        const tracks = Array.isArray(body.tracks) ? body.tracks : []
        setResults(tracks)
        setActive(tracks.length ? 0 : -1)
        setOpen(true)
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        setMode('fallback')
        setOpen(false)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, mode])

  // Close the listbox on an outside click (Escape is handled on the input).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const choose = useCallback(
    (track: Track) => {
      setPicked(track)
      onChange(track.url)
      setOpen(false)
      setResults([])
      setQuery('')
      setActive(-1)
    },
    [onChange]
  )

  const clear = useCallback(() => {
    setPicked(null)
    onChange('')
    setQuery('')
    setResults([])
    setOpen(false)
    // Put the caret back where the organizer expects it.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [onChange])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || results.length === 0) {
      if (e.key === 'ArrowDown' && results.length > 0) {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      const track = results[active]
      if (track) {
        e.preventDefault()
        choose(track)
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const shell =
    'bg-white/[0.06] flex items-center gap-3 rounded-xl px-4 transition-colors focus-within:ring-2 focus-within:ring-brand-400/40'

  // ── Selected state ──────────────────────────────────────────────────────
  // A picked track (or a saved/pasted link) collapses to one compact row.
  if (selected && (picked || parsed)) {
    const label = picked?.name || selected
    const sub = picked ? picked.artists : t('composer.spotifyPastedLink', { defaultValue: 'Spotify link' })

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.055] px-3 py-2.5">
          {picked?.albumArt ? (
            // Plain <img>: i.scdn.co isn't in images.remotePatterns and these are
            // already 64px squares, so /_next/image would only add a hop.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picked.albumArt}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            // A saved or pasted link has no album art to show, so the logo
            // stands in — it still says where the song lives.
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.07]">
              <SpotifyLogo className="h-[20px] w-[20px]" />
            </span>
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-white">{label}</span>
            <span className="block truncate text-xs text-white/50">
              {sub}
              {picked?.durationMs ? ` · ${formatDuration(picked.durationMs)}` : ''}
            </span>
          </span>

          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-white/60 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            {t('composer.spotifyChange', { defaultValue: 'Change' })}
          </button>
          <button
            type="button"
            onClick={clear}
            aria-label={t('composer.spotifyRemove', { defaultValue: 'Remove song' })}
            className="shrink-0 rounded-lg p-1 text-white/40 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Fallback: yesterday's paste-a-URL field ─────────────────────────────
  if (mode === 'fallback') {
    return (
      <div className="space-y-1.5">
        <div className={shell}>
          <SpotifyLogo className="h-[20px] w-[20px] shrink-0" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('composer.spotifyPlaceholder', { defaultValue: 'Add song from Spotify' })}
            aria-label={t('composer.spotifyPlaceholder', { defaultValue: 'Add song from Spotify' })}
            inputMode="url"
            autoComplete="off"
            className="w-full bg-transparent py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>
        <p className="px-1 text-[11px] text-white/40">
          {t('composer.spotifySearchUnavailable', {
            defaultValue: 'Song search needs setup. Paste a Spotify link for now.',
          })}
        </p>
      </div>
    )
  }

  // ── Search state ────────────────────────────────────────────────────────
  const activeId = active >= 0 && results[active] ? `${listboxId}-${results[active].id}` : undefined

  return (
    <div ref={wrapRef} className="relative">
      <div className={shell}>
        {/* The logo, not a magnifying glass: it says both "search" and "search
            Spotify" in one mark, and matches how the field reads in the app. */}
        <SpotifyLogo className="h-[20px] w-[20px] shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (results.length) setOpen(true)
          }}
          placeholder={t('composer.spotifySearchPlaceholder', {
            defaultValue: 'Search a song on Spotify',
          })}
          aria-label={t('composer.spotifySearchPlaceholder', {
            defaultValue: 'Search a song on Spotify',
          })}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          className="w-full bg-transparent py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" aria-hidden />}
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('composer.spotifyResultsLabel', { defaultValue: 'Song results' })}
          className="absolute left-0 right-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-xl bg-[#1c1c1c] py-1 shadow-2xl"
        >
          {results.length === 0 ? (
            <li className="px-4 py-3 text-xs text-white/40">
              {t('composer.spotifyNoResults', { defaultValue: 'No songs found.' })}
            </li>
          ) : (
            results.map((track, i) => (
              <li
                key={track.id}
                id={`${listboxId}-${track.id}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  // onMouseDown, not onClick: the outside-click listener fires
                  // on mousedown and would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(track)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    i === active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  {track.albumArt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.albumArt}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.07]">
                      <Music2 className="h-[18px] w-[18px] text-white/40" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{track.name}</span>
                    <span className="block truncate text-xs text-white/50">{track.artists}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-white/30">
                    {formatDuration(track.durationMs)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
