// "I lost my ticket link."
//
// The recovery rule that makes this safe: the link is only ever sent TO THE CONTACT
// DETAIL ALREADY ON THE ORDER, and the response never says whether anything was found.
// Typing a stranger's email therefore mails that stranger their own link (which they
// already have) and tells the caller nothing.

import { NextResponse, after } from 'next/server'
import {
  findIssuedGuestOrdersByContact,
  guestTicketUrl,
  guestTokenFor,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
} from '@/lib/guest/identity'
import { sendEmail } from '@/lib/email'
import { renderEmail, poster, title, meta, serifEyebrow, p, gap, button, C } from '@/lib/email-kit/layout'
import { formatEventWhen, type EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { eventInstantIso } from '@/lib/email-templates/reminder'
import { sendSms } from '@/lib/sms'
import { adminDb } from '@/lib/firebase/admin'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'

const HOUR_MS = 60 * 60 * 1000
/** Per IP: generous, because Haitian mobile data sits behind carrier-grade NAT. */
const IP_LIMIT_PER_HOUR = 30
/** Per contact: enough for a genuine retry, too few to mail-bomb someone. */
const CONTACT_LIMIT_PER_HOUR = 3

/** Identical response for every outcome — success, no match, malformed lookup. */
const OPAQUE_OK = {
  success: true,
  message:
    'If we have tickets for that email or phone number, we just sent the link to it.',
}

async function loadEvent(eventId: string): Promise<Record<string, any> | null> {
  try {
    const snap = await adminDb.collection('events').doc(eventId).get()
    return snap.exists ? ((snap.data() as any) ?? {}) : null
  } catch {
    return null
  }
}

const LINK_COPY = {
  en: {
    fallbackTitle: 'your event',
    subject: (e: string) => `Your Tikèm ticket link for ${e}`,
    preheader: (e: string) => `Here is your ticket link for ${e}.`,
    status: 'Your ticket',
    eyebrow: 'here it is',
    body: 'Open this link to show your QR code at the door.',
    view: 'View my ticket',
    note: 'Keep this link private: anyone who has it can view your ticket.',
  },
  fr: {
    fallbackTitle: 'votre événement',
    subject: (e: string) => `Votre lien de billet Tikèm pour ${e}`,
    preheader: (e: string) => `Voici le lien de votre billet pour ${e}.`,
    status: 'Votre billet',
    eyebrow: 'le voici',
    body: "Ouvrez ce lien pour présenter votre QR code à l'entrée.",
    view: 'Voir mon billet',
    note: 'Gardez ce lien pour vous : toute personne qui l’a peut voir votre billet.',
  },
  ht: {
    fallbackTitle: 'evènman ou an',
    subject: (e: string) => `Lyen tikè Tikèm ou pou ${e}`,
    preheader: (e: string) => `Men lyen tikè ou pou ${e}.`,
    status: 'Tikè ou',
    eyebrow: 'men li',
    body: 'Louvri lyen sa a pou w montre QR kòd ou nan pòtay la.',
    view: 'Wè tikè m',
    note: 'Pa bay pèsonn lyen sa a: nenpòt moun ki genyen l ka wè tikè ou.',
  },
} satisfies Record<EmailLang, unknown>

function ticketLinkEmail(lang: EmailLang, event: Record<string, any> | null, url: string) {
  const t = LINK_COPY[lang]
  const eventTitle = String(event?.title || '').replace(/[\r\n]+/g, ' ').trim() || t.fallbackTitle
  const posterUrl = String(event?.banner_image_url || '').trim() || null
  const when = event ? formatEventWhen(eventInstantIso(event.start_datetime), lang, event) : null
  const metaLine = [when?.line, [event?.venue_name, event?.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  const html = renderEmail({
    lang,
    title: eventTitle,
    preheader: t.preheader(eventTitle),
    status: { label: t.status, tone: 'teal' },
    footer: 'attendee',
    blocks: [
      poster(posterUrl, eventTitle),
      posterUrl ? gap(28) : '',
      serifEyebrow(t.eyebrow),
      title(eventTitle),
      metaLine ? meta(metaLine) : '',
      gap(20),
      p(t.body),
      gap(4),
      button(t.view, url),
      gap(16),
      p(t.note, C.text3),
    ],
  })
  return { subject: t.subject(eventTitle), html }
}

async function deliverLinks(params: { email?: string; phone?: string }): Promise<void> {
  const orders = await findIssuedGuestOrdersByContact({
    email: params.email,
    phone: params.phone,
    limit: 5,
  })

  for (const order of orders) {
    const url = guestTicketUrl(guestTokenFor(order.orderKey))
    const event = await loadEvent(order.eventId)
    const title = String(event?.title || 'your event')

    // Delivered to the address ON THE ORDER — never to an address in this request.
    if (order.email) {
      // A guest has no profile language: the event's region decides (Kreyòl in Haiti).
      const lang = await resolveEmailLang({ email: order.email, event })
      const email = ticketLinkEmail(lang, event, url)
      await sendEmail({ to: order.email, subject: email.subject, html: email.html })
    }

    if (params.phone && order.phone) {
      try {
        await sendSms({
          to: order.phone,
          message: `🎟️ Your Tikem ticket for ${title}: ${url}`,
        })
      } catch (err) {
        console.error('[guest-lookup] SMS failed', (err as any)?.message)
      }
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = normalizeEmail(body?.email)
    const phone = normalizePhone(body?.phone)

    const byEmail = email && isValidEmail(email)
    const byPhone = !byEmail && phone && isValidPhone(phone)
    if (!byEmail && !byPhone) {
      return NextResponse.json(OPAQUE_OK)
    }

    const ipThrottle = await consumeRateLimit({
      key: `guest-lookup:ip:${clientIp(request)}`,
      limit: IP_LIMIT_PER_HOUR,
      windowMs: HOUR_MS,
    })
    if (ipThrottle.limited) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    // Over the per-contact cap the answer is still the opaque OK, so the cap
    // itself does not reveal whether the contact has orders.
    const contactThrottle = await consumeRateLimit({
      key: `guest-lookup:contact:${byEmail ? email : phone}`,
      limit: CONTACT_LIMIT_PER_HOUR,
      windowMs: HOUR_MS,
    })
    if (contactThrottle.limited) {
      return NextResponse.json(OPAQUE_OK)
    }

    // Lookup and delivery run after the response is sent, so response timing
    // does not reveal whether anything was found.
    after(async () => {
      try {
        await deliverLinks({ email: byEmail ? email : undefined, phone: byPhone ? phone : undefined })
      } catch (err) {
        console.error('[guest-lookup] delivery failed', (err as any)?.message)
      }
    })

    return NextResponse.json(OPAQUE_OK)
  } catch (error) {
    // Even a server-side failure answers identically: the caller learns nothing about
    // whether the contact exists.
    console.error('[guest-lookup] error', (error as any)?.message)
    return NextResponse.json(OPAQUE_OK)
  }
}
