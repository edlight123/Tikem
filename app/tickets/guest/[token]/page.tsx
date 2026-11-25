// A guest's tickets, reachable ONLY with their signed retrieval token.
//
// This is the page the confirmation email and SMS link to. It is deliberately
// self-contained: no session is consulted, because a guest has none. The URL is the
// credential — `{orderKey}.{HMAC}` — and it is verified before a single document is
// read (lib/guest/identity.ts). Nothing here is reachable by guessing a ticket id,
// a guest id, an email address, or an order key on its own.

import { notFound } from 'next/navigation'
import Image from 'next/image'
import { adminDb } from '@/lib/firebase/admin'
import { getGuestOrderByToken } from '@/lib/guest/identity'
import { generateTicketQRCode } from '@/lib/qrcode'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import GuestAccountOffer from './GuestAccountOffer'
import RefundRequestAction from '@/components/tickets/RefundRequestAction'
import TicketAddOns from '@/components/tickets/TicketAddOns'
import { StatusChip } from '@/components/ui/kit'
import { Ticket } from 'lucide-react'
import { resolveServerLanguage, tServer } from '@/lib/serverT'
import { isSmsConfigured } from '@/lib/sms'
import { formatEventDateTime, type ClockEvent } from '@/lib/datetime/eventClock'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Not a page search engines or social previews should ever hold on to.
export const metadata = {
  title: 'Your tickets · Tikèm',
  robots: { index: false, follow: false },
}

function toIso(value: any): string | null {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  return String(value)
}

/**
 * On the EVENT's clock (this page renders on a UTC server), and "8:00 PM" for
 * a Haiti event in every language (lib/datetime/eventClock).
 */
function formatDate(iso: string | null, event: ClockEvent, lang: string, fallback: string): string {
  if (!iso) return fallback
  return (
    formatEventDateTime(iso, event, lang, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) || fallback
  )
}

export default async function GuestTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ purchased?: string }>
}) {
  const { token } = await params
  const { purchased } = await searchParams

  const lang = await resolveServerLanguage()
  const t = (path: string, fallback: string) => tServer(lang, path, fallback)

  const order = await getGuestOrderByToken(decodeURIComponent(token))
  // A bad signature and a missing order are indistinguishable to the visitor —
  // there is nothing here to probe for.
  if (!order) notFound()

  // Fetch each ticket by id. `ticket_ids` was written by fulfillment, so this page
  // can never surface a ticket that does not belong to this order.
  const ticketDocs = await Promise.all(
    order.ticketIds.slice(0, 20).map(async (id) => {
      const snap = await adminDb.collection('tickets').doc(id).get()
      return snap.exists ? { id: snap.id, ...(snap.data() as any) } : null
    })
  )
  // The link is a bearer credential that is never revoked, so it may only render
  // tickets the guest STILL holds: once a ticket is claimed onto an account,
  // transferred, refunded or cancelled, its live QR must not stay reachable here.
  const tickets = (ticketDocs.filter(Boolean) as any[]).filter(
    (ticket) =>
      Boolean(order.guestId) &&
      String(ticket.attendee_id || '') === order.guestId &&
      isLiveTicketStatus(ticket.status)
  )
  const ticketsMovedAway = order.ticketIds.length > 0 && ticketDocs.some(Boolean) && tickets.length === 0

  const eventSnap = order.eventId
    ? await adminDb.collection('events').doc(order.eventId).get()
    : null
  const event = eventSnap?.exists ? ({ id: eventSnap.id, ...(eventSnap.data() as any) }) : null

  const qrCodes = await Promise.all(
    tickets.map(async (ticket) => {
      try {
        return await generateTicketQRCode(String(ticket.qr_code_data || ticket.id))
      } catch {
        return null
      }
    })
  )

  // What the confirmation step can actually have sent (lib/tickets/confirmation.ts).
  const emailed = Boolean(order.email)
  const texted = Boolean(order.phone) && isSmsConfigured()

  const startIso = toIso(event?.start_datetime)
  const dateFallback = t('guest_tickets.date_tba', 'Date to be announced')

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar user={null} isAdmin={false} />

      <main className="max-w-2xl mx-auto px-4 py-8 pb-mobile-nav md:pb-16">
        {purchased === '1' && (
          <div className="mb-6 rounded-2xl bg-success-strong/10 px-5 py-4">
            <p className="text-success-soft font-semibold">{t('guest_tickets.payment_confirmed', 'Payment confirmed')}</p>
            <p className="text-sm text-fg-muted mt-1">
              {/* Say only what can have gone out: an email when the order has an
                  address, a text only when an SMS provider is configured
                  (lib/sms.ts). This used to promise "a copy and a text message"
                  with no SMS provider, and "sent you a copy" with no address. */}
              {emailed && (
                <>
                  {t('guest_tickets.also_sent_prefix', 'We also sent')}{' '}
                  <strong className="text-fg">{order.email}</strong>{' '}
                  {texted
                    ? t('guest_tickets.also_sent_copy_and_text', 'a copy and a text message.')
                    : t('guest_tickets.also_sent_copy', 'a copy.')}{' '}
                </>
              )}
              {!emailed && texted && (
                <>
                  {t('guest_tickets.also_texted_prefix', 'We also texted this link to')}{' '}
                  <strong className="text-fg">{order.phone}</strong>.{' '}
                </>
              )}
              {t('guest_tickets.keep_link', 'Keep this link. It is your ticket.')}
            </p>
          </div>
        )}

        <header className="mb-8">
          <p className="label-mono text-eyebrow uppercase tracking-widest text-fg-subtle mb-2">
            {tickets.length > 1
              ? t('guest_tickets.tickets_count', '{{count}} tickets').replace('{{count}}', String(tickets.length))
              : t('guest_tickets.your_ticket', 'Your ticket')}
          </p>
          <h1 className="font-display italic !text-display md:!text-hero !leading-[1.05] text-fg">
            {event?.title || t('guest_tickets.your_event', 'Your event')}
          </h1>
          <p className="text-fg-muted mt-2">{formatDate(startIso, event, lang, dateFallback)}</p>
          {(event?.venue_name || event?.city) && (
            <p className="text-fg-muted">
              {[event?.venue_name, event?.city].filter(Boolean).join(', ')}
            </p>
          )}
        </header>

        {ticketsMovedAway ? (
          <div className="rounded-2xl bg-surface p-6 text-center">
            <p className="text-fg font-semibold">{t('guest_tickets.no_longer_here', 'These tickets are no longer on this link.')}</p>
            <p className="text-sm text-fg-muted mt-2">
              {t(
                'guest_tickets.no_longer_here_detail',
                'They were moved to an account, transferred, or refunded. Sign in to the account that holds them, or contact support.'
              )}
            </p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-2xl bg-surface p-6 text-center">
            <p className="text-fg font-semibold">{t('guest_tickets.still_being_issued', 'Your tickets are still being issued.')}</p>
            <p className="text-sm text-fg-muted mt-2">
              {t('guest_tickets.still_being_issued_detail', 'This usually takes a few seconds. Refresh this page. The link stays valid.')}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {tickets.map((ticket, index) => (
              <div
                key={ticket.id}
                className="rounded-2xl bg-surface overflow-hidden"
              >
                <div className="px-5 py-4 bg-surface-low flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-fg font-semibold truncate">
                      {ticket.tier_name || ticket.ticket_type || t('guest_tickets.general_admission', 'General Admission')}
                    </p>
                    <p className="text-xs text-fg-subtle mt-0.5">{order.name}</p>
                  </div>
                  <StatusChip tone={ticket.checked_in ? 'neutral' : 'success'} className="shrink-0">
                    {ticket.checked_in ? t('guest_tickets.checked_in', 'Checked in') : t('guest_tickets.valid', 'Valid')}
                  </StatusChip>
                </div>

                <div className="p-6 flex flex-col items-center">
                  {qrCodes[index] ? (
                    <div className="rounded-2xl bg-inverse p-4">
                      {/* Data URI, rendered unoptimized — there is no remote asset to optimize. */}
                      <Image
                        src={qrCodes[index] as string}
                        alt={t('guest_tickets.qr_alt', 'Ticket QR code')}
                        width={220}
                        height={220}
                        unoptimized
                      />
                    </div>
                  ) : (
                    <div className="grid place-items-center rounded-2xl bg-surface-raised px-10 py-12">
                      <Ticket className="h-10 w-10 text-fg-subtle" strokeWidth={1.5} aria-hidden />
                    </div>
                  )}
                  <p className="mt-4 font-code text-lg tracking-[0.2em] text-fg">
                    {String(ticket.id).slice(0, 12).toUpperCase()}
                  </p>
                  <p className="text-xs text-fg-subtle mt-1">{t('guest_tickets.show_code_fallback', "Show this code if the QR won't scan")}</p>
                  {/* Add-ons bought with the order (on its first ticket); plain fields only. */}
                  <TicketAddOns
                    ticket={{ add_ons: (ticket as any).add_ons ?? null, add_ons_ticket_id: (ticket as any).add_ons_ticket_id ?? null }}
                    className="mt-4 w-full text-left"
                  />
                  {/* Authorised by this link's token on the server, never by the id alone. */}
                  <div className="mt-5 w-full">
                    <RefundRequestAction
                      ticketId={String(ticket.id)}
                      refundStatus={ticket.refund_status ? String(ticket.refund_status) : null}
                      eligible={!ticket.checked_in && !ticket.checked_in_at}
                      eventStartIso={startIso}
                      guestToken={decodeURIComponent(token)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* The account is OFFERED here, after the ticket is already in hand — never
            demanded before it. */}
        <GuestAccountOffer
          token={decodeURIComponent(token)}
          email={order.email}
          alreadyClaimed={Boolean(order.claimedByUid)}
        />

        <p className="mt-8 text-xs text-fg-subtle text-center leading-relaxed">
          {order.phone
            ? t('guest_tickets.lost_page_email_and_text', 'Lost this page? It is in your confirmation email and text message.')
            : t('guest_tickets.lost_page_email', 'Lost this page? It is in your confirmation email.')}{' '}
          {t(
            'guest_tickets.lost_page_support',
            'For help with a change to your ticket, contact support with the email or phone number you used at checkout.'
          )}
        </p>
      </main>

      <MobileNavWrapper />
    </div>
  )
}
