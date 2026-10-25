import { T } from '@/components/organizer/ui/TranslatedText'
import { requireOrgPage } from '../../_lib/orgPage'
import Link from 'next/link'
import { ChevronLeft, CalendarDays, ShieldCheck, Users } from 'lucide-react'
import { createClient } from '@/lib/firebase-db/server'
import EventStaffHub from './EventStaffHub'
import { PageHeader } from '@/components/organizer/ui'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'

export const revalidate = 0

type OrganizerEvent = {
  id: string
  title?: string
  start_datetime?: string
  city?: string
  is_published?: boolean
  is_cancelled?: boolean
  organizer_id?: string
}

async function getOrganizerEvents(organizerId: string): Promise<{ events: OrganizerEvent[]; error: boolean }> {
  const supabase = await createClient()
  const res = await supabase
    .from('events')
    .select('id,title,start_datetime,city,is_published,is_cancelled,organizer_id')
    .eq('organizer_id', organizerId)
    .limit(200)

  if ((res as any)?.error) {
    console.error('Failed to load organizer events for team settings:', (res as any).error)
    return { events: [], error: true }
  }

  const events = ((res as any)?.data as OrganizerEvent[] | null) || []
  const sorted = events.sort((a, b) => {
    const aTime = a?.start_datetime ? new Date(a.start_datetime).getTime() : 0
    const bTime = b?.start_datetime ? new Date(b.start_datetime).getTime() : 0
    return bTime - aTime
  })
  return { events: sorted, error: false }
}

export default async function TeamSettingsPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise.
  searchParams?: Promise<{ eventId?: string }>
}) {
  const resolvedSearchParams = await searchParams
  // Per-event door staff is event work (manage_events) for the acting org.
  const { orgId } = await requireOrgPage('manage_events', '/organizer/settings/team')

  const { events, error: eventsError } = await getOrganizerEvents(orgId)

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <Link
          href="/organizer/settings"
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white mb-6 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /><T k="event_analytics.back_to_settings" /></Link>

        <TranslatedPageHeader
          eyebrowKey="settings"
          titleKey="team_title"
          subtitleKey="team_subtitle"
        />

        {eventsError ? (
          <div className="mt-8 mb-6 rounded-2xl bg-amber-500/10 p-4 text-sm text-white/70">
            We couldn&apos;t load your events right now. Some counts may be incomplete, please refresh to try again.
          </div>
        ) : null}

        {/* mt-8, matching the sibling settings pages. */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          <div className="rounded-2xl bg-white/[0.055] p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-white/[0.07] text-white/70 flex items-center justify-center">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-white/50 uppercase tracking-wide"><T k="event_analytics.your_events" /></p>
                <p className="text-2xl font-semibold text-white">{events.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.055] p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-white/[0.07] text-white/70 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-white/50 uppercase tracking-wide"><T k="event_analytics.check_in_access" /></p>
                <p className="text-sm font-semibold text-white"><T k="event_analytics.event_scoped" /></p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.055] p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-white/[0.07] text-white/70 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-white/50 uppercase tracking-wide"><T k="event_analytics.staff" /></p>
                <p className="text-sm font-semibold text-white"><T k="event_analytics.managed_per_event" /></p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2">
            <EventStaffHub events={events} initialEventId={resolvedSearchParams?.eventId} />
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-white/[0.055] p-5">
              <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white mb-3"><T k="event_analytics.guidelines" /></h3>
              <ul className="space-y-3 text-sm text-white/70">
                <li className="flex gap-2">
                  <span className="text-white/40">•</span><T k="event_analytics.invite_staff_for_event" /></li>
                <li className="flex gap-2">
                  <span className="text-white/40">•</span><T k="event_analytics.one_time_invite_links" /></li>
                <li className="flex gap-2">
                  <span className="text-white/40">•</span><T k="event_analytics.remove_access_if_lost" /></li>
              </ul>
            </div>

            <div className="bg-white/[0.055] rounded-2xl p-5">
              <h3 className="text-base font-semibold text-white mb-2"><T k="event_analytics.need_help" /></h3>
              <p className="text-sm text-white/70 mb-4"><T k="event_analytics.support_can_help" /></p>
              <Link
                href="mailto:support@tikem.co"
                className="inline-flex items-center text-sm font-semibold text-white underline underline-offset-4 hover:text-white/80 transition-colors"
              >
                Contact Support →
              </Link>
            </div>
          </div>
        </div>
      </div>    </div>
  )
}
