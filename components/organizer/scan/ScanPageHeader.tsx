'use client'

import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function ScanPageHeader() {
  const { t } = useTranslation('organizer')

  return (
    <>
      <h1 className="text-2xl md:text-4xl font-bold text-fg mb-2 flex items-center justify-center gap-2">
        {t('scan.title')}
        <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-brand-500" />
      </h1>
      <p className="text-meta md:text-lg text-fg-muted">
        {t('scan.subtitle')}
      </p>
    </>
  )
}
