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

  // Role-aware: money (finance) is the owner's alone; Team and Settings are
  // for owners and admins (lib/organizer/teamRoles.ts). The pages redirect too.
  const org = useOrgRole()
  const role = org?.role ?? 'owner'
  const showFinance = orgCan(role, 'owner_only')
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
    <div className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="shrink-0 pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
          <TikemWordmark italic className="text-2xl text-white" />
        </Link>

        {/* Tabs */}
        <nav className="scrollbar-hide flex flex-1 items-center gap-1 overflow-x-auto" aria-label={t('actions.organizer')}>
          {tabs.map((tab) => {
            const active = isActive(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex h-14 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-semibold transition-colors ${
                  active ? 'text-white' : 'text-white/55 hover:text-white/80'
                }`}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-white/[0.14] px-1.5 text-[11px] font-bold text-white">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                ) : null}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-brand-400" />}
              </Link>
            )
          })}
        </nav>

        {/* Right: finance, settings, account */}
        <div className="flex shrink-0 items-center gap-1">
          <OrgSwitcher orgs={orgs} staleOrgCookie={staleOrgCookie} />
          {showFinance && (
          <Link
            href="/organizer/finance"
            aria-label={t('actions.finance')}
            className={`relative grid h-9 w-9 place-items-center rounded-lg transition-colors ${
              financeActive ? 'bg-white/[0.12] text-white' : 'text-white/55 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            <DollarSign className="h-[18px] w-[18px]" />
            {pendingPayouts > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-white px-1 text-[10px] font-bold text-black">
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
              settingsActive ? 'bg-white/[0.12] text-white' : 'text-white/55 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
          )}
          <Link
            href="/profile"
            aria-label={t('actions.account')}
            className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-white/[0.12] text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {accountInitial}
          </Link>
        </div>
      </div>
    </div>
  )
}
