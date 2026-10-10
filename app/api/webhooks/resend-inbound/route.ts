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
// It is dropped twice over: it carries X-Tikem-Forwarded, and it is FROM tikem.co.

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

function addressOnly(v: string): string {
  const m = String(v || '').match(/<([^>]+)>/)
  return (m ? m[1] : String(v || '')).trim().toLowerCase()
}

function escapeHtml(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/**
 * Did the ORIGINAL sender authenticate? Our forward is DKIM-signed by tikem.co, so
 * without this a forged "From: billing@stripe.com" would arrive looking legitimate
 * (authentication laundering). Trust only an explicit dmarc=pass, or dkim=pass for
 * the From domain, in the receiving server's Authentication-Results.
 */
function senderVerified(headers: Record<string, string>, fromAddress: string): boolean {
  const ar = String(headers['authentication-results'] || '').toLowerCase()
  if (!ar) return false
  if (/\bdmarc=pass\b/.test(ar)) return true
  const domain = fromAddress.split('@')[1] || ''
  return Boolean(domain) && new RegExp(`dkim=pass[^;]*header\\.(d|i)=@?${domain.replace(/\./g, '\\.')}`).test(ar)
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
  if (headers[FORWARD_HEADER.toLowerCase()] || from.endsWith('@tikem.co')) {
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
  const name = displayName(email.from).replace(/["<>\r\n]/g, '').slice(0, 60) || from
  const verified = senderVerified(headers, from)
  const subject = `${verified ? '' : '[Unverified sender] '}${email.subject || '(no subject)'}`

  // Every forward opens with the real sender address, so a spoofed display name
  // can't hide it, and a red warning when the sender didn't authenticate.
  const banner = `<div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:10px 12px;margin:0 0 14px;border-radius:6px;${
    verified ? 'background:#f3f4f3;color:#444;' : 'background:#fdecea;color:#8a1c12;'
  }">${verified ? '' : '<b>Unverified sender.</b> This message failed sender checks and may be forged. Do not click links or share codes.<br>'}From <b>${escapeHtml(
    from
  )}</b> to ${escapeHtml(original)} · forwarded by Tikèm</div>`
  const textBanner = `${verified ? '' : 'UNVERIFIED SENDER: this message failed sender checks and may be forged.\n'}From ${from} to ${original}, forwarded by Tikèm\n\n`

  const sent = await resend.emails.send(
    {
      from: `${name} via Tikèm <${original}>`,
      to: [original],
      bcc: destinations,
      replyTo,
      subject,
      html: banner + (email.html || (email.text ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(email.text)}</pre>` : '')),
      text: textBanner + (email.text || ''),
      attachments: attachments.length ? (attachments as any) : undefined,
      headers: { [FORWARD_HEADER]: '1', ...(email.message_id ? { 'X-Tikem-Original-Message-Id': email.message_id } : {}) },
    } as any,
    { idempotencyKey: `inbound-${emailId}` }
  )
  if (sent.error) {
    console.error('[inbound] forward failed', emailId, sent.error.message)
    return NextResponse.json({ error: 'forward_failed' }, { status: 500 })
  }
  return NextResponse.json({ forwarded: sent.data?.id, to: destinations.length })
}
