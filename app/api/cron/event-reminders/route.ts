import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { sendEmail } from '@/lib/email'
import { sendWhatsAppMessage, getEventReminderWhatsApp } from '@/lib/whatsapp'
import { sendEventReminder } from '@/lib/notification-triggers'
import { claimReminder, releaseReminderClaim } from '@/lib/notifications/reminder-claim'
import { liveTicketStatusesForQuery } from '@/lib/tickets/status'
import { reminderWindows } from '@/lib/notifications/reminder-windows'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { appUrl } from '@/lib/email-kit/layout'
import { getEventReminderEmail } from '@/lib/email-templates/reminder'

export const dynamic = 'force-dynamic'

/**
 * Event Reminder Cron Job
 * 
 * This endpoint should be called hourly by a cron service (Vercel Cron, GitHub Actions, etc.)
 * It sends email, WhatsApp, and in-app/push reminders at:
 * - 24 hours before event
 * - 3 hours before event
 * - 30 minutes before event
 * 
 * To set up in Vercel:
 * 1. Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/event-reminders",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 * 
 * To secure this endpoint, add CRON_SECRET to environment variables
 */

export async function GET(request: Request) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const now = new Date()
    
    // Windows come from lib/notifications/reminder-windows, which is unit-tested
    // for the property that matters: no window may be narrower than the cron
    // period, or events silently fall between runs.
    const reminders = reminderWindows(now)

    let totalEmailsSent = 0
    let totalWhatsAppSent = 0
    let totalNotificationsSent = 0
    const results = []

    for (const reminder of reminders) {
      // Find events starting within the reminder window.
      //
      // `start_datetime` is an ISO STRING from the event composer but a Firestore
      // TIMESTAMP from the seed script and some older writes. A Firestore range
      // never crosses value types, so a single query silently returns only one of
      // the two populations — with no error to notice. Ask for both and merge.
      const [asString, asTimestamp] = await Promise.all([
        supabase
          .from('events')
          .select('*')
          .gte('start_datetime', reminder.windowStart.toISOString())
          .lte('start_datetime', reminder.windowEnd.toISOString())
          .eq('is_published', true),
        supabase
          .from('events')
          .select('*')
          .gte('start_datetime', reminder.windowStart)
          .lte('start_datetime', reminder.windowEnd)
          .eq('is_published', true),
      ])

      const eventsError = asString.error && asTimestamp.error ? asString.error : null
      const byId = new Map<string, any>()
      for (const row of [...(asString.data || []), ...(asTimestamp.data || [])]) {
        if (row?.id) byId.set(row.id, row)
      }
      const events = Array.from(byId.values())

      if (eventsError || events.length === 0) {
        results.push({ 
          type: reminder.type, 
          events: 0, 
          emailsSent: 0, 
          whatsappSent: 0,
          notificationsSent: 0 
        })
        continue
      }

      let emailsSent = 0
      let whatsappSent = 0
      let notificationsSent = 0

      // For each event, get ticket holders and send reminders
      for (const event of events) {
        const { data: tickets, error: ticketsError } = await supabase
          .from('tickets')
          .select(`
            *,
            attendee:users (*)
          `)
          .eq('event_id', event.id)
          // A live ticket is valid|confirmed|active. Matching only 'valid' meant
          // every MonCash and SogePay buyer — i.e. the whole Haiti market — was
          // invisible to reminders.
          .in('status', liveTicketStatusesForQuery())

        if (ticketsError || !tickets || tickets.length === 0) continue

        // Get unique attendee IDs for in-app/push notifications
        const attendeeIds = Array.from(new Set(tickets.map((t: any) => t.attendee_id))) as string[]

        // Take the send-once claim BEFORE notifying. Windows are now a full hour
        // wide, so the same event legitimately appears in consecutive runs; this
        // is what stops every attendee being reminded twice.
        const claimed = await claimReminder(event.id, reminder.type)
        if (!claimed) continue

        // Send in-app and push notifications via notification-triggers
        try {
          await sendEventReminder(
            event.id,
            event.title,
            new Date(event.start_datetime),
            attendeeIds,
            reminder.type
          )
          notificationsSent += attendeeIds.length
        } catch (error) {
          console.error(`Failed to send ${reminder.type} notifications for event ${event.id}:`, error)
          // Hand the claim back so the next run retries rather than losing the
          // reminder permanently to a transient failure — and skip the email and
          // WhatsApp block below, since that retry will send those too.
          await releaseReminderClaim(event.id, reminder.type)
          continue
        }

        // Send email and WhatsApp for 24h reminder only (to avoid spam)
        if (reminder.type === 'event_reminder_24h') {
          for (const ticket of tickets) {
            if (!ticket.attendee) continue

            // Send email reminder, in the attendee's language, as the shared
            // "it's tomorrow" template (poster, facts, ticket, directions).
            const lang = await resolveEmailLang({
              explicit: ticket.attendee.language,
              userId: ticket.attendee_id || ticket.attendee.id,
              event,
            })
            const reminderEmail = getEventReminderEmail({
              lang,
              event,
              ticketUrl: `${appUrl()}/tickets/${encodeURIComponent(String(ticket.id))}`,
            })
            const emailResult = await sendEmail({
              to: ticket.attendee.email,
              subject: reminderEmail.subject,
              html: reminderEmail.html,
            })

            if (emailResult.success) emailsSent++

            // Send WhatsApp reminder if phone available
            if (ticket.attendee.phone) {
              const whatsappResult = await sendWhatsAppMessage({
                to: ticket.attendee.phone,
                message: getEventReminderWhatsApp(
                  ticket.attendee.full_name || 'Guest',
                  event.title,
                  24,
                  `${event.venue_name}, ${event.city}`
                ),
              })

              if (whatsappResult.success) whatsappSent++
            }
          }
        }
      }

      totalEmailsSent += emailsSent
      totalWhatsAppSent += whatsappSent
      totalNotificationsSent += notificationsSent
      
      results.push({ 
        type: reminder.type, 
        events: events.length, 
        emailsSent, 
        whatsappSent,
        notificationsSent 
      })
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      totalEmailsSent,
      totalWhatsAppSent,
      totalNotificationsSent,
      results
    })
  } catch (error: any) {
    console.error('Event reminder cron error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process event reminders' },
      { status: 500 }
    )
  }
}
