import { createClient } from '@/lib/firebase-db/server'
import { requireEventAccess } from '@/lib/organizer/context'

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
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // The event's org team (owner, admin, manager) or a platform admin.
    const access = await requireEventAccess(eventId, 'view')
    if (!access.ok) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get total tickets count
    const { data: allTickets } = await supabase
      .from('tickets')
      .select('*')
      .eq('event_id', eventId)
      .not('status', 'in', '(refunded,cancelled)')

    const totalTickets = allTickets?.length || 0

    // Get checked-in tickets count
    const { data: checkedTickets } = await supabase
      .from('tickets')
      .select('*')
      .eq('event_id', eventId)
      .not('checked_in_at', 'is', null)

    const checkedInTickets = checkedTickets?.length || 0

    // Get tickets by status
    const { data: ticketsByStatus } = await supabase
      .from('tickets')
      .select('status')
      .eq('event_id', eventId)

    const statusCounts = ticketsByStatus?.reduce((acc: any, ticket: any) => {
      acc[ticket.status] = (acc[ticket.status] || 0) + 1
      return acc
    }, {})

    // Get check-in timeline (grouped by hour)
    const { data: checkIns } = await supabase
      .from('tickets')
      .select('checked_in_at')
      .eq('event_id', eventId)
      .not('checked_in_at', 'is', null)
      .order('checked_in_at', { ascending: true })

    const timeline = checkIns?.reduce((acc: any, ticket: any) => {
      const hour = new Date(ticket.checked_in_at!).toISOString().slice(0, 13) + ':00'
      acc[hour] = (acc[hour] || 0) + 1
      return acc
    }, {})

    return Response.json({
      totalTickets: totalTickets || 0,
      checkedInTickets: checkedInTickets || 0,
      attendanceRate: totalTickets ? ((checkedInTickets || 0) / totalTickets * 100).toFixed(1) : '0',
      statusCounts: statusCounts || {},
      checkInTimeline: timeline || {}
    })
  } catch (error) {
    console.error('Attendance stats error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
