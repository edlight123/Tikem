import { createClient } from '@/lib/firebase-db/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { redirect, notFound } from 'next/navigation'
import { isDemoMode, DEMO_TICKETS, DEMO_EVENTS } from '@/lib/demo'
import EventTicketsContent from '@/components/tickets/EventTicketsContent'

export const dynamic = 'force-dynamic'
export const revalidate = 60 // Cache for 1 minute

// Helper function to serialize all Timestamp objects recursively
function serializeTimestamps(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  
  // Check if it's a Firestore Timestamp
  if (obj.toDate && typeof obj.toDate === 'function') {
    return obj.toDate().toISOString()
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serializeTimestamps(item))
  }
  
  // Handle plain objects
  const serialized: any = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      serialized[key] = serializeTimestamps(obj[key])
    }
  }
  return serialized
}

export default async function EventTicketsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const { user, error } = await requireAuth()

  if (error || !user) {
    redirect(`/auth/login?redirect=/tickets/event/${eventId}`)
  }

  // Validate eventId
  if (!eventId) {
    notFound()
  }

  let tickets: any[] = []
  let event: any = null

  try {
    if (isDemoMode()) {
      // Find demo tickets for this event
      const demoTickets = DEMO_TICKETS.filter(t => t.event_id === eventId && t.attendee_id === user.id)
      event = DEMO_EVENTS.find(e => e.id === eventId)
      tickets = demoTickets
    } else {
      // Fetch real tickets from database
      const supabase = await createClient()
      
      // Get all tickets and filter
      const { data: allTickets } = await supabase
        .from('tickets')
        .select('*')

      const userEventTickets = allTickets?.filter((t: any) => 
        t && t.event_id === eventId && t.attendee_id === user.id
      ) || []

      // Get event details
      const { data: allEvents } = await supabase
        .from('events')
        .select('*')

      event = allEvents?.find((e: any) => e && e.id === eventId)
      
      tickets = userEventTickets
    }
  } catch (err) {
    console.error('Error fetching tickets/event:', err instanceof Error ? err.message : String(err))
    // Set empty values to show not found
    tickets = []
    event = null
  }

  if (!event || !tickets || tickets.length === 0) {
    notFound()
  }

  // Serialize ALL Firestore Timestamps recursively
  const serializedEvent = serializeTimestamps(event)
  const serializedTickets = tickets.map(ticket => serializeTimestamps(ticket))

  // `bg-[#0a0a0a]` here is the PAGE canvas, which is the one place it belongs —
  // never as a card fill, where it renders invisible against this. Surfaces
  // inside the content use the white/[0.0x] ladder in docs/POSH_DESIGN_BRIEF.md.
  // `pb-mobile-nav` is conditional in CSS (body[data-mobile-nav], <768px), so it
  // reserves nothing for a signed-out reader.
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <EventTicketsContent event={serializedEvent} tickets={serializedTickets} />

      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
