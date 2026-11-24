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
 *    does NOT build the hero around a logo that does not exist. The mark
 *    does show the logo when there is one (organizer.logo).
 *
 * 3. The spacing. `py-10 md:py-16 lg:py-24` plus a 128px avatar plus a
 *    three-deep heading stack put the first event card most of a screen down.
 *
 * Also: the "sold" stat had a Star on it. A star means featured or favourite
 * everywhere else here; tickets sold is a Ticket.
 */

import { collapseSeries } from '@/lib/events/series'
import { useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import FollowButton from '@/components/FollowButton'
import ConnectButton from '@/components/connections/ConnectButton'
import { BlockOrganizerButton, ReportButton } from '@/components/moderation/ModerationActions'
import {
  Shield,
  CalendarDays,
  MapPin,
  Instagram,
  Music2,
  Twitter,
  Facebook,
  Linkedin,
  Globe,
  ImagePlus,
  Images,
  Eye,
} from 'lucide-react'
import OrganizerMark from '@/components/OrganizerMark'
import { defaultAvatarUrl } from '@/lib/defaultAvatar'
import { externalUrlLabel } from '@/lib/safeUrl'
import type { FriendshipState } from '@/types/social'
import type { PublicProfileDetails } from '@/lib/profile/public-details'
import type { OrgCover } from '@/lib/organizer/cover'
import type { GalleryPhoto } from '@/lib/gallery'
import GalleryStrip from '@/components/organizer/page/GalleryStrip'

interface OrganizerProfileClientProps {
  /**
   * Public fields only. `name` is the display name (organization_name, else
   * full_name). Never add `email` here: this object is serialized into the
   * public page.
   */
  organizer: {
    id: string
    name: string
    /** organization_logo (lib/profile/org-brand.ts); '' when none is set. */
    logo?: string
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
  /**
   * What shows under the name, already privacy-checked on the server
   * (lib/profile/public-details.ts): an org's description + links, or a
   * person's bio + socials (null when their privacy hides them). Every link
   * is a safe absolute href.
   */
  details?: PublicProfileDetails
  friendshipState?: FriendshipState
  isAuthenticated?: boolean
  /** Where they organize, when they have set it. Often absent. */
  city?: string
  country?: string
  /** The viewer has blocked this organizer (lib/moderation/blocks.ts). */
  isBlocked?: boolean
  /**
   * Has ever hosted (organization name, any event, or the organizer role).
   * False renders a person's profile: "Joined Tikèm <Mon YYYY>" once, no
   * stats, no Follow, no events section (owner, 2026-11-17).
   */
  isHost?: boolean
  /** The org's banner (lib/organizer/cover.ts), or null. */
  cover?: OrgCover | null
  /** The org's photos (lib/gallery.ts). */
  gallery?: GalleryPhoto[]
  /** The viewer may edit this org's page (owner or team admin), and this is not a preview. */
  canEdit?: boolean
  /** "Preview my page": exactly what a visitor sees, no owner tools. */
  preview?: boolean
  /** A person's own photo (person view), else their drawn portrait. */
  personPhoto?: string
  /** Person view of an organization's owner: the organization they run. */
  alsoRuns?: { name: string; logo: string; href: string } | null
}

type Network = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'tiktok'

const SOCIAL_META: Array<{ key: Network; Icon: typeof Instagram; label: string }> = [
  { key: 'instagram', Icon: Instagram, label: 'Instagram' },
  { key: 'tiktok', Icon: Music2, label: 'TikTok' },
  { key: 'twitter', Icon: Twitter, label: 'X' },
  { key: 'facebook', Icon: Facebook, label: 'Facebook' },
  { key: 'linkedin', Icon: Linkedin, label: 'LinkedIn' },
]

/** The text and links to show, from whichever kind of profile this is. */
function aboutFrom(details: PublicProfileDetails | undefined): {
  text: string
  website: string
  links: Partial<Record<Network, string>>
} {
  if (details?.kind === 'org' && details.org) {
    const { description, website, ...links } = details.org
    return { text: description, website, links }
  }
  if (details?.kind === 'person' && details.person) {
    return { text: details.person.bio, website: '', links: details.person.socials }
  }
  return { text: '', website: '', links: {} }
}

/** A count beside the logo: the figure, its label under it. */
function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span className="text-lead font-semibold leading-tight tabular-nums text-fg">{value}</span>
      <span className="text-meta lowercase text-fg-subtle">{label}</span>
    </div>
  )
}

/** Section heading in the house editorial voice — serif, lowercase, italic. */
function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display lowercase italic !text-[clamp(24px,3.6vw,30px)] !leading-[1.05] text-fg">
        {title}
      </h2>
      {note && <p className="mt-1 text-meta text-fg-subtle sm:text-sm">{note}</p>}
    </div>
  )
}

export default function OrganizerProfileClient({
  organizer,
  upcomingEvents: upcomingAllDates,
  pastEvents,
  followerCount,
  totalEvents,
  isFollowing,
  userId,
  details,
  friendshipState = 'none',
  isAuthenticated = false,
  city,
  country,
  isBlocked = false,
  isHost = true,
  cover = null,
  gallery = [],
  canEdit = false,
  preview = false,
  personPhoto = '',
  alsoRuns = null,
}: OrganizerProfileClientProps) {
  // A recurring series is listed once, at its next date (lib/events/series).
  const upcomingEvents = useMemo(() => collapseSeries(upcomingAllDates || []), [upcomingAllDates])
  const { t, i18n } = useTranslation('profile')
  const about = aboutFrom(details)
  const socialEntries = SOCIAL_META.filter(({ key }) => (about.links[key] || '').trim())
  const isOrg = details?.kind === 'org'

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

  /** A person's "Joined Tikèm Nov 2025": short month, said once. */
  const joined = useMemo(() => {
    const d = new Date(organizer.created_at)
    if (Number.isNaN(d.getTime())) return null
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', { month: 'short', year: 'numeric' }).format(d)
    } catch {
      return String(d.getFullYear())
    }
  }, [organizer.created_at, i18n.language])

  const place = [city, country].filter(Boolean).join(', ')
  const showOrgMark = !alsoRuns && (!!organizer.logo || isOrg || totalEvents > 0)
  // Never an empty band: a banner only when there is something to show.
  const hasBanner = isHost && !alsoRuns && (!!cover || !!backdrop)

  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <header className="relative isolate">
        {/* The banner: the org's own (a template photo or an upload), else
            their newest poster as a blurred wash. Nothing at all when there
            is neither, so there is never an empty band. */}
        {hasBanner && (
          <div className="relative h-36 overflow-hidden bg-surface-low sm:h-52 lg:h-64">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : backdrop ? (
              <Image
                src={backdrop}
                alt=""
                fill
                // A blurred wash: a thumbnail looks identical and arrives far
                // sooner than a full-width image (speed pass 2026-11-17).
                sizes="96px"
                quality={40}
                priority
                className="scale-110 object-cover opacity-40 blur-2xl"
              />
            ) : null}
            {/* Bottom-weighted veil so the overlapping logo and the name sit on near-black. */}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent via-canvas/20 to-canvas" />
            {canEdit && cover && (
              <Link
                href="/organizer/settings/organization#banner"
                className="absolute right-4 top-3 inline-flex items-center gap-1.5 rounded bg-scrim px-3 py-2 text-meta font-semibold text-fg backdrop-blur transition-colors hover:bg-scrim-strong sm:right-6 lg:right-8"
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
                {t('org_page.change_banner')}
              </Link>
            )}
          </div>
        )}

        <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${hasBanner ? 'pb-8' : 'py-8 md:py-10'}`}>
          {/* Logo (or portrait) overlapping the banner, the counts beside it. */}
          <div className={`flex items-end gap-4 sm:gap-6 ${hasBanner ? '-mt-10 sm:-mt-12' : ''}`}>
            {showOrgMark ? (
              <OrganizerMark
                logoUrl={organizer.logo}
                className="relative h-20 w-20 rounded shadow-lg ring-4 ring-canvas sm:h-24 sm:w-24"
              />
            ) : (
              // A person: their own photo, else their drawn portrait, in a circle.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={personPhoto || defaultAvatarUrl(organizer.id)}
                alt=""
                className="relative h-20 w-20 shrink-0 rounded-full bg-surface object-cover shadow-lg ring-4 ring-canvas sm:h-24 sm:w-24"
              />
            )}

            {/* Counts, hosts only: a person never shows "0 events". */}
            {isHost && !alsoRuns && (
              <div className="flex items-baseline gap-5 pb-1 sm:gap-7">
                <Stat value={totalEvents || 0} label={t('organizer_profile.events', 'events')} />
                <Stat value={followerCount || 0} label={t('organizer_profile.followers', 'followers')} />
              </div>
            )}
          </div>

          <h1 className="mt-4 font-grotesk font-bold uppercase tracking-[-0.02em] text-fg !text-[clamp(28px,5vw,44px)] !leading-[0.98]">
            {organizer.name}
          </h1>

          {/* Verified as a mark plus a label, never a filled pill (house rule). */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta">
            {organizer.is_verified && (
              <span className="inline-flex items-center gap-1.5 text-brand-300">
                <Shield className="h-3.5 w-3.5" aria-hidden />
                {t('organizer_profile.verified', 'Verified')}
              </span>
            )}
            {place && (
              <span className="inline-flex items-center gap-1.5 text-fg-subtle">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {place}
              </span>
            )}
            {isHost && since && (
              <span className="text-fg-subtle">
                {t('organizer_profile.since', { defaultValue: 'On Tikèm since {{date}}', date: since })}
              </span>
            )}
            {!isHost && joined && (
              <span className="text-fg-subtle">
                {t('organizer_profile.joined', { defaultValue: 'Joined Tikèm {{date}}', date: joined })}
              </span>
            )}
          </div>

          {/* An org's description, or a person's bio when their privacy lets
              this viewer see it (decided on the server). */}
          {about.text && (
            <p className="mt-4 max-w-[60ch] whitespace-pre-line text-body leading-relaxed text-fg-muted">{about.text}</p>
          )}

          {details?.kind === 'person' && details.person === null && (
            <p className="mt-4 text-meta text-fg-subtle">
              {t('organizer_profile.private_details', 'Bio and socials are visible to friends only.')}
            </p>
          )}

          {/* An organization's owner seen as a person: the org they run. */}
          {alsoRuns && (
            <Link
              href={alsoRuns.href}
              className="mt-4 inline-flex max-w-full items-center gap-2.5 rounded bg-surface px-3 py-2 transition-colors hover:bg-surface-raised"
            >
              <OrganizerMark logoUrl={alsoRuns.logo} className="h-7 w-7 rounded" />
              <span className="truncate text-meta text-fg-muted">{t('org_page.also_runs', { name: alsoRuns.name })}</span>
            </Link>
          )}

          {/* Website and socials as line icons, on one row. */}
          {(about.website || socialEntries.length > 0) && (
            <div className="mt-4 flex flex-wrap items-center gap-1">
              {about.website && (
                <a
                  href={about.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-2 inline-flex max-w-full items-center gap-1.5 py-2 text-sm text-fg-muted transition-colors hover:text-fg"
                >
                  <Globe className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="truncate">{externalUrlLabel(about.website)}</span>
                </a>
              )}
              {socialEntries.map(({ key, Icon, label }) => (
                <a
                  key={key}
                  href={about.links[key]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="grid h-10 w-10 place-items-center rounded text-fg-muted transition-colors hover:bg-surface hover:text-fg"
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </a>
              ))}
            </div>
          )}

          {/* Actions: Add friend + Follow, never on your own page. */}
          {userId && userId !== organizer.id && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* `quiet`: Follow is the page's primary action and takes the
                  white pill, so Add friend is a quiet fill. */}
              <ConnectButton
                targetUserId={organizer.id}
                initialState={friendshipState}
                isAuthenticated={isAuthenticated}
                quiet
              />
              {/* No Follow while blocked (the follow API refuses it), and
                  Follow is for hosts, kept for anyone already following. */}
              {!isBlocked && !alsoRuns && (isHost || isFollowing) && (
                <FollowButton organizerId={organizer.id} userId={userId} initialIsFollowing={isFollowing} />
              )}
            </div>
          )}

          {/* Owner tools: only what is missing, plus the visitor's view. Never in a preview. */}
          {canEdit && (
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-meta">
              {!cover && (
                <Link
                  href="/organizer/settings/organization#banner"
                  className="inline-flex items-center gap-1.5 font-semibold text-fg-soft hover:text-fg"
                >
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  {t('org_page.add_banner')}
                </Link>
              )}
              {gallery.length === 0 && (
                <Link
                  href="/organizer/settings/organization#photos"
                  className="inline-flex items-center gap-1.5 font-semibold text-fg-soft hover:text-fg"
                >
                  <Images className="h-4 w-4" aria-hidden />
                  {t('org_page.add_photos')}
                </Link>
              )}
              <Link
                href={`/profile/organizer/${encodeURIComponent(organizer.id)}?preview=1`}
                className="inline-flex items-center gap-1.5 text-fg-subtle hover:text-fg"
              >
                <Eye className="h-4 w-4" aria-hidden />
                {t('org_page.preview')}
              </Link>
            </div>
          )}

          {/* Report / block (App Store 1.2): quiet text actions, never on your own page. */}
          {userId !== organizer.id && !preview && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <ReportButton kind="organizer" targetId={organizer.id} userId={userId} person={!isHost} />
              <BlockOrganizerButton
                person={!isHost}
                organizerId={organizer.id}
                organizerName={organizer.name}
                userId={userId}
                initialBlocked={isBlocked}
              />
            </div>
          )}
        </div>
      </header>

      {/* ───────────────────────── EVENTS ───────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        {/* A person who never hosted has no events section at all. */}
        {(isHost || (upcomingEvents?.length || 0) > 0) && (
        <section className="border-t border-line pt-8 md:pt-10">
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
            <div className="grid grid-cols-1 gap-0 min-[420px]:grid-cols-2 min-[420px]:gap-4 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4">
              {upcomingEvents.map((event: any) => (
                <DiscoverEventCard key={event.id} event={event} rowOnPhone />
              ))}
            </div>
          ) : (
            /* A fill, not a hairline around the page colour — this was
               `bg-canvas border border-line`, i.e. a ring around
               nothing. Also half the height it was. */
            <div className="rounded-2xl bg-surface-low px-6 py-10 text-center">
              <CalendarDays className="mx-auto mb-3 h-8 w-8 text-fg-faint" aria-hidden />
              <p className="text-body font-semibold text-fg">
                {t('organizer_profile.no_upcoming_title', 'No upcoming events')}
              </p>
              <p className="mx-auto mt-1 max-w-[42ch] text-meta text-fg-subtle">
                {t(
                  'organizer_profile.no_upcoming_desc',
                  "This organizer doesn't have any upcoming events at the moment."
                )}
              </p>
            </div>
          )}
        </section>
        )}

        {/* Photos: a strip with a viewer. */}
        {gallery.length > 0 && (
          <section className="mt-10 border-t border-line pt-8 md:mt-14 md:pt-10">
            <SectionHead title={t('org_page.photos')} />
            <GalleryStrip photos={gallery} orgName={organizer.name} />
          </section>
        )}

        {pastEvents && pastEvents.length > 0 && (
          <section className="mt-10 border-t border-line pt-8 md:mt-14 md:pt-10">
            <SectionHead
              title={t('organizer_profile.past_events', 'past events')}
              note={t('organizer_profile.past_events_desc', {
                defaultValue: 'Previous events organized by {{name}}',
                name: organizer.name,
              })}
            />
            <div className="grid grid-cols-1 gap-0 min-[420px]:grid-cols-2 min-[420px]:gap-4 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4">
              {pastEvents.map((event: any) => (
                <DiscoverEventCard key={event.id} event={event} rowOnPhone />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
