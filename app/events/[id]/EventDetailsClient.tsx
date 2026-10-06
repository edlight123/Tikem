'use client'

import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import { useTranslation } from 'react-i18next'
import BuyTicketButton from './BuyTicketButton'
import FavoriteButton from '@/components/FavoriteButton'
import FollowButton from '@/components/FollowButton'
import ShareIconButton from './ShareIconButton'
import ShareButtonInline from './ShareButtonInline'
import { ReportButton } from '@/components/moderation/ModerationActions'
import MobileHero from './MobileHero'
import MobileKeyFacts from './MobileKeyFacts'
import MobileSections from './MobileSections'
import WhosGoing from '@/components/events/WhosGoing'
import FriendsGoing from '@/components/events/FriendsGoing'
import PromoVideo from '@/components/events/PromoVideo'
import { ticketScarcity, scarcityCopy, isUrgent } from '@/lib/ticketScarcity'
import { guestlistVisibilityFrom } from '@/lib/guestlistVisibility'
import SpotifyEmbed from '@/components/events/SpotifyEmbed'
import VenueMap from '@/components/events/VenueMap'
import EventLineup from '@/components/events/EventLineup'
import { Shield } from 'lucide-react'
import { formatInZone } from '@/lib/home/format'
import { eventZone } from '@/lib/home/feed'
import Image from 'next/image'
import { getPosterTheme } from '@/lib/posterGradient'
import { resolveEventPricing } from '@/lib/ticketPricing'
import { priceOrder } from '@/lib/checkout/buyer-pricing'
import { dateLocaleFor, intlLocaleFor } from '@/lib/dateLocale'

interface EventDetailsClientProps {
  event: any
  user: any
  isFavorite: boolean
  isFollowing: boolean
  relatedEvents: any[]
}

export default function EventDetailsClient({ event, user, isFavorite, isFollowing, relatedEvents }: EventDetailsClientProps) {
  const { t, i18n } = useTranslation('common')
  const dfLocale = dateLocaleFor(i18n.language)
  const numLocale = intlLocaleFor(i18n.language)
  // Every date on this page prints in the EVENT's zone. Formatting in the
  // runtime's zone printed UTC on the server and the reader's zone in the
  // browser, a hydration mismatch (React #418) on every event page.
  const zone = eventZone(event)
  const startDate = new Date(event.start_datetime)
  const isSoldOut = (event.total_tickets && event.tickets_sold >= event.total_tickets) || false
  const ticketsRemaining = event.total_tickets ? event.total_tickets - (event.tickets_sold || 0) : null
  // Freeness comes from the TIER SET, never from `event.ticket_price` (which is the
  // lowest tier price, hence 0 whenever a free tier sits next to a paid one — that
  // old test hid tier selection and made the paid tiers unsellable).
  const pricing = resolveEventPricing(event)
  const isFree = pricing.isFreeOnly
  // What to show as the headline price. For a 'mixed' event we advertise the
  // cheapest PAID tier (rendered as a "Free – X" range), never "from 0".
  const headlinePrice = pricing.lowestPaidPrice ?? (Number(event.ticket_price) || 0)
  // WHAT THE BUYER ACTUALLY PAYS for one of those tickets. In a buyer-pays market
  // (US/CA/FR) the fee is added on top, so advertising the bare face value here would
  // be quoting a price nobody is charged — and US rules on live-event pricing require
  // the all-in figure up front, not at the last step. Haiti absorbs the fee into the
  // organizer's proceeds, so `buyerFee` is 0 and this is the face value unchanged.
  // The whole event, not just its country: the organizer may have chosen to absorb
  // the fee (or to pass it on) for this event, and that choice outranks the default.
  const headlineAllIn = priceOrder(headlinePrice, event as any)
  const headlineDisplayPrice = headlineAllIn.total
  const showHeadlineFee = headlineAllIn.feeOnTop && headlineAllIn.buyerFee > 0
  const isPastEvent = event.end_datetime ? new Date(event.end_datetime) < new Date() : new Date(event.start_datetime) < new Date()
  
  // Premium badge logic
  // "VIP Event" removed on owner ask (2026-09-03). Worth recording WHY it was
  // never meaningful: the flag was `ticket_price > 100`, and with prices held
  // in the event's own currency that is ~US$0.75 in HTG — so essentially every
  // paid event in Haiti was labelled VIP. A badge that fires on almost
  // everything tells a buyer nothing.
  const isTrending = (event.tickets_sold || 0) > 10
  /**
   * One ladder for the whole app now (lib/ticketScarcity). This was a bare
   * `ticketsRemaining < 10` here and a second copy in page.tsx reading a
   * different source — the classic way two surfaces come to disagree about
   * the same event.
   */
  const scarcity = ticketScarcity({
    total: event.total_tickets,
    sold: event.tickets_sold,
    startsAt: event.start_datetime,
  })
  const selloutSoon = !isSoldOut && isUrgent(scarcity)
  const posterTheme = getPosterTheme(event.id || event.title, event.category)
  // Organization brand overrides the personal name wherever the organizer is
  // shown (falls back to full_name, then a generic label).
  const organizerLabel = event.users?.organization_name || event.users?.full_name || 'Event Organizer'
  const organizerInitial = (event.users?.organization_name || event.users?.full_name || 'E')[0].toUpperCase()

  // The venue map tile opens exactly what the "Google Maps" text link opens —
  // same query, same destination — so a visitor never gets two different places
  // depending on which one they clicked. The existing anchors keep their inline
  // expressions untouched; this only feeds the new tile.
  const googleMapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address || `${event.venue_name}, ${event.commune}, ${event.city}`)}`

  // Buying no longer requires an account.
  //
  // Most visitors arrive from an Instagram link, inside a WebView where Google's
  // popup sign-in is refused outright — so a "Sign in to get tickets" button was the
  // end of the funnel for them. A logged-out visitor gets the real buy button and
  // checks out as a guest (name, email, and a phone number for Haiti).
  //
  // Password-protected events used to be the exception, because the access grant was
  // keyed by uid and a guest has none. A guest now presents the code with their
  // checkout request and the server verifies it before creating anything, granting
  // against the `guest_…` id it mints — so the gate is unchanged in strength and the
  // sign-in dead end is gone here too. Every visitor therefore gets the buy button.

  return (
    <div className="min-h-screen pb-mobile-nav md:pb-8">
      {/* MOBILE HERO */}
      <MobileHero
        title={event.title}
        category={event.category}
        bannerUrl={event.banner_image_url}
        organizerName={organizerLabel}
        isVerified={event.users?.is_verified || false}
        organizerId={event.organizer_id}
        isTrending={isTrending}
        isSoldOut={isSoldOut}
        selloutSoon={selloutSoon}
      />

      {/* DESKTOP HERO - Poster-shaped (portrait), editorial layout */}
      <div className="hidden md:block relative overflow-hidden bg-gray-950">
        {/* Ambient blurred backdrop from the poster */}
        {event.banner_image_url ? (
          <div className="absolute inset-0">
            <Image
              src={event.banner_image_url}
              alt=""
              aria-hidden
              fill
              sizes="100vw"
              className="object-cover scale-125 blur-3xl opacity-70"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-b from-gray-950/45 via-gray-950/65 to-gray-950/90" />
          </div>
        ) : (
          <div className="absolute inset-0" style={{ backgroundImage: posterTheme.bg }}>
            <div className="absolute inset-0 bg-gray-950/45 backdrop-blur-2xl" />
          </div>
        )}

        {/* Hero Content */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-8 lg:gap-12 items-start">

            {/* Poster image, portrait poster shape.
                The bloom behind it is tinted with `accent_color`, the poster's
                own dominant colour derived in the composer. That field used to
                be written and read by nothing; this is what makes it mean
                something. Falls back to no bloom when the event has no
                accent, so an older event looks exactly as before. */}
            <div className="relative mx-auto w-full max-w-[320px] lg:mx-0 lg:max-w-none">
              {event.accent_color && event.banner_image_url && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-6 -z-10 rounded-full opacity-40 blur-3xl"
                  style={{ backgroundColor: event.accent_color }}
                />
              )}
              <div
                className="poster-vignette relative aspect-[4/5] overflow-hidden rounded-none shadow-poster ring-1 ring-white/10"
                style={event.banner_image_url ? undefined : { backgroundImage: posterTheme.bg }}
              >
                {event.banner_image_url ? (
                  <Image
                    src={event.banner_image_url}
                    alt={event.title}
                    fill
                    sizes="(max-width: 1024px) 320px, 340px"
                    className="object-cover"
                    priority
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                    <span className="font-display text-[clamp(24px,3vw,38px)] leading-[1.0] text-white/90">
                      {event.title}
                    </span>
                  </div>
                )}
                {/* Status overlaid on poster — dot + label, never a filled pill */}
                {(isSoldOut || selloutSoon) && (
                  <div className="absolute left-3 top-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
                      <span className={`h-1.5 w-1.5 rounded-full ${isSoldOut ? 'bg-red-400' : 'bg-amber-400'}`} />
                      {(() => {
                        if (isSoldOut) return t('ticket.sold_out')
                        const copy = scarcityCopy(scarcity)
                        return copy
                          ? t(copy.key, { defaultValue: copy.defaultValue, count: copy.count })
                          : t('ticket.almost_sold_out')
                      })()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Details column */}
            <div className="min-w-0 text-white">
              {/* Category + marketing signals as one quiet eyebrow line */}
              <div className="mb-5 flex items-start justify-between gap-3">
                <p className="eyebrow pt-2 text-white/60">
                  {event.category}
                  {isTrending && <span className="text-white/30"> · </span>}
                  {isTrending && <span>{t('events.trending')}</span>}
                </p>
                {/* Save + share as one cluster, mirroring the mobile buy row.
                    The heart previously hung in a `mt-4` block under the
                    ticket panel, far from the only other icon action on the
                    page and below the fold on a laptop. */}
                <div className="flex shrink-0 items-center gap-2">
                  {user && (
                    <FavoriteButton eventId={event.id} userId={user.id} initialIsFavorite={isFavorite} />
                  )}
                  <ShareIconButton eventId={event.id} eventTitle={event.title} tone="light" />
                </div>
              </div>

              {/* Title */}
              {/* The poster voice: event titles are grotesk (design system 2026-08-28);
                  serif italic is the eyebrow/wordmark voice, never a title. */}
              <h1 className="font-grotesk font-bold !text-[clamp(30px,4vw,52px)] !leading-[1.03] tracking-[-0.01em] text-white mb-4">
                {event.title}
              </h1>

              {/* Organizer */}
              <a href={`/profile/organizer/${event.organizer_id}`} className="inline-flex items-center gap-3 mb-7 hover:opacity-80 transition-opacity">
                <div className="w-11 h-11 bg-gradient-to-br from-brand-400 to-brand-600 rounded-full flex items-center justify-center text-white font-bold text-base overflow-hidden">
                  {event.users?.organization_logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={event.users.organization_logo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    organizerInitial
                  )}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm md:text-base">
                    {organizerLabel}
                  </p>
                  {event.users?.is_verified && (
                    <div className="flex items-center gap-1 text-brand-300 text-xs md:text-sm">
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t('events.verified')}</span>
                    </div>
                  )}
                </div>
              </a>

              {/* Key facts — no boxes, no icon squares: a quiet ledger row */}
              <div className="flex flex-wrap gap-x-12 gap-y-6 border-t border-white/10 pt-6">
                <div>
                  <p className="eyebrow mb-1.5 text-[10px] text-white/50">{t('events.date_time')}</p>
                  <p className="text-[15px] text-white" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'EEE, MMM d, yyyy', { locale: dfLocale })}
                  </p>
                  <p className="text-[13px] text-white/60" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'h:mm a', { locale: dfLocale })}
                  </p>
                </div>
                <div className="min-w-0 max-w-[260px]">
                  <p className="eyebrow mb-1.5 text-[10px] text-white/50">{t('events.venue_name')}</p>
                  <p className="text-[15px] text-white line-clamp-1">{event.venue_name}</p>
                  <p className="text-[13px] text-white/60 line-clamp-1">{event.city}</p>
                </div>
                <div>
                  <p className="eyebrow mb-1.5 text-[10px] text-white/50">{t('events.availability')}</p>
                  <p className="flex items-center gap-2 text-[15px] text-white">
                    <span className={`h-1.5 w-1.5 rounded-full ${isPastEvent ? 'bg-white/40' : isSoldOut ? 'bg-red-400' : 'bg-emerald-400'}`} />
                    {isPastEvent
                      ? t('events.event_ended', { defaultValue: 'Event ended' })
                      : isSoldOut
                        ? t('ticket.sold_out')
                        : isFree
                          ? t('common.free')
                          : t('ticket.available')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* No bottom rule: this bar pins directly under the navbar, whose own
          border sits a few pixels above it, and two hairlines that close
          together read as a crack across the page rather than as two bars.
          The blur plus the page colour separate it from content scrolling
          underneath. */}
      <div className="md:hidden sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {isPastEvent ? (
              <div className="block w-full rounded-xl bg-white/[0.06] py-3 text-center font-semibold text-white/70">
                {t('events.event_ended', { defaultValue: 'Event ended' })}
              </div>
            ) : isSoldOut ? (
              <div className="block w-full rounded-xl bg-white/[0.06] py-3 text-center font-semibold text-white/70">
                {t('ticket.sold_out_caps')}
              </div>
            ) : (
              <BuyTicketButton
                eventId={event.id}
                userId={user?.id ?? null}
                isFree={isFree}
                ticketPrice={headlinePrice}
                eventTitle={event.title}
                currency={event.currency || 'HTG'}
                country={event.country}
                eventStartsAt={event.start_datetime}
                isPasswordProtected={!!event.is_password_protected}
              />
            )}
          </div>
          {/* Save and share, as a pair, ON the buy row.
              The heart used to sit in a `mt-3` block BELOW this row — and
              because this bar is `sticky top-0`, that orphaned row cost ~52px
              of viewport at every scroll position, not just once. Folding it
              in beside share reclaims that height, groups the two secondary
              actions into one cluster, and keeps save reachable the whole way
              down the page (on the poster it would scroll out of reach). */}
          {user && (
            <div className="flex-shrink-0">
              <FavoriteButton eventId={event.id} userId={user.id} initialIsFavorite={isFavorite} />
            </div>
          )}
          <div className="flex-shrink-0">
            <ShareIconButton eventId={event.id} eventTitle={event.title} tone="dark" />
          </div>
        </div>
      </div>

      <MobileKeyFacts
        startDate={event.start_datetime}
        zone={zone}
        venueName={event.venue_name}
        city={event.city}
        address={event.address || ''}
        commune={event.commune || ''}
        isFree={isFree}
        hasFreeOption={pricing.kind === 'mixed'}
        // The all-in per-ticket price, for the same reason the sidebar shows it.
        ticketPrice={headlineDisplayPrice}
        feesIncluded={showHeadlineFee}
        currency={event.currency || 'HTG'}
        remainingTickets={ticketsRemaining || 0}
        isSoldOut={isSoldOut}
        scarcity={scarcity}
      />

      <MobileSections
        description={event.description}
        videoUrl={(event as any).video_url}
        tags={event.tags}
        venueName={event.venue_name}
        address={event.address || ''}
        commune={event.commune || ''}
        city={event.city}
        startDatetime={event.start_datetime}
        endDatetime={event.end_datetime || event.start_datetime}
        zone={zone}
        organizerName={organizerLabel}
        organizerId={event.organizer_id}
        isVerified={event.users?.is_verified || false}
        venueMap={
          <VenueMap
            event={event}
            href={googleMapsHref}
            venueName={event.venue_name}
            className="mt-4"
          />
        }
        shareButton={
          <ShareButtonInline
            eventId={event.id}
            eventTitle={event.title}
            eventDate={formatInZone(event.start_datetime, zone, 'MMM d, yyyy', { locale: dfLocale })}
            eventVenue={`${event.venue_name}, ${event.city}`}
          />
        }
      />

      {/* The bill — mobile placement, above the song: who is playing is a
          bigger reason to buy than what the event sounds like. Renders nothing
          when the organizer added no lineup. */}
      <EventLineup guestlist={(event as any).guestlist} className="px-4 pt-6 md:hidden" />

      {/* The event's song — mobile placement, under the accordions. */}
      <SpotifyEmbed url={event.spotify_url} className="px-4 pt-4 md:hidden" />

      {/* MAIN CONTENT - Desktop */}
      <div className="max-w-7xl mx-auto px-0 md:px-6 lg:px-8 py-0 md:py-8">
        {/* `hidden md:grid`: every child here is desktop-only (mobile reads the
            flat sections above), but the wrapper's padding and the grid gap
            still laid out ~80px of empty black between Share and the footer.
            The breakpoint is the exact complement of MobileSections' md:hidden,
            so nothing is dropped at any width. */}
        <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8 px-4 md:px-0">
          
          {/* Left Column - Event Details. No boxes: sections separated by
              hairlines, headings in the editorial serif voice. */}
          <div className="lg:col-span-2">
            {/* Desktop About Section */}
            <div className="hidden md:block border-b border-white/10 pb-8">
              <h2 className="mb-3 font-display lowercase italic !text-[22px] !leading-snug text-white">
                {t('events.about_event')}
              </h2>
              {event.description && event.description.trim() ? (
                <p className="max-w-[65ch] text-[15px] leading-relaxed text-white/70 whitespace-pre-wrap">
                  {event.description}
                </p>
              ) : (
                <p className="text-[15px] italic leading-relaxed text-white/70">
                  {t('events.no_description', { defaultValue: 'The organizer hasn’t added a description yet.' })}
                </p>
              )}
              {/* The trailer, then the song — both under the about text. */}
              <PromoVideo url={(event as any).video_url} className="mt-6 max-w-[65ch]" />
              {/* The event's song — desktop placement, under the about text. */}
              <SpotifyEmbed url={event.spotify_url} className="mt-6 max-w-[65ch]" />
            </div>

            {/* The bill — desktop. Between About and the venue: the reader has
                just learned what the event is, and who is on it is the next
                question. Self-hiding when there is no lineup, hence the wrapper
                carrying no heading or border of its own. */}
            {Array.isArray((event as any).guestlist) &&
              (event as any).guestlist.length > 0 && (
                <div className="hidden border-b border-white/10 py-8 md:block">
                  <EventLineup guestlist={(event as any).guestlist} />
                </div>
              )}

            {/* Venue Details - Desktop */}
            <div className="hidden md:block border-b border-white/10 py-8">
              <h2 className="mb-3 font-display lowercase italic !text-[22px] !leading-snug text-white">
                {t('events.venue_information')}
              </h2>
              <p className="text-[15px] text-white">{event.venue_name}</p>
              <p className="mt-1 text-[15px] text-white/60">
                {event.address || t('events.address_not_specified')}
              </p>
              <p className="text-[15px] text-white/60">{event.commune}, {event.city}</p>
              {/* The venue, as a picture. Sits between the address and the two
                  map links: the tile shows where, the links are the actions.
                  Renders nothing at all until a static-maps key exists, which
                  is why the section reads identically today. Capped in width
                  because a 3:2 tile across the full two-column measure would be
                  ~460px tall and push the date section off the fold. */}
              <VenueMap
                event={event}
                href={googleMapsHref}
                venueName={event.venue_name}
                className="mt-5 max-w-md"
              />
              <div className="mt-3 flex items-center gap-2 text-sm">
                <a
                  href={`https://maps.apple.com/?q=${encodeURIComponent(event.address || `${event.venue_name}, ${event.commune}, ${event.city}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
                >
                  {t('events.apple_maps')}
                </a>
                <span className="text-white/25">·</span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address || `${event.venue_name}, ${event.commune}, ${event.city}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
                >
                  {t('events.google_maps')}
                </a>
              </div>
            </div>

            {/* Date & Time Details - Desktop */}
            <div className="hidden md:block border-b border-white/10 py-8">
              <h2 className="mb-3 font-display lowercase italic !text-[22px] !leading-snug text-white">
                {t('events.date_and_time')}
              </h2>
              <div className="flex flex-wrap gap-x-12 gap-y-4">
                <div>
                  <p className="eyebrow mb-1.5 text-[10px] text-white/50">{t('events.start')}</p>
                  <p className="text-[15px] text-white" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'EEEE, MMMM d, yyyy', { locale: dfLocale })}
                  </p>
                  <p className="text-[13px] text-white/60" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'h:mm a', { locale: dfLocale })}
                  </p>
                </div>
                {/* Same rule as the mobile accordion: an end equal to the
                    start is not information. */}
                {event.end_datetime &&
                  new Date(event.end_datetime).getTime() !==
                    new Date(event.start_datetime).getTime() && (
                  <div>
                    <p className="eyebrow mb-1.5 text-[10px] text-white/50">{t('events.end')}</p>
                    <p className="text-[15px] text-white" suppressHydrationWarning>
                      {formatInZone(event.end_datetime, zone, 'EEEE, MMMM d, yyyy', { locale: dfLocale })}
                    </p>
                    <p className="text-[13px] text-white/60" suppressHydrationWarning>
                      {formatInZone(event.end_datetime, zone, 'h:mm a', { locale: dfLocale })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Organizer Info - Desktop */}
            <div className="hidden md:block py-8">
              <h2 className="mb-4 font-display lowercase italic !text-[22px] !leading-snug text-white">
                {t('events.organizer')}
              </h2>
              <a href={`/profile/organizer/${event.organizer_id}`} className="inline-flex items-center gap-4 transition-opacity hover:opacity-80">
                <div className="w-12 h-12 bg-gradient-to-br from-brand-400 to-brand-600 rounded-full flex items-center justify-center text-white font-bold text-lg overflow-hidden">
                  {event.users?.organization_logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={event.users.organization_logo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    organizerInitial
                  )}
                </div>
                <div>
                  <p className="font-medium text-white text-base">
                    {organizerLabel}
                  </p>
                  {event.users?.is_verified && (
                    <div className="flex items-center gap-1 text-brand-400 text-sm mt-0.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t('events.verified_organizer')}</span>
                    </div>
                  )}
                </div>
              </a>
              <div className="mt-4">
                <FollowButton
                  organizerId={event.organizer_id}
                  userId={user?.id || null}
                  initialIsFollowing={isFollowing}
                />
              </div>
            </div>
          </div>

          {/* Right Column - Ticket Purchase Sidebar */}
          <div className="lg:col-span-1">
            <div className="hidden md:block sticky top-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <div className="mb-6">
                {isFree ? (
                  <div>
                    <p className="font-grotesk text-3xl font-bold text-white">{t('common.free')}</p>
                    <p className="mt-1.5 text-[13px] text-white/50">{t('events.no_ticket_required')}</p>
                  </div>
                ) : pricing.kind === 'mixed' ? (
                  // Free AND paid tiers coexist. Showing the denormalized
                  // `ticket_price` here would read "0" (it is the lowest tier
                  // price); show the honest range instead.
                  <div>
                    <p className="font-grotesk text-3xl font-bold text-white">
                      {t('common.free')}
                      <span className="text-white/40">, </span>
                      <span className="text-base font-medium text-white/50">{event.currency || 'HTG'}</span> {headlineDisplayPrice.toLocaleString(numLocale)}
                    </p>
                    <p className="mt-1.5 text-[13px] text-white/50">{t('events.per_ticket', { defaultValue: 'per ticket' })}</p>
                    {showHeadlineFee && (
                      <p className="mt-1 text-[12px] text-white/40">
                        {t('events.fees_included', { defaultValue: 'Fees included' })}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="font-grotesk text-3xl font-bold text-white">
                      <span className="text-base font-medium text-white/50">{event.currency || 'HTG'}</span> {headlineDisplayPrice.toLocaleString(numLocale)}
                    </p>
                    <p className="mt-1.5 text-[13px] text-white/50">{t('events.per_ticket', { defaultValue: 'per ticket' })}</p>
                    {showHeadlineFee && (
                      <p className="mt-1 text-[12px] text-white/40">
                        {t('events.fees_included_detail', {
                          defaultValue: `Includes ${headlineAllIn.buyerFee.toLocaleString(numLocale)} ${event.currency || 'HTG'} fee`,
                          fee: headlineAllIn.buyerFee.toLocaleString(numLocale),
                          currency: event.currency || 'HTG',
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {isPastEvent ? (
                <div className="py-2">
                  <p className="flex items-center gap-2 text-[15px] font-medium text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                    {t('events.event_ended', { defaultValue: 'Event ended' })}
                  </p>
                  <p className="mt-1.5 text-sm text-white/60">
                    {t('events.event_ended_detail', { defaultValue: 'This event has ended. Tickets are no longer available.' })}
                  </p>
                </div>
              ) : isSoldOut ? (
                <div className="py-2">
                  <p className="flex items-center gap-2 text-[15px] font-medium text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    {t('ticket.sold_out')}
                  </p>
                  <p className="mt-1.5 text-sm text-white/60">{t('events.event_reached_capacity')}</p>
                </div>
              ) : (
                <>
                  <BuyTicketButton
                    eventId={event.id}
                    userId={user?.id ?? null}
                    isFree={isFree}
                    ticketPrice={headlinePrice}
                    eventTitle={event.title}
                    currency={event.currency || 'HTG'}
                    country={event.country}
                    eventStartsAt={event.start_datetime}
                isPasswordProtected={!!event.is_password_protected}
                  />
                  {!user && (
                    <p className="text-xs text-white/50 text-center mt-3">
                      {t('events.no_account_needed', {
                        defaultValue: 'No account needed. Your ticket is emailed to you.',
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Your connections going (config/auth.friend_suggestions); renders
            nothing, margin included, when off or when no friend is going. */}
        <FriendsGoing eventId={event.id} currentUserId={user?.id || null} className="mt-8" />

        {/* Who's Going - social attendance */}
        <WhosGoing
          eventId={event.id}
          currentUserId={user?.id || null}
          visibility={guestlistVisibilityFrom(event as any)}
          className="mt-8"
        />

        {/* Report — quiet, but on every event page (App Store 1.2). Hidden
            from the organizer's own event: the server refuses a self-report. */}
        {user?.id !== event.organizer_id && (
          <div className="mt-8 px-4 md:px-0">
            <ReportButton kind="event" targetId={event.id} userId={user?.id} />
          </div>
        )}

        {/* Related Events Section */}
        {relatedEvents?.length > 0 && (
          <div className="mt-12 px-4 md:px-0">
            <h2 className="mb-6 font-display lowercase italic !text-[26px] !leading-snug text-white">{t('events.similar_events')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {relatedEvents.map((e: any) => <DiscoverEventCard key={e.id} event={e} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
