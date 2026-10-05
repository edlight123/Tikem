'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Clock,
  Compass,
  Flag,
  Megaphone,
  MessageCircle,
  Repeat,
  ShieldCheck,
  Ticket,
  UserPlus,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { markAsRead, markAllAsRead } from '@/lib/notifications'
import { ConfirmProvider, useConfirm } from '@/components/ui/ConfirmProvider'
import { SectionHeader } from '@/components/ui/EditorialRails'
import { Chip } from '@/components/ui/kit'
import { dateLocaleFor, intlLocaleFor } from '@/lib/dateLocale'
import type { Notification } from '@/types/notifications'

interface NotificationsClientProps {
  userId: string
  initialNotifications: Notification[]
  initialUnreadCount: number
  /** Event poster per notification id, when the notification is about an event. */
  posters?: Record<string, string>
}

/* ------------------------------------------------------------------ *
 * Type → glyph, tone and filter family
 *
 * POSH direction: the poster is the colour. A row about an event shows that
 * event's flyer; everything else gets a monochrome glyph on a filled tile.
 * Colour on a glyph is semantic only, from the brief's locked map: amber
 * means "you need to act", rose means "something went wrong". Teal is kept
 * for exactly one job on this page, the unread dot.
 * ------------------------------------------------------------------ */

type Tone = 'neutral' | 'amber' | 'rose'
type Family = 'tickets' | 'events' | 'payouts' | 'other'

const TONE_FG: Record<Tone, string> = {
  neutral: 'text-white/70',
  amber: 'text-amber-200',
  rose: 'text-rose-200',
}

const FAMILY_ORDER: Family[] = ['tickets', 'events', 'payouts', 'other']

function markFor(type: string): { Icon: LucideIcon; tone: Tone; family: Family } {
  switch (type) {
    case 'ticket_purchased':
      return { Icon: Ticket, tone: 'neutral', family: 'tickets' }
    case 'ticket_transfer':
      return { Icon: Repeat, tone: 'neutral', family: 'tickets' }
    case 'event_updated':
      return { Icon: Megaphone, tone: 'neutral', family: 'events' }
    case 'event_reminder_24h':
    case 'event_reminder_3h':
    case 'event_reminder_30min':
      return { Icon: Clock, tone: 'neutral', family: 'events' }
    case 'event_cancelled':
      return { Icon: XCircle, tone: 'rose', family: 'events' }
    case 'event_filling_fast':
      // A nudge, not an alarm: neutral, and the poster carries the row.
      return { Icon: Clock, tone: 'neutral', family: 'events' }
    case 'city_discovery':
      return { Icon: Compass, tone: 'neutral', family: 'events' }
    case 'national_day':
      return { Icon: Flag, tone: 'neutral', family: 'events' }
    case 'organizer_milestone':
      return { Icon: Ticket, tone: 'neutral', family: 'events' }
    case 'organizer_nudge':
      return { Icon: Megaphone, tone: 'amber', family: 'events' }
    case 'payment_dispute':
      return { Icon: AlertTriangle, tone: 'rose', family: 'payouts' }
    case 'payout_account_blocked':
      return { Icon: Wallet, tone: 'amber', family: 'payouts' }
    case 'withdrawal_update':
      return { Icon: Wallet, tone: 'neutral', family: 'payouts' }
    case 'withdrawal_escalated':
      return { Icon: Wallet, tone: 'amber', family: 'payouts' }
    case 'staff_invite':
      return { Icon: Users, tone: 'neutral', family: 'other' }
    case 'connection_request':
    case 'connection_accepted':
      return { Icon: UserPlus, tone: 'neutral', family: 'other' }
    case 'organizer_message':
    case 'organizer_reply':
      return { Icon: MessageCircle, tone: 'neutral', family: 'other' }
    case 'verification_info_needed':
      return { Icon: ShieldCheck, tone: 'amber', family: 'other' }
    case 'verification_rejected':
      return { Icon: ShieldCheck, tone: 'rose', family: 'other' }
    case 'verification':
    case 'verification_submitted':
    case 'verification_approved':
      return { Icon: ShieldCheck, tone: 'neutral', family: 'other' }
    case 'content_reported':
      return { Icon: Flag, tone: 'amber', family: 'other' }
    default:
      return { Icon: Bell, tone: 'neutral', family: 'other' }
  }
}

/** Hosts next/image is configured to optimise (next.config.js remotePatterns). */
const OPTIMISABLE_HOSTS = new Set(['images.unsplash.com', 'storage.googleapis.com', 'firebasestorage.googleapis.com'])

function canOptimise(src: string): boolean {
  if (src.startsWith('/')) return true
  try {
    const u = new URL(src)
    return u.protocol === 'https:' && OPTIMISABLE_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Time buckets
 * ------------------------------------------------------------------ */

type BucketKey = 'today' | 'yesterday' | 'this_week' | 'earlier'

const BUCKET_ORDER: BucketKey[] = ['today', 'yesterday', 'this_week', 'earlier']

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function bucketFor(when: number, now: number): BucketKey {
  const today = startOfLocalDay(now)
  if (when >= today) return 'today'
  if (when >= today - 86_400_000) return 'yesterday'
  if (when >= today - 7 * 86_400_000) return 'this_week'
  return 'earlier'
}

/** Quiet text action: no box, no border; underline on hover. */
const QUIET_ACTION =
  'rounded text-[13px] font-medium underline-offset-4 transition-colors duration-200 ' +
  'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ' +
  'motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-45'

export function NotificationsClient(props: NotificationsClientProps) {
  // The clear-all guard routes through the shared confirm primitive, so the
  // page needs the provider above the component that calls useConfirm().
  return (
    <ConfirmProvider>
      <NotificationsFeed {...props} />
    </ConfirmProvider>
  )
}

function NotificationsFeed({
  userId,
  initialNotifications,
  initialUnreadCount,
  posters = {},
}: NotificationsClientProps) {
  const router = useRouter()
  const { t, i18n } = useTranslation('notifications')
  const confirmDialog = useConfirm()
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [isLoading, setIsLoading] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [filter, setFilter] = useState<Family | 'all'>('all')

  // "Today" is a local-calendar idea, so it can only be decided in the
  // visitor's timezone. Grouping therefore waits for mount: the server render
  // (UTC) and the first client render agree on a flat list, then the buckets
  // settle in with the reader's own clock — no hydration drift.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
  }, [])

  const intlLocale = intlLocaleFor(i18n.language)
  const fnsLocale = dateLocaleFor(i18n.language)

  // Filter chips only for families that actually have rows: a "Payouts" chip
  // that always filters to nothing is noise for a buyer who never sells.
  const families = useMemo(() => {
    const present = new Set(notifications.map((n) => markFor(n.type).family))
    return FAMILY_ORDER.filter((f) => present.has(f))
  }, [notifications])

  // If the active family empties out (declined invite, clear all), fall back.
  useEffect(() => {
    if (filter !== 'all' && !families.includes(filter)) setFilter('all')
  }, [families, filter])

  const visible = useMemo(
    () => (filter === 'all' ? notifications : notifications.filter((n) => markFor(n.type).family === filter)),
    [notifications, filter]
  )

  const groups = useMemo(() => {
    if (now === null) {
      return [{ key: null as BucketKey | null, items: visible }]
    }
    const byBucket = new Map<BucketKey, Notification[]>()
    for (const n of visible) {
      const ms = new Date(n.createdAt).getTime()
      const key = Number.isNaN(ms) ? 'earlier' : bucketFor(ms, now)
      const list = byBucket.get(key)
      if (list) list.push(n)
      else byBucket.set(key, [n])
    }
    return BUCKET_ORDER.filter((k) => byBucket.has(k)).map((k) => ({
      key: k as BucketKey | null,
      items: byBucket.get(k)!,
    }))
  }, [visible, now])

  const groupLabel = (key: BucketKey): string => {
    switch (key) {
      case 'today':
        return t('groups.today', { defaultValue: 'Today' })
      case 'yesterday':
        return t('groups.yesterday', { defaultValue: 'Yesterday' })
      case 'this_week':
        return t('groups.this_week', { defaultValue: 'This week' })
      default:
        return t('groups.earlier', { defaultValue: 'Earlier' })
    }
  }

  const familyLabel = (f: Family | 'all'): string => {
    switch (f) {
      case 'tickets':
        return t('filters.tickets', { defaultValue: 'Tickets' })
      case 'events':
        return t('filters.events', { defaultValue: 'Events' })
      case 'payouts':
        return t('filters.payouts', { defaultValue: 'Payouts' })
      case 'other':
        return t('filters.other', { defaultValue: 'Other' })
      default:
        return t('filters.all', { defaultValue: 'All' })
    }
  }

  /** "2m ago" / "4h ago" / "yesterday" / "Tuesday" / "12 Aug" — localized. */
  const relativeTime = (iso: string): string => {
    const ms = new Date(iso).getTime()
    if (Number.isNaN(ms)) return ''

    const absolute = (withYear: boolean) =>
      new Intl.DateTimeFormat(intlLocale, {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' } : {}),
      }).format(ms)

    if (now === null) return absolute(false)

    const minutes = Math.floor((now - ms) / 60_000)
    if (minutes < 1) return t('time.just_now', { defaultValue: 'Just now' })
    if (minutes < 60) return t('time.minutes_ago', { defaultValue: '{{value}}m ago', value: minutes })

    const bucket = bucketFor(ms, now)
    if (bucket === 'today') {
      return t('time.hours_ago', { defaultValue: '{{value}}h ago', value: Math.floor(minutes / 60) })
    }
    if (bucket === 'yesterday') return t('time.yesterday', { defaultValue: 'yesterday' })
    if (bucket === 'this_week') {
      return new Intl.DateTimeFormat(intlLocale, { weekday: 'long' }).format(ms)
    }
    return absolute(new Date(ms).getFullYear() !== new Date(now).getFullYear())
  }

  /** Full date on hover — the precise answer behind the relative one. */
  const exactTime = (iso: string): string | undefined => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return undefined
    try {
      return format(d, 'PPPp', { locale: fnsLocale })
    } catch {
      return undefined
    }
  }

  const handleAcceptStaffInvite = async (notification: Notification) => {
    const metadata = (notification as any)?.metadata || {}
    const eventId = String(metadata?.eventId || notification.eventId || '')
    const token = String(metadata?.token || '')

    if (!eventId || !token) {
      alert(
        t('invite.missing_details', {
          defaultValue: 'Missing invite details. Please open the invite link.',
        })
      )
      return
    }

    try {
      const res = await fetch('/api/staff/invites/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, token }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error || t('invite.accept_failed', { defaultValue: 'Failed to accept invite' })
        alert(msg)
        return
      }

      if (!notification.isRead) {
        await handleMarkAsRead(notification.id)
      }

      // Send the user to the staff hub.
      router.push('/staff')
    } catch (error) {
      console.error('Error accepting staff invite:', error)
      alert(t('invite.accept_failed', { defaultValue: 'Failed to accept invite' }))
    }
  }

  const handleDeclineStaffInvite = async (notification: Notification) => {
    const metadata = (notification as any)?.metadata || {}
    const eventId = String(metadata?.eventId || notification.eventId || '')
    const token = String(metadata?.token || '')

    if (!eventId || !token) {
      alert(
        t('invite.missing_details', {
          defaultValue: 'Missing invite details. Please open the invite link.',
        })
      )
      return
    }

    try {
      const res = await fetch('/api/staff/invites/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, token }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error || t('invite.decline_failed', { defaultValue: 'Failed to decline invite' })
        alert(msg)
        return
      }

      if (!notification.isRead) {
        await handleMarkAsRead(notification.id)
      }

      // Dismiss it from the list (it will still exist in Firestore as read).
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id))
    } catch (error) {
      console.error('Error declining staff invite:', error)
      alert(t('invite.decline_failed', { defaultValue: 'Failed to decline invite' }))
    }
  }

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markAsRead(userId, notificationId)

      // Update local state
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
        )
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  const handleMarkAllAsRead = async () => {
    setIsLoading(true)
    try {
      await markAllAsRead(userId)

      // Update local state
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Error marking all as read:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClearAll = async () => {
    const ok = await confirmDialog({
      title: t('clear_all', { defaultValue: 'Clear all' }),
      description: t('confirm_clear', {
        defaultValue: 'Are you sure you want to clear all notifications? This cannot be undone.',
      }),
      confirmLabel: t('clear_all', { defaultValue: 'Clear all' }),
      cancelLabel: t('cancel', { defaultValue: 'Cancel' }),
      variant: 'danger',
    })
    if (!ok) return

    setIsClearing(true)
    try {
      const response = await fetch('/api/notifications/clear-all', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to clear notifications')
      }

      // Clear local state
      setNotifications([])
      setUnreadCount(0)
    } catch (error) {
      console.error('Error clearing notifications:', error)
      alert(t('clear_failed', { defaultValue: 'Failed to clear notifications. Please try again.' }))
    } finally {
      setIsClearing(false)
    }
  }

  const getNotificationLink = (notification: Notification): string => {
    if ((notification as any).actionUrl) {
      return (notification as any).actionUrl as string
    }
    if (notification.ticketId) {
      return `/tickets/${notification.ticketId}`
    }
    if (notification.eventId) {
      return `/events/${notification.eventId}`
    }
    return '#'
  }

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await handleMarkAsRead(notification.id)
    }

    const link = getNotificationLink(notification)
    if (link !== '#') {
      router.push(link)
    }
  }

    const renderRow = (notification: Notification) => {
    const { Icon, tone } = markFor(notification.type)
    const unread = !notification.isRead
    const poster = posters[notification.id]
    const isReply = notification.type === 'organizer_reply'
    const body = isReply
      ? (notification.metadata as any)?.replyBody || notification.message
      : notification.message

    return (
      <li key={notification.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleNotificationClick(notification)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleNotificationClick(notification)
            }
          }}
          className={[
            'group flex cursor-pointer items-start gap-3.5 rounded-2xl px-3 py-3 outline-none sm:gap-4 sm:px-4 sm:py-3.5',
            'transition-colors duration-300 motion-reduce:transition-none',
            'hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50',
            // Fill, not a hairline: an unread row is a surface on the page;
            // once read it settles back onto the canvas.
            unread ? 'bg-white/[0.045]' : 'bg-transparent',
          ].join(' ')}
        >
          {/* Poster thumbnail when the row is about an event, else a glyph tile. */}
          <div
            className={[
              'relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/[0.07] sm:h-14 sm:w-14',
              'transition-opacity duration-300 motion-reduce:transition-none',
              unread ? 'opacity-100' : 'opacity-75 group-hover:opacity-100',
            ].join(' ')}
          >
            {poster ? (
              <Image
                src={poster}
                alt=""
                fill
                sizes="56px"
                quality={60}
                unoptimized={!canOptimise(poster)}
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Icon className={`h-5 w-5 ${TONE_FG[tone]}`} strokeWidth={1.6} aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3
                className={[
                  'min-w-0 truncate font-grotesk !text-[15px] font-semibold !leading-snug tracking-[-0.01em]',
                  'transition-colors duration-300 motion-reduce:transition-none',
                  unread ? 'text-white' : 'text-white/60',
                ].join(' ')}
              >
                {notification.title}
              </h3>

              <span className="flex shrink-0 items-center gap-2">
                <span
                  className="label-mono text-[11px] text-white/40"
                  title={exactTime(notification.createdAt)}
                  suppressHydrationWarning
                >
                  {relativeTime(notification.createdAt)}
                </span>
                {unread && (
                  // Unread is a small teal dot: the one place teal appears here.
                  <span className="h-2 w-2 rounded-full bg-[#14B8A6]" role="img" aria-label={t('new_label', { defaultValue: 'New' })} />
                )}
              </span>
            </div>

            {/* An organizer's reply is the answer to a question the attendee
                asked, so it shows in full; every other detail is a one-liner
                (two on a phone) that the target page expands on. */}
            <p
              className={[
                '!mt-1 !text-[13.5px] !leading-relaxed',
                isReply ? 'whitespace-pre-line' : 'line-clamp-2 sm:line-clamp-1',
                'transition-colors duration-300 motion-reduce:transition-none',
                unread ? 'text-white/60' : 'text-white/40',
              ].join(' ')}
            >
              {body}
            </p>

            {notification.type === 'staff_invite' && (
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAcceptStaffInvite(notification)
                  }}
                  className="rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  {t('invite.accept', { defaultValue: 'Accept invite' })}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeclineStaffInvite(notification)
                  }}
                  className={`${QUIET_ACTION} text-white/55 hover:text-white`}
                >
                  {t('invite.decline', { defaultValue: 'Decline' })}
                </button>
              </div>
            )}
          </div>
        </div>
      </li>
    )
  }

  const hasUnread = unreadCount > 0

  return (
    <div className="min-h-screen bg-black pb-mobile-nav">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 sm:pt-14 lg:px-8">
        {/* Header: a poster-weight grotesk title, as on the event page and
            the homepage hero, with the actions as quiet text, never boxes. */}
        <header>
          {/* A div, not a p: `.mobile-typography p` would drag it to 14px. */}
          <div className="label-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
            {t('eyebrow', { defaultValue: 'Your inbox' })}
          </div>
          <h1 className="mt-2 font-grotesk font-bold text-white !text-[clamp(40px,7vw,64px)] !leading-[0.95] tracking-[-0.035em]">
            {t('title', { defaultValue: 'Notifications' })}
          </h1>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 text-[14px] text-white/55 sm:text-[15px]">
              {hasUnread && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#14B8A6]" />}
              <span>
                {hasUnread
                  ? t('unread_count', {
                      count: unreadCount,
                      defaultValue: 'You have {{count}} unread notifications',
                    })
                  : t('all_caught_up', { defaultValue: "You're all caught up!" })}
              </span>
            </div>

            {notifications.length > 0 && (
              <div className="flex items-center gap-5">
                {hasUnread && (
                  <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    disabled={isLoading}
                    className={`${QUIET_ACTION} text-white/85 hover:text-white`}
                  >
                    {isLoading
                      ? t('working', { defaultValue: 'Working…' })
                      : t('mark_all_read', { defaultValue: 'Mark all read' })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={isClearing}
                  className={`${QUIET_ACTION} text-white/45 hover:text-rose-200`}
                >
                  {isClearing
                    ? t('working', { defaultValue: 'Working…' })
                    : t('clear_all', { defaultValue: 'Clear all' })}
                </button>
              </div>
            )}
          </div>
        </header>

        {notifications.length === 0 ? (
          /* Empty state: the brief's formula (headline, one line, one white
             CTA), carried by a piece from the Tikèm art library instead of
             an outline icon in a box. */
          <div className="mt-10 overflow-hidden rounded-3xl bg-white/[0.03] sm:mt-12 sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="relative aspect-[4/3] sm:aspect-auto sm:min-h-[400px]">
              <Image
                src="/art/notifications-empty.jpg"
                alt=""
                fill
                sizes="(min-width: 640px) 340px, 100vw"
                className="object-cover"
              />
              {/* Fade the art into the card on a phone, where text sits below. */}
              <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#080808] to-transparent sm:hidden" />
            </div>
            <div className="flex flex-col justify-center px-6 pb-8 pt-2 sm:px-10 sm:py-12">
              <div className="label-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
                {t('empty.eyebrow', { defaultValue: 'Quiet for now' })}
              </div>
              <h2 className="mt-3 font-grotesk font-bold text-white !text-[clamp(28px,4vw,40px)] !leading-[1] tracking-[-0.03em]">
                {t('empty.title', { defaultValue: 'No notifications yet' })}
              </h2>
              <p className="!mt-3 max-w-sm !text-[15px] !leading-relaxed text-white/55">
                {t('empty.description', {
                  defaultValue: "When you get notifications, they'll show up here.",
                })}
              </p>
              <div className="mt-7">
                <Link
                  href="/discover"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-[15px] font-semibold text-black transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <Compass className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  {t('empty.cta', { defaultValue: 'Find events' })}
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <>
            {families.length > 1 && (
              <div
                role="group"
                aria-label={t('filters.label', { defaultValue: 'Filter notifications' })}
                className="scrollbar-hide -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:mt-10 sm:flex-wrap sm:px-0"
              >
                {(['all', ...families] as const).map((f) => (
                  <Chip
                    key={f}
                    active={filter === f}
                    pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className="shrink-0"
                  >
                    {familyLabel(f)}
                  </Chip>
                ))}
              </div>
            )}

            <div className="mt-8 sm:mt-10">
              {groups.map((group, index) => (
                <section key={group.key ?? 'all'} className={index === 0 ? '' : 'mt-8 sm:mt-10'}>
                  {group.key && <SectionHeader title={groupLabel(group.key)} />}
                  {/* -mx so the row fill reaches the gutter while the text
                      stays on the column's left edge. */}
                  <ul className="-mx-3 space-y-1 sm:-mx-4">{group.items.map(renderRow)}</ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
