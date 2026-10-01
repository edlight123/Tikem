// The homepage body, top to bottom: the featured hero, the poster film strip,
// then quiet sections (this week, the worlds, starting soon), the one step
// outside the visitor's country, and the organizer door. Every section's data
// arrives already derived and scoped on the server (lib/home/feed); each one
// hides itself when it has nothing true to show, so a thin week reads as a
// short page, not a broken one.
//
// The catalog (every event, every filter) lives on /discover. The sections
// here link there; this page does not try to be a second listing.

import FeaturedHero from '@/components/home/FeaturedHero'
import PosterFilmStrip from '@/components/home/PosterFilmStrip'
import ThisWeek from '@/components/home/ThisWeek'
import WorldsIndex from '@/components/home/WorldsIndex'
import StartingSoon from '@/components/home/StartingSoon'
import ElsewhereRail from '@/components/home/ElsewhereRail'
import OrganizerBand from '@/components/home/OrganizerBand'
import type { HomeEvent, HomeWorld, WeekDay } from '@/lib/home/feed'

interface StripEvent {
  id: string
  title: string
  banner_image_url?: string | null
}

export interface HomePageContentProps {
  /** Server time the derivations used; the client islands start from it. */
  now: number
  /** The reader's IANA zone; every date on the page prints in it. */
  zone: string
  /** The country being browsed. */
  country: string
  /** True when that country has no upcoming events at all. */
  countryEmpty: boolean
  /** `country=…&city=…`, carried into every discover link. */
  scopeQs: string
  hero: HomeEvent[]
  filmStrip: StripEvent[]
  week: WeekDay[]
  worlds: HomeWorld[]
  soon: HomeEvent[]
  elsewhereMode: 'home' | 'abroad'
  elsewhere: HomeEvent[]
}

export default function HomePageContent({
  now,
  zone,
  country,
  countryEmpty,
  scopeQs,
  hero,
  filmStrip,
  week,
  worlds,
  soon,
  elsewhereMode,
  elsewhere,
}: HomePageContentProps) {
  const elsewhereRail = (
    <ElsewhereRail
      mode={elsewhereMode}
      events={elsewhere}
      emptyCountry={countryEmpty ? country : undefined}
    />
  )
  return (
    <>
      <FeaturedHero events={hero} now={now} zone={zone} />
      <PosterFilmStrip events={filmStrip} />
      <div className="mx-auto max-w-7xl space-y-20 px-4 pb-20 pt-16 sm:space-y-24 sm:px-6 sm:pt-20 lg:space-y-28 lg:px-8 lg:pb-28">
        {/* Nothing listed here: say so first, then show what is. */}
        {countryEmpty && elsewhereRail}
        <ThisWeek days={week} scopeQs={scopeQs} />
        <WorldsIndex worlds={worlds} scopeQs={scopeQs} />
        <StartingSoon events={soon} now={now} zone={zone} />
        {!countryEmpty && elsewhereRail}
        <OrganizerBand />
      </div>
    </>
  )
}
