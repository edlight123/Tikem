// Who may be handed a ticket id, a guest's signed link, or a live QR after checkout.
//
// The MonCash / SogePay browser returns are reachable by anyone who knows (or
// guesses) an order id, and they used to redirect any caller to
// /purchase/success?ticketId=… for a completed order, which rendered that ticket's
// admitting QR, or straight to the guest's signed ticket link. A ticket id or a
// guest link is now only handed to the browser that started the checkout (it holds
// the order cookie set by /api/moncash-button/initiate) or to the signed-in buyer.

import { getGuestOrderByToken } from '@/lib/guest/identity'

/** Cookie names /api/moncash-button/initiate sets with the order id. */
export const ORDER_COOKIE_NAMES = [
  'moncash_button_order_id',
  '__Host-moncash_button_order_id',
  'moncash_button_order_id_domain',
] as const

/** The order ids this browser holds, from a Next cookie store. */
export function orderIdsFromCookies(store: { get(name: string): { value?: string } | undefined }): string[] {
  return ORDER_COOKIE_NAMES.map((name) => String(store.get(name)?.value || '').trim()).filter(Boolean)
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
