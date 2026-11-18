'use client'

import { useState, useEffect } from 'react'
import { auth, db } from '@/lib/firebase/client'
import { onAuthStateChanged, User } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import {
  ConsoleButton,
  ConsoleCaption,
  ConsolePanel,
  ConsoleSection,
} from '@/components/admin/console'

/**
 * Database debug — a read-only dump of the signed-in admin's own Firestore
 * shape (their user doc, events, favorites, follows, tiers).
 *
 * The screen is console-styled but the query block below is untouched: the
 * counts and samples it assembles are what someone reads this page for, and
 * the console.log lines are part of how it is used.
 *
 * The page frame (container, breadcrumb trail, title) comes from DevToolShell,
 * so nothing here renders a page wrapper or a heading of its own.
 */
export default function DebugDBClient() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState<any>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const checkDatabase = async () => {
    if (!user) {
      setResults({ error: 'Not logged in' })
      return
    }

    setLoading(true)
    try {
      // Get user document
      const usersQuery = query(collection(db, 'users'), where('email', '==', user.email))
      const userSnapshot = await getDocs(usersQuery)
      const userId = userSnapshot.docs[0]?.id

      // Get all events
      const eventsSnapshot = await getDocs(collection(db, 'events'))
      const allEvents = eventsSnapshot.docs.map(doc => {
        const data = doc.data()
        return {
          firestoreId: doc.id,
          hasIdField: 'id' in data,
          idFieldValue: (data as any).id,
          ...data
        }
      })

      // Get events by this user
      const userEventsQuery = query(collection(db, 'events'), where('organizer_id', '==', userId))
      const userEventsSnapshot = await getDocs(userEventsQuery)
      const userEvents = userEventsSnapshot.docs.map(doc => ({
        firestoreId: doc.id,
        ...doc.data()
      }))

      // Get event_favorites
      const favoritesSnapshot = await getDocs(collection(db, 'event_favorites'))
      const allFavorites = favoritesSnapshot.docs.map(doc => ({
        firestoreId: doc.id,
        ...doc.data()
      }))

      // Get user's favorites
      const userFavoritesQuery = query(collection(db, 'event_favorites'), where('user_id', '==', userId))
      const userFavoritesSnapshot = await getDocs(userFavoritesQuery)
      const userFavorites = userFavoritesSnapshot.docs.map(doc => ({
        firestoreId: doc.id,
        ...doc.data()
      }))

      // Test date comparison
      const now = new Date().toISOString()
      const nowDate = new Date()
      console.log('Testing date comparisons:')
      console.log('Now as ISO string:', now)
      console.log('Now as Date:', nowDate)

      // Try to query upcoming events
      const upcomingQuery = query(
        collection(db, 'events'),
        where('organizer_id', '==', userId),
        where('start_datetime', '>=', now)
      )
      const upcomingSnapshot = await getDocs(upcomingQuery)
      const upcomingEvents = upcomingSnapshot.docs.map(doc => doc.data())

      console.log('Upcoming events found:', upcomingEvents.length)

      // Get organizer_follows
      const followsSnapshot = await getDocs(collection(db, 'organizer_follows'))
      const allFollows = followsSnapshot.docs.map(doc => ({
        firestoreId: doc.id,
        ...doc.data()
      }))

      // Get ticket_tiers
      const tiersSnapshot = await getDocs(collection(db, 'ticket_tiers'))
      const allTiers = tiersSnapshot.docs.map(doc => ({
        firestoreId: doc.id,
        ...doc.data()
      }))

      setResults({
        userId,
        userEmail: user.email,
        currentTime: now,
        totalEvents: allEvents.length,
        userEvents: userEvents.length,
        upcomingEventsCount: upcomingEvents.length,
        totalFavorites: allFavorites.length,
        userFavorites: userFavorites.length,
        totalFollows: allFollows.length,
        totalTiers: allTiers.length,
        sampleEvent: allEvents[0],
        sampleUserEvent: userEvents[0],
        sampleUpcomingEvent: upcomingEvents[0],
        sampleFavorite: allFavorites[0],
        sampleUserFavorite: userFavorites[0],
        sampleFollow: allFollows[0],
        sampleTier: allTiers[0],
        allEvents: allEvents.slice(0, 3),
        allUserEvents: userEvents,
        allUpcomingEvents: upcomingEvents,
        allUserFavorites: userFavorites,
      })
    } catch (error: any) {
      setResults({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // First paint, before Firebase has answered who is signed in.
  if (loading && !user) {
    return (
      <ConsolePanel className="px-4 py-8 text-center">
        <span className="label-mono text-meta text-console-mut">Loading…</span>
      </ConsolePanel>
    )
  }

  if (!user) {
    return (
      <ConsolePanel className="px-4 py-8 text-center">
        <p className="text-sm font-semibold text-console-text">Please sign in</p>
        <p className="mt-1 text-meta text-console-mut">
          This tool reads the database as the signed-in admin.
        </p>
      </ConsolePanel>
    )
  }

  return (
    <>
      <ConsoleCaption>
        Reads the live database and dumps counts plus sample documents for events, favorites,
        follows and ticket tiers. Nothing here writes.
      </ConsoleCaption>

      <ConsoleButton variant="primary" onClick={checkDatabase} disabled={loading}>
        {loading ? 'Checking...' : 'Check Database'}
      </ConsoleButton>

      {results && (
        <>
          <ConsoleSection>Output</ConsoleSection>
          <ConsolePanel className="p-2">
            <pre className="label-mono max-h-[600px] overflow-auto rounded bg-console-ground p-4 text-xs text-console-mut">
              {JSON.stringify(results, null, 2)}
            </pre>
          </ConsolePanel>
        </>
      )}
    </>
  )
}
