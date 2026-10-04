import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { isAdmin } from '@/lib/admin'
import { adminDb } from '@/lib/firebase/admin'
import { getUserNotificationsServer, getUnreadCountServer } from '@/lib/notifications/helpers'
import { NotificationsClient } from '@/components/NotificationsClient'

export const metadata = {
  title: 'Notifications | Tikèm',
  description: 'View your notifications'
}

export const revalidate = 30 // Cache for 30 seconds

// Depends on auth cookies and per-user notifications.
export const dynamic = 'force-dynamic'

/** The event a notification is about: its eventId, else an /events/{id} actionUrl. */
function eventIdOf(n: { eventId?: string; actionUrl?: string; metadata?: Record<string, any> }): string | null {
  if (n.eventId) return String(n.eventId)
  if (n.metadata?.eventId) return String(n.metadata.eventId)
  const m = typeof n.actionUrl === 'string' ? n.actionUrl.match(/\/events\/([^/?#]+)/) : null
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * Poster thumbnails for the inbox, keyed by notification id. Notifications do
 * not carry an image, so this reads each distinct event once (one batched
 * getAll). Presentation only: any failure returns {} and the rows fall back
 * to their glyph tiles.
 */
async function postersFor(notifications: any[]): Promise<Record<string, string>> {
  try {
    const byNotification = new Map<string, string>()
    for (const n of notifications) {
      const id = eventIdOf(n)
      if (id && !id.includes('/')) byNotification.set(n.id, id)
    }
    const ids = Array.from(new Set(byNotification.values())).slice(0, 50)
    if (ids.length === 0) return {}
    const snaps = await adminDb.getAll(...ids.map((id) => adminDb.collection('events').doc(id)))
    const image = new Map<string, string>()
    for (const s of snaps) {
      const d = s.exists ? s.data() : null
      const url = d?.banner_image_url || d?.image_url
      if (typeof url === 'string' && url) image.set(s.id, url)
    }
    const out: Record<string, string> = {}
    byNotification.forEach((eventId, notificationId) => {
      const url = image.get(eventId)
      if (url) out[notificationId] = url
    })
    return out
  } catch (error) {
    console.error('Error loading notification posters:', error)
    return {}
  }
}

export default async function NotificationsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/login?redirect=/notifications')
  }

  // Fetch notifications and unread count
  const [notifications, unreadCount] = await Promise.all([
    getUserNotificationsServer(user.id, 50),
    getUnreadCountServer(user.id)
  ])
  const posters = await postersFor(notifications)

  return (
    <>
      <Navbar user={user} isAdmin={isAdmin(user.email)} />
      <NotificationsClient
        userId={user.id}
        initialNotifications={notifications}
        initialUnreadCount={unreadCount}
        posters={posters}
      />
      <MobileNavWrapper user={user} isAdmin={isAdmin(user.email)} />
    </>
  )
}
