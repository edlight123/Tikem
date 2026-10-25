import { requireOrgPage } from '../_lib/orgPage'
import ScanPageHeader from '@/components/organizer/scan/ScanPageHeader'
import { createClient } from '@/lib/firebase-db/server'
import EventSelector from './EventSelector'
import { QrCode, Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ScanTicketPage() {
  // Check-in is event work (manage_events): owner, org admins and managers.
  const { orgId } = await requireOrgPage('manage_events', '/organizer/scan')

  // Fetch organizer's events
  const supabase = await createClient()
  const userEventsQuery = await supabase
    .from('events')
    .select('id,title,start_datetime,venue_name,city,tickets_sold,organizer_id,banner_image_url,category')
    .eq('organizer_id', orgId)

  const userEvents = userEventsQuery.data || []
  
  // Get today's date boundaries
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  // Separate events happening today from others
  const todayEvents = userEvents.filter((e: any) => {
    const eventDate = new Date(e.start_datetime)
    return eventDate >= today && eventDate < tomorrow
  })
  
  const otherEvents = userEvents.filter((e: any) => {
    const eventDate = new Date(e.start_datetime)
    return eventDate < today || eventDate >= tomorrow
  })
  
  // Sort today's events by time (earliest first)
  todayEvents.sort((a: any, b: any) => 
    new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
  )
  
  // Sort other events newest to oldest (by event date)
  otherEvents.sort((a: any, b: any) => 
    new Date(b.start_datetime).getTime() - new Date(a.start_datetime).getTime()
  )
  
  // Combine: today's events first, then others
  const events = [...todayEvents, ...otherEvents]

  return (
    <div className="bg-[#0a0a0a]">

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="mb-6 md:mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 bg-white/[0.055] rounded-xl md:rounded-2xl mb-3 md:mb-4">
            <QrCode className="w-7 h-7 md:w-8 md:h-8 text-white" />
          </div>
          <ScanPageHeader />
        </div>

        <EventSelector events={events} organizerId={orgId} />
      </div>
    </div>
  )
}
