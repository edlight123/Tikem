import { Resend } from 'resend'
import { createClient } from '@/lib/firebase-db/server'
import { escapeHtml } from '@/lib/html'

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
            const eventDate = new Date(event.start_datetime)
            const formattedDate = eventDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
            const formattedTime = eventDate.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })

            await resend.emails.send({
              from: 'Tikem <noreply@tikem.co>',
              to: user.email,
              subject: `Reminder: ${event.title} is Tomorrow! 🎉`,
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #0d9488 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
                    .event-card { background: white; border-radius: 10px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .highlight { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
                    .button { display: inline-block; background: #0d9488; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
                    .info-row { display: flex; align-items: center; padding: 8px 0; }
                    .info-icon { margin-right: 10px; font-size: 20px; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <h1 style="margin: 0; font-size: 32px;">⏰ Event Reminder</h1>
                      <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">Your event is tomorrow!</p>
                    </div>
                    
                    <div class="content">
                      <p>Hi ${escapeHtml(user.full_name || 'there')},</p>
                      
                      <p>This is a friendly reminder that you have an upcoming event tomorrow!</p>
                      
                      <div class="highlight">
                        <h3 style="margin-top: 0; color: #92400e;">🎯 Don't Forget!</h3>
                        <p style="margin: 0; color: #78350f;">Your event <strong>${escapeHtml(event.title)}</strong> is happening in less than 24 hours.</p>
                      </div>
                      
                      <div class="event-card">
                        <h2 style="margin-top: 0; color: #0d9488;">${escapeHtml(event.title)}</h2>
                        
                        <div class="info-row">
                          <span class="info-icon">📅</span>
                          <span><strong>Date:</strong> ${escapeHtml(formattedDate)}</span>
                        </div>
                        
                        <div class="info-row">
                          <span class="info-icon">🕐</span>
                          <span><strong>Time:</strong> ${escapeHtml(formattedTime)}</span>
                        </div>
                        
                        <div class="info-row">
                          <span class="info-icon">📍</span>
                          <span><strong>Location:</strong> ${escapeHtml(event.venue_name)}, ${escapeHtml(event.city)}</span>
                        </div>
                        
                        <div class="info-row">
                          <span class="info-icon">🎫</span>
                          <span><strong>Your Tickets:</strong> ${tickets.length} ticket${tickets.length > 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      
                      <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
                        <strong>📌 Preparation Checklist:</strong>
                        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                          <li>Arrive 15-30 minutes early</li>
                          <li>Bring a valid ID for verification</li>
                          <li>Have your ticket QR code ready (screenshot is fine)</li>
                          <li>Check the weather and dress accordingly</li>
                          <li>Plan your transportation ahead of time</li>
                        </ul>
                      </div>
                      
                      <div style="text-align: center;">
                        <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'}/tickets" class="button">
                          View My Tickets
                        </a>
                      </div>
                      
                      <p>Have a great time at the event! 🎉</p>
                    </div>
                    
                    <div class="footer">
                      <p>Tikèm - Discover Events in Haiti</p>
                      <p style="font-size: 12px;">
                        This is an automated reminder. You're receiving this because you have tickets for this event.
                      </p>
                    </div>
                  </div>
                </body>
                </html>
              `
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
