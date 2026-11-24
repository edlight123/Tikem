'use client'

import { defaultAvatarUrl } from '@/lib/defaultAvatar'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Bell, ChevronDown, Plus, Search, User as UserIcon, X } from 'lucide-react'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { isDemoMode, isDemoEmail } from '@/lib/demo'
import { demoLogout } from '@/app/auth/actions'
import LocationMenu, { type NavLocation } from '@/components/home/LocationMenu'

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
        className="relative p-2 rounded-lg text-fg-muted hover:bg-surface-low transition-colors"
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
    photo_url?: string | null
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
  /**
   * The place being browsed (homepage only). It becomes the second half of the
   * search bar, and a small chip on phones, in place of the old city row.
   */
  location?: NavLocation
}

export default function Navbar({ user, isAdmin = false, flush = false, solid = false, location }: NavbarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useTranslation('common')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  // A team member of someone's org (lib/organizer/context) is a host too, even
  // when their own account is an attendee: probed once per browser session.
  const [onATeam, setOnATeam] = useState(false)
  useEffect(() => {
    if (!user || user.role === 'organizer' || user.role === 'staff') return
    const key = `tikem_on_team_${user.id}`
    try {
      const cached = sessionStorage.getItem(key)
      if (cached !== null) {
        setOnATeam(cached === '1')
        return
      }
    } catch {
      // Storage unavailable: fall through to the probe.
    }
    let cancelled = false
    fetch('/api/organizer/orgs')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const has = Array.isArray(d?.memberships) && d.memberships.some((m: any) => m.role === 'admin' || m.role === 'manager')
        if (!cancelled) setOnATeam(has)
        try {
          sessionStorage.setItem(key, has ? '1' : '0')
        } catch {}
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id, user?.role])

  const isHost = user?.role === 'organizer' || user?.role === 'staff' || onATeam

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

  // The mobile menu closes on Escape and on navigation.
  useEffect(() => {
    if (!mobileMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileMenuOpen])
  useEffect(() => {
    setMobileMenuOpen(false)
    setAccountMenuOpen(false)
  }, [pathname])

  // Churn guard: composing an event never requires an account up front;
  // guests build the whole thing at /create and only meet sign-up at publish.
  // Organizers go straight in.
  const createHref = user?.role === 'organizer' || onATeam ? '/organizer/events/new' : '/create'
  // Discover has its own search bar right under the nav: one search per page.
  const showSearch = !pathname?.startsWith('/discover')
  const loginHref = `/auth/login?redirect=${encodeURIComponent(redirectTarget)}`
  const signupHref = `/auth/signup?redirect=${encodeURIComponent(redirectTarget)}`

  const accountMenuItemClass =
    'block w-full text-left px-4 py-2 text-meta text-fg-muted hover:bg-surface hover:text-fg transition-colors duration-200'
  const topLinkClass = (active: boolean) =>
    `hidden h-10 items-center rounded px-2.5 text-meta font-medium transition-colors duration-200 md:inline-flex ${
      active ? 'text-fg' : 'text-fg-muted hover:text-fg'
    }`
  const mobileItemClass = (active: boolean) =>
    `flex h-11 items-center rounded px-3 text-body font-medium transition-colors ${
      active ? 'text-fg' : 'text-fg-muted hover:bg-surface hover:text-fg'
    }`
  const close = () => setMobileMenuOpen(false)

  return (
    <nav
      aria-label={t('nav.primary', { defaultValue: 'Main' })}
      // A fill, no hairline under the bar (fill-not-hairline rule). `flush`
      // is still accepted from older call sites; there is no rule to drop.
      data-flush={flush || undefined}
      className={`sticky top-0 z-50 ${solid ? 'bg-black' : 'bg-canvas/90 backdrop-blur-xl'}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-3 sm:h-16">
          <Link href="/" className="group flex flex-none items-center" aria-label="Tikèm">
            <TikemWordmark className="text-headline text-fg transition-opacity duration-200 group-hover:opacity-80" />
          </Link>

          {/* One search for events, organizers and venues, opening Discover.
              Focus lights up the whole bar instead of boxing the text field. */}
          {showSearch ? (
            <form
              action="/discover"
              role="search"
              className={`mx-2 hidden h-10 max-w-xl min-w-0 flex-1 items-center gap-2 rounded bg-surface pl-3 ${location ? 'pr-0' : 'pr-3'} transition-colors duration-150 focus-within:bg-surface-raised focus-within:ring-1 focus-within:ring-line-strong hover:bg-surface-raised md:flex lg:mx-8`}
            >
              <Search aria-hidden className="h-4 w-4 flex-none text-fg-subtle" />
              {/* The hint is drawn, not a placeholder, so a narrow bar (tablets,
                  or beside the place menu) says "Search" instead of a cut-off
                  sentence. */}
              <div className="relative flex h-10 min-w-0 flex-1 items-center">
                <input
                  type="search"
                  name="search"
                  aria-label={t('nav.searchPlaceholder', { defaultValue: 'Search events, organizers, venues' })}
                  placeholder=" "
                  className="nav-search peer h-10 w-full min-w-0 bg-transparent text-meta text-fg outline-none focus-visible:!outline-none"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center truncate text-meta text-fg-subtle peer-placeholder-shown:flex"
                >
                  <span className={`truncate ${location ? 'xl:hidden' : 'lg:hidden'}`}>{t('nav.searchShort', { defaultValue: 'Search' })}</span>
                  <span className={`hidden truncate ${location ? 'xl:inline' : 'lg:inline'}`}>
                    {t('nav.searchPlaceholder', { defaultValue: 'Search events, organizers, venues' })}
                  </span>
                </span>
              </div>
              {location && (
                <>
                  <span aria-hidden className="h-5 w-px flex-none bg-surface-high" />
                  <LocationMenu location={location} inline />
                </>
              )}
            </form>
          ) : (
            <div className="hidden flex-1 md:block" />
          )}

          <div className="flex flex-none items-center gap-1 sm:gap-2">
            <Link href="/discover" className={topLinkClass(pathname === '/discover')}>
              {t('nav.home')}
            </Link>
            <Link href="/resources" className={topLinkClass(!!pathname?.startsWith('/resources'))}>
              {t('nav.resources', { defaultValue: 'Guides' })}
            </Link>

            {/* The one solid button in the bar. */}
            <Link
              href={createHref}
              className="ml-1 hidden h-10 items-center rounded bg-inverse px-4 text-meta font-medium text-on-inverse transition-colors duration-200 hover:bg-inverse-hover md:inline-flex"
            >
              {t('nav.createEvent', { defaultValue: 'Create event' })}
            </Link>

            {location && (
              <div className="md:hidden">
                <LocationMenu location={location} />
              </div>
            )}

            {/* Phones: add an event from the top bar, a small white tile. */}
            <Link
              href={createHref}
              aria-label={t('nav.addEvent', { defaultValue: 'Add an event' })}
              className="grid h-11 w-11 place-items-center md:hidden"
            >
              <span className="grid h-8 w-8 place-items-center rounded bg-inverse text-on-inverse">
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
              </span>
            </Link>

            {user ? (
              <>
                <NotificationBell userId={user.id} />

                {/* Account dropdown (desktop) */}
                <div className="relative hidden md:block" ref={accountMenuRef}>
                  <button
                    type="button"
                    onClick={() => setAccountMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    aria-label={user.full_name}
                    className="flex h-10 items-center gap-2 rounded pl-1 pr-2 text-meta text-fg-soft transition-colors duration-200 hover:bg-surface hover:text-fg"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={user.photo_url || defaultAvatarUrl(user.id)}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover bg-surface-raised"
                    />
                    <span className="hidden max-w-[10rem] truncate font-medium xl:inline">{user.full_name}</span>
                    <ChevronDown
                      aria-hidden
                      className={`h-4 w-4 text-fg-subtle transition-transform duration-200 ${accountMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {accountMenuOpen && (
                    <div
                      role="menu"
                      aria-label={user.full_name}
                      className="absolute right-0 mt-2 w-56 rounded bg-surface-raised-solid py-1 shadow-xl"
                    >
                      <Link href="/tickets" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
                        {t('nav.myTickets')}
                      </Link>
                      <Link href="/favorites" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
                        {t('nav.favorites')}
                      </Link>
                      <Link href="/connections" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
                        {t('nav.friends', { defaultValue: 'Friends' })}
                      </Link>
                      <Link href="/organizer" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
                        {isHost ? t('nav.organizer') : t('nav.becomeHost', { defaultValue: 'Become a host' })}
                      </Link>
                      {isPromoter && (
                        <Link href="/promoter" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
                          {t('nav.promoterPortal', { defaultValue: 'Promoter portal' })}
                        </Link>
                      )}
                      {isAdmin && (
                        <Link href="/admin" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
                          {t('nav.admin')}
                        </Link>
                      )}
                      <div aria-hidden className="mx-4 my-1 h-px bg-surface-high" />
                      <Link href="/profile" role="menuitem" onClick={() => setAccountMenuOpen(false)} className={accountMenuItemClass}>
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
              // Signing in is a quiet link: "Create event" is the only fill.
              <Link
                href={loginHref}
                className="hidden h-10 items-center rounded px-3 text-meta font-medium text-fg-soft transition-colors duration-200 hover:bg-surface hover:text-fg md:inline-flex"
              >
                {t('nav.signIn')}
              </Link>
            )}

            {/* Phones: the menu opens from your avatar (or a person glyph). */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-controls="site-mobile-menu"
              aria-label={t('nav.menu', { defaultValue: 'Menu' })}
              className="-mr-1.5 grid h-11 w-11 place-items-center md:hidden"
            >
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-surface-raised text-fg-soft">
                {user ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.photo_url || defaultAvatarUrl(user.id)} alt="" className="h-full w-full object-cover" />
                ) : mobileMenuOpen ? (
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                ) : (
                  <UserIcon className="h-4 w-4" strokeWidth={2} aria-hidden />
                )}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile menu: one filled panel, no rules. */}
        {mobileMenuOpen && (
          <div id="site-mobile-menu" className="md:hidden mb-3 rounded bg-surface-solid p-2">
            <form action="/discover" role="search" className="mb-2 flex h-11 items-center gap-2 rounded bg-surface-raised px-3">
              <Search aria-hidden className="h-4 w-4 flex-none text-fg-subtle" />
              <input
                type="search"
                name="search"
                aria-label={t('nav.searchPlaceholder', { defaultValue: 'Search events, organizers, venues' })}
                placeholder={t('nav.searchPlaceholder', { defaultValue: 'Search events, organizers, venues' })}
                className="nav-search h-11 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
              />
            </form>
            <Link href="/discover" onClick={close} className={mobileItemClass(pathname === '/' || pathname === '/discover')}>
              {t('nav.home')}
            </Link>
            <Link href="/resources" onClick={close} className={mobileItemClass(!!pathname?.startsWith('/resources'))}>
              {t('nav.resources', { defaultValue: 'Guides' })}
            </Link>
            <Link href={createHref} onClick={close} className={mobileItemClass(!!pathname?.startsWith('/create'))}>
              {t('nav.createEvent', { defaultValue: 'Create event' })}
            </Link>
            {user ? (
              <>
                <div aria-hidden className="mx-3 my-1.5 h-px bg-surface-high" />
                <Link href="/tickets" onClick={close} className={mobileItemClass(!!pathname?.startsWith('/tickets'))}>
                  {t('nav.myTickets')}
                </Link>
                <Link href="/favorites" onClick={close} className={mobileItemClass(pathname === '/favorites')}>
                  {t('nav.favorites')}
                </Link>
                <Link href="/connections" onClick={close} className={mobileItemClass(!!pathname?.startsWith('/connections'))}>
                  {t('nav.friends', { defaultValue: 'Friends' })}
                </Link>
                <Link href="/organizer" onClick={close} className={mobileItemClass(!!pathname?.startsWith('/organizer'))}>
                  {isHost ? t('nav.organizer') : t('nav.becomeHost', { defaultValue: 'Become a host' })}
                </Link>
                {isPromoter && (
                  <Link href="/promoter" onClick={close} className={mobileItemClass(!!pathname?.startsWith('/promoter'))}>
                    {t('nav.promoterPortal', { defaultValue: 'Promoter portal' })}
                  </Link>
                )}
                {isAdmin && (
                  <Link href="/admin" onClick={close} className={mobileItemClass(!!pathname?.startsWith('/admin'))}>
                    {t('nav.admin')}
                  </Link>
                )}
                <Link href="/profile" onClick={close} className={mobileItemClass(pathname === '/profile')}>
                  {t('nav.profile')}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    handleSignOut()
                  }}
                  className={`w-full text-left ${mobileItemClass(false)}`}
                >
                  {t('nav.signOut')}
                </button>
              </>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link
                  href={loginHref}
                  onClick={close}
                  className="inline-flex h-10 items-center justify-center rounded bg-surface-raised text-meta font-medium text-fg"
                >
                  {t('nav.signIn')}
                </Link>
                <Link
                  href={signupHref}
                  onClick={close}
                  className="inline-flex h-10 items-center justify-center rounded bg-inverse text-meta font-medium text-on-inverse"
                >
                  {t('auth:signup.submit')}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
