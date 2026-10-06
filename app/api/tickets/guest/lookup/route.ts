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
import { sendEmail, escapeHtml } from '@/lib/email'
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

async function eventTitle(eventId: string): Promise<string> {
  try {
    const snap = await adminDb.collection('events').doc(eventId).get()
    return snap.exists ? String((snap.data() as any)?.title || 'your event') : 'your event'
  } catch {
    return 'your event'
  }
}

async function deliverLinks(params: { email?: string; phone?: string }): Promise<void> {
  const orders = await findIssuedGuestOrdersByContact({
    email: params.email,
    phone: params.phone,
    limit: 5,
  })

  for (const order of orders) {
    const url = guestTicketUrl(guestTokenFor(order.orderKey))
    const title = await eventTitle(order.eventId)

    // Delivered to the address ON THE ORDER — never to an address in this request.
    if (order.email) {
      await sendEmail({
        to: order.email,
        subject: `Your Tikèm ticket link for ${title}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;color:#0f172a">
            <p style="font-size:16px">Hi ${escapeHtml(order.name || 'there')},</p>
            <p style="font-size:15px;line-height:1.7">
              Here is your ticket link for <strong>${escapeHtml(title)}</strong>. Open it to show your QR code at the door.
            </p>
            <p style="margin:24px 0">
              <a href="${encodeURI(url)}" style="background:#0f172a;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600">View my ticket</a>
            </p>
            <p style="font-size:12px;color:#64748b">Keep this link private: anyone with it can view your ticket.</p>
          </div>
        `,
      })
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
