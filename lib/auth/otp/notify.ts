/**
 * "A phone number was added to your account": the security notice sent after
 * a successful link, so an unexpected link (a stolen session adding an
 * attacker's number) is visible to the real owner.
 *
 * Three channels, each best-effort, none throws: the in-app bell
 * (notifications/helpers.createNotification), push (notification-triggers.
 * sendPushNotification, the PUSH module) and email when the account has one.
 * Transactional: it ignores quiet hours and marketing opt-outs.
 * Localised from users/{uid}.language. The number is masked.
 */

import 'server-only'
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { escapeHtml, sendEmail } from '@/lib/email'
import { maskPhone } from './phone'

type Lang = 'en' | 'fr' | 'ht'

const COPY: Record<Lang, { title: string; body: (phone: string) => string }> = {
  en: {
    title: 'Phone number added',
    body: (p) =>
      `${p} can now be used to sign in to your Tikèm account. If this was not you, contact Tikèm support right away.`,
  },
  fr: {
    title: 'Numéro de téléphone ajouté',
    body: (p) =>
      `${p} peut maintenant servir à vous connecter à votre compte Tikèm. Si ce n’était pas vous, contactez le support Tikèm sans attendre.`,
  },
  ht: {
    title: 'Nimewo telefòn ajoute',
    body: (p) =>
      `Kounye a, ${p} ka sèvi pou konekte nan kont Tikèm ou. Si se pa t ou, kontakte sipò Tikèm touswit.`,
  },
}

export function phoneLinkedCopy(language: unknown, e164: string) {
  const lang: Lang = language === 'fr' || language === 'ht' ? language : 'en'
  const c = COPY[lang]
  return { title: c.title, body: c.body(maskPhone(e164)) }
}

export async function notifyPhoneLinked(uid: string, e164: string): Promise<void> {
  let user: Record<string, any> = {}
  try {
    const snap = await adminDb.collection('users').doc(uid).get()
    user = (snap.exists ? snap.data() : {}) || {}
  } catch {
    // Fall through with English and no email.
  }
  const { title, body } = phoneLinkedCopy(user.language, e164)
  const actionUrl = '/profile'

  await createNotification(uid, 'account_security', title, body, actionUrl, { kind: 'phone_linked' }).catch((err) =>
    console.warn('[otp] phone-linked bell entry failed', (err as Error)?.message)
  )
  await sendPushNotification(uid, title, body, actionUrl, { type: 'account_security' }).catch(() => {})

  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (email) {
    const html = `<p style="font-family:sans-serif;font-size:15px;line-height:1.5">${escapeHtml(body)}</p>`
    await sendEmail({ to: email, subject: title, html }).catch(() => {})
  }
}
