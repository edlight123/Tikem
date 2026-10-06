import { NextRequest, NextResponse } from 'next/server'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { sendEmail, getTicketConfirmationEmail } from '@/lib/email'
import { generateTicketQRCode } from '@/lib/qrcode'
import { releaseInventoryReservation, reserveInventoryAtomic } from '@/lib/tickets/inventory'
import { consumeRateLimit } from '@/lib/rate-limit'

/** Comps one event may issue per rolling day, and one account across all events. */
const COMPS_PER_EVENT_PER_DAY = 200
const COMPS_PER_ISSUER_PER_DAY = 300
/** Comp emails one recipient address may receive per day (each ticket is one email). */
const COMP_EMAILS_PER_RECIPIENT_PER_DAY = 20
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Issue complimentary (free) tickets for an event.
 * Owner/admin only. Creates `quantity` ticket docs with source='comp', price 0,
 * status 'valid', carrying recipient info + the chosen tier_id. Mirrors the
 * free-claim issuance shape so comps behave like any other valid ticket at scan.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    if (!eventId) return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })

    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.role !== 'organizer' && user.role !== 'admin' && user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Organizer access required' }, { status: 403 })
    }

    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    const event = eventDoc.data() as any

    // Organizers must own the event; admins may act on any event.
    if (user.role === 'organizer' && event?.organizer_id !== user.id) {
      return NextResponse.json({ error: 'You do not own this event' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const recipientName = String(body?.recipient_name || '').trim()
    const recipientEmail = String(body?.recipient_email || '').trim()
    const note = String(body?.note || '').trim()
    let tierId = String(body?.tier_id || '').trim()
    const quantity = Math.max(1, Math.min(20, Math.round(Number(body?.quantity) || 1)))

    if (!recipientName) {
      return NextResponse.json({ error: 'Recipient name is required' }, { status: 400 })
    }

    // Validate the tier belongs to this event; fall back to the event's first tier.
    try {
      const tiersSnap = await adminDb.collection('ticket_tiers').where('event_id', '==', eventId).get()
      const tierDocs = tiersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
      if (tierId && !tierDocs.some((t: any) => t.id === tierId)) tierId = ''
      if (!tierId && tierDocs.length > 0) {
        const sorted = [...tierDocs].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
        tierId = String(sorted[0].id)
      }
    } catch {
      // Tier resolution is best-effort; issue with tier_id='' if it fails.
    }

    // If the recipient email maps to a real Firebase user, stamp the ticket with
    // their uid so the comp shows up in their "My Tickets" and can be scanned by
    // them. A missing account is expected (they may not have signed up yet) and
    // must not fail issuance — the no-email/no-account path stays unchanged.
    // Caps: comps are free seats and each one sends an email, so an account (or
    // a stolen session) must not be able to mint and mail them without limit.
    const [eventLimit, issuerLimit] = await Promise.all([
      consumeRateLimit({ key: `comps:event:${eventId}`, limit: COMPS_PER_EVENT_PER_DAY, windowMs: DAY_MS, cost: quantity }),
      consumeRateLimit({ key: `comps:issuer:${user.id}`, limit: COMPS_PER_ISSUER_PER_DAY, windowMs: DAY_MS, cost: quantity }),
    ])
    if (eventLimit.limited || issuerLimit.limited) {
      return NextResponse.json(
        { error: 'Too many complimentary tickets issued today. Try again tomorrow or contact support.', code: 'comp_limit' },
        { status: 429 }
      )
    }

    // A comp is a seat: reserve it against the event and tier capacity in one
    // transaction, the same gate paid orders go through, so comps cannot
    // oversell a sold-out event.
    const tierIncrements = tierId ? [{ tierId, quantity }] : []
    const reservation = await reserveInventoryAtomic({ eventId, quantity, tierIncrements, logPrefix: '[comps]' })
    if (!reservation.ok) {
      return NextResponse.json(
        {
          error: 'Not enough capacity left for these complimentary tickets.',
          code: reservation.reason || 'capacity',
          remaining: reservation.remaining ?? null,
        },
        { status: 409 }
      )
    }

    let recipientUid: string | null = null
    if (recipientEmail) {
      try {
        const recipientUser = await adminAuth.getUserByEmail(recipientEmail)
        recipientUid = recipientUser?.uid || null
      } catch {
        // No account for this email yet — issue the comp without attendee_id.
      }
    }

    const created: string[] = []
    try {
      for (let i = 0; i < quantity; i++) {
        const ref = await adminDb.collection('tickets').add({
          event_id: eventId,
          event_title: event?.title || '',
          source: 'comp',
          status: 'valid',
          ...(recipientUid ? { attendee_id: recipientUid, user_id: recipientUid } : {}),
          price_paid: 0,
          currency: event?.currency || 'HTG',
          tier_id: tierId,
          tier_name: 'Complimentary',
          recipient_name: recipientName,
          recipient_email: recipientEmail || null,
          comp_note: note || null,
          issued_by: user.id,
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
          eventId,
          quantity: unissued,
          tierIncrements: tierId ? [{ tierId, quantity: unissued }] : [],
          logPrefix: '[comps]',
        })
      }
      throw issueErr
    }

    // Best-effort: email the recipient their ticket(s) with a QR. Never let a
    // mail failure fail the issuance — the tickets already exist and scan fine.
    let emailed = false
    let emailLimited = false
    if (recipientEmail && created.length > 0) {
      const mailLimit = await consumeRateLimit({
        key: `comps:email:${recipientEmail.toLowerCase()}`,
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
        const eventDate = startDate
          ? startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
          : 'TBA'

        for (const ticketId of created) {
          const qrCodeDataURL = await generateTicketQRCode(ticketId)
          const html = getTicketConfirmationEmail({
            attendeeName: recipientName,
            eventTitle: event?.title || 'Your event',
            eventDate,
            eventVenue: event?.venue_name || event?.city || '',
            ticketId,
            qrCodeDataURL,
            ticketTier: 'Complimentary',
            ticketPrice: 0,
            currency: event?.currency || 'HTG',
          })
          await sendEmail({
            to: recipientEmail,
            subject: `Your ticket for ${event?.title || 'the event'}`,
            html,
          })
        }
        emailed = true
      } catch (mailErr) {
        console.warn('[comps] ticket issued but email failed', { message: (mailErr as any)?.message })
      }
    }

    return NextResponse.json({ success: true, count: created.length, ticketIds: created, emailed, emailLimited })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to issue comps' }, { status: 500 })
  }
}
