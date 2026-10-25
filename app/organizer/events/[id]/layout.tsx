import { adminDb } from '@/lib/firebase/admin'
import { canViewEventFinances } from '@/lib/organizer/financeAccess'
import { requireEventPage } from '../../_lib/orgPage'
import { EventHeader } from '@/components/organizer/event-detail/EventHeader'
import { EventTabs } from '@/components/organizer/event-detail/EventTabs'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { ticketCountsAsSold } from '@/lib/organizer/salesSummary'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function serializeTs(v: unknown): string {
  if (!v) return new Date().toISOString()
  if (typeof v === 'string') return v
  if (typeof (v as any).toDate === 'function') return (v as any).toDate().toISOString()
  return String(v)
}

export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // The event's own org decides: its owner, its admins/managers, or a
  // platform admin (lib/organizer/context canOnEvent). Others get a 404.
  const { user, event: data } = await requireEventPage(id, 'view')
  // Earnings tab: the owner, finance-granted admins (read-only), platform admins.
  const showEarnings = await canViewEventFinances(user, data)

  // Lightweight ticket count for the Attendees tab badge.
  const ticketDocs = await loadTicketDocsForEvent(id)
  // Live tickets only (refunded / refund_pending / cancelled are not attendees).
  const ticketCount = ticketDocs.filter((d) => ticketCountsAsSold(d.data() || {})).length

  // Approval lists: a Requests tab with the pending count, only while the
  // event takes requests (docs/specs/approval-lists-and-plus-ones.md).
  const requiresApproval = data.requires_approval === true
  let pendingRequests = 0
  if (requiresApproval) {
    try {
      const reqSnap = await adminDb.collection('attend_requests').where('event_id', '==', id).get()
      pendingRequests = reqSnap.docs.filter((d: any) => {
        const st = d.data()?.status
        return st === 'pending' || st === 'approving'
      }).length
    } catch {
      /* the tab still links; the page loads its own list */
    }
  }

  const event = {
    id,
    title: String(data.title || ''),
    start_datetime: serializeTs(data.start_datetime),
    end_datetime: serializeTs(data.end_datetime),
    venue_name: data.venue_name || '',
    city: data.city || '',
    is_online: Boolean(data.is_online),
    is_published: Boolean(data.is_published),
    updated_at: serializeTs(data.updated_at),
  }

  return (
    <>
      <EventHeader event={event} />
      <EventTabs
        eventId={id}
        ticketCount={ticketCount}
        requiresApproval={requiresApproval}
        pendingRequests={pendingRequests}
        showEarnings={showEarnings}
      />
      <main>{children}</main>
    </>
  )
}
