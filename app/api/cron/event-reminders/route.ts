import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { sendEmail } from '@/lib/email'
import { sendWhatsAppMessage, getEventReminderWhatsApp } from '@/lib/whatsapp'
import { sendEventReminder } from '@/lib/notification-triggers'
import { claimReminder, releaseReminderClaim } from '@/lib/notifications/reminder-claim'
import { liveTicketStatusesForQuery } from '@/lib/tickets/status'
import { startDate } from '@/lib/notifications/event-reminder-settings'
import { runEventReminders, type ReminderTicket } from '@/lib/notifications/event-reminder-run'
import { sendConfiguredEventReminder } from '@/lib/notifications/event-reminder-send'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { appUrl } from '@/lib/email-kit/layout'
import { getEventReminderEmail } from '@/lib/email-templates/reminder'

export const dynamic = 'force-dynamic'

/**
 * Event Reminder Cron Job (hourly, vercel.json).
 *
 * Sends in-app/push reminders at each event's own reminder times
 * (events/{id}.reminders, set by the organizer in the app; see
 * lib/notifications/event-reminder-settings). An event without settings gets
 * the stock 24 hours, 3 hours and 30 minutes before, exactly as before. The
 * reminder one day before also goes by email and WhatsApp.
 *
 * The decisions live in lib/notifications/event-reminder-run (tested); this
 * route wires the I/O. Invariants kept from the earlier fixes:
 *  - send-once claim per (eventId, reminder) BEFORE notifying, released on failure;
 *  - one-period windows from lib/notifications/reminder-windows;
 *  - live tickets = liveTicketStatusesForQuery() (MonCash / SogePay buyers too);
 *  - start_datetime queried as BOTH an ISO string and a Timestamp.
 *
 * Secured by CRON_SECRET (fails closed when unset).
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const now = new Date()

    const result = await runEventReminders(now, {
      async loadEvents(from, to) {
        // `start_datetime` is an ISO STRING from the event composer but a
        // Firestore TIMESTAMP from the seed script and some older writes. A
        // Firestore range never crosses value types, so a single query silently
        // returns only one of the two populations, with no error to notice. Ask
        // for both and merge.
        const [asString, asTimestamp] = await Promise.all([
          supabase
            .from('events')
            .select('*')
            .gte('start_datetime', from.toISOString())
            .lte('start_datetime', to.toISOString())
            .eq('is_published', true),
          supabase
            .from('events')
            .select('*')
            .gte('start_datetime', from)
            .lte('start_datetime', to)
            .eq('is_published', true),
        ])
        if (asString.error && asTimestamp.error) {
          console.error('[event-reminders] event query failed', asString.error)
          return []
        }
        const byId = new Map<string, any>()
        for (const row of [...(asString.data || []), ...(asTimestamp.data || [])]) {
          if (row?.id) byId.set(row.id, row)
        }
        return Array.from(byId.values())
      },

      async loadTickets(eventId) {
        const { data, error } = await supabase
          .from('tickets')
          .select(`
            *,
            attendee:users (*)
          `)
          .eq('event_id', eventId)
          // A live ticket is valid|confirmed|active. Matching only 'valid' meant
          // every MonCash and SogePay buyer (the whole Haiti market) was
          // invisible to reminders.
          .in('status', liveTicketStatusesForQuery())
        if (error || !data) return []
        return data as ReminderTicket[]
      },

      claim: claimReminder,
      release: releaseReminderClaim,

      async sendStock(event, attendeeIds, reminder) {
        await sendEventReminder(
          event.id,
          event.title,
          startDate(event.start_datetime) || new Date(event.start_datetime),
          attendeeIds,
          reminder.id as 'event_reminder_24h' | 'event_reminder_3h' | 'event_reminder_30min'
        )
      },

      async sendCustom(event, attendeeIds, reminder) {
        await sendConfiguredEventReminder({
          eventId: event.id,
          eventTitle: event.title,
          attendeeIds,
          reminder,
        })
      },

      async sendDayBefore(event, tickets, reminder) {
        let emailsSent = 0
        let whatsappSent = 0
        for (const ticket of tickets) {
          const attendee = ticket.attendee
          if (!attendee) continue

          // In the attendee's language, as the shared "it's tomorrow" template
          // (poster, facts, ticket, directions).
          const lang = await resolveEmailLang({
            explicit: attendee.language,
            userId: ticket.attendee_id || attendee.id,
            event: event as any,
          })
          const reminderEmail = getEventReminderEmail({
            lang,
            event: event as any,
            ticketUrl: `${appUrl()}/tickets/${encodeURIComponent(String(ticket.id))}`,
          })
          const emailResult = await sendEmail({
            to: attendee.email,
            subject: reminderEmail.subject,
            html: reminderEmail.html,
          })
          if (emailResult.success) emailsSent++

          // WhatsApp when a phone is on file: the organizer's own words when
          // they wrote some, else the stock text.
          if (attendee.phone) {
            const whatsappResult = await sendWhatsAppMessage({
              to: attendee.phone,
              message: reminder.message
                ? `*${event.title}*\n\n${reminder.message}\n\n---\nTikèm`
                : getEventReminderWhatsApp(
                    attendee.full_name || 'Guest',
                    event.title,
                    24,
                    `${event.venue_name}, ${event.city}`
                  ),
            })
            if (whatsappResult.success) whatsappSent++
          }
        }
        return { emailsSent, whatsappSent }
      },
    })

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      ...result,
    })
  } catch (error: any) {
    console.error('Event reminder cron error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process event reminders' },
      { status: 500 }
    )
  }
}
