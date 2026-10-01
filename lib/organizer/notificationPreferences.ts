/**
 * Organizer notification preferences — organizers/{uid}/notificationPreferences/main.
 *
 * One definition of the fields and their defaults, shared by the web settings
 * page and GET /api/organizer/settings/notifications (which the mobile app
 * reads, since client rules do not expose that subcollection).
 */
export const ORGANIZER_NOTIFICATION_DEFAULTS = {
  email_ticket_sales: true,
  email_new_reviews: true,
  email_payout_updates: true,
  email_event_reminders: true,
  email_marketing: false,
  sms_ticket_sales: false,
  sms_event_reminders: false,
  push_ticket_sales: true,
  push_new_reviews: true,
} as const

export type OrganizerNotificationPreferences = {
  -readonly [K in keyof typeof ORGANIZER_NOTIFICATION_DEFAULTS]: boolean
}

export function withOrganizerNotificationDefaults(
  stored: Record<string, any> | null | undefined
): OrganizerNotificationPreferences {
  const out = { ...ORGANIZER_NOTIFICATION_DEFAULTS } as OrganizerNotificationPreferences
  for (const key of Object.keys(ORGANIZER_NOTIFICATION_DEFAULTS) as (keyof OrganizerNotificationPreferences)[]) {
    const value = stored?.[key]
    if (typeof value === 'boolean') out[key] = value
  }
  return out
}
