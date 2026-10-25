'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

interface EventTabsProps {
  eventId: string
  ticketCount?: number
  /** Approval-list event: show the Requests tab (with its pending count). */
  requiresApproval?: boolean
  pendingRequests?: number
  /** Earnings (payouts, withdrawals) is owner-only; hidden for team members. */
  showEarnings?: boolean
}

/**
 * Sticky tab bar for the per-event command center.
 *
 * There are fourteen sections, which is more than a tab rail can hold: at any
 * normal width they overflowed into a horizontal scroller, so half the event's
 * tools sat off-screen behind a sideways swipe nobody makes. Worse, a rail that
 * scrolls gives no hint of how much is hidden.
 *
 * So the rail now carries the six an organizer touches while an event is live,
 * and the rest live under one "More" menu. Nothing was removed — every route is
 * still one click away, and the menu marks itself active when the current page
 * is inside it, so the rail never looks like it has lost its place.
 *
 * Active state is derived from the URL; no local state beyond the menu.
 */
export function EventTabs({ eventId, ticketCount, requiresApproval = false, pendingRequests, showEarnings = true }: EventTabsProps) {
  const { t } = useTranslation('common')
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const base = `/organizer/events/${eventId}`

  // Primary — the day-to-day of running an event: who's coming, what sold,
  // what it earned, and getting people through the door.
  const primary = [
    { id: 'overview', label: t('organizer.overview', { defaultValue: 'Overview' }), href: base, exact: true },
    { id: 'attendees', label: t('organizer.attendees', { defaultValue: 'Attendees' }), href: `${base}/attendees`, count: ticketCount },
    ...(requiresApproval
      ? [{ id: 'requests', label: t('attend_requests.organizer.tile'), href: `${base}/requests`, count: pendingRequests }]
      : []),
    { id: 'orders', label: t('organizer.tab_orders', { defaultValue: 'Orders' }), href: `${base}/orders` },
    { id: 'tickets', label: t('organizer.tab_tickets', { defaultValue: 'Tickets' }), href: `${base}/tickets` },
    ...(showEarnings ? [{ id: 'earnings', label: t('organizer.earnings', { defaultValue: 'Earnings' }), href: `${base}/earnings` }] : []),
    { id: 'check-in', label: t('organizer.check_in', { defaultValue: 'Check-in' }), href: `/organizer/scan/${eventId}` },
  ]

  // Everything set up once, consulted occasionally, or belonging to a specific
  // job (promotion, staffing, comps).
  const more = [
    { id: 'analytics', label: t('organizer.tab_analytics', { defaultValue: 'Analytics' }), href: `${base}/analytics` },
    { id: 'messages', label: t('organizer.tab_messages', { defaultValue: 'Messages' }), href: `${base}/messages` },
    { id: 'marketing', label: t('organizer.tab_marketing', { defaultValue: 'Marketing' }), href: `${base}/marketing` },
    { id: 'promoters', label: t('organizer.tab_promoters', { defaultValue: 'Promoters' }), href: `${base}/promoters` },
    { id: 'guest-list', label: t('organizer.tab_guest_list', { defaultValue: 'Guest list' }), href: `${base}/guest-list` },
    { id: 'comps', label: t('organizer.tab_comps', { defaultValue: 'Comps' }), href: `${base}/comps` },
    { id: 'tracking', label: t('organizer.tab_tracking', { defaultValue: 'Tracking' }), href: `${base}/tracking` },
    { id: 'staff', label: t('organizer.tab_staff', { defaultValue: 'Staff' }), href: `${base}/staff` },
  ]

  const isActive = (tab: { href: string; exact?: boolean }) =>
    tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)

  const activeInMore = more.find(isActive)

  // Dismiss on outside click and on Escape — a sticky menu that traps the
  // reader is worse than the scroller it replaced.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Close the menu after navigating, or it stays open over the new page.
  useEffect(() => setMenuOpen(false), [pathname])

  const tabCls = (active: boolean) =>
    `flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
      active
        ? 'border-brand-600 text-brand-300'
        : 'border-transparent text-white/55 hover:border-white/20 hover:text-white'
    }`

  // The one sticky bar on this page, now that EventHeader above it scrolls.
  // `var(--chrome-h)` is OrganizerTopNav's own height (globals.css sets it to
  // 56px inside the organizer shell), so this cannot drift if the nav changes.
  return (
    <div className="sticky top-[var(--chrome-h)] z-20 border-b border-white/10 bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <nav
          aria-label={t('organizer.event_sections_aria', { defaultValue: 'Event sections' })}
          // Still scrollable as a floor for very narrow phones, where six tabs
          // genuinely cannot fit — but at any normal width nothing overflows.
          className="-mb-px flex gap-1 overflow-x-auto scrollbar-none"
        >
          {primary.map((tab) => {
            const active = isActive(tab)
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={tabCls(active)}
                aria-current={active ? 'page' : undefined}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold font-mono tabular-nums ${
                      active ? 'text-brand-300' : 'bg-white/8 text-white/55'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </Link>
            )
          })}

          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className={tabCls(!!activeInMore)}
            >
              {/* When the reader is inside the menu, the trigger says WHICH
                  section, so the rail still answers "where am I". */}
              {activeInMore ? activeInMore.label : t('organizer.tab_more', { defaultValue: 'More' })}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+1px)] z-30 w-56 overflow-hidden rounded-xl bg-[#171717] py-1 shadow-2xl"
              >
                {more.map((tab) => {
                  const active = isActive(tab)
                  return (
                    <Link
                      key={tab.id}
                      href={tab.href}
                      role="menuitem"
                      aria-current={active ? 'page' : undefined}
                      className={`block px-4 py-2.5 text-sm transition-colors ${
                        active
                          ? 'bg-white/[0.06] font-medium text-brand-300'
                          : 'text-white/70 hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </nav>
      </div>
    </div>
  )
}
