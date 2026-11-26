/**
 * An organizer's message to everyone holding a ticket or RSVP for an event:
 * the ONE fan-out behind POST /api/organizer/event-update (web dashboard and
 * app). It replaces three routes that each reached different people (the app's
 * sent in-app + push only, so guests heard nothing; the web's sent email only;
 * a third was dead).
 *
 * Every live holder (guests, comps and RSVPs included) is reached once:
 *   - email to everyone with an address, in their language;
 *   - in-app and push to account holders.
 * Each account holder's "event updates" switch (notify_event_updates) is
 * honoured on both channels: off means no email and no push; the in-app copy
 * is still written to their inbox.
 */
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail, getEventUpdateEmail } from '@/lib/email'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'
import { isSoldTicketStatus } from '@/lib/organizer/eventOrders'

// The few strings this sender needs, per email language (Tikèm has no shared
// email string catalog). {event} is the event title.
type BroadcastText = { subject: string; defaultTitle: string; inAppTitle: string; fallbackEvent: string }
const TEXT: Record<'en' | 'fr' | 'ht', BroadcastText> = {
  en: { subject: 'Message from the organizer: {event}', defaultTitle: 'A message about {event}', inAppTitle: 'Message from the organizer of {event}', fallbackEvent: 'your event' },
  fr: { subject: "Message de l'organisateur : {event}", defaultTitle: 'Un message à propos de {event}', inAppTitle: "Message de l'organisateur de {event}", fallbackEvent: 'votre événement' },
  ht: { subject: 'Mesaj òganizatè a: {event}', defaultTitle: 'Yon mesaj sou {event}', inAppTitle: 'Mesaj òganizatè {event} an', fallbackEvent: 'evènman ou an' },
}
type TextKey = keyof BroadcastText
function emailText(lang: string) {
  const table = (TEXT as Record<string, BroadcastText>)[lang] || TEXT.en
  return (key: TextKey, vars: { event?: string } = {}) => table[key].replace('{event}', vars.event ?? '')
}

export type BroadcastOutcome = {
  recipients: number
  emailed: number
  emailFailed: number
  pushed: number
  inApp: number
  optedOut: number
}

export async function broadcastToAttendees(params: {
  event: Record<string, any> & { id: string }
  senderId: string
  title: string | null
  message: string
  organizerName?: string | null
}): Promise<BroadcastOutcome> {
  const { event, senderId, message } = params
  const out: BroadcastOutcome = { recipients: 0, emailed: 0, emailFailed: 0, pushed: 0, inApp: 0, optedOut: 0 }

  const rows = (await loadEventTicketRows(event)).filter((r) => isSoldTicketStatus(r.status))
  const people = new Map<string, { uid: string | null; email: string }>()
  for (const r of rows) {
    const uid = r.isGuest ? null : r.buyerKey || null
    if (uid && uid === senderId) continue
    const email = String(r.buyer?.email || '').trim().toLowerCase()
    const key = uid ? `u:${uid}` : email ? `e:${email}` : null
    if (!key) continue
    const prev = people.get(key)
    people.set(key, { uid, email: prev?.email || email })
  }
  out.recipients = people.size

  const eventTitle = String(event.title || '').replace(/[\r\n]+/g, ' ').trim()
  const actionUrl = `/events/${event.id}`

  for (const person of people.values()) {
    try {
      const lang = await resolveEmailLang({ userId: person.uid, email: person.email, event: event as any })
      const t = emailText(lang)
      const heading = params.title?.trim() || t('defaultTitle', { event: eventTitle || t('fallbackEvent') })
      // The person's "event updates" switch (users.notify_event_updates): off
      // means no email and no push; the in-app copy below still lands.
      let allowed = true
      if (person.uid) {
        const prof = await adminDb.collection('users').doc(person.uid).get().catch(() => null)
        allowed = prof?.exists ? (prof.data() as any)?.notify_event_updates !== false : true
      }

      if (person.uid) {
        await adminDb.collection('users').doc(person.uid).collection('notifications').add({
          userId: person.uid,
          type: 'event_updated',
          title: t('inAppTitle', { event: eventTitle || t('fallbackEvent') }),
          message: params.title?.trim() ? `${heading}\n\n${message}` : message,
          actionUrl,
          eventId: event.id,
          metadata: { eventId: event.id, kind: 'organizer_message' },
          isRead: false,
          createdAt: new Date(),
        })
        out.inApp++
      }
      if (!allowed) {
        out.optedOut++
        continue
      }
      if (person.uid) {
        const { sendPushNotification } = await import('@/lib/notification-triggers')
        await sendPushNotification(person.uid, eventTitle || heading, params.title?.trim() || message.slice(0, 140), actionUrl, {
          type: 'event_update',
          eventId: event.id,
        })
        out.pushed++
      }
      if (person.email) {
        const html = getEventUpdateEmail({
          lang,
          attendeeName: '',
          eventTitle: eventTitle || t('fallbackEvent'),
          updateTitle: heading,
          updateMessage: message,
          eventId: event.id,
          posterUrl: event.banner_image_url || null,
          organizerName: params.organizerName || event.organizer_name || undefined,
        })
        const sent = await sendEmail({
          to: person.email,
          subject: t('subject', { event: eventTitle || t('fallbackEvent') }),
          html,
        })
        if (sent?.success) out.emailed++
        else out.emailFailed++
      }
    } catch (e) {
      console.error('[broadcast] one recipient failed', event.id, (e as any)?.message)
      out.emailFailed++
    }
  }
  return out
}
