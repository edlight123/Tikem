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
        <div className="h-[76px] rounded bg-white/[0.05] animate-pulse" />
      </div>
    )
  }

  if (!data || data.totalGoing === 0) {
    return null
  }

  const { totalGoing, viewerIsGoing, friendsGoing, publicGoing } = data
  // A small number talks people out of going, so it only prints once the
  // event is at least half full (same rule as the app).
  const showCount = shouldShowGoingCount(totalGoing, capacity)

  // 'count' — the number, and nothing that identifies anyone. No avatars, no
  // names, no friend row: those are exactly what this mode exists to withhold.
  if (visibility === 'count') {
    if (!showCount && !viewerIsGoing) return null
    if (!showCount) {
      return (
        <div className={`rounded-2xl p-4 md:p-6 ${className}`}>
          <h2 className="font-display lowercase italic !text-[22px] !leading-none text-white">
            {t('whos_going.youre_going', "You're going")}
          </h2>
        </div>
      )
    }
    return (
      <div className={`rounded-2xl p-4 md:p-6 ${className}`}>
        <h2 className="font-display lowercase italic !text-[22px] !leading-none text-white">
          {t('whos_going.going_count', { count: totalGoing, defaultValue: '{{count}} going' })}
        </h2>
        {viewerIsGoing && (
          <p className="mt-1 text-sm text-white/55">
            {t('whos_going.youre_going', "You're going")}
          </p>
        )}
      </div>
    )
  }

  // Nameless accounts come back as "Tikèm user": never the lead name, never a
  // face (they still count as an unnamed portrait below).
  const isNamed = (u: PublicUserSummary) => !!u.displayName?.trim() && u.displayName !== 'Tikèm user'
  const named = [...friendsGoing, ...publicGoing].filter(isNamed)
  // Nothing to show: no faces, not the viewer, and the number held back.
  if (!showCount && !viewerIsGoing && named.length === 0 && totalGoing <= (viewerIsGoing ? 1 : 0)) return null

  // The card's pile: three faces, unnamed portraits filling in for guests who
  // keep themselves private, so a crowd still reads as one.
  const faces = named.slice(0, 3)
  const others = Math.max(0, totalGoing - (viewerIsGoing ? 1 : 0) - faces.length)
  const anonBase = defaultAvatarIndex(eventId)
  const anon = Array.from({ length: Math.min(others, 3 - faces.length) }, (_, i) => defaultAvatarAt(anonBase + i * 5))

  const lead = (named[0]?.displayName || '').split(' ')[0]
  const sub = viewerIsGoing
    ? t('whos_going.youre_going', "You're going")
    : friendsGoing.length > 0
      ? t(friendsGoing.length === 1 ? 'whos_going.friend_going' : 'whos_going.friend_going_plural', {
          count: friendsGoing.length,
          defaultValue: friendsGoing.length === 1 ? '{{count}} friend going' : '{{count}} friends going',
        })
      : lead && showCount && totalGoing > 1
        ? t('whos_going.lead_and_others', { name: lead, count: totalGoing - 1, defaultValue: '{{name}} and {{count}} others going' })
        : lead && totalGoing > 1
          ? t('whos_going.lead_and_others_vague', { name: lead, defaultValue: '{{name}} and others are going' })
          : t('whos_going.see_whos_going', "See who's going")

  const openList = () => {
    if (!currentUserId) {
      const redirectTo = `${window.location.pathname}${window.location.search || ''}`
      window.location.href = `/auth/login?redirect=${encodeURIComponent(redirectTo)}`
      return
    }
    setSheetOpen(true)
  }

  // One filled card, Posh's shape in our materials: what it is on the left,
  // the faces and "View" on the right. It replaced a heading over a
  // left-aligned pile, which sat lopsided on the page (owner, 2026-11-16).
  return (
    <div className={`px-4 md:max-w-xl md:px-0 ${className}`}>
      <button
        type="button"
        onClick={openList}
        className="flex w-full items-center gap-3 rounded bg-white/[0.05] py-4 pl-[18px] pr-3.5 text-left transition-colors hover:bg-white/[0.08]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-white">{t('whos_going.guestlist', 'Guestlist')}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/55">{sub}</span>
        </span>
        <span className="flex shrink-0 -space-x-3.5" aria-hidden>
          {faces.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={u.uid}
              src={u.photoURL || defaultAvatarUrl(String(u.uid))}
              alt=""
              className="h-11 w-11 rounded-full object-cover ring-2 ring-[#161616]"
            />
          ))}
          {anon.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`anon-${i}`} src={src} alt="" className="h-11 w-11 rounded-full ring-2 ring-[#161616]" />
          ))}
        </span>
        <span className="grid h-9 shrink-0 place-items-center rounded bg-white/[0.08] px-4 text-[13px] font-bold text-white">
          {t('whos_going.view', 'View')}
        </span>
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
