'use client'

/**
 * The organizer's promo video, played in place.
 *
 * This was a link out, on the reasoning that embedding means opening the
 * enforcing CSP's `frame-src` to a third party. The owner's call is that
 * nobody should have to leave the page to watch a trailer, so it embeds — and
 * the safety comes from lib/videoEmbed instead of from refusing: only YouTube
 * and Vimeo are recognised, and the frame's URL is BUILT from a template
 * against a validated id, never taken from the organizer's string. Anything
 * unrecognised falls through to the old link, which is the honest outcome for
 * a URL we cannot vouch for.
 *
 * Autoplays MUTED once it is on screen (owner ask 2026-10-25, the way
 * Instagram does it): browsers refuse sound without a tap, so the preview
 * loops silently and "Tap for sound" restarts it with sound. Skipped for Data
 * Saver and reduced motion. It pauses when scrolled away and resumes when it
 * comes back, through the players' postMessage APIs.
 *
 * Still no iframe on mount: only once the card is actually in view. A cold iframe is ~600KB of
 * third-party JavaScript and a set of cookies, paid by every reader of every
 * event page whether or not they ever press play — on the connections this
 * product serves that is the difference between a page that opens and one that
 * hangs. The facade is a still and a button; the frame appears on the tap.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Volume2 } from 'lucide-react'
import { parseVideoEmbed } from '@/lib/videoEmbed'
import PromoVideoLink from './PromoVideoLink'

export default function PromoVideo({
  url,
  className = '',
}: {
  url?: string | null
  className?: string
}) {
  const { t } = useTranslation('common')
  // idle: the still. muted: the silent in-view preview. sound: the viewer
  // pressed play or "Tap for sound".
  const [mode, setMode] = useState<'idle' | 'muted' | 'sound'>('idle')
  const video = parseVideoEmbed(url)
  const boxRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el || !video || typeof IntersectionObserver === 'undefined') return
    const saveData = Boolean((navigator as any).connection?.saveData)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (saveData || reduced) return
    const post = (cmd: 'play' | 'pause') => {
      const w = frameRef.current?.contentWindow
      if (!w) return
      if (video.provider === 'youtube') {
        w.postMessage(JSON.stringify({ event: 'command', func: cmd === 'play' ? 'playVideo' : 'pauseVideo', args: '' }), '*')
      } else {
        w.postMessage(JSON.stringify({ method: cmd }), '*')
      }
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMode((m) => (m === 'idle' ? 'muted' : m))
          post('play')
        } else {
          post('pause')
        }
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.provider, video?.id])

  // Not a provider we can frame — keep the link rather than pretend.
  if (!video) return <PromoVideoLink url={url} className={className} />

  const label = t('events.watchTrailer', { defaultValue: 'Watch the trailer' })

  return (
    <figure className={`m-0 ${className}`}>
      {/* 16:9, not the house 4:5. A poster is portrait; a video is not, and
          letterboxing one into the other would put black bars inside a frame
          that is already on a black page. */}
      <div ref={boxRef} className="relative aspect-video w-full overflow-hidden rounded bg-white/[0.05]">
        {mode !== 'idle' ? (
          <>
            <iframe
              ref={frameRef}
              key={mode}
              src={mode === 'muted' ? video.mutedAutoplayUrl : video.autoplayUrl}
              title={label}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
            {mode === 'muted' && (
              <button
                type="button"
                onClick={() => setMode('sound')}
                className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded bg-black/70 px-3 py-2 text-[13px] font-semibold text-white backdrop-blur transition-colors hover:bg-black/85"
              >
                <Volume2 className="h-4 w-4" aria-hidden />
                {t('events.tapForSound', { defaultValue: 'Tap for sound' })}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMode('sound')}
            aria-label={label}
            className="group absolute inset-0 h-full w-full cursor-pointer text-left"
          >
            {video.thumbnailUrl ? (
              <>
                {/* Plain img: i.ytimg.com serves this already sized, so the
                    Next optimizer would re-fetch and re-encode a still we show
                    once. eslint wants next/image; this is the exception the
                    venue map makes for the same reason.
                    `object-cover` in a 16:9 box is exactly right for
                    hqdefault, which is 480x360 with the 16:9 frame
                    letterboxed inside it: covering a 16:9 container scales by
                    4/3 and crops precisely the two black bands away. Chosen
                    over maxresdefault, which is true 16:9 but does not exist
                    for every video and answers a missing one with a grey
                    placeholder rather than a 404 — undetectable, and it looks
                    like a broken player. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={video.thumbnailUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </>
            ) : (
              /* Vimeo has no stable still (see lib/videoEmbed), so the card
                 draws its own instead of showing an empty box. */
              <span
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(120%_120%_at_30%_0%,rgba(45,212,191,0.16),transparent_60%)]"
              />
            )}

            {/* Scrim: the caption has to stay legible over whatever still the
                organizer's video happens to have. */}
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/35"
            />

            {/* The play control. White on black is the house primary; the ring
                is the only teal, and it means "this is the thing to press". */}
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded bg-white/95 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.7)] ring-1 ring-brand-400/0 transition-all duration-200 group-hover:scale-105 group-hover:ring-4 group-hover:ring-brand-400/30 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            >
              {/* Nudged right by a pixel: a triangle's optical centre sits
                  left of its bounding box. */}
              <Play className="ml-0.5 h-6 w-6 fill-black text-black" />
            </span>

            <span className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-3 px-4 pb-3.5">
              <span className="font-display lowercase italic !text-[19px] !leading-none text-white">
                {t('events.trailer', { defaultValue: 'trailer' })}
              </span>
              <span className="label-mono shrink-0 text-[10px] uppercase tracking-wider text-white/55">
                {video.host}
              </span>
            </span>
          </button>
        )}
      </div>
    </figure>
  )
}
