'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bell, Briefcase, Heart, Lock, MessageCircle, Settings, SlidersHorizontal, Ticket, UserCheck, UserPen, Users } from 'lucide-react'
import { type UserProfile } from '@/lib/firestore/user-profile'
import type { ProfileDashboardData } from '@/lib/profile/dashboard-server'
import { ProfileIdentity } from '@/components/profile/ProfileIdentity'
import { AccountDetailsCard } from '@/components/profile/AccountDetailsCard'
import { SocialLinksCard } from '@/components/profile/SocialLinksCard'
import { PrivacyCard } from '@/components/profile/PrivacyCard'
import { PreferencesCard } from '@/components/profile/PreferencesCard'
import { NotificationsCard } from '@/components/profile/NotificationsCard'
import { AccountCard } from '@/components/profile/AccountCard'
import { AttendanceDefaultBanner } from '@/components/profile/AttendanceDefaultBanner'
import { InviteSummaryCard } from '@/components/profile/InviteSummaryCard'
import { FollowingCard } from '@/components/profile/FollowingCard'
import { MessagesCard } from '@/components/profile/MessagesCard'
import {
  FindFriendsCard,
  OrganizationCard,
  PostersSection,
  RowList,
  ViewAsSection,
  useHelpRows,
  type SettingsRow,
} from '@/components/profile/DashboardModules'

interface ProfileClientProps {
  initialProfile: UserProfile
  userId: string
  isVerifiedOrganizer: boolean
  dashboard: ProfileDashboardData
  /** Role is organizer/admin: the organization card (and its logo upload) applies. */
  showOrganization: boolean
  /** Mobile's canUseOrganizerMode: role organizer/admin, or verification approved. */
  canOrganize: boolean
}

/** The settings panels a row opens. The hash is the address: /profile#privacy. */
const PANELS = ['edit', 'messages', 'privacy', 'preferences', 'notifications', 'following'] as const
type PanelId = (typeof PANELS)[number]

function panelFromHash(): PanelId | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash.replace(/^#/, '')
  return (PANELS as readonly string[]).includes(h) ? (h as PanelId) : null
}

/**
 * The signed-in reader's own profile, as a dashboard (owner, 2026-10-22: "more
 * of a dashboard like the mobile"). It follows the mobile ProfileScreen top to
 * bottom: identity + stats, organization, find your people, invites, the
 * poster wall, view as, settings rows, help, then sign out / delete.
 *
 * Layout. Phone: one column in exactly that order. Desktop (lg): the identity
 * band runs across the top with the stats on its right, then two columns: the
 * dashboard in the wide main column, and the settings, help and account rows
 * in a sticky side column.
 *
 * Settings are not stacked down the page any more. Each is a row that opens
 * its panel in the main column (desktop) or in place of the dashboard (phone),
 * addressed by hash so /profile#privacy (the attendance notice's link) and the
 * browser back button both work. Every card that used to be on the page is one
 * of those panels, unchanged.
 */
export default function ProfileClient({
  initialProfile,
  isVerifiedOrganizer,
  dashboard,
  showOrganization,
  canOrganize,
}: ProfileClientProps) {
  const router = useRouter()
  const { t } = useTranslation('profile')
  const [profile, setProfile] = useState<UserProfile>(initialProfile)
  const [panel, setPanel] = useState<PanelId | null>(null)
  // The Following numeral tracks unfollows made in the Following panel.
  const [followingCount, setFollowingCount] = useState(dashboard.stats.following)
  const mainRef = useRef<HTMLDivElement>(null)
  const helpRows = useHelpRows()

  // Follow the hash: first paint, back/forward, and links like /profile#privacy.
  useEffect(() => {
    const sync = () => setPanel(panelFromHash())
    sync()
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const scrollToMain = () => {
    requestAnimationFrame(() => mainRef.current?.scrollIntoView({ block: 'start' }))
  }

  const openPanel = useCallback((id: string) => {
    if (!(PANELS as readonly string[]).includes(id)) return
    if (window.location.hash !== `#${id}`) window.location.hash = id
    setPanel(id as PanelId)
    scrollToMain()
  }, [])

  const closePanel = useCallback(() => {
    // A new entry rather than history.back(): the panel may have been the
    // landing URL (from the attendance notice), with nothing to go back to.
    // ?thread= belongs to the Messages panel; leaving the panel drops it.
    const search = new URLSearchParams(window.location.search)
    search.delete('thread')
    const qs = search.toString()
    window.history.pushState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    setPanel(null)
    scrollToMain()
  }, [])

  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    try {
      // Optimistic update
      setProfile((prev) => ({ ...prev, ...updates }))

      // Update via API route (uses admin SDK)
      const response = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        throw new Error('Failed to update profile')
      }

      // Refresh so the navbar picks up a new name.
      router.refresh()
    } catch (error) {
      console.error('Failed to update profile:', error)
      // Revert optimistic update on error
      router.refresh()
      throw error
    }
  }

  const isOrganizerRole = showOrganization || isVerifiedOrganizer
  const settingsRows: SettingsRow[] = [
    { kind: 'panel', id: 'edit', icon: UserPen, label: t('dashboard.edit_profile'), description: t('dashboard.settings.edit_profile_desc') },
    { kind: 'panel', id: 'messages', icon: MessageCircle, label: t('dashboard.messages.title'), description: t('dashboard.settings.messages_desc') },
    { kind: 'panel', id: 'privacy', icon: Lock, label: t('dashboard.settings.privacy'), description: t('dashboard.settings.privacy_desc') },
    { kind: 'panel', id: 'preferences', icon: SlidersHorizontal, label: t('preferences.title'), description: t('dashboard.settings.preferences_desc') },
    { kind: 'panel', id: 'notifications', icon: Bell, label: t('notifications.title'), description: t('dashboard.settings.notifications_desc') },
    { kind: 'panel', id: 'following', icon: UserCheck, label: t('dashboard.following.title'), description: t('dashboard.settings.following_desc') },
    { kind: 'link', href: '/tickets', icon: Ticket, label: t('dashboard.settings.tickets') },
    { kind: 'link', href: '/favorites', icon: Heart, label: t('dashboard.settings.favorites') },
    { kind: 'link', href: '/connections', icon: Users, label: t('dashboard.settings.friends') },
    // Publish-first: anyone can create an event; organizers go straight in.
    {
      kind: 'link',
      href: isOrganizerRole ? '/organizer/events/new' : '/create',
      icon: Briefcase,
      label: t('dashboard.settings.create_event'),
    },
    ...(canOrganize
      ? [{ kind: 'link' as const, href: '/organizer/settings', icon: Settings, label: t('dashboard.settings.organizer_settings') }]
      : []),
  ]

  const panelContent: Record<PanelId, React.ReactNode> = {
    edit: (
      <div className="space-y-9 sm:space-y-12">
        <AccountDetailsCard profile={profile} onUpdate={handleUpdateProfile} />
        <SocialLinksCard profile={profile} onUpdate={handleUpdateProfile} />
      </div>
    ),
    privacy: <PrivacyCard profile={profile} onUpdate={handleUpdateProfile} />,
    preferences: <PreferencesCard profile={profile} onUpdate={handleUpdateProfile} />,
    notifications: <NotificationsCard profile={profile} onUpdate={handleUpdateProfile} />,
    messages: <MessagesCard />,
    following: <FollowingCard onCountChange={(d) => setFollowingCount((n) => Math.max(0, n + d))} />,
  }

  return (
    <>
      <ProfileIdentity
        profile={profile}
        stats={{ ...dashboard.stats, following: followingCount }}
        onEdit={() => openPanel('edit')}
        onOpenFollowing={() => openPanel('following')}
      />

      <AttendanceDefaultBanner
        className="mt-8"
        show={Boolean(initialProfile.attendanceVisibilityUnset && !initialProfile.attendanceDefaultNoticeSeenAt)}
      />

      {/* `space-y-9`, not `space-y-8`: `.mobile-typography` rewrites
          space-y-8/6/4 to much tighter values under 640px. */}
      <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 sm:mt-12 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div ref={mainRef} className="min-w-0 scroll-mt-24">
          {panel ? (
            <div>
              <button
                type="button"
                onClick={closePanel}
                className="mb-6 inline-flex items-center gap-2 rounded text-[13px] font-semibold text-white/60 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t('dashboard.settings.back')}
              </button>
              {/* Keyed so a panel's local state starts fresh from `profile`. */}
              <div key={panel}>{panelContent[panel]}</div>
            </div>
          ) : (
            <div className="space-y-9 sm:space-y-12">
              {showOrganization ? (
                <OrganizationCard name={dashboard.organization.name} logo={dashboard.organization.logo} />
              ) : null}
              <FindFriendsCard />
              <InviteSummaryCard />
              <PostersSection posters={dashboard.posters} total={dashboard.posterTotal} />
              <ViewAsSection canOrganize={canOrganize} canStaff={dashboard.hasStaffAssignments} />
            </div>
          )}
        </div>

        {/* The side column. On a phone it follows the dashboard (the mobile
            order) and steps aside while a panel is open; from lg it is a
            sticky rail that stays put, with the open panel's row marked. */}
        <aside className={`min-w-0 ${panel ? 'hidden lg:block' : ''}`}>
          <div className="space-y-9 sm:space-y-12 lg:sticky lg:top-24">
            <RowList title={t('dashboard.settings.title')} rows={settingsRows} activeId={panel} onOpen={openPanel} />
            <RowList title={t('dashboard.help.title')} rows={helpRows} />
            <AccountCard />
          </div>
        </aside>
      </div>
    </>
  )
}
