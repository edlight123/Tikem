import { requireEventPage } from '../../../_lib/orgPage'
import { loadProfiles } from '@/lib/organizer/eventOrdersLoader'
import { buyerIdOf, isGuestTicket, toTicketRow } from '@/lib/organizer/eventOrders'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { normalizeCurrency, formatMoneyFromCents } from '@/lib/money'
import EventOrdersClient from './EventOrdersClient'

export const revalidate = 0

export default async function EventOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'view', `/organizer/events/${eventId}/orders`)
  const eventData = __event

  const eventCurrency = normalizeCurrency(eventData.currency, 'HTG')

  const ticketDocs = await loadTicketDocsForEvent(eventId)

  // Buyer names: the account profile, else the ticket's own details (guest
  // checkout, comps and guest-list tickets carry attendee_name / guest_email /
  // recipient_name / recipient_email), the same resolution the mobile orders
  // view uses (lib/organizer/eventOrders toTicketRow).
  const datas = ticketDocs.map((doc) => ({ id: doc.id, data: (doc.data() || {}) as Record<string, any> }))
  const profiles = await loadProfiles(
    datas.filter(({ data }) => !isGuestTicket(data)).map(({ data }) => buyerIdOf(data))
  )

  const orders = datas.map(({ id, data: d }) => {
    const row = toTicketRow(id, d, isGuestTicket(d) ? null : profiles.get(buyerIdOf(d)) || null, eventCurrency)
    const currency = normalizeCurrency(d.original_currency || d.currency, eventCurrency)
    const cents = Math.round(Number(d.price_paid || 0) * 100)
    return {
      id,
      attendeeName: row.buyer.name || row.buyer.email || 'Guest',
      attendeeEmail: row.buyer.name ? row.buyer.email : '',
      tierName: row.tierName || 'General Admission',
      amount: cents > 0 ? formatMoneyFromCents(cents, currency, 'en-US', { currencyDisplay: 'code' }) : 'Free',
      status: String(d.status || 'active'),
      purchasedAt: row.purchasedAt,
      checkedInAt: row.checkedInAt,
    }
  })

  return <EventOrdersClient orders={orders} />
}
