'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { type UserProfile } from '@/lib/firestore/user-profile'
import { EditorialHeader } from '@/components/ui/EditorialHeader'
import { ProfileHeaderCard } from '@/components/profile/ProfileHeaderCard'
import { SocialLinksCard } from '@/components/profile/SocialLinksCard'
import { PrivacyCard } from '@/components/profile/PrivacyCard'
import { PreferencesCard } from '@/components/profile/PreferencesCard'
import { NotificationsCard } from '@/components/profile/NotificationsCard'
import { AccountCard } from '@/components/profile/AccountCard'
import { InviteSummaryCard } from '@/components/profile/InviteSummaryCard'

interface ProfileClientProps {
  initialProfile: UserProfile
  userId: string
  isVerifiedOrganizer: boolean
}

/**
 * The signed-in reader's own profile.
 *
 * Structure before: a bold-sans h1 and six identical bordered cards, each with
 * its own bold-sans h2 and (sometimes) a coloured icon tile, stacked
 * `space-y-3`. Six equal boxes in a column, so nothing led and nothing
 * followed; the reader's own name was buried inside box one, at the same weight
 * as "Promotions & News".
 *
 * Structure now: the shared editorial page header, then IDENTITY (who you are —
 * no heading needed, the page title says it), then five titled sections in the
 * serif lowercase voice. Each section is one filled panel with hairline-divided
 * rows, matching the organizer settings hub, so the reader scans five names
 * before scanning any control.
 *
 * `space-y-9`, not `space-y-8`: `.mobile-typography` rewrites space-y-8/6/4 to
 * much tighter values under 640px, which would have crushed the section rhythm
 * on the phone this page is reviewed on.
 */
export default function ProfileClient({ initialProfile, userId, isVerifiedOrganizer }: ProfileClientProps) {
  const router = useRouter()
  const { t } = useTranslation('profile')
  const [profile, setProfile] = useState<UserProfile>(initialProfile)

  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    try {
      // Optimistic update
      const previousProfile = profile
      setProfile(prev => ({ ...prev, ...updates }))

      // Update via API route (uses admin SDK)
      const response = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      if (!response.ok) {
        throw new Error('Failed to update profile')
      }

      // Refresh the page to update navbar
      router.refresh()

      console.log('Profile updated successfully')
    } catch (error) {
      console.error('Failed to update profile:', error)
      // Revert optimistic update on error
      router.refresh()
      throw error
    }
  }

  return (
    <>
      {/* The shared editorial page header — same primitive /tickets, /favorites
          and /notifications render, so the four consumer pages open the same way.
          The old header here was a hand-rolled bold-sans h1. */}
      <EditorialHeader
        tone="dark"
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          isVerifiedOrganizer ? (
            <a
              href="/organizer/settings"
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:px-4"
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t('organizer_settings')}</span>
              <span className="sm:hidden">{t('common:nav.settings')}</span>
            </a>
          ) : undefined
        }
      />

      <div className="mt-7 space-y-9 sm:mt-9 sm:space-y-12">
        {/* Identity — the one section with no heading, because the page title is it. */}
        <ProfileHeaderCard profile={profile} onUpdate={handleUpdateProfile} />

        <InviteSummaryCard />

        <SocialLinksCard profile={profile} onUpdate={handleUpdateProfile} />

        <PrivacyCard profile={profile} onUpdate={handleUpdateProfile} />

        <PreferencesCard profile={profile} onUpdate={handleUpdateProfile} />

        <NotificationsCard profile={profile} onUpdate={handleUpdateProfile} />

        <AccountCard />
      </div>
    </>
  )
}
