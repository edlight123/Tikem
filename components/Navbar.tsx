'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Bell } from 'lucide-react'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { isDemoMode, isDemoEmail } from '@/lib/demo'
import { demoLogout } from '@/app/auth/actions'

/**
 * BUNDLE: the navbar renders on essentially every route, so anything it
 * statically imports lands on that route's FIRST LOAD. The Firebase client is
 * 444KB across three chunks (223 + 136 + 85) out of ~988KB of shared JS, and a
 * route only sheds it when its LAST static importer goes — /resources measured
 * 350KB -> 167KB once this file stopped pulling it in. Two importers lived
 * here, and both are gone:
 *
 *  1. `NotificationBell` opens a live onSnapshot listener and is rendered only
 *     for signed-in users, yet a static import shipped its Firestore code to
 *     every reader. It is loaded at the point of RENDER now. There is nothing
 *     to server-render in a live-updating bell, hence ssr: false; the `loading`
 *     placeholder is the bell's own pre-mount markup, so the header's geometry
 *     never moves while the chunk arrives.
 *  2. The auth shim, whose only use here is one signOut() — loaded inside the
 *     handler below.
 *
 * Please do not make either static again.
 */
const NotificationBell = dynamic(
  () => import('./NotificationBell').then((m) => m.NotificationBell),
  {
    ssr: false,
    loading: () => (
      <Link
        href="/notifications"
        className="relative p-2 rounded-lg text-white/70 hover:bg-white/[0.04] transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
      </Link>
    ),
  }
)

interface NavbarProps {
  user?: {
    id: string
    full_name: string
    email: string
    role: 'attendee' | 'organizer' | 'staff'
  } | null
  isAdmin?: boolean
  /**
   * Drop the navbar's own bottom rule. For pages (discover) that pin their own
   * bar directly beneath it: with both rules drawn, the top of the page reads
   * as a stack of hairlines rather than one header band — the page's bar then
   * supplies the band's single bottom edge.
   */
  flush?: boolean
  /**
   * An opaque black bar instead of the frosted one. For the homepage, whose
   * city row sits right under the nav on the same black: through the frosted
   * bar that row's text showed as it slid underneath (a page reloaded a few
   * pixels down opened with "New York · Change country" ghosting under the
   * nav), and the bar's #0a0a0a read as a second tone above the row.
   */
  solid?: boolean
}

export default function Navbar({ user, isAdmin = false, flush = false, solid = false }: NavbarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useTranslation('common')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  const isHost = user?.role === 'organizer' || user?.role === 'staff'

  // "Promoter portal" appears only for accounts that have claimed at least one
  // promoter record. Probed once per browser session (sessionStorage cache) so
  // ordinary visitors never pay for it twice.
  const [isPromoter, setIsPromoter] = useState(false)
  useEffect(() => {
    if (!user) return
    try {
      const cached = sessionStorage.getItem('tikem_is_promoter')
      if (cached !== null) {
        setIsPromoter(cached === '1')
        return
      }
    } catch {
      // Storage unavailable — fall through to the probe.
    }
    let cancelled = false
    fetch('/api/promoter/portfolio?summary=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const has = Boolean(d && Number(d.count) > 0)
        if (!cancelled) setIsPromoter(has)
        try {
          sessionStorage.setItem('tikem_is_promoter', has ? '1' : '0')
        } catch {}
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const redirectTarget = (() => {
    const query = searchParams?.toString()
    return query ? `${pathname}?${query}` : pathname
  })()

  // Close the account dropdown on outside-click and Escape.
  useEffect(() => {
    if (!accountMenuOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [accountMenuOpen])

  async function handleSignOut() {
    // Handle demo logout
    if (isDemoMode() && user && isDemoEmail(user.email)) {
      await demoLogout()
      return
    }

    // Regular Firebase logout. The auth shim (and with it the whole Firebase
    // client) is fetched here rather than imported at module scope — see the
    // BUNDLE note at the top of this file. A signed-in reader's first tap on
    // "sign out" therefore awaits a chunk; in practice the bell above has
    // already pulled the same chunks in for them.
    const { firebaseDb } = await import('@/lib/firebase-db/client')
    await firebaseDb.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const accountMenuItemClass =
    'block w-full text-left px-4 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors duration-200'

  return (
    <nav
      className={`sticky top-0 z-50 ${solid ? 'bg-black' : 'bg-[#0a0a0a]/80 backdrop-blur-xl'} ${
        flush ? '' : 'border-b border-white/10'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 sm:h-16">
          <div className="flex items-center">
            <Link href="/" className="group flex items-center">
              <TikemWordmark
                className="text-[28px] text-white sm:text-[30px] transition-opacity duration-200 group-hover:opacity-80"
              />
            </Link>
            <div className="hidden md:ml-8 md:flex md:space-x-2 lg:space-x-4">
              <Link
                href="/discover"
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  pathname === '/' || pathname === '/discover'
                    ? 'text-white'
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t('nav.home')}
              </Link>
              <Link
                href="/resources"
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  pathname?.startsWith('/resources') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t('nav.resources', { defaultValue: 'Guides' })}
              </Link>
              {/* Churn guard: composing an event never requires an account
                  up front, guests build the whole thing at /create and only
                  meet sign-up at publish. Organizers go straight in. */}
              <Link
                href={user?.role === 'organizer' ? '/organizer/events/new' : '/create'}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  pathname?.startsWith('/create') || pathname?.startsWith('/organizer/events/new')
                    ? 'text-white'
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t('nav.createEvent', { defaultValue: 'Create event' })}
              </Link>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {user ? (
              <>
                {/* Notification Bell */}
                <NotificationBell userId={user.id} />

                {/* Account dropdown (desktop) */}
                <div className="relative hidden sm:block" ref={accountMenuRef}>
                  <button
                    type="button"
                    onClick={() => setAccountMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    aria-label={user.full_name}
                    className="flex items-center gap-2 text-sm text-white/80 hover:text-white transition-colors duration-200"
                  >
                    <div className="w-8 h-8 bg-white/[0.08] rounded-full flex items-center justify-center text-white font-semibold text-xs">
                      {user.full_name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <span className="font-medium">{user.full_name}</span>
                    <svg
                      className={`w-4 h-4 transition-transform duration-200 ${accountMenuOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {accountMenuOpen && (
                    <div
                      role="menu"
                      aria-label={user.full_name}
                      className="absolute right-0 mt-2 w-56 rounded-lg border border-white/10 bg-[#111] py-1 shadow-xl"
                    >
                      <Link
                        href="/tickets"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className={accountMenuItemClass}
                      >
                        {t('nav.myTickets')}
                      </Link>
                      <Link
                        href="/favorites"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className={accountMenuItemClass}
                      >
                        {t('nav.favorites')}
                      </Link>
                      <Link
                        href="/connections"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className={accountMenuItemClass}
                      >
                        {t('nav.friends', { defaultValue: 'Friends' })}
                      </Link>
                      {isHost ? (
                        <Link
                          href="/organizer"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                          className={accountMenuItemClass}
                        >
                          {t('nav.organizer')}
                        </Link>
                      ) : (
                        <Link
                          href="/organizer"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                          className={accountMenuItemClass}
                        >
                          {t('nav.becomeHost', { defaultValue: 'Become a host' })}
                        </Link>
                      )}
                      {isPromoter && (
                        <Link
                          href="/promoter"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                          className={accountMenuItemClass}
                        >
                          {t('nav.promoterPortal', { defaultValue: 'Promoter portal' })}
                        </Link>
                      )}
                      {isAdmin && (
                        <Link
                          href="/admin"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                          className={accountMenuItemClass}
                        >
                          {t('nav.admin')}
                        </Link>
                      )}
                      <div className="my-1 border-t border-white/10" />
                      <Link
                        href="/profile"
                        role="menuitem"
                        onClick={() => setAccountMenuOpen(false)}
                        className={accountMenuItemClass}
                      >
                        {t('nav.profile')}
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          handleSignOut()
                        }}
                        className={accountMenuItemClass}
                      >
                        {t('nav.signOut')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Quiet buttons (posh calibration, 2026-08-28): sign-in is bare
                    text, the ONE white pill is the only chrome in the navbar.
                    Regular weights and small type read premium; teal never fills. */}
                <Link
                  href={`/auth/login?redirect=${encodeURIComponent(redirectTarget)}`}
                  className="hidden sm:inline-flex items-center px-3 py-2 text-[13px] font-normal text-white/70 transition-colors duration-200 hover:text-white"
                >
                  {t('nav.signIn')}
                </Link>
                <Link
                  href={`/auth/signup?redirect=${encodeURIComponent(redirectTarget)}`}
                  className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-[13px] font-medium text-black transition-colors duration-200 hover:bg-white/90"
                >
                  {t('auth:signup.submit')}
                </Link>
              </>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-white/80 hover:bg-white/10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-white/10">
            <div className="space-y-1">
              <Link
                href="/discover"
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                  pathname === '/' || pathname === '/discover'
                    ? 'text-white'
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t('nav.home')}
              </Link>
              <Link
                href="/resources"
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                  pathname?.startsWith('/resources') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t('nav.resources', { defaultValue: 'Guides' })}
              </Link>
              <Link
                href={user?.role === 'organizer' ? '/organizer/events/new' : '/create'}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                  pathname?.startsWith('/create') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t('nav.createEvent', { defaultValue: 'Create event' })}
              </Link>
              {user && (
                <>
                  <Link
                    href="/tickets"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname?.startsWith('/tickets') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {t('nav.myTickets')}
                  </Link>
                  <Link
                    href="/favorites"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname === '/favorites' ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {t('nav.favorites')}
                  </Link>
                  <Link
                    href="/connections"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname?.startsWith('/connections') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {t('nav.friends', { defaultValue: 'Friends' })}
                  </Link>
                  {isHost ? (
                    <Link
                      href="/organizer"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname?.startsWith('/organizer') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {t('nav.organizer')}
                    </Link>
                  ) : (
                    <Link
                      href="/organizer"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname?.startsWith('/organizer') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {t('nav.becomeHost', { defaultValue: 'Become a host' })}
                    </Link>
                  )}
                  {isPromoter && (
                    <Link
                      href="/promoter"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname?.startsWith('/promoter') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {t('nav.promoterPortal', { defaultValue: 'Promoter portal' })}
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      href="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname?.startsWith('/admin') ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {t('nav.admin')}
                    </Link>
                  )}
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname === '/profile' ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {t('nav.profile')}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false)
                      handleSignOut()
                    }}
                    className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    {t('nav.signOut')}
                  </button>
                </>
              )}
              {!user && (
                <>
                  <Link
                    href={`/auth/login?redirect=${encodeURIComponent(redirectTarget)}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    {t('nav.signIn')}
                  </Link>
                  <Link
                    href={`/auth/signup?redirect=${encodeURIComponent(redirectTarget)}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    {t('auth:signup.submit')}
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
