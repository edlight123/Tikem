'use client'

/**
 * An organizer's public page.
 *
 * Rebuilt 2026-09-03 ("refactor. i feel something is missing… too much space
 * used as well"). Three things were wrong, and the first two explain the
 * feeling:
 *
 * 1. It opened with a full-bleed teal gradient. Teal on this site means
 *    something — it is the accent, used sparingly — and a 200px band of it is
 *    the loudest possible use. Every other public surface is a black canvas
 *    carrying POSTERS. So the hero is black now, and the organizer's own
 *    newest artwork is the light behind it: no new query, and the page finally
 *    looks like it belongs to the same product.
 *
 * 2. It showed a letter, two counts and nothing else. What was actually
 *    missing was the organizer — so `created_at` (fetched here since forever
 *    and never rendered) becomes "on Tikèm since", and their city appears when
 *    they have set one. Checked against real data first: no organizer doc in
 *    production carries `organization_logo` or a `bio`, so this deliberately
 *    does NOT build the hero around a logo that does not exist.
 *
 * 3. The spacing. `py-10 md:py-16 lg:py-24` plus a 128px avatar plus a
 *    three-deep heading stack put the first event card most of a screen down.
 *
 * Also: the "sold" stat had a Star on it. A star means featured or favourite
 * everywhere else here; tickets sold is a Ticket.
 */

import { useMemo } from 'react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import FollowButton from '@/components/FollowButton'
import ConnectButton from '@/components/connections/ConnectButton'
import { BlockOrganizerButton, ReportButton } from '@/components/moderation/ModerationActions'
import {
  Shield,
  CalendarDays,
  Users,
  Ticket,
  MapPin,
  Instagram,
  Music2,
  Twitter,
  Facebook,
} from 'lucide-react'
import { socialUrlFor, type SocialLinks, type FriendshipState } from '@/types/social'

interface OrganizerProfileClientProps {
  organizer: {
    id: string
    full_name: string
    email: string
    is_verified: boolean
    created_at: string
  }
  upcomingEvents: any[]
  pastEvents: any[]
  followerCount: number
  totalEvents: number
  totalTicketsSold: number
  isFollowing: boolean
  userId?: string
  socialLinks?: SocialLinks
  bio?: string
  friendshipState?: FriendshipState
  isAuthenticated?: boolean
  /** Where they organize, when they have set it. Often absent. */
  city?: string
  country?: string
  /** The viewer has blocked this organizer (lib/moderation/blocks.ts). */
  isBlocked?: boolean
}

const SOCIAL_META: Array<{ key: keyof SocialLinks; Icon: typeof Instagram; label: string }> = [
  { key: 'instagram', Icon: Instagram, label: 'Instagram' },
  { key: 'tiktok', Icon: Music2, label: 'TikTok' },
  { key: 'twitter', Icon: Twitter, label: 'X' },
  { key: 'facebook', Icon: Facebook, label: 'Facebook' },
]

/** A stat: number, then label. No icon-only readings. */
function Stat({
  Icon,
  value,
  label,
}: {
  Icon: typeof Users
  value: number | string
  label: string
}) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Icon className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
      <span className="text-[15px] font-semibold tabular-nums text-white">{value}</span>
      <span className="text-[13px] text-white/50">{label}</span>
    </div>
  )
}

/** Section heading in the house editorial voice — serif, lowercase, italic. */
function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display lowercase italic !text-[clamp(24px,3.6vw,30px)] !leading-[1.05] text-white">
        {title}
      </h2>
      {note && <p className="mt-1 text-[13px] text-white/50 sm:text-sm">{note}</p>}
    </div>
  )
}

export default function OrganizerProfileClient({
  organizer,
  upcomingEvents,
  pastEvents,
  followerCount,
  totalEvents,
  totalTicketsSold,
  isFollowing,
  userId,
  socialLinks = {},
  bio = '',
  friendshipState = 'none',
  isAuthenticated = false,
  city,
  country,
  isBlocked = false,
}: OrganizerProfileClientProps) {
  const { t, i18n } = useTranslation('profile')
  const socialEntries = SOCIAL_META.filter(({ key }) => (socialLinks?.[key] || '').trim())

  /**
   * The light behind the hero: their newest poster, upcoming first.
   * Costs nothing — these arrays are already on the page for the grids below.
   */
  const backdrop = useMemo(() => {
    const pool = [...(upcomingEvents || []), ...(pastEvents || [])]
    return pool.find((e) => e?.banner_image_url)?.banner_image_url || null
  }, [upcomingEvents, pastEvents])

  /** "since March 2025" — from a field that was fetched and discarded. */
  const since = useMemo(() => {
    const d = new Date(organizer.created_at)
    if (Number.isNaN(d.getTime())) return null
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', {
        month: 'long',
        year: 'numeric',
      }).format(d)
    } catch {
      return String(d.getFullYear())
    }
  }, [organizer.created_at, i18n.language])

  const place = [city, country].filter(Boolean).join(', ')

  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <header className="relative isolate overflow-hidden">
        {backdrop && (
          <div aria-hidden className="absolute inset-0 -z-10">
            <Image
              src={backdrop}
              alt=""
              fill
              sizes="100vw"
              quality={40}
              priority
              className="scale-110 object-cover opacity-30 blur-2xl"
            />
            {/* Two stops, not one: the poster reads as light in the room, and
                the copy below still sits on near-black so it stays legible
                over whatever colours that particular flyer happens to have. */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/60 via-[#0a0a0a]/85 to-[#0a0a0a]" />
          </div>
        )}

        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12 lg:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
            {/* Avatar. A real surface — `bg-[#0a0a0a]` here would be the page
                colour, which is the invisible-card mistake this codebase has
                ~500 of. No organizer has uploaded a logo (checked against
                production), so the letter is the identity, set in the display
                serif rather than a bold sans. */}
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-4xl text-white shadow-lg ring-1 ring-inset ring-white/10 sm:h-24 sm:w-24 sm:text-5xl">
              <span className="font-display leading-none">
                {organizer.full_name[0].toUpperCase()}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="font-grotesk font-bold uppercase tracking-[-0.02em] text-white !text-[clamp(30px,5.5vw,46px)] !leading-[0.98]">
                {organizer.full_name}
              </h1>

              {/* Verified as a DOT plus a label, not a filled pill (house
                  rule). It was a rounded-full chip in page-colour on teal. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
                {organizer.is_verified && (
                  <span className="inline-flex items-center gap-1.5 text-brand-300">
                    <Shield className="h-3.5 w-3.5" aria-hidden />
                    {t('organizer_profile.verified', 'Verified')}
                  </span>
                )}
                {place && (
                  <span className="inline-flex items-center gap-1.5 text-white/50">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {place}
                  </span>
                )}
                {since && (
                  <span className="text-white/40">
                    {t('organizer_profile.since', {
                      defaultValue: 'On Tikèm since {{date}}',
                      date: since,
                    })}
                  </span>
                )}
              </div>

              {/* Stats. One row, no horizontal scroller — three items fit at
                  320px once the labels stop being 16px. */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <Stat
                  Icon={CalendarDays}
                  value={totalEvents || 0}
                  label={t('organizer_profile.events', 'events')}
                />
                <Stat
                  Icon={Users}
                  value={followerCount || 0}
                  label={t('organizer_profile.followers', 'followers')}
                />
                {/* Ticket, not Star: a star is "featured" everywhere else. */}
                <Stat
                  Icon={Ticket}
                  value={totalTicketsSold}
                  label={t('organizer_profile.sold', 'sold')}
                />
              </div>

              {bio.trim() && (
                <p className="mt-4 max-w-[60ch] whitespace-pre-line text-[15px] leading-relaxed text-white/70">
                  {bio}
                </p>
              )}

              {/* Actions and socials on ONE row: they were two stacked blocks
                  with their own margins, which is most of the height the hero
                  was spending. */}
              {(socialEntries.length > 0 || (userId && userId !== organizer.id)) && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {userId && userId !== organizer.id && (
                    <>
                      {/* `quiet`: Follow beside this is the page's primary
                          action and takes the white pill, so Add friend is a
                          quiet fill rather than a competing second primary. */}
                      <ConnectButton
                        targetUserId={organizer.id}
                        initialState={friendshipState}
                        isAuthenticated={isAuthenticated}
                        quiet
                      />
                      {/* No Follow while blocked: blocking removed the follow and
                          the follow API refuses to re-add it. */}
                      {!isBlocked && (
                        <FollowButton
                          organizerId={organizer.id}
                          userId={userId}
                          initialIsFollowing={isFollowing}
                        />
                      )}
                    </>
                  )}
                  {socialEntries.map(({ key, Icon, label }) => (
                    <a
                      key={key}
                      href={socialUrlFor(key, socialLinks[key] as string)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-white/70 transition-colors hover:bg-white/[0.14] hover:text-white"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              )}
              {/* Report / block (App Store 1.2) — quiet text actions, never
                  shown on your own profile. */}
              {userId !== organizer.id && (
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <ReportButton kind="organizer" targetId={organizer.id} userId={userId} />
                  <BlockOrganizerButton
                    organizerId={organizer.id}
                    organizerName={organizer.full_name}
                    userId={userId}
                    initialBlocked={isBlocked}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ───────────────────────── EVENTS ───────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        <section className="border-t border-white/10 pt-8 md:pt-10">
          <SectionHead
            title={t('organizer_profile.upcoming_events', 'upcoming events')}
            note={t(
              (upcomingEvents?.length || 0) === 1
                ? 'organizer_profile.upcoming_count'
                : 'organizer_profile.upcoming_count_plural',
              {
                count: upcomingEvents?.length || 0,
                defaultValue:
                  (upcomingEvents?.length || 0) === 1
                    ? '{{count}} event coming soon'
                    : '{{count}} events coming soon',
              }
            )}
          />

          {upcomingEvents && upcomingEvents.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
              {upcomingEvents.map((event: any) => (
                <DiscoverEventCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            /* A fill, not a hairline around the page colour — this was
               `bg-[#0a0a0a] border border-white/10`, i.e. a ring around
               nothing. Also half the height it was. */
            <div className="rounded-2xl bg-white/[0.03] px-6 py-10 text-center">
              <CalendarDays className="mx-auto mb-3 h-8 w-8 text-white/25" aria-hidden />
              <p className="text-[15px] font-semibold text-white">
                {t('organizer_profile.no_upcoming_title', 'No upcoming events')}
              </p>
              <p className="mx-auto mt-1 max-w-[42ch] text-[13px] text-white/50">
                {t(
                  'organizer_profile.no_upcoming_desc',
                  "This organizer doesn't have any upcoming events at the moment."
                )}
              </p>
            </div>
          )}
        </section>

        {pastEvents && pastEvents.length > 0 && (
          <section className="mt-10 border-t border-white/10 pt-8 md:mt-14 md:pt-10">
            <SectionHead
              title={t('organizer_profile.past_events', 'past events')}
              note={t('organizer_profile.past_events_desc', {
                defaultValue: 'Previous events organized by {{name}}',
                name: organizer.full_name,
              })}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
              {pastEvents.map((event: any) => (
                <DiscoverEventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
