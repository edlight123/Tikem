import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { toCsv } from '@/lib/csv'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user owns this event (direct doc get — no full-collection scan)
    const eventDoc = await adminDb.collection('events').doc(id).get()
    const event = eventDoc.exists ? { id: eventDoc.id, ...(eventDoc.data() as any) } : null

    if (!event || event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Event not found or unauthorized' }, { status: 404 })
    }

    // Fetch only this event's tickets (scoped query, not the whole collection)
    const ticketsSnap = await adminDb.collection('tickets').where('event_id', '==', id).get()
    const eventTickets = ticketsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))

    // Batch-resolve attendee users by document reference (getAll) instead of scanning all users.
    const attendeeIds = Array.from(
      new Set(eventTickets.map((t: any) => t.attendee_id).filter(Boolean))
    ) as string[]
    const usersMap = new Map<string, any>()
    if (attendeeIds.length > 0) {
      const refs = attendeeIds.map((uid) => adminDb.collection('users').doc(uid))
      const userDocs = await adminDb.getAll(...refs)
      userDocs.forEach((doc: any) => {
        if (doc.exists) usersMap.set(doc.id, { id: doc.id, ...doc.data() })
      })
    }

    // Build CSV
    const headers = ['Ticket ID', 'Attendee Name', 'Email', 'Phone', 'Purchase Date', 'Price', 'Payment Method', 'Status', 'Checked In', 'Check-in Time']
    
    const rows = eventTickets.map((ticket: any) => {
      const attendee = usersMap.get(ticket.attendee_id) || {}
      return [
        ticket.id || '',
        attendee.full_name || 'N/A',
        attendee.email || 'N/A',
        attendee.phone_number || 'N/A',
        ticket.purchased_at ? new Date(ticket.purchased_at).toLocaleString() : 'N/A',
        ticket.price_paid ? `$${ticket.price_paid.toFixed(2)}` : 'Free',
        ticket.payment_method || 'N/A',
        ticket.status || 'valid',
        ticket.checked_in_at ? 'Yes' : 'No',
        ticket.checked_in_at ? new Date(ticket.checked_in_at).toLocaleString() : 'N/A'
      ]
    })

    // Convert to CSV format
    const csvContent = toCsv([headers, ...rows])

    // Return as downloadable file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="attendees-${event.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.csv"`
      }
    })
  } catch (error: any) {
    console.error('Export attendees error:', error)
    return NextResponse.json({ error: 'Failed to export attendees' }, { status: 500 })
  }
}
