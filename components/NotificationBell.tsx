'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import Link from 'next/link'

interface NotificationBellProps {
  userId: string
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [mounted, setMounted] = useState(false)

  /**
   * BUNDLE: Firestore is fetched here, not imported at module scope. This bell
   * renders only for signed-in users, and a static import put the whole 444KB
   * Firebase client (223 + 136 + 85KB of the ~988KB shared JS) on the first
   * load of every route the navbar appears on — i.e. all of them, for everyone.
   * The navbar now loads this component itself with next/dynamic; keeping the
   * SDK import inside the effect is what makes that pay off.
   *
   * LISTENER LIFETIME: because the import is awaited, cleanup can run BEFORE
   * onSnapshot ever exists — that is the normal case under React 18
   * StrictMode, which mounts, unmounts and re-mounts every effect in dev. So
   * `cancelled` is checked both before subscribing (skip it entirely) and after
   * (tear down the one we just made), and every setState is gated on it. The
   * unsubscribe is also stashed for the ordinary path where teardown comes
   * later. A leaked Firestore listener per mount would cost far more than the
   * bundle ever did.
   */
  useEffect(() => {
    setMounted(true)

    if (!userId) return

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    ;(async () => {
      try {
        const [{ collection, onSnapshot, query, where }, { db }] = await Promise.all([
          import('firebase/firestore'),
          import('@/lib/firebase/client'),
        ])
        // Unmounted while the chunk was in flight: never open the listener.
        if (cancelled) return

        // Real-time listener for unread notifications
        const notificationsRef = collection(db, 'users', userId, 'notifications')
        const q = query(notificationsRef, where('isRead', '==', false))

        const unsub = onSnapshot(
          q,
          (snapshot) => {
            if (cancelled) return
            setUnreadCount(snapshot.size)
          },
          (error) => {
            // Handle errors gracefully - don't break the UI
            if (error.code === 'permission-denied') {
              console.warn('Notifications permission denied. Please configure Firestore security rules.')
            } else if (error.code === 'unavailable') {
              console.warn('Firestore temporarily unavailable. Notifications will retry automatically.')
            } else {
              console.error('Error listening to notifications:', error)
            }
            // Set count to 0 on error so the UI still works
            if (!cancelled) setUnreadCount(0)
          }
        )

        // Teardown may have happened between the check above and this line.
        if (cancelled) {
          try {
            unsub()
          } catch (error) {
            console.error('Error unsubscribing from notifications:', error)
          }
          return
        }
        unsubscribe = unsub
      } catch (error) {
        console.error('Failed to initialize notifications listener:', error)
        if (!cancelled) setUnreadCount(0)
      }
    })()

    return () => {
      cancelled = true
      if (unsubscribe) {
        try {
          unsubscribe()
        } catch (error) {
          console.error('Error unsubscribing from notifications:', error)
        }
      }
    }
  }, [userId])
  
  // Prevent hydration mismatch by not showing count until mounted
  if (!mounted) {
    return (
      <Link
        href="/notifications"
        className="relative p-2 rounded-lg text-fg-muted hover:bg-surface-low transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
      </Link>
    )
  }

  return (
    <Link
      href="/notifications"
      className="relative p-2 rounded-lg text-fg-muted hover:bg-surface-low transition-colors"
      title="Notifications"
    >
      <Bell className="w-5 h-5" />
      {unreadCount > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-fg transform translate-x-1/2 -translate-y-1/2 bg-danger-strong rounded-full min-w-[1.25rem]">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  )
}
