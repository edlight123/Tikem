import { Resend } from 'resend'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { getEventUpdateNoticeEmail } from '@/lib/email-templates/reminder'

const resend = new Resend(process.env.RESEND_API_KEY || '')

/**
 * Sends an update notification to all attendees of an event
 * Used when organizers make important changes to event details
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId, updateMessage, updateType } = await request.json()

    if (!eventId || !updateMessage) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = await createClient()

    // Verify user owns this event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .eq('organizer_id', user.id)
      .single()

    if (eventError || !event) {
      return Response.json({ error: 'Event not found or unauthorized' }, { status: 404 })
    }

    // Get all attendees for this event
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('*, users(*)')
      .eq('event_id', eventId)

    if (ticketsError || !tickets || tickets.length === 0) {
      return Response.json({ message: 'No attendees to notify' })
    }

    // Get unique attendees (one email per user even if multiple tickets)
    const attendeeMap = new Map()
    tickets.forEach((ticket: any) => {
      if (ticket.users && ticket.users.email) {
        attendeeMap.set(ticket.attendee_id, ticket.users)
      }
    })

    const attendees = Array.from(attendeeMap.values())

    let emailsSent = 0
    let errors = 0

    // Send email to each attendee
    for (const attendee of attendees) {
      try {
        const lang = await resolveEmailLang({ explicit: attendee.language, userId: attendee.id, event })
        const updateEmail = getEventUpdateNoticeEmail({
          lang,
          event: { ...event, id: event.id || eventId },
          updateType,
          updateMessage: String(updateMessage),
        })
        await resend.emails.send({
          from: 'Tikem <noreply@tikem.co>',
          to: attendee.email,
          subject: updateEmail.subject,
          html: updateEmail.html,
        })

        emailsSent++
      } catch (emailError) {
        console.error(`Error sending update to ${attendee.email}:`, emailError)
        errors++
      }
    }

    // Record the update in database (optional - could create an event_updates table)
    // For now, just return success

    return Response.json({
      success: true,
      attendeesNotified: emailsSent,
      errors
    })
  } catch (error) {
    console.error('Error in send-event-update:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
