'use client'

import { useTranslation } from 'react-i18next'

export function AdminAccessDenied({ userEmail }: { userEmail?: string | null }) {
  const { t } = useTranslation('admin')

  return (
    <div className="flex min-h-screen items-center justify-center bg-console-ground">
      <div className="w-full max-w-md rounded-lg bg-console-panel p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded">
          <svg className="h-8 w-8 text-console-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="label-mono mb-2 text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">
          {t('dashboard.access_denied')}
        </h1>
        <p className="mb-4 text-console-mut">
          {t('dashboard.no_admin_privileges')}
        </p>
        <div className="mb-6 rounded bg-console-ground p-4">
          <p className="text-sm text-console-mut">
            <strong className="text-console-text">{t('dashboard.your_email')}</strong> {userEmail}
          </p>
          <p className="mt-2 text-xs text-console-faint">
            {t('dashboard.contact_admin')}
          </p>
        </div>
        <a
          href="/"
          className="inline-block rounded bg-console-text px-6 py-2 text-[13px] font-bold text-console-ground transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
        >
          {t('dashboard.return_home')}
        </a>
      </div>
    </div>
  )
}
