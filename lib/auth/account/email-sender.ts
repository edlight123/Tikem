/**
 * The email one-time code ("confirm your email"), through the existing Resend
 * path (lib/email) and the shared email layout. Implements the OTP service's
 * OtpSender, so codes, expiry, attempts and rate limits are the phone flow's.
 */

import 'server-only'
import { sendEmail } from '@/lib/email'
import { renderEmail, title, p, gap, codeBlock } from '@/lib/email-kit/layout'
import { OtpSendError, type OtpLocale, type OtpSender } from '@/lib/auth/otp/senders'

const COPY: Record<OtpLocale, { subject: string; status: string; head: string; body: string; note: string; ignore: string }> = {
  en: {
    subject: 'Tikèm: your email code',
    status: 'Account',
    head: 'Confirm your email',
    body: 'Enter this code in Tikèm to confirm this email address for your account.',
    note: 'Expires in 10 minutes',
    ignore: 'If you did not ask for this, ignore this email. Nothing changes on your account.',
  },
  fr: {
    subject: 'Tikèm : votre code e-mail',
    status: 'Compte',
    head: 'Confirmez votre e-mail',
    body: 'Saisissez ce code dans Tikèm pour confirmer cette adresse e-mail pour votre compte.',
    note: 'Expire dans 10 minutes',
    ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail. Rien ne change sur votre compte.",
  },
  ht: {
    subject: 'Tikèm: kòd imèl ou',
    status: 'Kont',
    head: 'Konfime imèl ou',
    body: 'Antre kòd sa a nan Tikèm pou konfime adrès imèl sa a pou kont ou.',
    note: 'Li ekspire nan 10 minit',
    ignore: 'Si se pa ou ki mande sa, pa okipe imèl sa a. Anyen pa chanje sou kont ou.',
  },
}

export function emailCodeMessage(locale: OtpLocale, code: string): { subject: string; html: string } {
  const t = COPY[locale] ?? COPY.en
  return {
    subject: t.subject,
    html: renderEmail({
      lang: locale,
      title: t.head,
      preheader: `${t.body} ${t.note}.`,
      status: { label: t.status, tone: 'grey' },
      footer: 'account',
      blocks: [title(t.head, 34), gap(14), p(t.body), gap(4), codeBlock(code, t.note), gap(24), p(t.ignore)],
    }),
  }
}

export class ResendEmailCodeSender implements OtpSender {
  readonly name = 'resend-email'

  async send(to: string, code: string, locale: OtpLocale): Promise<void> {
    const { subject, html } = emailCodeMessage(locale, code)
    const result = await sendEmail({ to, subject, html })
    if (!result?.success) {
      throw new OtpSendError('email code not sent', (result as any)?.error, 'rejected')
    }
  }
}
