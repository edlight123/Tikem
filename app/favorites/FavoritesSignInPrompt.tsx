'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'

export default function FavoritesSignInPrompt() {
  const { t } = useTranslation('favorites')

  return (
    <div className="flex items-center justify-center py-16">
      <div className="text-center">
        <h2 className="font-display lowercase !text-[26px] !leading-tight text-white mb-5">
          {t('sign_in.title')}
        </h2>
        <Link
          href="/auth/login?redirect=/favorites"
          className="inline-flex items-center rounded bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
        >
          {t('sign_in.action')}
        </Link>
      </div>
    </div>
  )
}
