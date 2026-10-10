import { Resend } from 'resend'
import { createClient } from '@/lib/firebase-db/server'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { appUrl } from '@/lib/email-kit/layout'
import { getEventReminderEmail } from '@/lib/email-templates/reminder'

const resend = new Resend(process.env.RESEND_API_KEY || '')

/**
 * This endpoint sends reminder emails to attendees 24 hours before an event
 * It should be called by a cron job (e.g., Vercel Cron or external scheduler)
 * 
 * Setup in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/email/send-event-reminders",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */

export async function GET(request: Request) {
  // Verify request is from cron. Fails CLOSED when CRON_SECRET is unset —
  // without the null guard, "Bearer undefined" would authenticate.
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = await createClient()

    // Find events happening in 24 hours (with 1 hour buffer)
    const now = new Date()
    const twentyThreeHoursFromNow = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const twentyFiveHoursFromNow = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    const { data: upcomingEvents, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .gte('start_datetime', twentyThreeHoursFromNow.toISOString())
      .lte('start_datetime', twentyFiveHoursFromNow.toISOString())
      .eq('is_published', true)

    if (eventsError) {
      console.error('Error fetching upcoming events:', eventsError)
      return Response.json({ error: 'Failed to fetch events' }, { status: 500 })
    }

    if (!upcomingEvents || upcomingEvents.length === 0) {
      return Response.json({ message: 'No events in the next 24 hours' })
    }

    console.log(`Found ${upcomingEvents.length} events happening in 24 hours`)

    let emailsSent = 0
    let errors = 0

    // Process each event
    for (const event of upcomingEvents) {
      try {
        // Get all tickets for this event
        const { data: tickets, error: ticketsError } = await supabase
          .from('tickets')
          .select('*, users(*)')
          .eq('event_id', event.id)

        if (ticketsError || !tickets || tickets.length === 0) {
          console.log(`No tickets found for event ${event.id}`)
          continue
        }

        // Group tickets by user to avoid sending duplicate emails
        const ticketsByUser = new Map()
        tickets.forEach((ticket: any) => {
          if (ticket.users && ticket.users.email) {
            if (!ticketsByUser.has(ticket.attendee_id)) {
              ticketsByUser.set(ticket.attendee_id, {
                user: ticket.users,
                tickets: []
              })
            }
            ticketsByUser.get(ticket.attendee_id).tickets.push(ticket)
          }
        })

        // Send reminder email to each attendee
        const entries = Array.from(ticketsByUser.entries())
        for (const [userId, { user, tickets }] of entries) {
          try {
            const lang = await resolveEmailLang({ explicit: user.language, userId, event })
            const reminderEmail = getEventReminderEmail({
              lang,
              event,
              ticketUrl: `${appUrl()}/tickets`,
              ticketCount: tickets.length,
            })

            await resend.emails.send({
              from: 'Tikem <noreply@tikem.co>',
              to: user.email,
              subject: reminderEmail.subject,
              html: reminderEmail.html,
            })

            emailsSent++
          } catch (emailError) {
            console.error(`Error sending reminder to ${user.email}:`, emailError)
            errors++
          }
        }
      } catch (eventError) {
        console.error(`Error processing event ${event.id}:`, eventError)
        errors++
      }
    }

    return Response.json({
      success: true,
      eventsProcessed: upcomingEvents.length,
      emailsSent,
      errors
    })
  } catch (error) {
    console.error('Error in send-event-reminders:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
