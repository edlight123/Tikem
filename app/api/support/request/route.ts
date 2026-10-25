// POST /api/support/request
//
// The help-center form. Sends the request to support@tikem.co with Reply-To set
// to the requester, so the team answers from their inbox, then mails the
// requester a short confirmation in their language.
//
// Abuse controls: a honeypot field (`company`, hidden from people, filled by
// form bots) and two fixed-window limits, per IP and per email address.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { getCurrentUser } from '@/lib/auth'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { pickLang } from '@/lib/email-kit/i18n'
import {
  SUPPORT_INBOX,
  SUPPORT_TOPICS,
  newSupportReference,
  supportConfirmationEmail,
  supportInboxEmail,
} from '@/lib/email-templates/support'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOUR_MS = 60 * 60 * 1000
/** Per IP: generous, because Haitian mobile data sits behind carrier-grade NAT. */
const SUPPORT_IP_LIMIT_PER_HOUR = 10
/** Per requester email: a genuine follow-up or two, not a flood. */
const SUPPORT_EMAIL_LIMIT_PER_HOUR = 3

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  topic: z.enum(SUPPORT_TOPICS),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(10).max(5000),
  userType: z.enum(['attendee', 'organizer']).default('attendee'),
  lang: z.string().max(10).optional(),
  /** Honeypot. Real people never see it, so anything here is a bot. */
  company: z.string().max(200).optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid' }, { status: 400 })
  }
  const input = parsed.data

  // Bot filled the hidden field: answer exactly like a success, send nothing.
  if (input.company && input.company.trim()) {
    return NextResponse.json({ success: true })
  }

  const email = input.email.toLowerCase()
  const ipLimit = await consumeRateLimit({
    key: `support-request:ip:${clientIp(request)}`,
    limit: SUPPORT_IP_LIMIT_PER_HOUR,
    windowMs: HOUR_MS,
  })
  if (ipLimit.limited) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }
  const emailLimit = await consumeRateLimit({
    key: `support-request:email:${email}`,
    limit: SUPPORT_EMAIL_LIMIT_PER_HOUR,
    windowMs: HOUR_MS,
  })
  if (emailLimit.limited) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  const lang = pickLang(input.lang)
  const user = await getCurrentUser().catch(() => null)
  const reference = newSupportReference()

  const inbox = supportInboxEmail({
    name: input.name,
    email,
    topic: input.topic,
    subject: input.subject,
    message: input.message,
    userType: input.userType,
    lang,
    uid: user?.id || null,
    reference,
  })
  const sent = await sendEmail({ to: SUPPORT_INBOX, subject: inbox.subject, html: inbox.html, replyTo: email })
  if (!sent.success) {
    console.error('[support-request] could not deliver to the support inbox', { code: sent.code })
    return NextResponse.json({ error: 'Could not send your request', code: 'send_failed' }, { status: 502 })
  }

  // The requester's copy is a courtesy: the team already has the request. The
  // address is unverified, so the copy is a fixed template (topic + reference),
  // never an echo of what was typed: see supportConfirmationEmail.
  const confirmation = supportConfirmationEmail({ lang, topic: input.topic, reference })
  const copy = await sendEmail({ to: email, subject: confirmation.subject, html: confirmation.html, replyTo: SUPPORT_INBOX })
  if (!copy.success) console.warn('[support-request] confirmation copy not sent', { code: copy.code })

  return NextResponse.json({ success: true, reference, confirmationSent: copy.success })
}
