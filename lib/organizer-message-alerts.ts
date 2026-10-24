/**
 * Telling the two sides of an attendee ↔ organizer thread that the other one
 * wrote (SERVER-SIDE ONLY).
 *
 * Before this module an organizer learned about a question ONLY from the bell
 * in the app, so most questions sat unanswered. Now a new thread or follow-up
 * reaches the organizer three ways:
 *
 *  - in-app notification (`createNotification`, type 'organizer_message'),
 *    always;
 *  - push, every message, unless the organizer switched off
 *    `push_attendee_messages`;
 *  - email, unless they switched off `email_attendee_messages`, and at most
 *    ONE per thread per ORGANIZER_EMAIL_COOLDOWN_MS (claimOrganizerEmailSlot),
 *    so a chatty attendee can't flood an inbox.
 *
 * MODULES: `createNotification` comes from lib/notifications/helpers (the
 * in-app writer) and `sendPushNotification` from lib/notification-triggers
 * (push only). Do NOT swap either for the same-named `notify*` wrappers in the
 * other module: the trigger wrappers write a SECOND in-app notification.
 *
 * PRIVACY: nothing here reads or forwards the attendee's email or phone. The
 * organizer sees a first name, the topic and the words of the message.
 *
 * Every channel is best-effort and independently guarded: the message is
 * already stored before any of this runs, and a failed alert must never turn a
 * delivered message into an error for the person who wrote it.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { sendEmail, getOrganizerNewMessageEmail, emailSubjects } from '@/lib/email'
import { fallbackLangForEvent, normalizeLang, type EmailLang } from '@/lib/email-kit/i18n'
import { withOrganizerNotificationDefaults } from '@/lib/organizer/notificationPreferences'
import { claimOrganizerEmailSlot } from '@/lib/organizer-messages'

/** Characters of a message carried in a push or a bell entry. */
export const ALERT_EXCERPT = 140

export function excerpt(text: string, max: number): string {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const ANONYMOUS: Record<EmailLang, string> = {
  en: 'An attendee',
  fr: 'Un participant',
  ht: 'Yon patisipan',
}

/**
 * The first word of the display name the attendee gave. Falls back to a
 * localized "An attendee" for the placeholder the contact route stores when a
 * profile has no name.
 */
export function attendeeFirstName(senderName: string, lang: EmailLang): string {
  const name = String(senderName || '').trim()
  if (!name || name === 'An attendee') return ANONYMOUS[lang]
  return name.split(/\s+/)[0]
}

/** Web inbox for one event with the thread preselected (also the mobile push path). */
export function organizerInboxPath(eventId: string, threadId: string): string {
  return `/organizer/events/${encodeURIComponent(eventId)}/messages?thread=${encodeURIComponent(threadId)}`
}

/** Where an attendee reads a thread on the web: the /profile Messages panel. */
export function attendeeThreadPath(threadId: string): string {
  return `/profile?thread=${encodeURIComponent(threadId)}#messages`
}

/** The app's own route for the attendee's thread (mobile linking config). */
export function attendeeThreadDeepLink(threadId: string): string {
  return `tikem://messages/${encodeURIComponent(threadId)}`
}

const ORGANIZER_COPY: Record<
  EmailLang,
  { title: (n: string, e: string) => string; titleAgain: (n: string, e: string) => string }
> = {
  en: {
    title: (n, e) => `${n} sent you a message about ${e}`,
    titleAgain: (n, e) => `${n} wrote again about ${e}`,
  },
  fr: {
    title: (n, e) => `${n} vous a écrit à propos de ${e}`,
    titleAgain: (n, e) => `${n} vous a réécrit à propos de ${e}`,
  },
  ht: {
    title: (n, e) => `${n} voye yon mesaj ba ou sou ${e}`,
    titleAgain: (n, e) => `${n} ekri ou ankò sou ${e}`,
  },
}

const ATTENDEE_COPY: Record<EmailLang, (o: string, e: string) => string> = {
  en: (o, e) => `${o} replied about ${e}`,
  fr: (o, e) => `${o} a répondu à propos de ${e}`,
  ht: (o, e) => `${o} reponn ou sou ${e}`,
}

async function readOrganizerPrefs(organizerId: string) {
  try {
    const snap = await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('notificationPreferences')
      .doc('main')
      .get()
    return withOrganizerNotificationDefaults(snap.exists ? snap.data() : null)
  } catch (error) {
    // Unreadable preferences: fall back to the defaults (both on). Missing an
    // attendee's question is the worse failure.
    console.error('organizer-message-alerts: preferences unreadable', error)
    return withOrganizerNotificationDefaults(null)
  }
}

export interface OrganizerAlertResult {
  inApp: boolean
  push: boolean
  email: 'sent' | 'rate_limited' | 'disabled' | 'no_address' | 'failed'
}

/**
 * Alert the organizer that an attendee wrote: a new thread (`followUp` false)
 * or a follow-up in an existing one.
 */
export async function alertOrganizerOfMessage(params: {
  threadId: string
  organizerId: string
  eventId: string
  eventTitle: string
  /** The attendee's display name as stored on the thread. Only its first word is used. */
  senderName: string
  topic: string
  message: string
  followUp: boolean
  /** Event location, for the language fallback when the organizer never chose one. */
  event?: { country?: unknown; city?: unknown; timezone?: unknown } | null
  now?: Date
}): Promise<OrganizerAlertResult> {
  const result: OrganizerAlertResult = { inApp: false, push: false, email: 'disabled' }
  const path = organizerInboxPath(params.eventId, params.threadId)

  let organizer: Record<string, any> = {}
  try {
    const snap = await adminDb.collection('users').doc(params.organizerId).get()
    organizer = (snap.exists ? snap.data() : null) || {}
  } catch (error) {
    console.error('organizer-message-alerts: organizer profile unreadable', error)
  }
  const lang: EmailLang = normalizeLang(organizer.language) || fallbackLangForEvent(params.event || null)
  const firstName = attendeeFirstName(params.senderName, lang)
  const copy = ORGANIZER_COPY[lang]
  const title = params.followUp
    ? copy.titleAgain(firstName, params.eventTitle)
    : copy.title(firstName, params.eventTitle)
  const body = excerpt(params.message, ALERT_EXCERPT)

  try {
    await createNotification(params.organizerId, 'organizer_message', title, body, path, {
      eventId: params.eventId,
      messageId: params.threadId,
      topic: params.topic,
      followUp: params.followUp,
    })
    result.inApp = true
  } catch (error) {
    console.error('organizer-message-alerts: in-app notification failed', error)
  }

  const prefs = await readOrganizerPrefs(params.organizerId)

  if (prefs.push_attendee_messages) {
    try {
      await sendPushNotification(params.organizerId, title, body, path, {
        type: 'organizer_message',
        eventId: params.eventId,
        messageId: params.threadId,
      })
      result.push = true
    } catch (error) {
      console.error('organizer-message-alerts: push failed', error)
    }
  }

  if (!prefs.email_attendee_messages) return result

  const to = String(organizer.email || '').trim()
  if (!to) {
    result.email = 'no_address'
    return result
  }

  try {
    const claimed = await claimOrganizerEmailSlot(params.threadId, params.now)
    if (!claimed) {
      result.email = 'rate_limited'
      return result
    }
    const sent = await sendEmail({
      to,
      subject: emailSubjects.organizerNewMessage(lang, firstName, params.eventTitle, params.followUp),
      html: getOrganizerNewMessageEmail({
        lang,
        attendeeFirstName: firstName,
        eventTitle: params.eventTitle,
        eventId: params.eventId,
        threadId: params.threadId,
        topic: params.topic,
        message: params.message,
        followUp: params.followUp,
      }),
    })
    result.email = sent?.success === false ? 'failed' : 'sent'
  } catch (error) {
    console.error('organizer-message-alerts: email failed', error)
    result.email = 'failed'
  }
  return result
}

/**
 * Push the attendee when the organizer answers. The in-app notification and
 * email are written by the reply route itself; this adds the push, which opens
 * the thread in the app (deepLink) or on the web (url).
 *
 * Respects `notify_messages` on the attendee's users doc (absent = on, the
 * same convention as lib/notifications/policy.ts).
 */
export async function pushAttendeeOfReply(params: {
  attendeeId: string
  attendee: Record<string, any>
  threadId: string
  eventId: string
  eventTitle: string
  organizerName: string
  reply: string
}): Promise<boolean> {
  if (params.attendee?.notify_messages === false) return false
  const lang: EmailLang = normalizeLang(params.attendee?.language) || 'en'
  try {
    await sendPushNotification(
      params.attendeeId,
      ATTENDEE_COPY[lang](params.organizerName, params.eventTitle),
      excerpt(params.reply, ALERT_EXCERPT),
      attendeeThreadPath(params.threadId),
      {
        type: 'organizer_reply',
        eventId: params.eventId,
        messageId: params.threadId,
        deepLink: attendeeThreadDeepLink(params.threadId),
      }
    )
    return true
  } catch (error) {
    console.error('organizer-message-alerts: attendee push failed', error)
    return false
  }
}
