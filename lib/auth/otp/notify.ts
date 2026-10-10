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
import { sendEmail } from '@/lib/email'
import { renderEmail, eyebrow, title as titleBlock, p, gap, button, appUrl } from '@/lib/email-kit/layout'
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

/** Email-only strings around the shared title/body. */
const EMAIL_COPY: Record<Lang, { eyebrow: string; notYou: string; cta: string }> = {
  en: {
    eyebrow: 'Account security',
    notYou: 'If you added this number, there is nothing else to do.',
    cta: 'Review your account',
  },
  fr: {
    eyebrow: 'Sécurité du compte',
    notYou: 'Si c’est vous qui avez ajouté ce numéro, vous n’avez rien d’autre à faire.',
    cta: 'Vérifier mon compte',
  },
  ht: {
    eyebrow: 'Sekirite kont',
    notYou: 'Si se ou ki ajoute nimewo sa a, ou pa bezwen fè anyen ankò.',
    cta: 'Gade kont ou',
  },
}

/** The phone-linked notice as a full email in the Tikèm layout. */
export function phoneLinkedEmailHtml(language: unknown, e164: string): string {
  const lang: Lang = language === 'fr' || language === 'ht' ? language : 'en'
  const { title, body } = phoneLinkedCopy(lang, e164)
  const e = EMAIL_COPY[lang]
  return renderEmail({
    lang,
    title,
    preheader: body,
    footer: 'account',
    blocks: [
      eyebrow(e.eyebrow, 'amber'),
      titleBlock(title, 34),
      gap(14),
      p(body),
      p(e.notYou),
      gap(12),
      button(e.cta, `${appUrl()}/profile`),
    ],
  })
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
    const html = phoneLinkedEmailHtml(user.language, e164)
    await sendEmail({ to: email, subject: title, html }).catch(() => {})
  }
}
