import { adminDb } from '@/lib/firebase/admin'
import type { NotificationType } from '@/types/database'
import { sendExpoPushNotificationToUser } from '@/lib/push/expo'
import { readUserNotifyPref } from '@/lib/notifications/userPreferences'

/**
 * SERVER-SIDE notification triggers
 * Uses Firebase Admin SDK for all database operations
 */

/**
 * Get user notification preferences (server-side)
 *
 * Exported because `lib/notifications/helpers` pushes directly rather than
 * calling the wrappers below — see the note on `sendPushNotification`.
 */
export async function getNotificationPreferences(userId: string) {
  try {
    const userDoc = await adminDb.collection('users').doc(userId).get()
    
    if (!userDoc.exists) {
      return {
        notifyTicketPurchase: true,
        notifyEventUpdates: true,
        notifyReminders: true
      }
    }
    
    const data = userDoc.data()
    return {
      notifyTicketPurchase: data?.notify_ticket_purchase ?? true,
      notifyEventUpdates: readUserNotifyPref(data, 'notify_event_updates'),
      notifyReminders: readUserNotifyPref(data, 'notify_reminders')
    }
  } catch (error) {
    console.error('Error getting notification preferences:', error)
    return {
      notifyTicketPurchase: true,
      notifyEventUpdates: true,
      notifyReminders: true
    }
  }
}

/**
 * Push a notification to the user's MOBILE devices (Expo), server-side only.
 *
 * This used to also POST to /api/push/send-user for web push. That route is
 * admin-only and this call carried no session, so every request came back 401
 * and no web push was ever delivered (no service worker is registered either).
 * Web push offers were removed from the site (2026-10-25); the app's Expo push
 * is the one push channel, called directly as a library function, never over
 * HTTP.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
  data?: Record<string, any>
): Promise<void> {
  try {
    await sendExpoPushNotificationToUser(userId, title, body, url, data)
  } catch (error) {
    console.error('Error sending push notification:', error)
  }
}

/**
 * Notify user about ticket purchase
 */
export async function notifyTicketPurchase(
  userId: string,
  eventTitle: string,
  ticketId: string,
  eventId: string
): Promise<void> {
  // Check user preferences
  const prefs = await getNotificationPreferences(userId)
  
  // Always create in-app notification via server-side helper
  const { createNotification } = await import('./notifications/helpers')
  await createNotification(
    userId,
    'ticket_purchased',
    'Ticket Purchased Successfully!',
    `Your ticket for "${eventTitle}" has been confirmed. Show your QR code at the entrance.`,
    // `/events/<id>/tickets/<id>` was linked here for a long time and NO SUCH
    // ROUTE EXISTS — every purchase notification landed on a 404. The buyer's
    // tickets for an event live at /tickets/event/<eventId>.
    `/tickets/event/${eventId}`,
    { eventId, ticketId }
  )

  // Send push notification if enabled
  if (prefs.notifyTicketPurchase) {
    await sendPushNotification(
      userId,
      'Ticket Purchased! 🎫',
      `Your ticket for "${eventTitle}" is ready`,
      `/tickets/event/${eventId}`,
      {
        type: 'ticket_purchased',
        ticketId,
        eventId
      }
    )
  }
}

/**
 * Notify all attendees about event update
 */
export async function notifyEventUpdate(
  eventId: string,
  eventTitle: string,
  updateMessage: string,
  attendeeIds: string[]
): Promise<void> {
  const { createNotification } = await import('./notifications/helpers')
  
  const notifications = attendeeIds.map(async (userId) => {
    const prefs = await getNotificationPreferences(userId)
    
    // Create in-app notification
    await createNotification(
      userId,
      'event_updated',
      `Event Update: ${eventTitle}`,
      updateMessage,
      `/events/${eventId}`,
      { eventId }
    )

    // Send push notification if enabled
    if (prefs.notifyEventUpdates) {
      await sendPushNotification(
        userId,
        `Event Update: ${eventTitle}`,
        updateMessage,
        `/events/${eventId}`,
        {
          type: 'event_updated',
          eventId
        }
      )
    }
  })

  await Promise.all(notifications)
}

/**
 * Send event reminder to attendees
 */
export async function sendEventReminder(
  eventId: string,
  eventTitle: string,
  startDateTime: Date,
  attendeeIds: string[],
  reminderType: 'event_reminder_24h' | 'event_reminder_3h' | 'event_reminder_30min'
): Promise<void> {
  const timeLabels = {
    event_reminder_24h: '24 hours',
    event_reminder_3h: '3 hours',
    event_reminder_30min: '30 minutes'
  }

  const timeLabel = timeLabels[reminderType]
  const formattedDate = startDateTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

  const { createNotification } = await import('./notifications/helpers')
  
  const notifications = attendeeIds.map(async (userId) => {
    const prefs = await getNotificationPreferences(userId)
    
    if (!prefs.notifyReminders) {
      return // Skip if user has disabled reminders
    }

    // Create in-app notification
    await createNotification(
      userId,
      reminderType,
      `Reminder: ${eventTitle}`,
      `Your event starts in ${timeLabel}! ${formattedDate}`,
      `/events/${eventId}`,
      { eventId }
    )

    // Send push notification
    await sendPushNotification(
      userId,
      `⏰ Event Reminder: ${eventTitle}`,
      `Starting in ${timeLabel} - ${formattedDate}`,
      `/events/${eventId}`,
      {
        type: reminderType,
        eventId
      }
    )
  })

  await Promise.all(notifications)
}

/**
 * Notify organizer about a ticket sale
 */
export async function notifyOrganizerTicketSale(
  organizerId: string,
  eventTitle: string,
  eventId: string,
  ticketCount: number,
  revenue: number
): Promise<void> {
  // Check organizer preferences
  const prefs = await getNotificationPreferences(organizerId)
  
  // Create in-app notification
  const { createNotification } = await import('./notifications/helpers')
  await createNotification(
    organizerId,
    'ticket_purchased',
    `🎫 ${ticketCount} New Ticket${ticketCount > 1 ? 's' : ''} Sold!`,
    `${ticketCount} ticket${ticketCount > 1 ? 's' : ''} sold for "${eventTitle}". Revenue: $${revenue.toFixed(2)}`,
    `/organizer/events/${eventId}/attendees`,
    { eventId, ticketCount, revenue }
  )

  // Send push notification if enabled
  if (prefs.notifyTicketPurchase) {
    await sendPushNotification(
      organizerId,
      `🎫 New Sale: ${eventTitle}`,
      `${ticketCount} ticket${ticketCount > 1 ? 's' : ''} sold - $${revenue.toFixed(2)}`,
      `/organizer/events/${eventId}/attendees`,
      {
        type: 'ticket_sale',
        eventId,
        ticketCount,
        revenue
      }
    )
  }
}
