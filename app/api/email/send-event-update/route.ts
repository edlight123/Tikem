import { Resend } from 'resend'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { escapeHtml } from '@/lib/html'

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

    // Determine update type emoji and title
    let updateIcon = '📢'
    let updateTitle = 'Event Update'
    
    switch (updateType) {
      case 'time':
        updateIcon = '🕐'
        updateTitle = 'Time Change'
        break
      case 'location':
        updateIcon = '📍'
        updateTitle = 'Location Change'
        break
      case 'cancellation':
        updateIcon = '⚠️'
        updateTitle = 'Event Cancelled'
        break
      case 'postponement':
        updateIcon = '📅'
        updateTitle = 'Event Postponed'
        break
      case 'important':
        updateIcon = '❗'
        updateTitle = 'Important Update'
        break
    }

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

    let emailsSent = 0
    let errors = 0

    // Send email to each attendee
    for (const attendee of attendees) {
      try {
        await resend.emails.send({
          from: 'Tikem <noreply@tikem.co>',
          to: attendee.email,
          subject: `${updateIcon} ${updateTitle}: ${event.title}`,
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
                .alert-box { background: ${updateType === 'cancellation' ? '#fee2e2' : '#fef3c7'}; border-left: 4px solid ${updateType === 'cancellation' ? '#dc2626' : '#f59e0b'}; padding: 20px; margin: 20px 0; border-radius: 4px; }
                .event-details { background: white; border-radius: 10px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .message-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
                .button { display: inline-block; background: #0d9488; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0; font-size: 36px;">${updateIcon}</h1>
                  <h2 style="margin: 10px 0 0 0;">${escapeHtml(updateTitle)}</h2>
                </div>
                
                <div class="content">
                  <p>Hi ${escapeHtml(attendee.full_name || 'there')},</p>
                  
                  <div class="alert-box">
                    <h3 style="margin-top: 0; color: ${updateType === 'cancellation' ? '#991b1b' : '#92400e'};">
                      ${updateType === 'cancellation' ? '⚠️ Important Notice' : '📢 Update from the Organizer'}
                    </h3>
                    <p style="margin: 0; font-size: 16px;">
                      The organizer has posted an update about your upcoming event:
                    </p>
                  </div>
                  
                  <div class="event-details">
                    <h2 style="margin-top: 0; color: #0d9488;">${escapeHtml(event.title)}</h2>
                    <p style="color: #6b7280; margin: 5px 0;">
                      📅 ${escapeHtml(formattedDate)}<br>
                      🕐 ${escapeHtml(formattedTime)}<br>
                      📍 ${escapeHtml(event.venue_name)}, ${escapeHtml(event.city)}
                    </p>
                  </div>
                  
                  <div class="message-box">
                    <h3 style="margin-top: 0; color: #111827;">Message from Organizer:</h3>
                    <p style="white-space: pre-wrap; color: #374151;">${escapeHtml(updateMessage)}</p>
                  </div>
                  
                  ${updateType === 'cancellation' ? `
                    <div style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 15px; margin: 20px 0;">
                      <strong style="color: #991b1b;">🔄 Refund Information:</strong>
                      <p style="color: #7f1d1d; margin: 10px 0 0 0;">
                        Your refund will be processed automatically within 5-7 business days. 
                        If you have any questions, please contact our support team.
                      </p>
                    </div>
                  ` : ''}
                  
                  <div style="text-align: center;">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'}/events/${encodeURIComponent(String(eventId))}" class="button">
                      View Event Details
                    </a>
                  </div>
                  
                  <p>If you have any questions about this update, you can reply to this email or contact the event organizer directly.</p>
                </div>
                
                <div class="footer">
                  <p>Tikèm - Discover Events in Haiti</p>
                  <p style="font-size: 12px;">
                    You're receiving this because you have tickets for this event.
                  </p>
                </div>
              </div>
            </body>
            </html>
          `
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
