'use client'

import OccasionTag from '@/components/occasions/OccasionTag'
import { usePosterAlt } from '@/lib/usePosterAlt'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import { useTranslation } from 'react-i18next'
import BuyTicketButton from './BuyTicketButton'
import RequestToJoin from './RequestToJoin'
import ExternalTicketsLink, { externalTicketsUrl } from './ExternalTicketsLink'
import { CommunityCredit, CommunityPrice, CommunityTickets, communityPriceLabel } from './CommunityEvent'
import { communityTicketsUrl, isCommunityEvent } from '@/lib/community/submissions'
import JoinWaitlistButton from '@/components/events/JoinWaitlistButton'
import { eventAllowedPlusOnes } from '@/lib/events/approval'
import FavoriteButton from '@/components/FavoriteButton'
import FollowButton from '@/components/FollowButton'
import ShareIconButton from './ShareIconButton'
import { ReportButton } from '@/components/moderation/ModerationActions'
import MobileHero from './MobileHero'
import OrganizerMark from '@/components/OrganizerMark'
import MobileKeyFacts from './MobileKeyFacts'
import MobileSections from './MobileSections'
import WhosGoing from '@/components/events/WhosGoing'
import FriendsGoing from '@/components/events/FriendsGoing'
import InviteFriends from '@/components/events/InviteFriends'
import PromoVideo from '@/components/events/PromoVideo'
import ContactOrganizer from '@/components/events/ContactOrganizer'
import { ticketScarcity, scarcityCopy, isUrgent } from '@/lib/ticketScarcity'
import { guestlistVisibilityFrom } from '@/lib/guestlistVisibility'
import SpotifyEmbed from '@/components/events/SpotifyEmbed'
import VenueMap from '@/components/events/VenueMap'
import { useVenueDistance } from '@/components/location/useVenueDistance'
import EventLineup from '@/components/events/EventLineup'
import { Shield } from 'lucide-react'
import { formatInZone } from '@/lib/home/format'
import { eventZone } from '@/lib/home/feed'
import Image from 'next/image'
import PosterImage from '@/components/ui/PosterImage'
import { getPosterTheme } from '@/lib/posterGradient'
import { freeClaimCap, resolveEventPricing } from '@/lib/ticketPricing'
import { doorPriceLabel, isDoorEvent, isDoorTier, lowestDoorPrice } from '@/lib/tickets/pay-at-door'
import { familyMax, freeClaimCapFor } from '@/lib/events/family'
import { priceOrder } from '@/lib/checkout/buyer-pricing'
import { dateLocaleFor, intlLocaleFor } from '@/lib/dateLocale'
import { venueAddressLines } from '@/lib/events/venueLines'
import VenueDetailsList from '@/components/events/VenueDetailsList'
import { hasVenueDetails, venueDetailsOf } from '@/lib/events/venue-details'
import RichText from '@/components/RichText'

interface EventDetailsClientProps {
  event: any
  user: any
  isFavorite: boolean
  isFollowing: boolean
  relatedEvents: any[]
  /** config/auth.invites, read on the server (lib/invites). */
  invitesEnabled?: boolean
  /** Live free tickets the signed-in viewer already holds here (one free claim per event). */
  heldFreeTickets?: number
}

export default function EventDetailsClient({ event, user, isFavorite, isFollowing, relatedEvents, invitesEnabled = false, heldFreeTickets = 0 }: EventDetailsClientProps) {
  const { t, i18n } = useTranslation('common')
  // "2.4 km away", only when this site already has the location permission.
  const venueDistance = useVenueDistance(event)
  const dfLocale = dateLocaleFor(i18n.language)
  const posterAlt = usePosterAlt()
  const numLocale = intlLocaleFor(i18n.language)
  // Every date on this page prints in the EVENT's zone. Formatting in the
  // runtime's zone printed UTC on the server and the reader's zone in the
  // browser, a hydration mismatch (React #418) on every event page.
  const zone = eventZone(event)
  const startDate = new Date(event.start_datetime)
  const isSoldOut = (event.total_tickets && event.tickets_sold >= event.total_tickets) || false
  // The organizer turned the waitlist on (lib/waitlist.ts emails it when seats free up).
  const waitlistOpen = isSoldOut && (event as any).enable_waitlist === true
  // Kept in sync from Eventbrite: tickets are sold there, so the page links out.
  const externalTickets = externalTicketsUrl(event as any)
  // Shared by the community (lib/community): nothing is sold here; the page
  // credits the source and links out to the tickets if the member gave a link.
  const community = isCommunityEvent(event as any)
  const communityTickets = communityTicketsUrl(event as any)
  const ticketsRemaining = event.total_tickets ? event.total_tickets - (event.tickets_sold || 0) : null
  // Freeness comes from the TIER SET, never from `event.ticket_price` (which is the
  // lowest tier price, hence 0 whenever a free tier sits next to a paid one — that
  // old test hid tier selection and made the paid tiers unsellable).
  const pricing = resolveEventPricing(event)
  const eventTiers: any[] = Array.isArray((event as any).ticket_tiers) ? (event as any).ticket_tiers : []
  // Pay at the door (lib/tickets/pay-at-door): nothing is charged online, the
  // tiers cost 0 and carry what is owed on arrival. Reserved through the tier
  // selector, so the button says "Reserve a spot", never "Free".
  const payAtDoor = isDoorEvent(event as any, eventTiers)
  const doorFrom = payAtDoor ? lowestDoorPrice(eventTiers) ?? (Number((event as any).door_price_from) || null) : null
  const doorLabel = doorFrom ? doorPriceLabel(doorFrom, event.currency || 'HTG', i18n.language) : undefined
  const isFree = pricing.isFreeOnly && !payAtDoor
  // A free event with several ticket types (Adults, Children...) lets the guest
  // pick types in the tier selector; one free type keeps the quick RSVP step.
  const freeTypes =
    isFree && eventTiers.filter((tier) => Number(tier?.price ?? 0) === 0 && !isDoorTier(tier) && tier?.is_active !== false).length > 1
  // Family registration (lib/events/family): one person registers up to N people.
  const familySize = familyMax(event as any)
  const familyNote =
    familySize > 0
      ? t('events.family_badge', { count: familySize, defaultValue: 'Families welcome, up to {{count}} per registration' })
      : undefined
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
  const showCategory = !!event.category && event.category.toLowerCase() !== 'other'
  // Organization brand overrides the personal name wherever the organizer is
  // shown (falls back to full_name, then a generic label).
  const organizerLabel = event.users?.organization_name || event.users?.full_name || 'Event Organizer'
  // "Message the organizer": shown signed out too (it routes to sign-in), but
  // never on the organizer's own event, where the server refuses a self-contact.
  // Never on a community-shared event: its host account has no inbox.
  const canContactOrganizer = !community && !!event.organizer_id && user?.id !== event.organizer_id

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
        occasion={(event as any).occasion}
        bannerUrl={event.banner_image_url}
        posterAlt={posterAlt(event)}
        organizerName={organizerLabel}
        organizerLogo={event.users?.organization_logo}
        isVerified={event.users?.is_verified || false}
        organizerId={event.organizer_id}
        isTrending={isTrending}
        isSoldOut={isSoldOut}
        selloutSoon={selloutSoon}
        actions={
          <>
            {user && <FavoriteButton eventId={event.id} userId={user.id} initialIsFavorite={isFavorite} />}
            <ShareIconButton eventId={event.id} eventTitle={event.title} tone="dark" />
          </>
        }
      />

      {/* DESKTOP HERO - Poster-shaped (portrait), editorial layout */}
      <div className="hidden md:block relative overflow-hidden bg-canvas">
        {/* Ambient blurred backdrop from the poster */}
        {event.banner_image_url ? (
          <div className="absolute inset-0">
            <Image
              src={event.banner_image_url}
              alt=""
              aria-hidden
              fill
              // Blurred to a wash: the smallest candidate looks identical, and
              // no priority, so the sharp poster gets the bandwidth (same as
              // MobileHero; speed pass 2026-11-17).
              sizes="32px"
              quality={20}
              className="object-cover scale-125 blur-3xl opacity-70"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-canvas/45 via-canvas/65 to-canvas/90" />
          </div>
        ) : (
          <div className="absolute inset-0" style={{ backgroundImage: posterTheme.bg }}>
            <div className="absolute inset-0 bg-canvas/45 backdrop-blur-2xl" />
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
                // The vignette only on the gradient fallback: over a real flyer
                // it darkened the corners where the date and venue usually sit.
                className={`${event.banner_image_url ? '' : 'poster-vignette '}relative aspect-[4/5] overflow-hidden rounded shadow-poster`}
                style={event.banner_image_url ? undefined : { backgroundImage: posterTheme.bg }}
              >
                {event.banner_image_url ? (
                  <PosterImage
                    src={event.banner_image_url}
                    alt={posterAlt(event)}
                    sizes="(max-width: 1024px) 320px, 340px"
                    priority
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                    <span className="font-display italic text-[clamp(24px,3vw,38px)] leading-[1.0] text-fg">
                      {event.title}
                    </span>
                  </div>
                )}
                {/* Status overlaid on poster — dot + label, never a filled pill */}
                {(isSoldOut || selloutSoon) && (
                  <div className="absolute left-3 top-3">
                    <span className="inline-flex items-center gap-1.5 rounded bg-scrim px-2.5 py-1 text-eyebrow font-medium text-fg backdrop-blur">
                      <span className={`h-1.5 w-1.5 rounded-full ${isSoldOut ? 'bg-danger' : 'bg-warning'}`} />
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
            <div className="min-w-0 text-fg">
              {/* Category + marketing signals as one quiet eyebrow line */}
              <div className="mb-5 flex items-start justify-between gap-3">
                <p className="eyebrow pt-2 text-fg-muted">
                  {/* "Other" says nothing; the line keeps its height either way. */}
                  {showCategory && event.category}
                  {showCategory && isTrending && <span className="text-fg-faint"> · </span>}
                  {isTrending && <span>{t('events.trending')}</span>}
                  {(event as any).occasion && (showCategory || isTrending) && <span className="text-fg-faint"> · </span>}
                  <OccasionTag occasion={(event as any).occasion} className="normal-case tracking-normal text-meta font-normal" />
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
              {/* Event names are the serif italic, as in the app (owner: "event
                  names stay serif"); the grotesk is the UI voice. */}
              <h1 className="font-display italic !text-[clamp(40px,4.6vw,64px)] !leading-[1.0] tracking-[-0.01em] text-fg mb-5">
                {event.title}
              </h1>

              {/* Organizer */}
              <a href={`/profile/organizer/${event.organizer_id}`} className="inline-flex items-center gap-3 mb-7 hover:opacity-80 transition-opacity">
                <OrganizerMark logoUrl={event.users?.organization_logo} className="h-11 w-11 rounded-xl" />
                <div>
                  <p className="text-fg font-semibold text-sm md:text-base">
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
              <div className="flex flex-wrap gap-x-12 gap-y-6 border-t border-line pt-6">
                <div>
                  <p className="eyebrow mb-1.5 text-eyebrow text-fg-subtle">{t('events.date_time')}</p>
                  <p className="text-body text-fg" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'EEE, MMM d, yyyy', { locale: dfLocale })}
                  </p>
                  <p className="text-meta text-fg-muted" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'h:mm a', { locale: dfLocale })}
                  </p>
                </div>
                {(event.venue_name || event.city) && (
                  <div className="min-w-0 max-w-[260px]">
                    <p className="eyebrow mb-1.5 text-eyebrow text-fg-subtle">{t('events.venue_label', { defaultValue: 'Venue' })}</p>
                    <p className="text-body text-fg line-clamp-1">{event.venue_name || event.city}</p>
                    {event.venue_name && event.city && (
                      <p className="text-meta text-fg-muted line-clamp-1">{event.city}</p>
                    )}
                  </div>
                )}
                <div>
                  <p className="eyebrow mb-1.5 text-eyebrow text-fg-subtle">{t('events.availability')}</p>
                  <p className="flex items-center gap-2 text-body text-fg">
                    <span className={`h-1.5 w-1.5 rounded-full ${isPastEvent ? 'bg-fg/40' : isSoldOut ? 'bg-danger' : 'bg-success'}`} />
                    {isPastEvent
                      ? t('events.event_ended', { defaultValue: 'Event ended' })
                      : isSoldOut
                        ? t('ticket.sold_out')
                        : community
                          ? communityPriceLabel(event, t, numLocale)
                          : isFree
                          ? t('common.free')
                          : payAtDoor && doorLabel
                            ? doorLabel
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
      {/* top-14 = the navbar's phone height (h-14): pinned UNDER the navbar,
          which is itself sticky. At top-0 it slid behind it while scrolling. */}
      <div className="md:hidden fixed inset-x-0 bottom-[var(--mobile-nav-h)] z-40 bg-canvas/95 backdrop-blur px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* items-end, not center: on a password-protected event the buy
            column grows a "Password required" line above the button, and
            centred icons then floated between that line and the button. The
            icons sit level with the button itself. */}
        {/* The buy column takes the full width: save + share moved up beside
            the organizer, where they were squeezing the quantity box. */}
        <div>
          <div className="min-w-0">
            {isPastEvent ? (
              <div className="block w-full rounded bg-surface py-3 text-center font-semibold text-fg-muted">
                {t('events.event_ended', { defaultValue: 'Event ended' })}
              </div>
            ) : isSoldOut ? (
              waitlistOpen ? (
                <JoinWaitlistButton eventId={event.id} userId={user?.id ?? null} compact />
              ) : (
                <div className="block w-full rounded bg-surface py-3 text-center font-semibold text-fg-muted">
                  {t('ticket.sold_out_caps')}
                </div>
              )
            ) : community ? (
              <CommunityTickets url={communityTickets} compact />
            ) : externalTickets ? (
              <ExternalTicketsLink url={externalTickets} compact />
            ) : (
              (event as any).requires_approval === true ? (
                <RequestToJoin
                  eventId={event.id}
                  userId={user?.id ?? null}
                  isPasswordProtected={!!event.is_password_protected}
                  compact
                  family={familySize > 0}
                />
              ) : (
                <BuyTicketButton
                  eventId={event.id}
                  userId={user?.id ?? null}
                  isFree={isFree && !freeTypes}
                  payAtDoor={payAtDoor}
                  freeTypes={freeTypes}
                  familyMax={familySize}
                  ticketPrice={headlinePrice}
                  eventTitle={event.title}
                  currency={event.currency || 'HTG'}
                  country={event.country}
                  feeIncidence={(event as any).fee_incidence ?? (event as any).feeIncidence ?? null}
                  eventStartsAt={event.start_datetime}
                  isPasswordProtected={!!event.is_password_protected}
                  plusOnesAllowed={eventAllowedPlusOnes(event as any)}
                  heldFreeTickets={heldFreeTickets}
                  maxFreePerPerson={freeClaimCap((event as any).ticket_tiers, null, freeClaimCapFor(event as any))}
                />
              )
            )}
          </div>
        </div>
      </div>

      <MobileKeyFacts
        startDate={event.start_datetime}
        endDate={event.end_datetime || undefined}
        zone={zone}
        venueName={event.venue_name}
        city={event.city}
        address={event.address || ''}
        commune={event.commune || ''}
        distance={venueDistance}
        isFree={isFree}
        hasFreeOption={pricing.kind === 'mixed'}
        // The all-in per-ticket price, for the same reason the sidebar shows it.
        ticketPrice={headlineDisplayPrice}
        feesIncluded={showHeadlineFee}
        currency={event.currency || 'HTG'}
        remainingTickets={ticketsRemaining || 0}
        isSoldOut={isSoldOut}
        scarcity={scarcity}
        doorLabel={community ? communityPriceLabel(event, t, numLocale) : doorLabel}
        note={familyNote}
      />

      <div className="mx-auto max-w-7xl md:px-6 md:pt-6 lg:px-8">
          {/* Who's going, right under the date and place (owner, 2026-11-18):
            nobody scrolls to the foot of the page to see it. */}
          <WhosGoing
            eventId={event.id}
            currentUserId={user?.id || null}
            visibility={guestlistVisibilityFrom(event as any)}
            capacity={(event as any).total_tickets}
            showGoingCount={(event as any).show_going_count === true}
            viewerName={(user as any)?.full_name ?? null}
            viewerPhotoUrl={(user as any)?.photo_url ?? null}
            className="mt-4 md:mt-0"
          />
      </div>

      {/* Organizer, after who's going, as in the app: name on the left,
          message and Follow at the line's end. */}
      <div className="mx-4 mt-5 flex items-center gap-3 border-t border-line pt-4 md:hidden">
        <a
          href={`/profile/organizer/${event.organizer_id}`}
          className="flex min-w-0 flex-1 items-center gap-3 transition-opacity hover:opacity-80"
        >
          <OrganizerMark logoUrl={event.users?.organization_logo} className="h-10 w-10 rounded" />
          <span className="truncate text-body font-semibold text-fg">{organizerLabel}</span>
          {event.users?.is_verified && (
            <Shield className="h-3.5 w-3.5 shrink-0 text-brand-400" aria-label={t('events.verified')} />
          )}
        </a>
        {canContactOrganizer && (
          <ContactOrganizer eventId={event.id} eventTitle={event.title} userId={user?.id ?? null} variant="icon" size="sm" />
        )}
        {user?.id !== event.organizer_id && (
          <FollowButton organizerId={event.organizer_id} userId={user?.id || null} initialIsFollowing={isFollowing} />
        )}
      </div>

      {community && <CommunityCredit event={event} className="mx-4 mt-3 md:hidden" />}

      <MobileSections
        description={event.description}
        videoUrl={(event as any).video_url}
        tags={event.tags}
        venueName={event.venue_name}
        address={event.address || ''}
        commune={event.commune || ''}
        city={event.city}
        goodToKnow={hasVenueDetails(venueDetailsOf(event)) ? <VenueDetailsList event={event} /> : null}
        venueMap={
          <VenueMap
            event={event}
            href={googleMapsHref}
            venueName={event.venue_name}
            className="mt-4"
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
        {/* Tablet (md) gets the ticket card as a right column too: there is no
            sticky buy bar at that width, and a single column put the only way
            to buy at the bottom of a long page. */}
        <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_288px] lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8 px-4 md:px-0">
          
          {/* Left Column - Event Details. No boxes: sections separated by
              hairlines, headings in the editorial serif voice. */}
          <div className="lg:col-span-2">
            {/* Desktop About Section */}
            {(event.description?.trim() || (event as any).video_url || event.spotify_url) && (
            <div className="hidden md:block border-b border-line pb-8">
              {/* No description: no heading and no apology line; the media
                  (if any) still sits here. */}
              {event.description && event.description.trim() && (
                <>
                  <h2 className="mb-3 font-display lowercase italic !text-section !leading-snug text-fg">
                    {t('events.about_event')}
                  </h2>
                  <RichText text={event.description} className="max-w-[65ch] break-words text-body leading-relaxed text-fg-muted [&_strong]:text-fg" />
                </>
              )}
              {/* The trailer, then the song — both under the about text. */}
              <PromoVideo url={(event as any).video_url} className="mt-6 max-w-[65ch]" />
              {/* The event's song — desktop placement, under the about text. */}
              <SpotifyEmbed url={event.spotify_url} className={`${event.description?.trim() ? 'mt-6 ' : ''}max-w-[65ch]`} />
            </div>
            )}

            {/* The bill — desktop. Between About and the venue: the reader has
                just learned what the event is, and who is on it is the next
                question. Self-hiding when there is no lineup, hence the wrapper
                carrying no heading or border of its own. */}
            {Array.isArray((event as any).guestlist) &&
              (event as any).guestlist.length > 0 && (
                <div className="hidden border-b border-line py-8 md:block">
                  <EventLineup guestlist={(event as any).guestlist} />
                </div>
              )}

            {/* Venue Details - Desktop. Left out when the event names no
                place at all (the map links searched for "undefined"). */}
            {(event.venue_name || event.address || event.commune || event.city) && (
            <div className="hidden md:block border-b border-line py-8">
              <h2 className="mb-3 font-display lowercase italic !text-section !leading-snug text-fg">
                {t('events.venue_information')}
              </h2>
              {event.venue_name && <p className="text-body text-fg">{event.venue_name}</p>}
              {venueAddressLines(event).map((line, i) => (
                <p key={i} className={`${i === 0 && event.venue_name ? 'mt-1 ' : ''}text-body text-fg-muted`}>
                  {line}
                </p>
              ))}
              {venueDistance && <p className="mt-1 text-meta text-fg-subtle">{venueDistance}</p>}
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
                  className="text-fg-muted underline decoration-fg-faint underline-offset-4 transition-colors hover:text-fg"
                >
                  {t('events.apple_maps')}
                </a>
                <span className="text-fg-faint">·</span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address || `${event.venue_name}, ${event.commune}, ${event.city}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg-muted underline decoration-fg-faint underline-offset-4 transition-colors hover:text-fg"
                >
                  {t('events.google_maps')}
                </a>
              </div>
            </div>
            )}

            {/* Good to know - Desktop: the venue details the organizer ticked. */}
            {hasVenueDetails(venueDetailsOf(event)) && (
              <div className="hidden md:block border-b border-line py-8">
                <h2 className="mb-3 font-display lowercase italic !text-section !leading-snug text-fg">
                  {t('venue_details.title')}
                </h2>
                <VenueDetailsList event={event} />
              </div>
            )}

            {/* Date & Time Details - Desktop */}
            <div className="hidden md:block border-b border-line py-8">
              <h2 className="mb-3 font-display lowercase italic !text-section !leading-snug text-fg">
                {t('events.date_and_time')}
              </h2>
              <div className="flex flex-wrap gap-x-12 gap-y-4">
                <div>
                  <p className="eyebrow mb-1.5 text-eyebrow text-fg-subtle">{t('events.start')}</p>
                  <p className="text-body text-fg" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'EEEE, MMMM d, yyyy', { locale: dfLocale })}
                  </p>
                  <p className="text-meta text-fg-muted" suppressHydrationWarning>
                    {formatInZone(event.start_datetime, zone, 'h:mm a', { locale: dfLocale })}
                  </p>
                </div>
                {/* Same rule as the mobile accordion: an end equal to the
                    start is not information. */}
                {event.end_datetime &&
                  new Date(event.end_datetime).getTime() !==
                    new Date(event.start_datetime).getTime() && (
                  <div>
                    <p className="eyebrow mb-1.5 text-eyebrow text-fg-subtle">{t('events.end')}</p>
                    <p className="text-body text-fg" suppressHydrationWarning>
                      {formatInZone(event.end_datetime, zone, 'EEEE, MMMM d, yyyy', { locale: dfLocale })}
                    </p>
                    <p className="text-meta text-fg-muted" suppressHydrationWarning>
                      {formatInZone(event.end_datetime, zone, 'h:mm a', { locale: dfLocale })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Organizer Info - Desktop */}
            <div className="hidden md:block py-8">
              <h2 className="mb-4 font-display lowercase italic !text-section !leading-snug text-fg">
                {t('events.organizer')}
              </h2>
              <a href={`/profile/organizer/${event.organizer_id}`} className="inline-flex items-center gap-4 transition-opacity hover:opacity-80">
                <OrganizerMark logoUrl={event.users?.organization_logo} className="h-12 w-12 rounded-xl" />
                <div>
                  <p className="font-medium text-fg text-base">
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
              {/* Follow, with "Message the organizer" as a small square icon
                  beside it: a full-width row read as too prominent (owner,
                  2026-11-18; same as the app). */}
              <div className="mt-4 flex items-center gap-2">
                <FollowButton
                  organizerId={event.organizer_id}
                  userId={user?.id || null}
                  initialIsFollowing={isFollowing}
                />
                {canContactOrganizer && (
                  <ContactOrganizer
                    eventId={event.id}
                    eventTitle={event.title}
                    userId={user?.id ?? null}
                    variant="icon"
                    size="sm"
                  />
                )}
              </div>
              {community && <CommunityCredit event={event} className="mt-4" />}
            </div>
          </div>

          {/* Right Column - Ticket Purchase Sidebar */}
          <div className="lg:col-span-1">
            {/* top-24 = navbar (h-16) + 32px: the card stops below the sticky
                navbar instead of sliding behind it. Capped to the viewport so
                a tall card (several tiers) on a short laptop screen scrolls
                inside itself rather than running off the bottom. A fill, not
                an outline, and the one 4px radius. */}
            <div className="hidden md:block sticky top-24 max-h-[calc(100dvh-7.5rem)] overflow-y-auto overscroll-contain rounded bg-surface p-5 lg:p-6 [scrollbar-width:thin]">
              <div className="mb-6">
                {community ? (
                  <CommunityPrice event={event} numLocale={numLocale} />
                ) : payAtDoor ? (
                  // Pay at the door: reserve online for nothing, pay on arrival.
                  <div>
                    {/* Same shape as a paid price: small currency, the amount, then
                        what it means on one quiet line. */}
                    {doorFrom ? (
                      <p className="font-grotesk text-3xl font-bold text-fg">
                        <span className="text-base font-medium text-fg-subtle">{event.currency || 'HTG'}</span>{' '}
                        {doorFrom.toLocaleString(numLocale)}
                      </p>
                    ) : (
                      <p className="font-grotesk text-3xl font-bold text-fg">
                        {t('events.pay_at_door', { defaultValue: 'Pay at the door' })}
                      </p>
                    )}
                    <p className="mt-1.5 text-meta text-fg-subtle">
                      {doorFrom ? `${t('events.pay_at_door', { defaultValue: 'Pay at the door' })} · ` : ''}
                      {t('events.door_note', { defaultValue: 'Reserve now, pay on arrival.' })}
                    </p>
                  </div>
                ) : isFree ? (
                  <div>
                    {/* "No ticket required" used to sit under this, above a
                        button that claims a free ticket. */}
                    <p className="font-grotesk text-3xl font-bold text-fg">{t('common.free')}</p>
                    {familyNote && <p className="mt-1.5 text-meta text-fg-subtle">{familyNote}</p>}
                  </div>
                ) : pricing.kind === 'mixed' ? (
                  // Free AND paid tiers coexist. Showing the denormalized
                  // `ticket_price` here would read "0" (it is the lowest tier
                  // price); show the honest range instead.
                  <div>
                    <p className="font-grotesk text-3xl font-bold text-fg">
                      {t('common.free')}
                      <span className="text-fg-subtle"> · </span>
                      <span className="text-base font-medium lowercase text-fg-subtle">{t('common.from')}</span>{' '}
                      <span className="text-base font-medium text-fg-subtle">{event.currency || 'HTG'}</span> {headlineDisplayPrice.toLocaleString(numLocale)}
                    </p>
                    <p className="mt-1.5 text-meta text-fg-subtle">{t('events.per_ticket', { defaultValue: 'per ticket' })}</p>
                    {showHeadlineFee && (
                      <p className="mt-1 text-caption text-fg-subtle">
                        {t('events.fees_included', { defaultValue: 'Fees included' })}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="font-grotesk text-3xl font-bold text-fg">
                      <span className="text-base font-medium text-fg-subtle">{event.currency || 'HTG'}</span> {headlineDisplayPrice.toLocaleString(numLocale)}
                    </p>
                    <p className="mt-1.5 text-meta text-fg-subtle">{t('events.per_ticket', { defaultValue: 'per ticket' })}</p>
                    {showHeadlineFee && (
                      <p className="mt-1 text-caption text-fg-subtle">
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
                  <p className="flex items-center gap-2 text-body font-medium text-fg">
                    <span className="h-1.5 w-1.5 rounded-full bg-fg/40" />
                    {t('events.event_ended', { defaultValue: 'Event ended' })}
                  </p>
                  <p className="mt-1.5 text-sm text-fg-muted">
                    {t('events.event_ended_detail', { defaultValue: 'This event has ended. Tickets are no longer available.' })}
                  </p>
                </div>
              ) : isSoldOut ? (
                <div className="py-2">
                  <p className="flex items-center gap-2 text-body font-medium text-fg">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    {t('ticket.sold_out')}
                  </p>
                  <p className="mt-1.5 text-sm text-fg-muted">{t('events.event_reached_capacity')}</p>
                  {waitlistOpen && (
                    <div className="mt-4">
                      <JoinWaitlistButton eventId={event.id} userId={user?.id ?? null} />
                    </div>
                  )}
                </div>
              ) : community ? (
                <CommunityTickets url={communityTickets} />
              ) : externalTickets ? (
                <ExternalTicketsLink url={externalTickets} />
              ) : (
                <>
                  {(event as any).requires_approval === true ? (
                    <RequestToJoin
                      eventId={event.id}
                      userId={user?.id ?? null}
                      isPasswordProtected={!!event.is_password_protected}
                      family={familySize > 0}
                    />
                  ) : (
                    <BuyTicketButton
                      eventId={event.id}
                      userId={user?.id ?? null}
                      isFree={isFree && !freeTypes}
                      payAtDoor={payAtDoor}
                      freeTypes={freeTypes}
                      familyMax={familySize}
                      ticketPrice={headlinePrice}
                      eventTitle={event.title}
                      currency={event.currency || 'HTG'}
                      country={event.country}
                      feeIncidence={(event as any).fee_incidence ?? (event as any).feeIncidence ?? null}
                      eventStartsAt={event.start_datetime}
                      isPasswordProtected={!!event.is_password_protected}
                      plusOnesAllowed={eventAllowedPlusOnes(event as any)}
                      heldFreeTickets={heldFreeTickets}
                      maxFreePerPerson={freeClaimCap((event as any).ticket_tiers, null, freeClaimCapFor(event as any))}
                    />
                  )}
                  {!user && (event as any).requires_approval !== true && (
                    <p className="text-xs text-fg-subtle text-center mt-3">
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

        {/* Invite connections + personal invite link (config/auth.invites).
            Renders nothing when off or signed out. */}
        <InviteFriends
          eventId={event.id}
          eventTitle={event.title}
          enabled={invitesEnabled}
          currentUserId={user?.id || null}
          className="mt-4"
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
            <h2 className="mb-6 font-display lowercase italic !text-headline !leading-snug text-fg">{t('events.similar_events')}</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
              {relatedEvents.map((e: any) => <DiscoverEventCard key={e.id} event={e} />)}
            </div>
          </div>
        )}
      </div>
      {/* Room for the buy bar pinned to the bottom on phones. */}
      <div className="h-24 md:hidden" aria-hidden />
    </div>
  )
}
