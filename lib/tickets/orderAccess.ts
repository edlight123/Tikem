// Who may be handed a ticket id, a guest's signed link, or a live QR after checkout.
//
// The MonCash / SogePay browser returns are reachable by anyone who knows (or
// guesses) an order id, and they used to redirect any caller to
// /purchase/success?ticketId=… for a completed order, which rendered that ticket's
// admitting QR, or straight to the guest's signed ticket link. A ticket id or a
// guest link is now only handed to the browser that started the checkout (it holds
// the order cookie set by /api/moncash-button/initiate) or to the signed-in buyer.

import { getGuestOrderByToken } from '@/lib/guest/identity'

import crypto from 'crypto'

/** Cookie names /api/moncash-button/initiate sets with the order id (lookup only). */
export const ORDER_COOKIE_NAMES = [
  'moncash_button_order_id',
  '__Host-moncash_button_order_id',
  'moncash_button_order_id_domain',
] as const

/**
 * Proof-of-checkout cookies: `${orderId}.${HMAC(secret, orderId)}`. The plain
 * order-id cookies above only help the return route FIND the order; they prove
 * nothing, since anyone who learns an order id can set them. Only the server can
 * mint a valid proof, so only the browser that started the checkout holds one.
 */
export const ORDER_PROOF_COOKIE_NAMES = ['moncash_order_proof', 'moncash_order_proof_domain'] as const

function orderProofSecret(): string | null {
  const s =
    process.env.ORDER_COOKIE_SECRET ||
    process.env.TICKET_QR_SECRET ||
    process.env.TICKET_ID_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    ''
  return s ? s : null
}

function orderProofMac(orderId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`moncash-order:${orderId}`).digest('hex')
}

/** The proof cookie value for an order, or null when no secret is configured. */
export function orderProofValue(orderId: string): string | null {
  const secret = orderProofSecret()
  const id = String(orderId || '').trim()
  if (!secret || !id) return null
  return `${id}.${orderProofMac(id, secret)}`
}

/** Set the proof cookies next to the correlation cookies (same options). */
export function setOrderProofCookies(
  response: { cookies: { set: (name: string, value: string, opts: Record<string, any>) => void } },
  orderId: string,
  requestUrl: string
): void {
  const value = orderProofValue(orderId)
  if (!value) return
  const opts = { httpOnly: true, sameSite: 'none' as const, secure: true, path: '/', maxAge: 60 * 60 }
  response.cookies.set('moncash_order_proof', value, opts)
  const host = new URL(requestUrl).hostname
  const apex = host.startsWith('www.') ? host.slice(4) : host
  if (apex && apex.includes('.') && !/localhost/i.test(apex) && !/vercel\.app$/i.test(apex)) {
    response.cookies.set('moncash_order_proof_domain', value, { ...opts, domain: `.${apex}` })
  }
}

/** The order ids this browser can PROVE it started, from a Next cookie store. */
export function orderIdsFromCookies(store: { get(name: string): { value?: string } | undefined }): string[] {
  const secret = orderProofSecret()
  if (!secret) return []
  const out: string[] = []
  for (const name of ORDER_PROOF_COOKIE_NAMES) {
    const raw = String(store.get(name)?.value || '').trim()
    const dot = raw.lastIndexOf('.')
    if (dot <= 0) continue
    const id = raw.slice(0, dot)
    const mac = Buffer.from(raw.slice(dot + 1), 'utf8')
    const want = Buffer.from(orderProofMac(id, secret), 'utf8')
    if (mac.length === want.length && crypto.timingSafeEqual(mac, want) && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Is this caller the order's own buyer? True when the browser holds the order's
 * cookie, or the signed-in user is the order's user_id. A guest order's user_id is a
 * `guest_…` id no session can have, so for a guest only the cookie counts.
 */
export function callerHoldsOrder(params: {
  orderId: string
  order: Record<string, any> | null | undefined
  cookieOrderIds: string[]
  sessionUid?: string | null
}): boolean {
  const orderId = String(params.orderId || '').trim()
  if (!orderId || !params.order) return false
  if (params.cookieOrderIds.includes(orderId)) return true
  const uid = String(params.sessionUid || '').trim()
  return Boolean(uid && String(params.order.user_id || '') === uid)
}

/** The ticket's CURRENT holder (attendee_id, else the legacy user_id). */
export function ticketHolderId(ticket: Record<string, any> | null | undefined): string {
  return String(ticket?.attendee_id || ticket?.user_id || '')
}

/**
 * May this viewer see the ticket's QR? The signed-in holder, or a guest presenting
 * the signed retrieval token of an order that issued this ticket and still holds it.
 */
export async function viewerMayShowTicket(params: {
  ticketId: string
  ticket: Record<string, any> | null | undefined
  sessionUid?: string | null
  guestToken?: string | null
}): Promise<boolean> {
  const { ticket } = params
  if (!ticket) return false
  const holder = ticketHolderId(ticket)
  if (!holder) return false
  const uid = String(params.sessionUid || '').trim()
  if (uid && uid === holder) return true
  if (!params.guestToken) return false
  const order = await getGuestOrderByToken(String(params.guestToken))
  return Boolean(order && order.guestId && order.guestId === holder && order.ticketIds.includes(String(params.ticketId)))
}
