'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth, db } from '@/lib/firebase/client'
import { onAuthStateChanged, User } from 'firebase/auth'
import { collection, query, where, getDocs, serverTimestamp, deleteDoc, doc, setDoc } from 'firebase/firestore'
import {
  ConsoleButton,
  ConsoleCaption,
  ConsolePanel,
  ConsoleSection,
} from '@/components/admin/console'

/**
 * Test data — seeds seven sample events (each with three ticket tiers) under
 * the signed-in admin's own organizer account, and offers a destructive
 * delete-then-recreate that wipes every event that account already owns.
 *
 * The seeding and deleting logic is untouched by the console restyle,
 * including the window.confirm that names the exact number of events about to
 * be destroyed — that count is the only thing standing between a slip and a
 * wiped organizer.
 *
 * The page frame (container, breadcrumb trail, title) comes from DevToolShell.
 */
export default function CreateTestDataClient() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [results, setResults] = useState<string[]>([])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const deleteAndRecreateEvents = async () => {
    if (!user) {
      setResults(['❌ You must be logged in to manage test events'])
      return
    }

    // Look up the organizer and their events up-front so the confirmation can
    // state exactly how many events are about to be destroyed.
    let userId: string
    let eventsSnapshot: Awaited<ReturnType<typeof getDocs>>
    try {
      const usersQuery = query(collection(db, 'users'), where('email', '==', user.email))
      const userSnapshot = await getDocs(usersQuery)

      if (userSnapshot.empty) {
        setResults(['❌ User document not found in database'])
        return
      }

      userId = userSnapshot.docs[0].id
      const eventsQuery = query(collection(db, 'events'), where('organizer_id', '==', userId))
      eventsSnapshot = await getDocs(eventsQuery)
    } catch (error: any) {
      setResults(['', `❌ Error: ${error.message}`])
      return
    }

    const eventCount = eventsSnapshot.size
    const confirmed = window.confirm(
      `⚠️ IRREVERSIBLE ACTION\n\n` +
      `This will PERMANENTLY DELETE all ${eventCount} event${eventCount === 1 ? '' : 's'} for ${user.email} ` +
      `and every associated ticket tier, then recreate ${testEvents.length} fresh test events.\n\n` +
      `Deleted events and tiers cannot be recovered. Continue?`
    )
    if (!confirmed) return

    setDeleting(true)
    setResults(['🗑️ Deleting existing test events...', ''])

    try {
      setResults(prev => [...prev, `✅ Found user: ${user.email}`, ''])

      let deletedCount = 0
      let deletedTiersCount = 0

      for (const eventDoc of eventsSnapshot.docs) {
        // Delete ticket tiers for this event
        const tiersQuery = query(collection(db, 'ticket_tiers'), where('event_id', '==', eventDoc.id))
        const tiersSnapshot = await getDocs(tiersQuery)

        for (const tierDoc of tiersSnapshot.docs) {
          await deleteDoc(tierDoc.ref)
          deletedTiersCount++
        }

        await deleteDoc(eventDoc.ref)
        setResults(prev => [...prev, `🗑️ Deleted: ${(eventDoc.data() as any).title}`])
        deletedCount++
      }

      setResults(prev => [...prev, '', `✅ Deleted ${deletedCount} events and ${deletedTiersCount} ticket tiers`, '', '🔄 Creating new test events...', ''])
      setDeleting(false)

      // Now create new events
      await createTestEvents(userId)

    } catch (error: any) {
      setResults(prev => [...prev, '', `❌ Error: ${error.message}`])
      setDeleting(false)
    }
  }

  const testEvents = [
    {
      title: 'Tech Innovation Summit 2025',
      description: 'Join Haiti\'s premier technology conference featuring keynote speakers, workshops, and networking opportunities. Explore the latest innovations in AI, blockchain, and digital transformation shaping Haiti\'s tech landscape.',
      category: 'Technology',
      venue_name: 'Port-au-Prince Convention Center',
      venue_address: '123 Tech Avenue, Pétion-Ville, Port-au-Prince',
      address: '123 Tech Avenue, Pétion-Ville, Port-au-Prince',
      city: 'Port-au-Prince',
      commune: 'Pétion-Ville',
      start_datetime: new Date('2025-12-15T09:00:00').toISOString(),
      end_datetime: new Date('2025-12-15T17:00:00').toISOString(),
      ticket_price: 2500,
      price: 2500,
      currency: 'HTG',
      total_tickets: 500,
      banner_image_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80',
      is_virtual: false,
      is_featured: true,
      is_published: true
    },
    {
      title: 'Haiti Jazz & Arts Festival',
      description: 'Experience the vibrant sounds of Haitian jazz and international artists in this week-long celebration of music and culture. Features live performances, art exhibitions, and culinary experiences.',
      category: 'Music',
      venue_name: 'Jacmel Waterfront',
      venue_address: 'Beach Road, Jacmel',
      address: 'Beach Road, Jacmel',
      city: 'Jacmel',
      commune: 'Jacmel',
      start_datetime: new Date('2026-01-20T18:00:00').toISOString(),
      end_datetime: new Date('2026-01-20T23:00:00').toISOString(),
      ticket_price: 1500,
      price: 1500,
      currency: 'HTG',
      total_tickets: 1000,
      banner_image_url: 'https://images.unsplash.com/photo-1511735111819-9a3f7709049c?auto=format&fit=crop&w=1200&q=80',
      is_virtual: false,
      is_featured: true,
      is_published: true
    },
    {
      title: 'Entrepreneurship Workshop Series',
      description: 'A comprehensive 6-week program designed for aspiring entrepreneurs. Learn business fundamentals, financial planning, marketing strategies, and pitch preparation from successful Haitian business leaders.',
      category: 'Education',
      venue_name: 'Business Innovation Hub',
      venue_address: '45 Commerce Street, Port-au-Prince',
      address: '45 Commerce Street, Port-au-Prince',
      city: 'Port-au-Prince',
      commune: 'Port-au-Prince',
      start_datetime: new Date('2025-12-08T14:00:00').toISOString(),
      end_datetime: new Date('2025-12-08T18:00:00').toISOString(),
      ticket_price: 3000,
      price: 3000,
      currency: 'HTG',
      total_tickets: 150,
      banner_image_url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
      is_virtual: false,
      is_featured: false,
      is_published: true
    },
    {
      title: 'Haitian Cuisine Masterclass',
      description: 'Learn to prepare authentic Haitian dishes from renowned Chef Marie-Louise. This hands-on cooking class covers traditional recipes, local ingredients, and modern twists on classic favorites.',
      category: 'Food & Drink',
      venue_name: 'Culinary Arts Studio',
      venue_address: '78 Gourmet Lane, Pétion-Ville',
      address: '78 Gourmet Lane, Pétion-Ville',
      city: 'Pétion-Ville',
      commune: 'Pétion-Ville',
      start_datetime: new Date('2025-12-22T10:00:00').toISOString(),
      end_datetime: new Date('2025-12-22T14:00:00').toISOString(),
      ticket_price: 1800,
      price: 1800,
      currency: 'HTG',
      total_tickets: 40,
      banner_image_url: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=80',
      is_virtual: false,
      is_featured: false,
      is_published: true
    },
    {
      title: 'Charity 5K Run for Education',
      description: 'Run for a cause! Support education initiatives across Haiti while staying fit. All proceeds go toward building libraries and providing school supplies in underserved communities.',
      category: 'Sports',
      venue_name: 'Champ de Mars',
      venue_address: 'Champ de Mars, Port-au-Prince',
      address: 'Champ de Mars, Port-au-Prince',
      city: 'Port-au-Prince',
      commune: 'Port-au-Prince',
      start_datetime: new Date('2026-01-10T06:00:00').toISOString(),
      end_datetime: new Date('2026-01-10T09:00:00').toISOString(),
      ticket_price: 500,
      price: 500,
      currency: 'HTG',
      total_tickets: 2000,
      banner_image_url: 'https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?auto=format&fit=crop&w=1200&q=80',
      is_virtual: false,
      is_featured: true,
      is_published: true
    },
    {
      title: 'Art Gallery Opening: Haitian Masters',
      description: 'Grand opening of a new exhibition showcasing works by Haiti\'s most celebrated contemporary artists. Enjoy wine, light refreshments, and meet the artists in this elegant evening event.',
      category: 'Arts & Culture',
      venue_name: 'Musée d\'Art Haïtien',
      venue_address: '201 Art Boulevard, Port-au-Prince',
      address: '201 Art Boulevard, Port-au-Prince',
      city: 'Port-au-Prince',
      commune: 'Port-au-Prince',
      start_datetime: new Date('2025-12-28T19:00:00').toISOString(),
      end_datetime: new Date('2025-12-28T22:00:00').toISOString(),
      ticket_price: 0,
      price: 0,
      currency: 'HTG',
      total_tickets: 300,
      banner_image_url: 'https://images.unsplash.com/photo-1531243269054-5ebf6f34081e?auto=format&fit=crop&w=1200&q=80',
      is_virtual: false,
      is_featured: true,
      is_published: true
    },
    {
      title: 'Digital Marketing Bootcamp',
      description: 'Master the fundamentals of digital marketing including social media strategy, SEO, content creation, and analytics. Perfect for small business owners and marketing professionals.',
      category: 'Business',
      venue_name: 'Online via Zoom',
      venue_address: 'Virtual Event',
      address: 'Virtual Event',
      city: 'Port-au-Prince',
      commune: 'Port-au-Prince',
      start_datetime: new Date('2025-12-18T15:00:00').toISOString(),
      end_datetime: new Date('2025-12-18T18:00:00').toISOString(),
      ticket_price: 2000,
      price: 2000,
      currency: 'HTG',
      total_tickets: 500,
      banner_image_url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
      is_virtual: true,
      is_featured: false,
      is_published: true
    }
  ]

  const createTestEvents = async (userId?: string) => {
    if (!user) {
      setResults(['❌ You must be logged in to create test events'])
      return
    }

    setCreating(true)

    // Only add these messages if we're not already deleting
    if (!deleting) {
      setResults(['🔄 Starting event creation...', ''])
    }

    try {
      // Get user ID if not provided
      if (!userId) {
        const usersQuery = query(collection(db, 'users'), where('email', '==', user.email))
        const userSnapshot = await getDocs(usersQuery)

        if (userSnapshot.empty) {
          setResults(prev => [...prev, '❌ User document not found in database'])
          return
        }

        userId = userSnapshot.docs[0].id
        setResults(prev => [...prev, `✅ Found user: ${user.email}`, `✅ User ID: ${userId}`, ''])
      }

      let successCount = 0
      let errorCount = 0

      for (const event of testEvents) {
        try {
          // Create event with a pre-generated ID
          const eventId = doc(collection(db, 'events')).id

          const eventData = {
            ...event,
            id: eventId,
            organizer_id: userId,
            tickets_sold: 0,
            // Every event doc must carry country, rejected and reports_count:
            // the feed and the moderation tabs filter on them server-side, and
            // Firestore drops documents missing a filtered field.
            country: 'HT',
            rejected: false,
            reports_count: 0,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
          }

          await setDoc(doc(db, 'events', eventId), eventData)
          setResults(prev => [...prev, `✅ Created: ${event.title} (ID: ${eventId})`])

          // Create ticket tiers for this event
          const tiers = [
            {
              event_id: eventId,
              name: 'General Admission',
              description: 'Standard entry ticket with full event access',
              price: event.ticket_price,
              total_quantity: Math.floor(event.total_tickets * 0.6), // 60% of tickets
              sold_quantity: 0,
              sort_order: 1,
              is_active: true,
              sales_start: null,
              sales_end: null,
              created_at: serverTimestamp(),
              updated_at: serverTimestamp()
            },
            {
              event_id: eventId,
              name: 'VIP Access',
              description: 'Premium seating, exclusive lounge access, and complimentary refreshments',
              price: event.ticket_price * 2,
              total_quantity: Math.floor(event.total_tickets * 0.25), // 25% of tickets
              sold_quantity: 0,
              sort_order: 2,
              is_active: true,
              sales_start: null,
              sales_end: null,
              created_at: serverTimestamp(),
              updated_at: serverTimestamp()
            },
            {
              event_id: eventId,
              name: 'Early Bird',
              description: 'Discounted tickets for early registrations',
              price: Math.floor(event.ticket_price * 0.75), // 25% discount
              total_quantity: Math.floor(event.total_tickets * 0.15), // 15% of tickets
              sold_quantity: 0,
              sort_order: 0,
              is_active: true,
              sales_start: null,
              sales_end: new Date(new Date(event.start_datetime).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Ends 7 days before event
              created_at: serverTimestamp(),
              updated_at: serverTimestamp()
            }
          ]

          for (const tier of tiers) {
            const tierId = doc(collection(db, 'ticket_tiers')).id
            await setDoc(doc(db, 'ticket_tiers', tierId), { ...tier, id: tierId })
          }

          setResults(prev => [...prev, `   ↳ Added 3 ticket tiers`])
          successCount++
        } catch (error: any) {
          setResults(prev => [...prev, `❌ Failed: ${event.title} - ${error.message}`])
          errorCount++
        }
      }

      setResults(prev => [
        ...prev,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `✅ Successfully created ${successCount} events`,
        errorCount > 0 ? `❌ Failed to create ${errorCount} events` : '',
        '',
        '🎉 Done! You can now view the events at /discover'
      ])

    } catch (error: any) {
      setResults(prev => [...prev, '', `❌ Error: ${error.message}`])
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <ConsolePanel className="px-4 py-8 text-center">
        <span className="label-mono text-[13px] text-console-mut">Loading…</span>
      </ConsolePanel>
    )
  }

  if (!user) {
    return (
      <ConsolePanel className="mx-auto max-w-md px-6 py-8 text-center">
        <p className="text-sm font-semibold text-console-text">Authentication required</p>
        <p className="mb-5 mt-1 text-[13px] text-console-mut">
          You must be logged in to access this page.
        </p>
        <ConsoleButton
          variant="primary"
          onClick={() => router.push('/auth/login?redirect=/admin/system/dev/create-test-data')}
        >
          Go to Login
        </ConsoleButton>
      </ConsolePanel>
    )
  }

  return (
    <>
      <ConsoleCaption>
        Generates {testEvents.length} sample events with images under the signed-in account. For
        development and testing only.
      </ConsoleCaption>

      <ConsolePanel className="px-4 py-3.5">
        <div className="text-[13px] text-console-mut">
          <span className="font-semibold text-console-text">Logged in as</span>{' '}
          <span className="label-mono">{user.email}</span>
        </div>
        <div className="mt-0.5 text-[13px] text-console-mut">
          Events will be created under this account
        </div>
      </ConsolePanel>

      <ConsoleSection>Events to be created ({testEvents.length})</ConsoleSection>
      <ConsolePanel className="max-h-48 overflow-y-auto px-4 py-3">
        <ul className="space-y-2 text-[13px] text-console-mut">
          {testEvents.map((event, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="text-console-faint">•</span>
              <div>
                <span className="font-medium text-console-text">{event.title}</span>
                <span className="ml-2 text-console-faint">
                  ({event.category}, {event.price === 0 ? 'FREE' : `${event.currency} ${event.price.toLocaleString()}`})
                </span>
              </div>
            </li>
          ))}
        </ul>
      </ConsolePanel>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ConsoleButton
          variant="primary"
          onClick={() => createTestEvents()}
          disabled={creating || deleting}
        >
          {creating ? 'Creating Events...' : 'Create Test Events'}
        </ConsoleButton>

        <ConsoleButton
          variant="danger"
          onClick={deleteAndRecreateEvents}
          disabled={creating || deleting}
        >
          {deleting ? 'Deleting & Recreating...' : 'Delete Old & Create Fresh'}
        </ConsoleButton>
      </div>

      {results.length > 0 && (
        <>
          <ConsoleSection>Output</ConsoleSection>
          <ConsolePanel className="p-2">
            <div className="label-mono max-h-96 overflow-y-auto rounded bg-console-ground p-4 text-[13px] text-console-mut">
              {results.map((line, index) => (
                <div key={index} className="mb-1">
                  {line}
                </div>
              ))}
            </div>
          </ConsolePanel>
        </>
      )}

      {results.some(r => r.includes('Successfully created')) && (
        <div className="mt-4 flex flex-wrap gap-3">
          <ConsoleButton onClick={() => router.push('/discover')}>View Events</ConsoleButton>
          <ConsoleButton onClick={() => router.push('/organizer/events')}>
            Manage Events
          </ConsoleButton>
        </div>
      )}

      <ConsoleSection>Note</ConsoleSection>
      <p className="text-[13px] text-console-mut">
        Temporary admin page. This should be deleted after testing. It&apos;s only for development
        purposes.
      </p>
    </>
  )
}
