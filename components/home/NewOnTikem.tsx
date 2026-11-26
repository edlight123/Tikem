'use client'

// "new on Tikèm": what organizers just added, newest first, so a new event
// weeks out is not buried under the soonest-first sections. The data arrives
// picked on the server (lib/home/new-on-tikem); under three events it is
// empty and the section hides. No "see all": the rail already holds every
// recent event (up to twelve), and /discover has no newest-first order, so a
// link would open on a different list.

import { useTranslation } from 'react-i18next'
import { SectionHeader, EventRail } from '@/components/ui/EditorialRails'
import type { HomeEvent } from '@/lib/home/feed'

export default function NewOnTikem({ events }: { events: HomeEvent[] }) {
  const { t } = useTranslation('common')
  if (!events.length) return null
  return (
    <section>
      <SectionHeader title={t('home.new_on.title', { defaultValue: 'new on Tikèm' })} />
      <EventRail events={events} contained />
    </section>
  )
}
