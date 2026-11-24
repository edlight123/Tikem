'use client'

/**
 * "Preview my page": the org page exactly as a visitor sees it, with a quiet
 * bar on top saying so and a way back. Owner tools are hidden underneath.
 */
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'

export default function PreviewBanner({ exitHref }: { exitHref: string }) {
  const { t } = useTranslation('profile')
  return (
    <div className="sticky top-14 z-30 bg-surface-solid">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="inline-flex min-w-0 items-center gap-2 text-meta text-fg-muted">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{t('org_page.preview_note')}</span>
        </span>
        <Link href={exitHref} className="shrink-0 text-meta font-semibold text-fg hover:text-fg-soft">
          {t('org_page.exit_preview')}
        </Link>
      </div>
    </div>
  )
}
