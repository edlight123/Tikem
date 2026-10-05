import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { liveTicketStatusesForQuery } from '@/lib/tickets/status'

export const dynamic = 'force-dynamic'

function serializeFirestoreValue(value: any): any {
  if (value == null) return value
  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate()
      if (d instanceof Date) return d.toISOString()
    } catch {
      // ignore
    }
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeFirestoreValue)
  if (typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serializeFirestoreValue(v)
    return out
  }
  return value
}

export async function GET(request: Request) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50'), 100)
    const status = searchParams.get('status') || ''
    const paymentMethod = searchParams.get('paymentMethod') || ''
    const currency = searchParams.get('currency') || ''
    const eventId = searchParams.get('eventId') || ''
    const search = searchParams.get('search') || ''
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const sortBy = searchParams.get('sortBy') || 'newest'

    // Build query
    let queryRef: any = adminDb.collection('tickets')

    // Apply filters
    if (status && status !== 'all') {
      queryRef = queryRef.where('status', '==', status)
    }

    if (paymentMethod && paymentMethod !== 'all') {
      queryRef = queryRef.where('payment_method', '==', paymentMethod)
    }

    if (currency && currency !== 'all') {
      queryRef = queryRef.where('currency', '==', currency.toUpperCase())
    }

    if (eventId) {
      queryRef = queryRef.where('event_id', '==', eventId)
    }

    // Date filters
    if (startDate) {
      const start = new Date(startDate)
      queryRef = queryRef.where('purchased_at', '>=', start)
    }

    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      queryRef = queryRef.where('purchased_at', '<=', end)
    }

    // Sorting
    if (sortBy === 'oldest') {
      queryRef = queryRef.orderBy('purchased_at', 'asc')
    } else if (sortBy === 'highest') {
      queryRef = queryRef.orderBy('price_paid', 'desc')
    } else if (sortBy === 'lowest') {
      queryRef = queryRef.orderBy('price_paid', 'asc')
    } else {
      queryRef = queryRef.orderBy('purchased_at', 'desc')
    }

    // Get total count (for pagination info). The aggregation query can fail in
    // some environments / index states — degrade gracefully instead of 500-ing.
    let totalCount = 0
    try {
      const countSnapshot = await queryRef.count().get()
      totalCount = countSnapshot.data().count
    } catch (countErr) {
      console.warn('orders count() failed; falling back to a capped scan', countErr)
      try {
        const capped = await queryRef.limit(1000).get()
        totalCount = capped.size
      } catch {
        totalCount = 0
      }
    }

    // Apply pagination
    const offset = (page - 1) * pageSize
    const pagedRef = queryRef.limit(pageSize).offset(offset)

    // The orderBy can require a composite index when combined with filters.
    // If the ordered query fails, retry without ordering so the page still loads.
    let snapshot
    try {
      snapshot = await pagedRef.get()
    } catch (orderErr) {
      console.warn('orders ordered query failed; retrying unordered', orderErr)
      let fallbackRef: any = adminDb.collection('tickets')
      if (status && status !== 'all') fallbackRef = fallbackRef.where('status', '==', status)
      if (paymentMethod && paymentMethod !== 'all') fallbackRef = fallbackRef.where('payment_method', '==', paymentMethod)
      if (currency && currency !== 'all') fallbackRef = fallbackRef.where('currency', '==', currency.toUpperCase())
      if (eventId) fallbackRef = fallbackRef.where('event_id', '==', eventId)
      snapshot = await fallbackRef.limit(pageSize).offset(offset).get()
    }

    let orders = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...serializeFirestoreValue(doc.data()),
    }))

    // Client-side search filter (Firestore doesn't support text search)
    if (search) {
      const searchLower = search.toLowerCase()
      orders = orders.filter((order: any) => {
        const email = (order.attendee_email || order.attendeeEmail || order.email || '').toLowerCase()
        const name = (order.attendee_name || order.attendeeName || '').toLowerCase()
        const id = order.id.toLowerCase()
        return email.includes(searchLower) || name.includes(searchLower) || id.includes(searchLower)
      })
    }

    // Fetch event titles for display.
    //
    // Resolve each event by document reference (getAll) rather than a
    // `where('__name__', 'in', batch)` query. Filtering on the documentId /
    // `__name__` field requires Key values, not bare ID strings — passing plain
    // ids throws "__key__ filter value must be a Key". The previous query
    // therefore failed for every batch, the error was swallowed by the catch,
    // and every order fell back to "Unknown Event". getAll accepts plain doc
    // refs, has no 10-item `in` cap, and returns missing docs with
    // `exists === false`, so genuinely-deleted events still fall back cleanly.
    const eventIds = Array.from(
      new Set(orders.map((o: any) => o.event_id || o.eventId).filter(Boolean)),
    ) as string[]
    const eventNames: Record<string, string> = {}

    if (eventIds.length > 0) {
      try {
        const refs = eventIds.map((id) => adminDb.collection('events').doc(id))
        const eventDocs = await adminDb.getAll(...refs)
        eventDocs.forEach((doc: any) => {
          if (doc.exists) {
            const data = doc.data()
            const title = data?.title || data?.name
            if (title) eventNames[doc.id] = title
          }
        })
      } catch (e) {
        console.warn('Failed to fetch event names', e)
      }
    }

    // Enrich orders with the resolved event title. Fall back to any title that
    // was denormalized onto the order at purchase time before giving up with
    // "Unknown Event" (only for orders whose event truly no longer exists).
    orders = orders.map((order: any) => {
      const eventId = order.event_id || order.eventId
      return {
        ...order,
        event_name:
          (eventId && eventNames[eventId]) ||
          order.event_title ||
          order.event_name ||
          'Unknown Event',
      }
    })

    return adminOk({
      orders,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasMore: page * pageSize < totalCount,
      },
    })
  } catch (error: any) {
    console.error('Admin orders error:', error)
    return adminError('Failed to fetch orders', 500, error.message || String(error))
  }
}

// Get order analytics/summary
export async function POST(request: Request) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const body = await request.json()
    const { type } = body

    if (type === 'summary') {
      // Get orders summary statistics. Each aggregate is computed defensively so
      // a single failing query (e.g. a missing composite index) never 500s the
      // whole summary — the page just shows best-effort numbers.
      const ticketsRef = adminDb.collection('tickets')

      const safeCount = async (q: any): Promise<number> => {
        try {
          const s = await q.count().get()
          return s.data().count
        } catch (e) {
          console.warn('orders summary count() failed', e)
          return 0
        }
      }

      const [totalOrders, confirmed, pending, cancelled, refunded] = await Promise.all([
        safeCount(ticketsRef),
        safeCount(ticketsRef.where('status', 'in', liveTicketStatusesForQuery())),
        safeCount(ticketsRef.where('status', '==', 'pending')),
        safeCount(ticketsRef.where('status', '==', 'cancelled')),
        safeCount(ticketsRef.where('status', '==', 'refunded')),
      ])

      // Revenue (last 30 days). The status-in + date-range combo needs a
      // composite index; if it's missing, fall back to a status-only query and
      // filter the date in memory.
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const toDate = (v: any): Date | null => {
        if (!v) return null
        if (typeof v?.toDate === 'function') return v.toDate()
        const d = new Date(v)
        return Number.isNaN(d.getTime()) ? null : d
      }

      let recentDocs: any[] = []
      try {
        const recentTickets = await ticketsRef
          .where('status', 'in', liveTicketStatusesForQuery())
          .where('purchased_at', '>=', thirtyDaysAgo)
          .get()
        recentDocs = recentTickets.docs
      } catch (e) {
        console.warn('orders summary revenue query failed; falling back to in-memory date filter', e)
        try {
          const snap = await ticketsRef.where('status', 'in', liveTicketStatusesForQuery()).limit(2000).get()
          recentDocs = snap.docs.filter((d: any) => {
            const dt = toDate(d.data()?.purchased_at)
            return dt !== null && dt >= thirtyDaysAgo
          })
        } catch (e2) {
          console.warn('orders summary revenue fallback failed', e2)
          recentDocs = []
        }
      }

      let totalRevenueUSD = 0
      let totalRevenueHTG = 0
      let stripeCount = 0
      let moncashCount = 0
      let natcashCount = 0

      recentDocs.forEach((doc: any) => {
        const data = doc.data()
        const price = parseFloat(data.price_paid || 0) || 0
        const currency = (data.currency || 'USD').toUpperCase()
        const method = (data.payment_method || '').toLowerCase()

        if (currency === 'HTG') totalRevenueHTG += price
        else totalRevenueUSD += price

        if (method === 'stripe') stripeCount++
        else if (method === 'moncash') moncashCount++
        else if (method === 'natcash') natcashCount++
      })

      // Today's orders
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayOrders = await safeCount(ticketsRef.where('purchased_at', '>=', today))

      return adminOk({
        summary: {
          totalOrders,
          todayOrders,
          byStatus: { confirmed, pending, cancelled, refunded },
          last30Days: {
            orders: recentDocs.length,
            revenueUSD: totalRevenueUSD,
            revenueHTG: totalRevenueHTG,
            avgOrderValueUSD: recentDocs.length > 0 ? totalRevenueUSD / recentDocs.length : 0,
          },
          byPaymentMethod: {
            stripe: stripeCount,
            moncash: moncashCount,
            natcash: natcashCount,
          },
        },
      })
    }

    return adminError('Invalid type parameter', 400)
  } catch (error: any) {
    console.error('Admin orders summary error:', error)
    return adminError('Failed to fetch summary', 500, error.message || String(error))
  }
}
