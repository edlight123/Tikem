'use client'

import { useTranslation } from 'react-i18next'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DollarSign, Settings } from 'lucide-react'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import { orgCan } from '@/lib/organizer/teamRoles'
import { useOrgRole } from './OrgRoleProvider'
import { OrgSwitcher, type SwitchableOrg } from './OrgSwitcher'

interface OrganizerTopNavProps {
  draftEvents?: number
  pendingPayouts?: number
  accountInitial?: string
  /** Orgs this account can act for (own + admin/manager seats). */
  orgs?: SwitchableOrg[]
  staleOrgCookie?: boolean
}

interface Tab {
  label: string
  href: string
  badge?: number
}

/**
 * The single top bar for the organizer portal (Posh-style): tikèm wordmark,
 * primary tabs, then finance / settings / account on the right. This replaces
 * the global site navbar inside /organizer so there's only one bar.
 */
export function OrganizerTopNav({
  draftEvents = 0,
  pendingPayouts = 0,
  accountInitial = 'U',
  orgs = [],
  staleOrgCookie = false,
}: OrganizerTopNavProps) {
  const { t } = useTranslation('organizer')

  const pathname = usePathname()

  // Role-aware: finance shows for the owner and for admins the owner granted
  // read-only finances (the page drops every money-out action for them); Team
  // and Settings are for owners and admins (lib/organizer/teamRoles.ts). The
  // pages redirect too.
  const org = useOrgRole()
  const role = org?.role ?? 'owner'
  const showFinance = org ? org.financeView : true
  const showTeam = orgCan(role, 'manage_team')
  const showSettings = orgCan(role, 'manage_settings')

  const tabs: Tab[] = [
    { label: 'Home', href: '/organizer' },
    { label: 'Events', href: '/organizer/events', badge: draftEvents },
    { label: 'Marketing', href: '/organizer/marketing' },
    { label: 'Orders', href: '/organizer/orders' },
    ...(showTeam ? [{ label: 'Team', href: '/organizer/team' }] : []),
  ]

  const isActive = (href: string) =>
    href === '/organizer' ? pathname === '/organizer' : pathname?.startsWith(href)

  const financeActive = pathname?.startsWith('/organizer/earnings') || pathname?.startsWith('/organizer/finance') || pathname?.startsWith('/organizer/payouts')
  const settingsActive = pathname?.startsWith('/organizer/settings')

  return (
    // data-site-chrome: hidden inside the app (app/globals.css), which frames the page itself.
    <div data-site-chrome className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-xl">
      {/* Phones: brand + icons on the first row, the tabs on their own full-width
          row underneath, so Marketing / Orders / Team are never pushed off
          screen behind the icons. sm and up: one row, as before. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 px-4 sm:h-14 sm:flex-nowrap sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="flex h-14 shrink-0 items-center pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
          <TikemWordmark italic className="text-2xl text-fg" />
        </Link>

        {/* Tabs */}
        <nav className="scrollbar-hide order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-0.5 overflow-x-auto px-2 [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:order-none sm:[mask-image:none] sm:mx-0 sm:w-auto sm:flex-1 sm:gap-1 sm:px-0" aria-label={t('actions.organizer')}>
          {tabs.map((tab) => {
            const active = isActive(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-2.5 text-sm sm:h-14 sm:px-3 font-semibold transition-colors ${
                  active ? 'text-fg' : 'text-fg-muted hover:text-fg-soft'
                }`}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-surface-high px-1.5 text-eyebrow font-bold text-fg">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                ) : null}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-brand-400" />}
              </Link>
            )
          })}
        </nav>

        {/* Right: finance, settings, account */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <OrgSwitcher orgs={orgs} staleOrgCookie={staleOrgCookie} />
          {showFinance && (
          <Link
            href="/organizer/finance"
            aria-label={t('actions.finance')}
            className={`relative grid h-9 w-9 place-items-center rounded-lg transition-colors ${
              financeActive ? 'bg-surface-high text-fg' : 'text-fg-muted hover:bg-surface-raised hover:text-fg'
            }`}
          >
            <DollarSign className="h-[18px] w-[18px]" />
            {pendingPayouts > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-inverse px-1 text-eyebrow font-bold text-on-inverse">
                {pendingPayouts > 9 ? '9+' : pendingPayouts}
              </span>
            )}
          </Link>
          )}
          {showSettings && (
          <Link
            href="/organizer/settings"
            aria-label={t('actions.settings')}
            className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
              settingsActive ? 'bg-surface-high text-fg' : 'text-fg-muted hover:bg-surface-raised hover:text-fg'
            }`}
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
          )}
          <Link
            href="/profile"
            aria-label={t('actions.account')}
            className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-surface-high text-sm font-bold text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {accountInitial}
          </Link>
        </div>
      </div>
    </div>
  )
}
