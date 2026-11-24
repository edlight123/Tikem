'use client'

// The event page's small occasion link ("Kanaval ›" in the eyebrow line), shown
// when the event is tagged for one (lib/occasions). Nothing for an unknown key.

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { occasionByKey, occasionName, parseOccasion } from '@/lib/occasions'
import OccasionIcon from '@/components/occasions/OccasionIcon'

export default function OccasionTag({ occasion, className = '' }: { occasion: unknown; className?: string }) {
  const { t, i18n } = useTranslation('common')
  const key = parseOccasion(occasion)
  if (!key) return null
  const name = occasionName(key, i18n.language)
  return (
    <Link
      href={`/occasions/${key}`}
      aria-label={t('occasions.part_of', { name, defaultValue: 'Part of {{name}}' })}
      className={`inline-flex items-center gap-1.5 rounded text-fg-muted underline-offset-4 outline-none transition-colors hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-fg/70 ${className}`}
    >
      <OccasionIcon name={occasionByKey(key)!.icon} className="h-3.5 w-3.5" />
      {name}
    </Link>
  )
}
