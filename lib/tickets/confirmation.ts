// One place that DELIVERS a ticket to the person who bought it.
//
// Before this module, delivery was copy-pasted into every fulfillment path — and the
// free/RSVP path (app/api/tickets/claim-free) simply had no copy at all, so attendees
// of free events received nothing: no email, no QR, nothing to show at the door.
//
// Everything here is best-effort by construction. A ticket that exists is a ticket the
// buyer owns; a mail provider outage must never fail an order or a webhook.

import { generateTicketQRCode } from '@/lib/qrcode'
import { sendEmail, getTicketConfirmationEmail } from '@/lib/email'
import { sendSms, getTicketConfirmationSms } from '@/lib/sms'
import { sendWhatsAppMessage, getTicketConfirmationWhatsApp } from '@/lib/whatsapp'
import { guestTicketUrl, isValidPhone, normalizePhone } from '@/lib/guest/identity'

export interface ConfirmationRecipient {
  /** Resolved server-side FROM THE ORDER — never from a request body. */
  email: string | null | undefined
  name?: string | null
  phone?: string | null
  isGuest?: boolean
}

export interface ConfirmationEvent {
  title?: string | null
  start_datetime?: string | null
  venue_name?: string | null
  city?: string | null
}

export interface SendTicketConfirmationResult {
  emailSent: boolean
  smsSent: boolean
  whatsappSent: boolean
}

function formatEventDate(value: unknown): string {
  const date = value ? new Date(String(value)) : null
  if (!date || Number.isNaN(date.getTime())) return 'Date to be announced'
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatShortEventDate(value: unknown): string {
  const date = value ? new Date(String(value)) : null
  if (!date || Number.isNaN(date.getTime())) return 'TBA'
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Email + SMS/WhatsApp the buyer their ticket and its QR code.
 *
 * Channel policy:
 *   • email — always, when we have an address.
 *   • SMS — GUESTS with a phone number. They have no app to open, and in Haiti the
 *     phone is the address that actually reaches people.
 *   • WhatsApp — account holders with a phone, exactly as the paid paths did before.
 *     Account holders keep their existing channel; nobody gets double-messaged.
 */
export async function sendTicketConfirmation(params: {
  ticketId: string
  /** Payload encoded into the QR; defaults to the ticket id (what the scanner reads). */
  qrPayload?: string | null
  event: ConfirmationEvent | null
  recipient: ConfirmationRecipient
  quantity?: number
  tierName?: string | null
  ticketPrice?: number | null
  currency?: string | null
  /** Raw guest retrieval token — turns every link in the message into their own ticket page. */
  guestToken?: string | null
  logPrefix?: string
}): Promise<SendTicketConfirmationResult> {
  const logPrefix = params.logPrefix || '[confirmation]'
  const result: SendTicketConfirmationResult = { emailSent: false, smsSent: false, whatsappSent: false }

  const eventTitle = String(params.event?.title || 'your event')
  const venue = [params.event?.venue_name, params.event?.city].filter(Boolean).join(', ')
  const quantity = Math.max(1, Number(params.quantity || 1))
  const ticketWord = quantity > 1 ? `${quantity} tickets` : 'ticket'
  const guestUrl = params.guestToken ? guestTicketUrl(params.guestToken) : null

  let qrCodeDataURL: string | undefined
  try {
    qrCodeDataURL = await generateTicketQRCode(String(params.qrPayload || params.ticketId))
  } catch (err) {
    // The email still ships with the human-readable ticket code, which the door can key in.
    console.error(`${logPrefix} failed to generate QR code`, (err as any)?.message)
  }

  if (params.recipient.email) {
    try {
      const sent = await sendEmail({
        to: params.recipient.email,
        subject: `Your ${ticketWord} for ${eventTitle}`,
        html: getTicketConfirmationEmail({
          attendeeName: params.recipient.name || 'Guest',
          eventTitle,
          eventDate: formatEventDate(params.event?.start_datetime),
          eventVenue: venue,
          ticketId: String(params.ticketId),
          qrCodeDataURL,
          ticketTier: params.tierName || undefined,
          ticketPrice: params.ticketPrice ?? undefined,
          currency: params.currency || undefined,
          ...(guestUrl
            ? {
                ticketsUrl: guestUrl,
                ticketsUrlNote:
                  'This private link is your ticket, so keep this email. You can create a Tikèm account from that page to keep your tickets in the app.',
              }
            : {}),
        }),
      })
      result.emailSent = Boolean(sent?.success)
      if (!sent?.success) {
        console.warn(`${logPrefix} confirmation email not delivered`, { code: sent?.code, error: sent?.error })
      }
    } catch (err) {
      console.error(`${logPrefix} failed to send confirmation email`, (err as any)?.message)
    }
  } else {
    console.warn(`${logPrefix} no email address on the order — skipping confirmation email`, {
      ticketId: params.ticketId,
    })
  }

  const phone = normalizePhone(params.recipient.phone || '')
  if (phone && isValidPhone(phone)) {
    if (params.recipient.isGuest) {
      try {
        // Without an account the link IS the ticket, so only send when we have one.
        const smsUrl = guestUrl
        if (smsUrl) {
          await sendSms({
            to: phone,
            message: getTicketConfirmationSms({
              eventTitle,
              eventDate: formatShortEventDate(params.event?.start_datetime),
              ticketUrl: smsUrl,
              quantity,
            }),
          })
          result.smsSent = true
        }
      } catch (err) {
        console.error(`${logPrefix} failed to send confirmation SMS`, (err as any)?.message)
      }
    } else {
      try {
        await sendWhatsAppMessage({
          to: phone,
          message: getTicketConfirmationWhatsApp(
            params.recipient.name || 'Guest',
            eventTitle,
            formatShortEventDate(params.event?.start_datetime),
            venue,
            String(params.ticketId)
          ),
        })
        result.whatsappSent = true
      } catch (err) {
        console.error(`${logPrefix} failed to send WhatsApp confirmation`, (err as any)?.message)
      }
    }
  }

  return result
}
