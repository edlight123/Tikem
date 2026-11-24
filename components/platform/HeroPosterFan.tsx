'use client'

// The organizer landing's hero right half: a fanned stack of REAL posters
// already selling on the platform, each radiating its own extracted color
// (the poster-glow signature). The pitch is the artwork itself — "your
// flyer belongs here" — so every poster links to its live event page.
//
// Motion: each poster rises in on load (staggered), then drifts forever
// like a hung frame. Transform layers are separated on purpose — the
// entrance and float animate wrapper divs, the rotation lives on the
// link — so no animation clobbers another's transform.

import { usePosterAlt } from '@/lib/usePosterAlt'
import Link from 'next/link'
import Image from 'next/image'
import { usePosterAccent } from '@/components/ui/usePosterAccent'

interface FanEvent {
  id: string
  title: string
  banner_image_url: string
}

function FanPoster({
  ev,
  wrapper,
  rotate,
  enterDelay,
  floatDur,
  floatDelay,
}: {
  ev: FanEvent
  wrapper: string
  rotate: string
  enterDelay: string
  floatDur: string
  floatDelay: string
}) {
  const accent = usePosterAccent(ev.banner_image_url)
  const posterAlt = usePosterAlt()
  return (
    <div className={`plt-enter absolute ${wrapper}`} style={{ ['--d' as any]: enterDelay }}>
      <div
        className="plt-float"
        style={{ ['--dur' as any]: floatDur, ['--d' as any]: floatDelay }}
      >
        <Link
          href={`/events/${ev.id}`}
          prefetch={false}
          className={`block aspect-[4/5] w-full overflow-hidden rounded transition-opacity duration-200 hover:opacity-90 ${rotate}`}
          style={{ boxShadow: `0 0 56px -6px rgba(${accent},0.35)` }}
        >
          <Image
            src={ev.banner_image_url}
            alt={posterAlt(ev)}
            fill
            sizes="240px"
            quality={70}
            className="object-cover"
          />
        </Link>
      </div>
    </div>
  )
}

export default function HeroPosterFan({
  events,
  fanAriaLabel = 'Posters from events on Tikèm',
}: {
  events: FanEvent[]
  /** Localized aria-label, supplied by the (server) page's language dictionary. */
  fanAriaLabel?: string
}) {
  const [a, b, c] = events || []
  if (!a || !b || !c) return null
  return (
    <div aria-label={fanAriaLabel} className="relative isolate h-[440px]">
      <FanPoster
        ev={b}
        wrapper="left-0 top-12 z-0 w-[190px] opacity-85"
        rotate="-rotate-6"
        enterDelay="0.45s"
        floatDur="8s"
        floatDelay="0.8s"
      />
      <FanPoster
        ev={c}
        wrapper="right-0 top-20 z-0 w-[180px] opacity-85"
        rotate="rotate-6"
        enterDelay="0.6s"
        floatDur="9s"
        floatDelay="1.6s"
      />
      <FanPoster
        ev={a}
        wrapper="left-1/2 top-0 z-10 ml-[-118px] w-[235px]"
        rotate=""
        enterDelay="0.3s"
        floatDur="7s"
        floatDelay="0s"
      />
    </div>
  )
}
