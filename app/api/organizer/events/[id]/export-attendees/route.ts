import { createClient } from '@/lib/firebase-db/server'
import { toCsv } from '@/lib/csv'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Verify user is the organizer
    const { data: event } = await supabase
      .from('events')
      .select('organizer_id, title')
      .eq('id', eventId)
      .single()

    if (!event || event.organizer_id !== user.id) {
      return new Response('Forbidden', { status: 403 })
    }

    // Fetch all tickets with user information
    const { data: tickets } = await supabase
      .from('tickets')
      .select(`
        id,
        status,
        price,
        quantity,
        created_at,
        checked_in_at,
        attendee_name,
        guest_email,
        users:attendee_id (
          email,
          full_name
        )
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })

    if (!tickets) {
      return new Response('No tickets found', { status: 404 })
    }

    // Generate CSV content
    const csvRows = [
      ['Ticket ID', 'Attendee Name', 'Email', 'Status', 'Price', 'Quantity', 'Purchase Date', 'Check-in Time']
    ]

    tickets.forEach((ticket: any) => {
      const user = ticket.users as any
      // A GUEST ticket has no `users/{uid}` behind `attendee_id` — its buyer lives on
      // the ticket itself. Without this fallback every guest attendee would export as
      // "N/A", i.e. invisible to the organizer at the door and in follow-up.
      csvRows.push([
        ticket.id,
        user?.full_name || ticket.attendee_name || 'N/A',
        user?.email || ticket.guest_email || 'N/A',
        ticket.status,
        `$${ticket.price.toFixed(2)}`,
        ticket.quantity.toString(),
        new Date(ticket.created_at).toLocaleString(),
        ticket.checked_in_at ? new Date(ticket.checked_in_at).toLocaleString() : 'Not checked in'
      ])
    })

    // Convert to CSV string
    const csvContent = toCsv(csvRows)

    // Return as downloadable CSV
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${event.title.replace(/[^a-z0-9]/gi, '_')}_attendees.csv"`
      }
    })
  } catch (error) {
    console.error('Export error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
