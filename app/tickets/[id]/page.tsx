import { createClient } from '@/lib/firebase-db/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import { redirect, notFound } from 'next/navigation'
import { format, isPast } from 'date-fns'
import ReviewForm from '@/components/ReviewForm'
import { isDemoMode, DEMO_TICKETS, DEMO_EVENTS } from '@/lib/demo'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { revalidatePath } from 'next/cache'
import Image from 'next/image'
import TicketDetailContent from './TicketDetailContent'

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

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, error } = await requireAuth()

  if (error || !user) {
    redirect(`/auth/login?redirect=/tickets/${id}`)
  }
  
  // Server action for pull-to-refresh
  async function refreshPage() {
    'use server'
    revalidatePath(`/tickets/${id}`)
  }
  
  let ticket: any = null

  if (isDemoMode()) {
    // Find demo ticket by ID
    const demoTicket = DEMO_TICKETS.find(t => t.id === id)
    if (!demoTicket) {
      notFound()
    }
    
    const event = DEMO_EVENTS.find(e => e.id === demoTicket.event_id)
    ticket = {
      ...demoTicket,
      events: event
    }
  } else {
    // Fetch real ticket from database
    const supabase = await createClient()
    
    // Get all tickets and filter (since .eq() has issues with Firebase wrapper)
    const { data: allTickets } = await supabase
      .from('tickets')
      .select('*')

    const ticketData = allTickets?.find((t: any) => t.id === id && t.attendee_id === user.id)

    if (ticketData) {
      // Get all events and find the matching one
      const { data: allEvents } = await supabase
        .from('events')
        .select('*')

      const eventData = allEvents?.find((e: any) => e.id === ticketData.event_id)

      ticket = {
        ...ticketData,
        events: eventData
      }
    }
  }

  if (!ticket) {
    notFound()
  }

  const event = ticket.events as any
  
  // Serialize ALL Firestore Timestamps recursively
  const serializedEvent = event ? serializeTimestamps(event) : null
  const serializedTicket = {
    ...serializeTimestamps(ticket),
    events: serializedEvent,
  }
  
  const eventPassed = isPast(new Date(serializedEvent.end_datetime || serializedEvent.start_datetime || serializedEvent.date))

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-20 sm:pb-24">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <TicketDetailContent 
          ticket={serializedTicket}
          event={serializedEvent}
          user={user}
        />

        {/* Review Form for Past Events */}
        {eventPassed && !isDemoMode() && (
          <div className="mt-4 sm:mt-6">
            <ReviewForm 
              eventId={event.id} 
              ticketId={ticket.id}
              eventTitle={event.title}
            />
          </div>
        )}
      </div>
      
      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
    
  )
}
