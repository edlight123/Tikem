import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { requireEventAccess } from '@/lib/organizer/context'
import { loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'
import { isSoldTicketStatus } from '@/lib/organizer/eventOrders'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { getEventUpdateNoticeEmail } from '@/lib/email-templates/reminder'
import { sendEmail } from '@/lib/email'
import { consumeRateLimit } from '@/lib/rate-limit'

/** Event-update emails one event may send per rolling day. */
const UPDATES_PER_EVENT_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_MESSAGE = 2000

/**
 * Email an update to everyone holding a live ticket for an event (the
 * Attendees page's "Email attendees" sheet).
 *
 * Each attendee gets their OWN email: no attendee ever sees another's address.
 * Recipients resolve through the shared loader (lib/organizer/eventOrdersLoader),
 * so guest checkouts, comps and guest-list tickets are included, and only live
 * tickets count (refunded / cancelled holders are not written to).
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const eventId = String(body?.eventId || '').trim()
    const updateMessage = String(body?.updateMessage || '').trim()
    const updateType = String(body?.updateType || 'important').trim() || 'important'

    if (!eventId || !updateMessage) {
      return NextResponse.json({ error: 'Write a message first.' }, { status: 400 })
    }
    if (updateMessage.length > MAX_MESSAGE) {
      return NextResponse.json({ error: `Keep the message under ${MAX_MESSAGE} characters.` }, { status: 400 })
    }

    // The event's org (owner, admin, manager) or a platform admin.
    const access = await requireEventAccess(eventId, 'manage_events')
    if (!access.ok) return access.response
    const event = { ...(access.value.event as any), id: eventId }

    const rows = await loadEventTicketRows(event)
    const recipients = new Map<string, { email: string; userId: string | null }>()
    for (const r of rows) {
      if (!isSoldTicketStatus(r.status)) continue
      const email = r.buyer.email.trim().toLowerCase()
      if (!email || recipients.has(email)) continue
      recipients.set(email, { email, userId: r.isGuest ? null : r.buyerKey || null })
    }

    if (recipients.size === 0) {
      return NextResponse.json({ success: true, sent: 0, failed: 0, recipients: 0 })
    }

    const limit = await consumeRateLimit({
      key: `event-update-email:${eventId}`,
      limit: UPDATES_PER_EVENT_PER_DAY,
      windowMs: DAY_MS,
    })
    if (limit.limited) {
      return NextResponse.json(
        { error: 'This event has sent its updates for today. Try again tomorrow.', code: 'update_limit' },
        { status: 429 }
      )
    }

    let sent = 0
    let failed = 0
    for (const recipient of recipients.values()) {
      try {
        const lang = await resolveEmailLang({ userId: recipient.userId, email: recipient.email, event })
        const mail = getEventUpdateNoticeEmail({ lang, event, updateType, updateMessage })
        const result = await sendEmail({ to: recipient.email, subject: mail.subject, html: mail.html })
        if (result?.success) sent++
        else failed++
      } catch (err) {
        console.error('[send-event-update] one recipient failed', (err as any)?.message)
        failed++
      }
    }

    return NextResponse.json({ success: true, sent, failed, recipients: recipients.size })
  } catch (error) {
    console.error('Error in send-event-update:', error)
    return NextResponse.json({ error: 'Something went wrong sending the update.' }, { status: 500 })
  }
}
