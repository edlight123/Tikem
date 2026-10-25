import { requireEventAccess } from '@/lib/organizer/context'
import { loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'
import { toCsv } from '@/lib/csv'

/**
 * Attendee CSV for one event. Buyers resolve through the shared loader
 * (lib/organizer/eventOrdersLoader): the account profile, else the ticket's
 * own details, so guest checkouts, comps and guest-list tickets export with
 * their names. The old version joined users with Supabase syntax the Firestore
 * shim does not support.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params

    // The event's org team (owner, admin, manager) or a platform admin.
    const access = await requireEventAccess(eventId, 'view')
    if (!access.ok) return access.response
    const event = access.value.event

    const rows = await loadEventTicketRows({ ...(event as any), id: eventId })
    rows.sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))

    const csvRows = [
      ['Ticket ID', 'Attendee Name', 'Email', 'Status', 'Price', 'Currency', 'Purchase Date', 'Check-in Time'],
      ...rows.map((r) => [
        r.id,
        r.buyer.name || 'N/A',
        r.buyer.email || 'N/A',
        r.status,
        r.pricePaid.toFixed(2),
        r.currency,
        r.purchasedAt ? new Date(r.purchasedAt).toLocaleString() : '',
        r.checkedInAt ? new Date(r.checkedInAt).toLocaleString() : 'Not checked in',
      ]),
    ]

    return new Response(toCsv(csvRows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${String((event as any).title || 'event').replace(/[^a-z0-9]/gi, '_')}_attendees.csv"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
