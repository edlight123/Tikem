'use client'

// Home's occasion row (lib/occasions homeOccasion): while an occasion is under
// way or starts within 30 days and has at least two tagged events, one quiet
// header (the dates, the occasion's name, "See all") over a poster rail.
// The server picks the occasion and its events; this only lays them out.

import { useTranslation } from 'react-i18next'
import { SectionHeader, EventRail } from '@/components/ui/EditorialRails'
import { occasionName, type OccasionKey } from '@/lib/occasions'
import { formatOccasionShort } from '@/lib/occasionFormat'

export interface HomeOccasionRow {
  key: OccasionKey
  mainStart: string
  mainEnd: string
  events: any[]
}

export default function OccasionRow({ row }: { row: HomeOccasionRow | null }) {
  const { t, i18n } = useTranslation('common')
  if (!row || row.events.length === 0) return null
  const lang = (i18n.language || 'en').slice(0, 2)
  return (
    <section>
      <SectionHeader
        eyebrow={formatOccasionShort(row.mainStart, row.mainEnd, lang)}
        title={occasionName(row.key, lang)}
        href={`/occasions/${row.key}`}
        cta={t('occasions.see_all', { defaultValue: 'See all' })}
        ctaTone="quiet"
      />
      <EventRail events={row.events} />
    </section>
  )
}
