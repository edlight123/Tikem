'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User, Shield, Bell, Lock, Trash2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { EditorialHeader, EditorialSectionHeading } from '@/components/ui/EditorialHeader'
import { StatusChip } from '@/components/ui/kit'
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog'

interface SettingsPageClientProps {
  user: {
    id: string
    full_name: string
    email: string
    phone_number?: string
    is_verified: boolean
    role: string
  }
}

/**
 * /settings, brought onto the house surface ladder.
 *
 * What it was: four cards of `bg-white/[0.03] rounded-2xl shadow-soft border
 * border-white/10`, and inside them every read-only field was the SAME 3% fill
 * with its own hairline. On the #0a0a0a page a 3% white fill is very nearly the
 * page colour, so the only thing that read was the outlines — and a 0.03 field
 * inside a 0.03 card is invisible twice over. Cards now carry the fill alone;
 * anything sitting ON a card steps UP the ladder to the inset tone. Same
 * correction already shipped on /profile (components/profile/ui.tsx), which is
 * this page's sibling. `shadow-soft` went with the borders: rgba(0,0,0,0.08) is
 * a black shadow on a black page.
 *
 * Also: the section headings are the shared serif `EditorialSectionHeading`
 * rather than hand-rolled bold sans h2s, and verification/role are read out as
 * dot + label `StatusChip`s instead of filled Badge pills — a filled pill for
 * a state you cannot act on reads as a button.
 */

/** A read-only value display. An inset on a card, so it steps up the ladder. */
const READONLY_FIELD = 'rounded-xl bg-white/[0.055] px-4 py-3'

export default function SettingsPageClient({ user }: SettingsPageClientProps) {
  const { t } = useTranslation('settings')
  const [showDelete, setShowDelete] = useState(false)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Back Button */}
      <Link
        href="/profile"
        className="inline-flex items-center gap-2 text-white/65 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="font-medium">{t('back_to_profile')}</span>
      </Link>

      {/* Header */}
      <EditorialHeader tone="dark" title={t('title')} subtitle={t('subtitle')} className="mb-8" />

      {/* Settings Sections */}
      <div className="space-y-6">

        {/* Personal Information */}
        <div className="rounded-2xl bg-white/[0.03] p-6">
          <div className="flex items-start gap-3 mb-6">
            <User className="mt-1 h-5 w-5 shrink-0 text-brand-300" />
            <EditorialSectionHeading
              className="min-w-0 flex-1"
              title={t('personal_info.title')}
              description={t('personal_info.subtitle')}
            />
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-white/70 mb-2">{t('personal_info.full_name')}</label>
                <div className={READONLY_FIELD}>
                  <p className="text-white font-medium">{user.full_name}</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-white/70 mb-2">{t('personal_info.email')}</label>
                <div className={`${READONLY_FIELD} break-words`}>
                  <p className="text-white font-medium">{user.email}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-white/70 mb-2">{t('personal_info.phone')}</label>
              <div className={READONLY_FIELD}>
                <p className="text-white font-medium">{user.phone_number || t('personal_info.not_provided')}</p>
              </div>
            </div>

            <div className="pt-4">
              <p className="text-sm text-white/65 bg-white/[0.055] rounded-xl p-4">
                <strong className="text-white">{t('personal_info.note')}:</strong> {t('personal_info.note_text')}
              </p>
            </div>
          </div>
        </div>

        {/* Account Security */}
        <div className="rounded-2xl bg-white/[0.03] p-6">
          <div className="flex items-start gap-3 mb-6">
            <Shield className="mt-1 h-5 w-5 shrink-0 text-brand-300" />
            <EditorialSectionHeading
              className="min-w-0 flex-1"
              title={t('security.title')}
              description={t('security.subtitle')}
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-white/70 mb-2">{t('security.verification_status')}</label>
              <div className="flex flex-wrap items-center gap-3">
                {user.is_verified ? (
                  <StatusChip tone="success" icon={Shield} className="text-sm">
                    {t('security.verified')}
                  </StatusChip>
                ) : (
                  <>
                    <StatusChip tone="warning" className="text-sm">
                      {t('security.not_verified')}
                    </StatusChip>
                    {user.role === 'organizer' && (
                      // The one primary action on this page, so it is the white
                      // pill from the ladder — teal is semantic here, not a
                      // button surface.
                      <Link
                        href="/organizer/verify"
                        className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-white/90"
                      >
                        {t('security.get_verified')}
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-white/70 mb-2">{t('security.role')}</label>
              <StatusChip tone={user.role === 'organizer' ? 'brand' : 'neutral'} className="text-sm">
                {user.role === 'organizer' ? t('security.event_organizer') : t('security.event_attendee')}
              </StatusChip>
            </div>

            {/* Kept: a rule BETWEEN two blocks of one card is the legitimate
                border — it separates, it does not draw a box. */}
            <div className="pt-4 border-t border-white/10">
              <Link
                href="/api/auth/logout"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl hover:bg-red-500/10 text-red-400 font-medium transition-colors"
              >
                <Lock className="w-4 h-4" />
                {t('security.change_password')}
              </Link>
            </div>
          </div>
        </div>

        {/* Notification Preferences */}
        <div className="rounded-2xl bg-white/[0.03] p-6">
          <div className="flex items-start gap-3 mb-6">
            <Bell className="mt-1 h-5 w-5 shrink-0 text-brand-300" />
            <EditorialSectionHeading
              className="min-w-0 flex-1"
              title={t('notifications.title')}
              description={t('notifications.subtitle')}
            />
          </div>

          <div className="space-y-4">
            {/* A row sitting ON the card: inset fill, and a hover that is
                actually a step (0.03 → 0.04 was not one). */}
            <Link
              href="/settings/notifications"
              className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white/[0.055] hover:bg-white/[0.12] transition-colors"
            >
              <div className="min-w-0">
                <p className="font-semibold text-white">{t('notifications.preferences')}</p>
                <p className="text-sm text-white/65">{t('notifications.preferences_desc')}</p>
              </div>
              <svg className="w-5 h-5 shrink-0 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-2xl bg-white/[0.03] p-6">
          <div className="flex items-start gap-3 mb-6">
            <Trash2 className="mt-1 h-5 w-5 shrink-0 text-red-400" />
            <EditorialSectionHeading
              className="min-w-0 flex-1"
              title={t('danger.title')}
              description={t('danger.subtitle')}
            />
          </div>

          <div className="space-y-4">
            {/* Was an empty box outlined in red. The warning is carried by a red
                FILL instead, so it reads at a glance. */}
            <div className="rounded-xl bg-red-500/[0.08] p-4">
              <p className="font-semibold text-red-300 mb-2">{t('danger.delete_account')}</p>
              <p className="text-sm text-red-300 mb-4">
                {t('danger.delete_warning')}
              </p>
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="px-4 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-200 font-semibold transition-colors"
              >
                {t('danger.delete_button')}
              </button>
              <p className="mt-3 text-xs text-white/45">
                <Link href="/account/delete" className="underline underline-offset-2 hover:text-white/70">
                  {t('danger.what_is_deleted')}
                </Link>
              </p>
              <DeleteAccountDialog open={showDelete} onClose={() => setShowDelete(false)} />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
