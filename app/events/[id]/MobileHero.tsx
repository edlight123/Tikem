'use client'

import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { Shield } from 'lucide-react'
import OrganizerMark from '@/components/OrganizerMark'
import { getPosterTheme } from '@/lib/posterGradient'

interface MobileHeroProps {
  title: string
  category: string
  bannerUrl?: string
  organizerName: string
  /** Organizer's uploaded logo; the organization mark stands in without one. */
  organizerLogo?: string | null
  organizerId: string
  isVerified: boolean
  isTrending: boolean
  isSoldOut: boolean
  selloutSoon: boolean
}

export default function MobileHero({
  title,
  category,
  bannerUrl,
  organizerName,
  organizerLogo,
  organizerId,
  isVerified,
  isTrending,
  isSoldOut,
  selloutSoon
}: MobileHeroProps) {
  const { t } = useTranslation('common')
  const posterTheme = getPosterTheme(title, category)

  return (
    /* `isolate` + `overflow-hidden` scope the aura: isolate creates the
       stacking context that keeps the -z-10 backdrop behind the poster rather
       than behind the page itself (where it would be invisible), and
       overflow-hidden stops a 64px blur from bleeding down over the sections.
       The aura lives on THIS element, not on the poster's own wrapper — the
       poster is only inset by 16px, so an aura scoped to it would show through
       a hairline margin and nowhere else. Spanning the poster AND the title
       block is what makes it read as light coming off the artwork. */
    <div className="relative isolate overflow-hidden md:hidden">
      {/* The aura: the poster itself, scaled up and blurred out behind the
          whole hero, the way the phone app lights the top of the screen with
          the artwork's own colours. `sizes="32px"` makes Next hand back the
          smallest srcset candidate — a couple of kB, which is all a blur-3xl
          can show — and there is deliberately no `priority`, so the sharp
          poster keeps the bandwidth. The gradient lands it on the page colour
          so the bottom edge is a fade, not a seam. */}
      {bannerUrl && (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <Image
            src={bannerUrl}
            alt=""
            fill
            sizes="32px"
            quality={20}
            className="scale-125 object-cover opacity-60 blur-3xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/30 via-[#0a0a0a]/55 to-[#0a0a0a]" />
        </div>
      )}

      {/* The poster, in the house 4:5 portrait shape.
          This was `aspect-video` — a 16:9 landscape box — with object-cover, so
          every vertical poster was cropped to a horizontal band through its
          middle: the title and the artwork's composition both cut away. The
          desktop hero has always used aspect-[4/5]; mobile was the outlier,
          and mobile is where the poster matters most. */}
      {/* Inset, not full-bleed. Every other poster on this site sits in a
          rounded frame with the page breathing around it — the discover cards,
          the film strip, the hero scatter — and this one ran edge to edge,
          which made the event page look like a different product. Same px-4
          as the sections below it, so the left edges line up down the page.

          `pt-4` is the gap under the navbar. The poster used to start flush
          against the chrome, which read as the artwork being cropped by the
          navbar rather than sitting on the page. */}
      <div className="pt-4">
        {/* `rounded`, not `rounded-2xl`. The house poster frame is
            components/ui/PosterCard, which every discover card and the film
            strip render through, and it uses `rounded` — 4px in this config,
            where `rounded-2xl` is 10px. At 10px this one poster read visibly
            softer than every other poster on the site. */}
        <div className="relative mx-4 aspect-[4/5] overflow-hidden rounded bg-white/[0.04]">
          {bannerUrl ? (
            <>
              <Image
                src={bannerUrl}
                alt={title}
                fill
                sizes="100vw"
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </>
          ) : (
            <div className="poster-vignette absolute inset-0" style={{ backgroundImage: posterTheme.bg }}>
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <span className="font-display text-[28px] leading-[0.98] text-white/90 drop-shadow line-clamp-3">
                  {title}
                </span>
              </div>
            </div>
          )}

          {/* Status over the poster: a dark scrim chip with a coloured dot,
              never a filled pill (house rule). The scrim keeps the label
              legible over whatever colours the flyer has. */}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
            {isSoldOut && <PosterChip dot="bg-red-400">{t('ticket.sold_out')}</PosterChip>}
            {!isSoldOut && selloutSoon && (
              <PosterChip dot="bg-amber-400">{t('ticket.almost_sold_out')}</PosterChip>
            )}
            {isTrending && <PosterChip dot="bg-brand-400">{t('events.trending')}</PosterChip>}
          </div>
        </div>
      </div>

      {/* Title & Organizer - Below image */}
      <div className="px-4 py-4">
        {/* Category: a quiet eyebrow, not a pill */}
        <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
          {category}
        </p>

        {/* Title */}
        <h1 className="font-grotesk font-bold !text-[26px] tracking-[-0.01em] text-white mb-3 !leading-[1.05] break-words">
          {title}
        </h1>

        {/* Organizer */}
        <a
          href={`/profile/organizer/${organizerId}`}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <OrganizerMark logoUrl={organizerLogo} className="h-10 w-10 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">
              {organizerName}
            </p>
            {isVerified && (
              <div className="flex items-center gap-1 text-brand-400 text-xs">
                <Shield className="w-3 h-3" />
                <span className="font-medium">{t('events.verified')}</span>
              </div>
            )}
          </div>
        </a>
      </div>
    </div>
  )
}

function PosterChip({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-black/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-white backdrop-blur-md">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  )
}
