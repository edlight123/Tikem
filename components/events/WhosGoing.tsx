'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PublicUserSummary } from '@/types/social'
import type { GuestlistVisibility } from '@/lib/guestlistVisibility'
import { shouldShowGoingCount } from '@/lib/socialProof'
import { defaultAvatarAt, defaultAvatarIndex, defaultAvatarUrl } from '@/lib/defaultAvatar'
import GuestlistSheet from './GuestlistSheet'

interface WhosGoingProps {
  eventId: string
  currentUserId: string | null
  /**
   * What the organizer chose in the composer. 'hidden' renders nothing at all
   * — not a privacy note, not a count: the organizer asked for the section to
   * be absent, and a note saying "attendance is private" still announces that
   * there are attendees.
   */
  visibility?: GuestlistVisibility
  /**
   * Spacing, applied to this component's own root rather than to a wrapper
   * around it. A wrapper's `mt-8` survives when this returns null — which it
   * does whenever nobody is going yet — and left 32px of unexplained black
   * above the footer on every quiet event page. Same trap the venue map hit.
   */
  className?: string
  /** Ticket capacity: the count only prints once half of it is taken
   *  (shouldShowGoingCount). Unset means faces and names, no number. */
  capacity?: number | null
  /** The organizer's "Show how many are going" (event.show_going_count):
   *  the number prints whatever the capacity. */
  showGoingCount?: boolean
  /** The viewer's own name and photo: the photo decides the "show your face"
   *  step before the full list. */
  viewerName?: string | null
  viewerPhotoUrl?: string | null
}

interface SocialData {
  totalGoing: number
  viewerIsGoing: boolean
  friendsGoing: PublicUserSummary[]
  publicGoing: PublicUserSummary[]
}

function Avatar({ user, size = 40 }: { user: PublicUserSummary; size?: number }) {
  // No photo: a drawn portrait (lib/defaultAvatar), not an initial.
  return (
    <div
      className="rounded-full overflow-hidden bg-white/[0.08] ring-2 ring-black shrink-0"
      style={{ width: size, height: size }}
      title={user.displayName}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={user.photoURL || defaultAvatarUrl(String(user.uid || user.displayName || ''))}
        alt={user.displayName}
        className="w-full h-full object-cover"
      />
    </div>
  )
}

export default function WhosGoing({
  eventId,
  currentUserId,
  visibility = 'faces',
  className = '',
  capacity,
  showGoingCount = false,
  viewerName,
  viewerPhotoUrl,
}: WhosGoingProps) {
  const { t } = useTranslation('common')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [data, setData] = useState<SocialData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // No request when the section will not render: the social endpoint returns
    // who is attending, and fetching that for a page that must not show it is
    // both wasted and the kind of thing that leaks through a network tab.
    if (visibility === 'hidden') {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    fetch(`/api/events/${eventId}/social`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json) setData(json)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [eventId, visibility])

  if (visibility === 'hidden') return null

  // The card's own footprint while it loads, so nothing jumps when it lands.
  if (loading) {
    return (
      <div className={`px-4 md:px-0 ${className}`}>
        <div className="h-8 w-56 rounded bg-white/[0.05] animate-pulse" />
      </div>
    )
  }

  if (!data || data.totalGoing === 0) {
    return null
  }

  const { totalGoing, viewerIsGoing, friendsGoing, publicGoing } = data
  // A small number talks people out of going, so it only prints once the
  // event is at least half full, or when the organizer chose to always show
  // it (same rule as the app).
  const showCount = shouldShowGoingCount(totalGoing, capacity, showGoingCount)
  // Someone already going sees the real number ("You, Mika and 84 others",
  // owner 2026-11-18): the half-capacity rule protects those still deciding.
  const sayCount = showCount || viewerIsGoing

  // 'count' — the number, and nothing that identifies anyone. No avatars, no
  // names, no friend row: those are exactly what this mode exists to withhold.
  if (visibility === 'count') {
    if (!showCount && !viewerIsGoing) return null
    return (
      <p className={`px-4 text-[14px] text-white/60 md:px-0 ${className}`}>
        {[
          viewerIsGoing ? t('whos_going.youre_going', "You're going") : '',
          showCount ? t('whos_going.going_count', { count: totalGoing, defaultValue: '{{count}} going' }) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    )
  }

  // Nameless accounts come back as "Tikèm user": never the lead name, never a
  // face (they still count as an unnamed portrait below). Faces with a real
  // photo lead (owner, 2026-11-17); a stable sort keeps the server's order
  // within each group.
  const isNamed = (u: PublicUserSummary) => !!u.displayName?.trim() && u.displayName !== 'Tikèm user'
  const named = [...friendsGoing, ...publicGoing]
    .filter(isNamed)
    .sort((a, b) => Number(!!b.photoURL) - Number(!!a.photoURL))
  // No named face and the number held back still shows the row: unnamed
  // portraits and "See who's going" (others ARE going; same as the app).

  // The row's pile: three faces, unnamed portraits filling in for guests who
  // keep themselves private, so a crowd still reads as one.
  const MAX_FACES = 3
  const faces = named.slice(0, MAX_FACES)
  const others = Math.max(0, totalGoing - (viewerIsGoing ? 1 : 0) - faces.length)
  const anonBase = defaultAvatarIndex(eventId)
  const anon = Array.from({ length: Math.min(others, MAX_FACES - faces.length) }, (_, i) => defaultAvatarAt(anonBase + i * 5))

  // The line under "Guestlist", names in bold: "You, Mika and 84 others",
  // "Mika and others" while the number is held back. Whole-sentence templates
  // keep the word order translatable; the names go in as markers and are
  // swapped for <strong> below.
  const leadName = (faces[0]?.displayName || '').split(' ')[0]
  // Two names when "You" isn't leading: "Olivier and Marie are going" fills
  // the line the way Posh does (owner, 2026-11-18). Same rule as the app.
  const secondName = viewerIsGoing ? '' : (faces[1]?.displayName || '').split(' ')[0]
  const othersCount = Math.max(
    0,
    totalGoing - (viewerIsGoing ? 1 : 0) - (leadName ? 1 : 0) - (secondName ? 1 : 0)
  )
  const lineKey = viewerIsGoing
    ? leadName
      ? othersCount === 0
        ? 'you_lead'
        : othersCount === 1
          ? 'you_lead_one'
          : 'you_lead_others'
      : othersCount === 0
        ? 'you_only'
        : othersCount === 1
          ? 'you_one'
          : 'you_others'
    : secondName
      ? othersCount === 0
        ? 'lead_second'
        : !sayCount
          ? 'lead_second_vague'
          : othersCount === 1
            ? 'lead_second_one'
            : 'lead_second_others'
      : leadName
        ? othersCount === 0
          ? 'lead_only'
          : !sayCount
            ? 'lead_vague'
            : othersCount === 1
              ? 'lead_one'
              : 'lead_others'
        : sayCount
          ? 'count'
          : 'vague'
  const YOU = '\u0001'
  const LEAD = '\u0002'
  const SECOND = '\u0003'
  const template = t(`whos_going.line.${lineKey}`, {
    you: YOU,
    lead: LEAD,
    second: SECOND,
    count: lineKey === 'count' ? totalGoing : othersCount,
    interpolation: { escapeValue: false },
  })
  const sub = template.split(/([\u0001\u0002\u0003])/).map((part, i) =>
    part === YOU || part === LEAD || part === SECOND ? (
      <strong key={i} className="font-semibold text-white">
        {part === YOU ? t('whos_going.you_badge', 'You') : part === LEAD ? leadName : secondName}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )

  const openList = () => {
    if (!currentUserId) {
      const redirectTo = `${window.location.pathname}${window.location.search || ''}`
      window.location.href = `/auth/login?redirect=${encodeURIComponent(redirectTo)}`
      return
    }
    setSheetOpen(true)
  }

  // Inline under the date and place (Posh, owner 2026-11-18), same as the
  // app: three faces then one sentence, no card, no title, no button. The
  // whole line opens the guest list.
  return (
    <div className={`px-4 md:px-0 ${className}`}>
      <button
        type="button"
        onClick={openList}
        className="group flex max-w-full items-center gap-2.5 text-left"
      >
        <span className="flex shrink-0 -space-x-2" aria-hidden>
          {faces.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={u.uid}
              src={u.photoURL || defaultAvatarUrl(String(u.uid))}
              alt=""
              className="h-[30px] w-[30px] rounded-full object-cover ring-2 ring-[#0a0a0a]"
            />
          ))}
          {anon.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`anon-${i}`} src={src} alt="" className="h-[30px] w-[30px] rounded-full ring-2 ring-[#0a0a0a]" />
          ))}
        </span>
        <span className="min-w-0 line-clamp-2 text-[14px] leading-[19px] text-white/60 group-hover:text-white/80">{sub}</span>
      </button>

      {currentUserId && (
        <GuestlistSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          eventId={eventId}
          viewerId={currentUserId}
          viewerName={viewerName}
          viewerPhotoUrl={viewerPhotoUrl}
          previewFaces={named}
          totalGoing={totalGoing}
          showCount={showCount}
        />
      )}
    </div>
  )
}
