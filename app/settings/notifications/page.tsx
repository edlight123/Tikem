import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * This page used to offer web push ("Enable Push", "Send Test", topics kept in
 * localStorage). None of it worked: no service worker was registered, so
 * Enable hung, and the test and send routes are admin-only. Web push offers
 * were removed (2026-10-25). The notification switches the senders actually
 * read live in the profile's Notifications panel, so the old address lands
 * there. Push itself is delivered by the mobile app.
 */
export default function NotificationSettingsPage() {
  redirect('/profile#notifications')
}
