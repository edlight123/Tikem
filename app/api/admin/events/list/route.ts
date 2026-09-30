import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import type { EventModerationTab } from '@/lib/admin/event-moderation'

const PAGE_SIZE = 50

/**
 * Apply the moderation-tab predicate to a Firestore query.
 *
 * These filters run against the normalized `is_published`, `rejected`, and
 * `reports_count` fields (see scripts/backfill-event-moderation-fields.js).
 * Because Firestore drops docs missing a filtered field, every event MUST carry
 * these fields — run the backfill before relying on this endpoint.
 */
function applyTab(query: FirebaseFirestore.Query, tab: EventModerationTab): FirebaseFirestore.Query {
  switch (tab) {
    case 'published':
      return query.where('is_published', '==', true)
    case 'pending':
      return query.where('is_published', '==', false).where('rejected', '==', false)
    case 'unpublished':
      return query.where('is_published', '==', false).where('rejected', '==', true)
    case 'reported':
      return query.where('reports_count', '>', 0)
    default:
      return query
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const tab: EventModerationTab = body.tab || 'published'
    const filters = body.filters || {}
    const searchQuery: string = body.searchQuery || ''
    const cursor: string | null = body.cursor || null
    const sortBy: string = filters.sortBy || 'newest'

    const events = adminDb.collection('events')

    // --- True per-tab counts (server-side, over ALL events) --------------------
    // These are the authoritative badge numbers, independent of pagination or
    // the in-memory city/category/search refinement below.
    const tabs: EventModerationTab[] = ['pending', 'published', 'reported', 'unpublished']
    let counts: Record<EventModerationTab, number>
    try {
      const countSnaps = await Promise.all(
        tabs.map((t) => applyTab(events, t).count().get()),
      )
      counts = {
        pending: countSnaps[0].data().count,
        published: countSnaps[1].data().count,
        reported: countSnaps[2].data().count,
        unpublished: countSnaps[3].data().count,
      }
    } catch (err: any) {
      // A FAILED_PRECONDITION here almost always means a composite index is still
      // building. Surface it explicitly instead of returning zeroed counts that
      // look like "no work to do".
      console.error('Event tab count failed (index may be building):', err?.message || err)
      return NextResponse.json(
        {
          error: 'index_building',
          message:
            'Event moderation indexes are still building. Counts and lists will be available once they finish.',
        },
        { status: 200 },
      )
    }

    // --- Paginated, sorted list for the active tab -----------------------------
    let listQuery = applyTab(events, tab)
    if (tab === 'reported') {
      // reports_count is a range filter, so it must lead the ordering.
      listQuery = listQuery.orderBy('reports_count', 'desc')
    } else if (sortBy === 'soonest') {
      listQuery = listQuery.orderBy('start_datetime', 'asc')
    } else {
      listQuery = listQuery.orderBy('created_at', 'desc')
    }

    if (cursor) {
      const cursorDoc = await events.doc(cursor).get()
      if (cursorDoc.exists) listQuery = listQuery.startAfter(cursorDoc)
    }

    let snapshot: FirebaseFirestore.QuerySnapshot
    try {
      snapshot = await listQuery.limit(PAGE_SIZE).get()
    } catch (err: any) {
      console.error('Event list query failed (index may be building):', err?.message || err)
      return NextResponse.json(
        {
          error: 'index_building',
          message:
            'Event moderation indexes are still building. This tab will load once they finish.',
        },
        { status: 200 },
      )
    }

    const hasMore = snapshot.size === PAGE_SIZE
    const nextCursor = hasMore ? snapshot.docs[snapshot.docs.length - 1].id : null

    // Resolve organizers in batches of 10 (Firestore 'in' limit).
    const organizerIds = Array.from(
      new Set(snapshot.docs.map((d: any) => d.data().organizer_id).filter(Boolean)),
    )
    const organizersMap = new Map<string, { name: string; email: string; verified: boolean }>()
    if (organizerIds.length > 0) {
      // Resolve users by document reference (getAll) rather than a
      // `where('__name__', 'in', batch)` query: filtering on the documentId
      // requires Key values, not bare id strings, so passing plain ids throws
      // "__key__ filter value must be a Key". getAll takes plain refs, has no
      // 10-item cap, and returns missing docs with `exists === false`.
      const refs = (organizerIds as string[]).map((id) => adminDb.collection('users').doc(id))
      const results = await adminDb.getAll(...refs)
      results.forEach((doc: any) => {
        if (!doc.exists) return
        const data = doc.data()
        organizersMap.set(doc.id, {
          name: data.full_name || data.email || 'Unknown',
          email: data.email || '',
          verified: data.verified || false,
        })
      })
    }

    // Ticket counts via aggregation (no more per-event full-scan reads).
    const eventsWithData = await Promise.all(
      snapshot.docs.map(async (doc: any) => {
        const data = doc.data()
        const organizer = organizersMap.get(data.organizer_id) || {
          name: 'Unknown',
          email: '',
          verified: false,
        }

        let tickets_sold = 0
        try {
          const ticketsCount = await adminDb
            .collection('tickets')
            .where('event_id', '==', doc.id)
            .where('status', '!=', 'cancelled')
            .count()
            .get()
          tickets_sold = ticketsCount.data().count || 0
        } catch {
          tickets_sold = 0
        }

        return {
          id: doc.id,
          title: data.title,
          description: data.description,
          start_datetime: data.start_datetime?.toDate?.()?.toISOString() || data.start_datetime,
          end_datetime: data.end_datetime?.toDate?.()?.toISOString() || data.end_datetime,
          city: data.city || '',
          venue_name: data.venue_name,
          address: data.venue_address || data.address,
          banner_image_url: data.banner_image || data.banner_image_url,
          category: data.category || '',
          is_published: data.is_published || false,
          featured: data.featured || false,
          max_attendees: data.max_attendees || 0,
          organizer_id: data.organizer_id,
          organizer_name: organizer.name,
          organizer_email: organizer.email,
          organizer_verified: organizer.verified,
          tickets_sold,
          reports_count: data.reports_count || 0,
          hidden_pending_review: data.hidden_pending_review === true,
          rejected: data.rejected || false,
        }
      }),
    )

    // In-memory refinement of the current page (secondary filters). These narrow
    // what is shown; the tab counts above remain the authoritative totals.
    let pageEvents = eventsWithData
    if (filters.city) pageEvents = pageEvents.filter((e) => e.city === filters.city)
    if (filters.category) pageEvents = pageEvents.filter((e) => e.category === filters.category)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      pageEvents = pageEvents.filter(
        (e) =>
          (e.title || '').toLowerCase().includes(q) ||
          (e.city || '').toLowerCase().includes(q) ||
          (e.organizer_name || '').toLowerCase().includes(q) ||
          (e.organizer_email || '').toLowerCase().includes(q),
      )
    }
    const refined = Boolean(filters.city || filters.category || searchQuery)

    return NextResponse.json({
      events: pageEvents,
      counts,
      nextCursor,
      hasMore,
      refined,
    })
  } catch (error) {
    console.error('Error listing events:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
