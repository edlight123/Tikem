import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { sendEmail, getTicketConfirmationEmail, emailSubjects, TICKET_QR_CID } from '@/lib/email'
import { formatEventWhen } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { generateTicketQRCodeBuffer } from '@/lib/qrcode'
import { releaseInventoryReservation, reserveInventoryAtomic } from '@/lib/tickets/inventory'
import { consumeRateLimit } from '@/lib/rate-limit'
import { createGuestOrder, attachTicketsToGuestOrder, guestTicketUrl, guestTokenFor } from '@/lib/guest/identity'

/**
 * Organizer-issued free tickets: comps (events/[id]/comps) and guest-list
 * entries (events/[id]/guests). One issuance path, so a guest-list guest holds
 * a real ticket the door scanner admits exactly like a bought one.
 *
 * - The seats are reserved against event and tier capacity first
 *   (reserveInventoryAtomic, sharded counters; never a direct tickets_sold write).
 * - The recipient's account is stamped on the ticket when their email has one;
 *   otherwise a guest order is created so the ticket has a signed link
 *   (/tickets/guest/{token}) that works without an account.
 * - The ticket email is best-effort: `emailed` says whether it went out.
 */

/** Comps one event may issue per rolling day, and one account across all events. */
export const COMPS_PER_EVENT_PER_DAY = 200
export const COMPS_PER_ISSUER_PER_DAY = 300
/** Comp emails one recipient address may receive per day (each ticket is one email). */
export const COMP_EMAILS_PER_RECIPIENT_PER_DAY = 20
const DAY_MS = 24 * 60 * 60 * 1000

export type CompSource = 'comp' | 'guest_list'

export interface IssueCompParams {
  eventId: string
  event: Record<string, any>
  issuerId: string
  recipientName: string
  recipientEmail?: string | null
  note?: string | null
  tierId?: string | null
  quantity: number
  source?: CompSource
  /** events/{id}/guests/{guestId}, when the ticket is for a guest-list entry. */
  guestListId?: string | null
}

export type IssueCompResult =
  | {
      ok: true
      ticketIds: string[]
      tierId: string
      tierName: string
      reservationId: string
      emailed: boolean
      emailLimited: boolean
      /** A link the organizer can share: the guest link, or the account ticket page. */
      ticketLink: string | null
      /** Set when the ticket has no account behind it (the guest-link order key). */
      guestOrderKey: string | null
      recipientUid: string | null
    }
  | { ok: false; status: number; error: string; code: string; remaining?: number | null }

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co').replace(/\/+$/, '')
}

/** The shareable link for a ticket the organizer issued. */
export function compTicketLink(opts: { guestOrderKey?: string | null; ticketId?: string | null }): string | null {
  if (opts.guestOrderKey) return guestTicketUrl(guestTokenFor(opts.guestOrderKey))
  if (opts.ticketId) return `${appUrl()}/tickets/${encodeURIComponent(opts.ticketId)}`
  return null
}

/** The event's tier, or its first tier when none (or a foreign one) was asked for. */
async function resolveTier(eventId: string, wanted: string): Promise<{ id: string; name: string }> {
  try {
    const snap = await adminDb.collection('ticket_tiers').where('event_id', '==', eventId).get()
    const tiers = snap.docs.map((d: any) => ({ id: String(d.id), ...(d.data() || {}) }))
    const match = wanted ? tiers.find((t: any) => t.id === wanted) : null
    const chosen =
      match || [...tiers].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null
    if (chosen) return { id: chosen.id, name: String((chosen as any).name || '').trim() }
  } catch {
    // Best-effort: issue against the event only.
  }
  return { id: '', name: '' }
}

export async function issueCompTickets(params: IssueCompParams): Promise<IssueCompResult> {
  const { eventId, event, issuerId } = params
  const source: CompSource = params.source || 'comp'
  const recipientName = String(params.recipientName || '').trim()
  const recipientEmail = String(params.recipientEmail || '').trim().toLowerCase()
  const note = String(params.note || '').trim()
  const quantity = Math.max(1, Math.min(20, Math.round(Number(params.quantity) || 1)))

  if (!recipientName) {
    return { ok: false, status: 400, error: 'Recipient name is required', code: 'name_required' }
  }

  const tier = await resolveTier(eventId, String(params.tierId || '').trim())

  // Caps: comps are free seats and each one sends an email, so an account (or
  // a stolen session) must not be able to mint and mail them without limit.
  const [eventLimit, issuerLimit] = await Promise.all([
    consumeRateLimit({ key: `comps:event:${eventId}`, limit: COMPS_PER_EVENT_PER_DAY, windowMs: DAY_MS, cost: quantity }),
    consumeRateLimit({ key: `comps:issuer:${issuerId}`, limit: COMPS_PER_ISSUER_PER_DAY, windowMs: DAY_MS, cost: quantity }),
  ])
  if (eventLimit.limited || issuerLimit.limited) {
    return {
      ok: false,
      status: 429,
      error: 'Too many complimentary tickets issued today. Try again tomorrow or contact support.',
      code: 'comp_limit',
    }
  }

  // A comp is a seat: reserve it against the event and tier capacity in one
  // transaction, the same gate paid orders go through.
  const tierIncrements = tier.id ? [{ tierId: tier.id, quantity }] : []
  const reservation = await reserveInventoryAtomic({ eventId, quantity, tierIncrements, logPrefix: `[${source}]` })
  if (!reservation.ok && reservation.reason === 'busy') {
    return {
      ok: false,
      status: 503,
      error: 'Ticket sales are very busy right now. Please try again in a moment.',
      code: 'busy_try_again',
    }
  }
  if (!reservation.ok) {
    return {
      ok: false,
      status: 409,
      error: 'Not enough capacity left for these tickets.',
      code: reservation.reason || 'capacity',
      remaining: reservation.remaining ?? null,
    }
  }

  const reservationId = reservation.reservationId || ''

  // An account behind the email gets the ticket in "My tickets". No account is
  // expected (they may not have signed up) and must not fail issuance.
  let recipientUid: string | null = null
  if (recipientEmail) {
    try {
      const u = await adminAuth.getUserByEmail(recipientEmail)
      recipientUid = u?.uid || null
    } catch {
      // No account for this email yet.
    }
  }

  // No account: a guest order gives the ticket a signed link that works
  // signed out, and lets the recipient claim it later by signing up.
  let guestOrderKey: string | null = null
  let guestId: string | null = null
  if (!recipientUid) {
    try {
      const { record } = await createGuestOrder({
        contact: { name: recipientName, email: recipientEmail, phone: '' },
        eventId,
      })
      guestOrderKey = record.orderKey
      guestId = record.guestId
    } catch (err) {
      console.warn(`[${source}] guest order not created; ticket issued without a link`, { message: (err as any)?.message })
    }
  }

  const tierName = tier.name || 'Complimentary'
  const created: string[] = []
  try {
    for (let i = 0; i < quantity; i++) {
      const ref = await adminDb.collection('tickets').add({
        event_id: eventId,
        event_title: event?.title || '',
        source,
        status: 'valid',
        ...(recipientUid ? { attendee_id: recipientUid, user_id: recipientUid } : {}),
        ...(guestId
          ? { attendee_id: guestId, is_guest: true, guest_email: recipientEmail || null, guest_phone: null }
          : {}),
        attendee_name: recipientName,
        price_paid: 0,
        currency: event?.currency || 'HTG',
        tier_id: tier.id,
        tier_name: tierName,
        ticket_type: tierName,
        recipient_name: recipientName,
        recipient_email: recipientEmail || null,
        comp_note: note || null,
        ...(params.guestListId ? { guest_list_id: params.guestListId } : {}),
        ...(reservationId ? { comp_reservation_id: reservationId } : {}),
        issued_by: issuerId,
        quantity: 1,
        checked_in: false,
        checked_in_at: null,
        start_datetime: event?.start_datetime || null,
        end_datetime: event?.end_datetime || null,
        venue_name: event?.venue_name || null,
        city: event?.city || null,
        purchased_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
      })
      created.push(ref.id)
      // Give the QR a stable payload = the ticket id.
      await ref.update({ qr_code_data: ref.id })
    }
  } catch (issueErr) {
    // Give back the seats that were reserved but never issued.
    const unissued = quantity - created.length
    if (unissued > 0) {
      await releaseInventoryReservation({
        reservationId,
        eventId,
        quantity: unissued,
        tierIncrements: tier.id ? [{ tierId: tier.id, quantity: unissued }] : [],
        logPrefix: `[${source}]`,
      })
    }
    throw issueErr
  }

  if (guestOrderKey) await attachTicketsToGuestOrder(guestOrderKey, created)
  const ticketLink = compTicketLink({ guestOrderKey, ticketId: created[0] })

  // Best-effort email with the QR. A mail failure never fails issuance: the
  // tickets exist and scan fine, and the organizer gets the link to share.
  let emailed = false
  let emailLimited = false
  if (recipientEmail && created.length > 0) {
    const mailLimit = await consumeRateLimit({
      key: `comps:email:${recipientEmail}`,
      limit: COMP_EMAILS_PER_RECIPIENT_PER_DAY,
      windowMs: DAY_MS,
      cost: created.length,
    })
    emailLimited = mailLimit.limited
  }
  if (recipientEmail && created.length > 0 && !emailLimited) {
    try {
      const startDate = event?.start_datetime?.toDate
        ? event.start_datetime.toDate()
        : event?.start_datetime
          ? new Date(event.start_datetime)
          : null
      const startIso = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null
      const lang = await resolveEmailLang({ userId: recipientUid, email: recipientEmail, event })
      const when = formatEventWhen(startIso, lang, event)
      const eventTitle = event?.title || { en: 'Your event', fr: 'Votre événement', ht: 'Evènman ou' }[lang]
      const venue = [event?.venue_name, event?.city].filter(Boolean).join(', ')
      const poster = String(event?.banner_image_url || '').trim() || null
      const compLabel = { en: 'Complimentary', fr: 'Invitation', ht: 'Envitasyon' }[lang]

      let sentAll = true
      for (const ticketId of created) {
        let qrPng: Buffer | null = null
        try {
          qrPng = await generateTicketQRCodeBuffer(ticketId)
        } catch (qrErr) {
          console.warn(`[${source}] QR generation failed`, { message: (qrErr as any)?.message })
        }
        const html = getTicketConfirmationEmail({
          lang,
          attendeeName: recipientName,
          eventTitle,
          eventDate: when ? when.line : '',
          eventVenue: venue,
          ticketId,
          qrCodeDataURL: qrPng ? `cid:${TICKET_QR_CID}` : undefined,
          ticketTier: tier.name ? `${tier.name} · ${compLabel}` : compLabel,
          ticketPrice: 0,
          currency: event?.currency || 'HTG',
          posterUrl: poster,
          doorsTime: String(event?.doors_open_time || '').trim() || undefined,
          ...(guestOrderKey && ticketLink ? { ticketsUrl: ticketLink } : {}),
        })
        const sent = await sendEmail({
          to: recipientEmail,
          subject: emailSubjects.ticketConfirmation(lang, eventTitle),
          html,
          attachments: qrPng
            ? [{ filename: 'ticket-qr.png', content: qrPng.toString('base64'), contentType: 'image/png', contentId: TICKET_QR_CID }]
            : undefined,
        })
        if (!sent?.success) sentAll = false
      }
      if (!sentAll) console.warn(`[${source}] some ticket emails were not delivered`, { eventId })
      emailed = sentAll
    } catch (mailErr) {
      console.warn(`[${source}] ticket issued but email failed`, { message: (mailErr as any)?.message })
    }
  }

  return {
    ok: true,
    ticketIds: created,
    tierId: tier.id,
    tierName,
    reservationId,
    emailed,
    emailLimited,
    ticketLink,
    guestOrderKey,
    recipientUid,
  }
}
