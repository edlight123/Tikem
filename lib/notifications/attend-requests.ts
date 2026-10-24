/**
 * Approval-list notifications (docs/specs/approval-lists-and-plus-ones.md).
 *
 * In-app rows go through `createNotification` in lib/notifications/helpers (the
 * module every server call site uses), and push goes DIRECTLY through
 * `sendPushNotification`. Never the same-named wrappers in
 * lib/notification-triggers: they write a second in-app row.
 *
 * All three are transactional (about the person's own request or event), so
 * none is subject to quiet hours or marketing opt-outs.
 */

import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { normalizeLang, type EmailLang } from '@/lib/email-kit/i18n'

type Copy = { title: string; body: string }

async function userLang(uid: string): Promise<EmailLang> {
  try {
    const snap = await adminDb.collection('users').doc(uid).get()
    return normalizeLang(snap.exists ? snap.data()?.language : null) || 'en'
  } catch {
    return 'en'
  }
}

async function push(uid: string, copy: Copy, url: string, data: Record<string, any>) {
  try {
    const { sendPushNotification } = await import('@/lib/notification-triggers')
    await sendPushNotification(uid, copy.title, copy.body, url, data)
  } catch (error) {
    console.error('[attend-requests] push failed', (error as any)?.message)
  }
}

async function deliver(uid: string, type: any, copy: Copy, url: string, metadata: Record<string, any>) {
  try {
    await createNotification(uid, type, copy.title, copy.body, url, metadata)
  } catch (error) {
    console.error('[attend-requests] in-app notification failed', (error as any)?.message)
  }
  await push(uid, copy, url, { type, ...metadata })
}

export function newRequestCopy(lang: EmailLang, eventTitle: string, name: string, quantity: number): Copy {
  const who = name || { en: 'Someone', fr: "Quelqu'un", ht: 'Yon moun' }[lang]
  const extra = quantity > 1 ? quantity - 1 : 0
  const plus = extra > 0 ? ` (+${extra})` : ''
  return {
    en: { title: `New request: ${eventTitle}`, body: `${who}${plus} asked to join. Approve or decline in Requests.` },
    fr: { title: `Nouvelle demande : ${eventTitle}`, body: `${who}${plus} demande à participer. Approuvez ou refusez dans Demandes.` },
    ht: { title: `Nouvo demann: ${eventTitle}`, body: `${who}${plus} mande vini. Apwouve oswa refize nan Demann yo.` },
  }[lang]
}

export function approvedCopy(lang: EmailLang, eventTitle: string, quantity: number): Copy {
  const many = quantity > 1
  return {
    en: { title: `You're in: ${eventTitle}`, body: many ? `The host approved you. Your ${quantity} tickets are ready.` : 'The host approved you. Your ticket is ready.' },
    fr: { title: `C'est confirmé : ${eventTitle}`, body: many ? `L'organisateur vous a approuvé. Vos ${quantity} billets sont prêts.` : "L'organisateur vous a approuvé. Votre billet est prêt." },
    ht: { title: `Ou anndan: ${eventTitle}`, body: many ? `Òganizatè a apwouve w. ${quantity} tikè ou yo pare.` : 'Òganizatè a apwouve w. Tikè ou pare.' },
  }[lang]
}

export function declinedCopy(lang: EmailLang, eventTitle: string): Copy {
  return {
    en: { title: `Request not approved: ${eventTitle}`, body: 'The host could not fit you in this time.' },
    fr: { title: `Demande non approuvée : ${eventTitle}`, body: "L'organisateur n'a pas pu vous accueillir cette fois." },
    ht: { title: `Demann pa apwouve: ${eventTitle}`, body: 'Òganizatè a pa t ka resevwa w fwa sa a.' },
  }[lang]
}

export async function notifyOrganizerNewRequest(params: {
  organizerId: string
  eventId: string
  eventTitle: string
  requesterName: string
  quantity: number
  requestId: string
}) {
  const lang = await userLang(params.organizerId)
  await deliver(
    params.organizerId,
    'attend_request',
    newRequestCopy(lang, params.eventTitle, params.requesterName, params.quantity),
    `/organizer/events/${params.eventId}/requests`,
    { eventId: params.eventId, requestId: params.requestId }
  )
}

export async function notifyRequestApproved(params: {
  userId: string
  eventId: string
  eventTitle: string
  quantity: number
  requestId: string
}) {
  const lang = await userLang(params.userId)
  await deliver(
    params.userId,
    'attend_request_approved',
    approvedCopy(lang, params.eventTitle, params.quantity),
    `/tickets/event/${params.eventId}`,
    { eventId: params.eventId, requestId: params.requestId, ticketCount: params.quantity }
  )
}

export async function notifyRequestDeclined(params: {
  userId: string
  eventId: string
  eventTitle: string
  requestId: string
}) {
  const lang = await userLang(params.userId)
  await deliver(
    params.userId,
    'attend_request_declined',
    declinedCopy(lang, params.eventTitle),
    `/events/${params.eventId}`,
    { eventId: params.eventId, requestId: params.requestId }
  )
}
