/**
 * Charging an organizer through the MonCash Button (Tikèm's own revenue:
 * printed tickets, door team). Shared by lib/physical and lib/doorTeam.
 *
 * Start: createMonCashButtonCheckoutToken → redirect → /api/moncash-button/return.
 * Confirm: RetrieveOrderPayment by order id, plus the paid-amount check.
 */

import crypto from 'node:crypto'
import { createMonCashButtonCheckoutToken, getMonCashButtonRedirectUrl, isMonCashButtonPaidAmountAcceptable } from '@/lib/moncash-button'
import { retrieveMonCashOrderPayment } from '@/lib/moncash'

/** Same numeric order id shape as the ticket checkout (Digicel expects digits). */
export function newMonCashOrderId(): string {
  return `${crypto.randomInt(1_000_000, 10_000_000)}${String(crypto.randomInt(0, 100_000_000)).padStart(8, '0')}`
}

/** The gateway URL to send the payer to for `amountHtg` on `orderId`. */
export async function monCashRedirectFor(amountHtg: number, orderId: string): Promise<string> {
  const { token } = await createMonCashButtonCheckoutToken({ amount: amountHtg, orderId })
  return getMonCashButtonRedirectUrl(token)
}

export type MonCashOrderCheck =
  | { paid: true; reference: string; amount: number; amountVerified: boolean }
  | { paid: false; reason: string }

/** Ask MonCash whether `orderId` was paid, in full, for `expectedHtg`. */
export async function checkMonCashOrder(orderId: string, expectedHtg: number, logPrefix = '[platform-pay]'): Promise<MonCashOrderCheck> {
  const payment = await retrieveMonCashOrderPayment(orderId)
  if (!payment?.success) return { paid: false, reason: String(payment?.payment_status || 'not_paid') }
  const amount = isMonCashButtonPaidAmountAcceptable(Number(expectedHtg), payment.cost)
  if (amount.verified && !amount.ok) {
    console.error(`${logPrefix} MonCash amount mismatch; NOT marked paid`, { orderId, expected: amount.expected, paid: amount.paid })
    return { paid: false, reason: 'amount_mismatch' }
  }
  return {
    paid: true,
    reference: String(payment.transactionId || orderId),
    amount: Number(payment.cost ?? expectedHtg),
    amountVerified: Boolean(amount.verified),
  }
}
