// Inbound mail for @tikem.co → the team's Gmail.
//
// tikem.co's MX points at Resend Receiving. Resend calls this webhook with
// `email.received`; we fetch the message and re-send it to the people behind the
// address (support@ → Ted + Fredler, everything else → info@edlight.org).
//
// The forwarded copy is addressed To: the original tikem.co address with the team
// in Bcc, and Reply-To: the customer. That way Gmail's "reply from the same address
// the message was sent to" picks support@tikem.co (a "Send mail as" alias that sends
// through Resend SMTP), and the reply lands with the customer, not back here.
//
// Loop guard: the copy addressed To: support@ comes back through Resend Receiving.
// It is dropped twice over: it carries X-Tikem-Forwarded (an HMAC only this server
// can produce, so a sender can't set it to suppress their own mail), and it is
// FROM tikem.co.

import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEAM = 'info@edlight.org'

/** Local part → who reads it. Anything not listed goes to TEAM. */
const ROUTES: Record<string, string[]> = {
  support: [TEAM, 'fredler.pierre-louis@edlight.org'],
  admin: [TEAM],
  hello: [TEAM],
}

const FORWARD_HEADER = 'X-Tikem-Forwarded'

/** The address part of a header value. The LAST <...> wins, so a display name like
 *  "billing@stripe.com <x" <evil@x.com> can't make us read the wrong address. */
function addressOnly(v: string): string {
  const str = String(v || '')
  const open = str.lastIndexOf('<')
  const close = str.lastIndexOf('>')
  const addr = open >= 0 && close > open ? str.slice(open + 1, close) : str
  return addr.trim().toLowerCase()
}

function escapeHtml(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/*
 * Sender authenticity: we deliberately make NO claim. Our forward is DKIM-signed by
 * tikem.co, so anything that looked like "verified" would launder a forged sender,
 * and the Authentication-Results we could read can be supplied by the sender
 * (we can't prove which hop wrote it). Instead every forward opens with the real
 * sender address and a standing caution, and the From display name is reduced to
 * plain text with the address shown beside it.
 */

function forwardMark(secret: string): string {
  return crypto.createHmac('sha256', secret).update('tikem-inbound-forward-v1').digest('hex').slice(0, 32)
}

function displayName(v: string): string {
  const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*</)
  return (m && m[1].trim()) || addressOnly(v)
}

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_INBOUND_API_KEY
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET
  if (!apiKey || !secret) {
    console.error('[inbound] RESEND_INBOUND_API_KEY / RESEND_INBOUND_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }
  const resend = new Resend(apiKey)

  // Raw body: re-serialized JSON breaks the signature.
  const payload = await req.text()
  const id = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signature = req.headers.get('svix-signature')
  if (!id || !timestamp || !signature) return NextResponse.json({ error: 'missing_signature' }, { status: 400 })

  let event: any
  try {
    event = resend.webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret: secret })
  } catch {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
  }
  if (event?.type !== 'email.received') return NextResponse.json({ ignored: event?.type || 'unknown' })

  const emailId = String(event.data?.email_id || '')
  if (!emailId) return NextResponse.json({ error: 'no_email_id' }, { status: 400 })

  const { data: email, error } = await resend.emails.receiving.get(emailId, { html_format: 'cid' })
  if (error || !email) {
    console.error('[inbound] could not fetch received email', emailId, error?.message)
    // 500 → Resend retries; the message also stays in the Resend dashboard.
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  const from = addressOnly(email.from)
  const headers = Object.fromEntries(Object.entries(email.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const mark = forwardMark(secret)
  if (String(headers[FORWARD_HEADER.toLowerCase()] || '') === mark || from.endsWith('@tikem.co')) {
    return NextResponse.json({ ignored: 'own_forward' })
  }

  // Which tikem.co address(es) it was for; route on the first we know.
  const targets = [...(email.received_for || []), ...(email.to || [])].map(addressOnly).filter((a) => a.endsWith('@tikem.co'))
  const original = targets[0] || 'support@tikem.co'
  const local = original.split('@')[0]
  const destinations = ROUTES[local] || [TEAM]

  // Attachments, including inline images (cid) so the HTML still renders.
  let attachments: Array<{ filename: string; content: string; content_type?: string; content_id?: string }> = []
  try {
    const { data: list } = await resend.emails.receiving.attachments.list({ emailId })
    attachments = await Promise.all(
      ((list as any)?.data || []).map(async (a: any) => {
        const res = await fetch(a.download_url)
        const buf = Buffer.from(await res.arrayBuffer())
        return {
          filename: a.filename || 'attachment',
          content: buf.toString('base64'),
          ...(a.content_type ? { content_type: a.content_type } : {}),
          ...(a.content_id ? { content_id: String(a.content_id).replace(/^<|>$/g, '') } : {}),
        }
      })
    )
  } catch (err) {
    console.warn('[inbound] attachments not forwarded', emailId, (err as any)?.message)
  }

  const replyTo = (email.reply_to && email.reply_to.length ? email.reply_to : [email.from]).filter(Boolean)
  // The display name is attacker-controlled: keep it short and plain.
  const safeFrom = from.replace(/["\\\r\n<>]/g, '')
  const name = displayName(email.from).replace(/["<>\\()\r\n@]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const subject = email.subject || '(no subject)'

  // Every forward opens with the real sender address and a standing caution, so a
  // spoofed display name can't hide who actually wrote.
  const banner = `<div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:10px 12px;margin:0 0 14px;border-radius:6px;background:#f3f4f3;color:#444;">External message from <b>${escapeHtml(
    from
  )}</b> to ${escapeHtml(original)}, forwarded by Tikèm. Tikèm can't confirm who sent it: be careful with links, attachments and payment or code requests.</div>`
  const textBanner = `External message from ${from} to ${original}, forwarded by Tikèm. Tikèm can't confirm who sent it: be careful with links, attachments and payment or code requests.\n\n`

  const sent = await resend.emails.send(
    {
      // The real address rides in the display name, so the inbox list shows it too.
      from: `"${name ? `${name} (${safeFrom})` : safeFrom} via Tikèm" <${original}>`,
      to: [original],
      bcc: destinations,
      replyTo,
      subject,
      html: banner + (email.html || (email.text ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(email.text)}</pre>` : '')),
      text: textBanner + (email.text || ''),
      attachments: attachments.length ? (attachments as any) : undefined,
      headers: { [FORWARD_HEADER]: mark, ...(email.message_id ? { 'X-Tikem-Original-Message-Id': email.message_id } : {}) },
    } as any,
    { idempotencyKey: `inbound-${emailId}` }
  )
  if (sent.error) {
    console.error('[inbound] forward failed', emailId, sent.error.message)
    return NextResponse.json({ error: 'forward_failed' }, { status: 500 })
  }
  return NextResponse.json({ forwarded: sent.data?.id, to: destinations.length })
}
