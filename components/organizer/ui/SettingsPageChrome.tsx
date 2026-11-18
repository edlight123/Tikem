'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/organizer/ui'

/**
 * The back link and header shared by every organizer settings page.
 *
 * It exists to move that chrome across the server/client boundary. The settings
 * pages are SERVER components — they read auth cookies and query Firestore with
 * the Admin SDK — so they cannot call useTranslation, and their titles were the
 * last English text on otherwise translated screens. Rather than split six pages
 * into six server/client pairs, the shared chrome becomes one client component
 * and the pages pass keys to it.
 *
 * Titles are passed as KEYS, not strings: a server component may hand a client
 * component data, but it cannot hand it a translation it has no way to perform.
 */
export function SettingsPageChrome({
  titleKey,
  subtitleKey,
}: {
  /** Key under `settings_pages` in organizer.json, e.g. 'security_title'. */
  titleKey: string
  subtitleKey: string
}) {
  const { t } = useTranslation('organizer')

  return (
    <>
      <Link
        href="/organizer/settings"
        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('settings_pages.back_to_settings')}
      </Link>

      <PageHeader
        eyebrow={t('settings_pages.eyebrow')}
        title={t(`settings_pages.${titleKey}`)}
        subtitle={t(`settings_pages.${subtitleKey}`)}
      />
    </>
  )
}
