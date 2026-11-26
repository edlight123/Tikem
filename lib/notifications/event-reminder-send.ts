import { sendPushNotification } from '@/lib/notification-triggers'
import { createNotification } from '@/lib/notifications/helpers'
import type { NotificationType } from '@/types/database'
import { getEventReminderWhatsApp } from '@/lib/whatsapp'
import { cleanReminderMessage, spanLabel, type EventReminder } from './event-reminder-settings'

/**
 * The organizer's words are re-cleaned at send time (links, emails and phone
 * numbers stripped, plain text, capped) even though the save already cleaned
 * them: stored data may predate the rule or arrive by another path. They are
 * always attributed ("<organizer>: ..."), never presented as Tikèm's own.
 */
export function customReminderCopy(
  eventTitle: string,
  reminder: EventReminder,
  organizerName?: string | null
): { title: string; body: string } {
  const message = cleanReminderMessage(reminder.message)
  const org = String(organizerName || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'The organizer'
  return {
    title: `Reminder: ${eventTitle}`,
    body: message ? `${org}: ${message}` : `"${eventTitle}" starts in ${spanLabel(reminder.minutes_before)}!`,
  }
}

/** The organizer's display name as stored on the event. */
export function eventOrganizerName(event: Record<string, any> | null | undefined): string {
  return String(event?.organizer_name || event?.organization_name || '').trim()
}

/** The bell icon type: the closest stock tier, so older app builds render it. */
export function customReminderType(minutesBefore: number): NotificationType {
  if (minutesBefore >= 24 * 60) return 'event_reminder_24h'
  if (minutesBefore >= 3 * 60) return 'event_reminder_3h'
  return 'event_reminder_30min'
}

/**
 * The bell entry and push for a reminder the organizer moved, added or
 * reworded. Stock reminders keep going through sendEventReminder in
 * lib/notification-triggers with their original copy.
 *
 * One bell entry plus one push, the same shape as helpers.notifyTicketPurchase
 * (createNotification + sendPushNotification directly), never a trigger wrapper
 * that writes a second bell entry. Reminders are TRANSACTIONAL (lib/notifications/policy), so no quiet hours or
 * caps. One attendee's failure never stops the rest.
 */
export async function sendConfiguredEventReminder(opts: {
  eventId: string
  eventTitle: string
  organizerName?: string | null
  attendeeIds: string[]
  reminder: EventReminder
}): Promise<void> {
  const { eventId, eventTitle, attendeeIds, reminder } = opts
  const { title, body } = customReminderCopy(eventTitle, reminder, opts.organizerName)
  const type = customReminderType(reminder.minutes_before)
  const url = `/events/${eventId}`

  await Promise.allSettled(
    attendeeIds.map(async (userId) => {
      await createNotification(userId, type, title, body, url, { eventId })
      await sendPushNotification(userId, title, body, url, {
        type,
        eventId,
        reminderId: reminder.id,
      })
    })
  )
}

/**
 * The day-before WhatsApp text: always the stock template. There is no
 * parameter for the organizer's message, so it cannot leak onto this channel.
 */
export function dayBeforeWhatsAppText(attendee: Record<string, any>, event: Record<string, any>): string {
  return getEventReminderWhatsApp(
    attendee?.full_name || 'Guest',
    event?.title,
    24,
    `${event?.venue_name}, ${event?.city}`
  )
}
