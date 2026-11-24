'use client'

// The composer's "Occasion" row (lib/occasions). Quiet by default: None, the
// occasion the start date falls in (marked with a dot), the one already
// chosen, and a "More" link that opens the full list. The value saved is an
// OccasionKey or null; firestore.rules accepts nothing else.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarHeart } from 'lucide-react'
import { OCCASION_KEYS, occasionByKey, occasionName, suggestOccasion, type OccasionKey } from '@/lib/occasions'
import OccasionIcon from '@/components/occasions/OccasionIcon'

export default function OccasionPicker({
  value,
  onChange,
  startDate,
  chipClassName,
}: {
  value: OccasionKey | null
  onChange: (next: OccasionKey | null) => void
  /** The event's start day (YYYY-MM-DD), for the suggestion. */
  startDate: string
  /** The composer's chip style, so the row matches Category. */
  chipClassName: (on: boolean) => string
}) {
  const { t, i18n } = useTranslation('common')
  const lang = (i18n.language || 'en').slice(0, 2)
  const [open, setOpen] = useState(false)
  const suggested = suggestOccasion(startDate || null)

  const shown: OccasionKey[] = open
    ? [...(suggested ? [suggested] : []), ...OCCASION_KEYS.filter((k) => k !== suggested)]
    : Array.from(new Set([suggested, value].filter((k): k is OccasionKey => !!k)))

  return (
    <div className="mt-3 rounded-xl bg-surface-low px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-meta font-medium text-fg-subtle">
        <CalendarHeart className="h-4 w-4" aria-hidden /> {t('occasions.label')}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('occasions.label')}>
        <button type="button" onClick={() => onChange(null)} className={chipClassName(value === null)} aria-pressed={value === null}>
          {t('occasions.none')}
        </button>
        {shown.map((k) => {
          const o = occasionByKey(k)!
          const on = value === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(on ? null : k)}
              className={`${chipClassName(on)} gap-1.5`}
              aria-pressed={on}
              aria-label={k === suggested ? `${occasionName(k, lang)}, ${t('occasions.suggested')}` : undefined}
            >
              <OccasionIcon name={o.icon} className="h-3.5 w-3.5" />
              {occasionName(k, lang)}
              {k === suggested && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="px-1 text-meta font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          aria-expanded={open}
        >
          {open ? t('occasions.less') : t('occasions.more')}
        </button>
      </div>
    </div>
  )
}
