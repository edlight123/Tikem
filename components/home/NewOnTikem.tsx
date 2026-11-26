'use client'

// "new on Tikèm": what organizers just added, newest first, so a new event
// weeks out is not buried under the soonest-first sections. The data arrives
// picked on the server (lib/home/new-on-tikem: two weeks, widening when
// thin); under two events it is empty and the section hides. "See all" opens
// the same list in full (app/new) for the same country and city.

import { useTranslation } from 'react-i18next'
import { SectionHeader, EventRail } from '@/components/ui/EditorialRails'
import type { HomeEvent } from '@/lib/home/feed'

export default function NewOnTikem({ events, scopeQs = '' }: { events: HomeEvent[]; scopeQs?: string }) {
  const { t } = useTranslation('common')
  if (!events.length) return null
  return (
    <section>
      <SectionHeader
        title={t('home.new_on.title', { defaultValue: 'new on Tikèm' })}
        href={scopeQs ? `/new?${scopeQs}` : '/new'}
        cta={t('home.new_on.see_all', { defaultValue: 'See all' })}
        ctaTone="quiet"
      />
      <EventRail events={events} contained />
    </section>
  )
}
