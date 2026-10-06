import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { PurchaseSuccessNotificationPrompt } from '@/components/PurchaseSuccessNotificationPrompt'
import PurchasePopupBridge from '@/components/PurchasePopupBridge'
import type { Database } from '@/types/database'
import { generateTicketQRCode } from '@/lib/qrcode'
import PurchaseSuccessContentClient from './PurchaseSuccessContentClient'

type Ticket = Database['public']['Tables']['tickets']['Row']

export const revalidate = 0

type TicketEvent = Pick<Database['public']['Tables']['events']['Row'], 'title' | 'start_datetime' | 'venue_name' | 'city'>

export default async function PurchaseSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; ticket_id?: string; ticketId?: string }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams

  const ticketId = params.ticket_id || params.ticketId

  let ticket: any = null
  let event: TicketEvent | null = null
  let qrCodeDataUrl: string | null = null

  if (ticketId) {
    const supabase = await createClient()
    const { data: ticketData } = await supabase.from('tickets').select('*').eq('id', ticketId).single()
    ticket = ticketData

    // Generate QR code for on-page display (best-effort; never crash the page).
    try {
      const qrPayload = String((ticketData as any)?.qr_code_data || (ticketData as any)?.qrCodeData || ticketId)
      qrCodeDataUrl = await generateTicketQRCode(qrPayload)
    } catch {
      qrCodeDataUrl = null
    }

    // Our Firebase "Supabase-like" adapter doesn't reliably support joins.
    // Fetch the event separately and tolerate missing data.
    const eventId = (ticketData as any)?.event_id
    if (eventId) {
      const { data: eventData } = await supabase
        .from('events')
        .select('title,start_datetime,venue_name,city')
        .eq('id', eventId)
        .single()
      event = (eventData as any) || null
    }

    // Some ticket records are denormalized and may already include event fields.
    if (!event) {
      const maybeTitle = (ticketData as any)?.event_title || (ticketData as any)?.title
      const maybeStart = (ticketData as any)?.start_datetime || (ticketData as any)?.event_date
      const maybeVenue = (ticketData as any)?.venue_name || (ticketData as any)?.venue
      const maybeCity = (ticketData as any)?.city
      if (maybeTitle || maybeStart || maybeVenue || maybeCity) {
        event = {
          title: String(maybeTitle || 'Event'),
          start_datetime: String(maybeStart || ''),
          venue_name: String(maybeVenue || ''),
          city: String(maybeCity || ''),
        }
      }
    }
  }

  const safeEventTitle = event?.title || 'Your event'
  const safeStart = event?.start_datetime ? new Date(event.start_datetime) : null
  const safeLocation = [event?.venue_name || '', event?.city || ''].filter(Boolean).join(', ')
  const amountPaid = (() => {
    const raw = (ticket as any)?.price_paid
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) return null
    return value
  })()
  const amountCurrency = (ticket as any)?.currency || null

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      <PurchasePopupBridge status="success" ticketId={ticketId || null} />
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <PurchaseSuccessContentClient
        hasTicket={!!ticket}
        ticketIdShort={ticket?.id ? String(ticket.id).slice(0, 8) : null}
        eventTitle={safeEventTitle}
        startDateIso={event?.start_datetime ? String(event.start_datetime) : null}
        location={safeLocation || null}
        amountPaid={amountPaid}
        amountCurrency={amountCurrency}
        qrCodeDataUrl={qrCodeDataUrl}
      />

      {/* Notification Prompt - ONLY on purchase success, NOT on scan/check-in pages */}
      {user && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <PurchaseSuccessNotificationPrompt userId={user.id} />
        </div>
      )}
      
      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
