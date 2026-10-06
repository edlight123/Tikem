import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/html'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId } = await request.json()

    if (!eventId || typeof eventId !== 'string') {
      return Response.json({ error: 'Event ID required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Check if event exists and is sold out
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 })
    }

    const availableTickets = (event.total_tickets || 0) - (event.tickets_sold || 0)
    
    // Check if already on waitlist
    const { data: existing } = await supabase
      .from('event_waitlist')
      .select('id, position')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .single()

    if (existing) {
      return Response.json({ 
        message: 'Already on waitlist',
        position: existing.position 
      })
    }

    // Get current waitlist count for this event
    const { data: waitlistEntries } = await supabase
      .from('event_waitlist')
      .select('id')
      .eq('event_id', eventId)

    const position = (waitlistEntries?.length || 0) + 1

    // Add to waitlist
    const { error: insertError } = await supabase
      .from('event_waitlist')
      .insert({
        event_id: eventId,
        user_id: user.id,
        position
      })

    if (insertError) {
      console.error('Error adding to waitlist:', insertError)
      return Response.json({ error: 'Failed to join waitlist' }, { status: 500 })
    }

    // Send confirmation email. `user.email` is the Firebase Auth address (never
    // the client-writable profile copy); a phone-only account has none and is
    // skipped by sendEmail's null guard. Every organizer-typed value is escaped.
    try {
      const eventPath = `/events/${encodeURIComponent(String(eventId))}`
      await sendEmail({
        to: user.email || null,
        subject: `You're on the waitlist for ${String(event.title || 'this event').replace(/[\r\n]+/g, ' ')}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #0d9488 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
              .button { display: inline-block; background: #0d9488; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">📋 Waitlist Confirmed</h1>
              </div>
              <div class="content">
                <p>Hi ${escapeHtml(user.full_name || 'there')},</p>
                <p>You've been added to the waitlist for <strong>${escapeHtml(event.title)}</strong>!</p>
                <p><strong>Your position:</strong> #${position}</p>
                <p>We'll notify you immediately if tickets become available. Keep an eye on your inbox!</p>
                <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <strong>💡 What happens next?</strong>
                  <ul style="margin: 10px 0 0 0;">
                    <li>If tickets become available, you'll receive an email with a link to purchase</li>
                    <li>You'll have 24 hours to complete your purchase</li>
                    <li>If you don't purchase, the next person on the waitlist will be notified</li>
                  </ul>
                </div>
                <div style="text-align: center;">
                  <a href="${escapeHtml((process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co') + eventPath)}" class="button">
                    View Event Details
                  </a>
                </div>
              </div>
            </div>
          </body>
          </html>
        `
      })
    } catch (emailError) {
      console.error('Error sending waitlist email:', emailError)
      // Don't fail the request if email fails
    }

    return Response.json({ 
      success: true,
      position,
      message: `You're #${position} on the waitlist`
    })
  } catch (error) {
    console.error('Error joining waitlist:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Leave waitlist
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')

    if (!eventId) {
      return Response.json({ error: 'Event ID required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Remove from waitlist
    const { error } = await supabase
      .from('event_waitlist')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error leaving waitlist:', error)
      return Response.json({ error: 'Failed to leave waitlist' }, { status: 500 })
    }

    // Reorder remaining waitlist positions
    const { data: remaining } = await supabase
      .from('event_waitlist')
      .select('id')
      .eq('event_id', eventId)
      .order('position', { ascending: true })

    if (remaining) {
      for (let i = 0; i < remaining.length; i++) {
        await supabase
          .from('event_waitlist')
          .update({ position: i + 1 })
          .eq('id', remaining[i].id)
      }
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error leaving waitlist:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
