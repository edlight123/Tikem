import { getNotificationPreferences, sendPushNotification } from '@/lib/notification-triggers'
import { createNotification } from '@/lib/notifications/helpers'
import type { NotificationType } from '@/types/database'
import { spanLabel, type EventReminder } from './event-reminder-settings'

/**
 * The bell entry and push for a reminder the organizer moved, added or
 * reworded. Stock reminders keep going through sendEventReminder in
 * lib/notification-triggers with their original copy.
 *
 * One bell entry plus one push, the same shape as helpers.notifyTicketPurchase
 * (createNotification + sendPushNotification directly), never a trigger wrapper
 * that writes a second bell entry. Respects the attendee's reminders switch;
 * reminders are TRANSACTIONAL (lib/notifications/policy), so no quiet hours or
 * caps. One attendee's failure never stops the rest.
 */
export function customReminderCopy(eventTitle: string, reminder: EventReminder): { title: string; body: string } {
  return {
    title: `Reminder: ${eventTitle}`,
    body: reminder.message || `"${eventTitle}" starts in ${spanLabel(reminder.minutes_before)}!`,
  }
}

/** The bell icon type: the closest stock tier, so older app builds render it. */
export function customReminderType(minutesBefore: number): NotificationType {
  if (minutesBefore >= 24 * 60) return 'event_reminder_24h'
  if (minutesBefore >= 3 * 60) return 'event_reminder_3h'
  return 'event_reminder_30min'
}

export async function sendConfiguredEventReminder(opts: {
  eventId: string
  eventTitle: string
  attendeeIds: string[]
  reminder: EventReminder
}): Promise<void> {
  const { eventId, eventTitle, attendeeIds, reminder } = opts
  const { title, body } = customReminderCopy(eventTitle, reminder)
  const type = customReminderType(reminder.minutes_before)
  const url = `/events/${eventId}`

  await Promise.allSettled(
    attendeeIds.map(async (userId) => {
      const prefs = await getNotificationPreferences(userId)
      if (!prefs.notifyReminders) return
      await createNotification(userId, type, title, body, url, { eventId })
      await sendPushNotification(userId, title, body, url, {
        type,
        eventId,
        reminderId: reminder.id,
      })
    })
  )
}
