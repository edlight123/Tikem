// Sogepay payment helpers.
//
// Sogepay is the card-processing provider for Haiti events. We do NOT have the vendor's exact
// signature/redirect spec in this codebase, so this module is intentionally:
//   - FAIL-CLOSED: callbacks are only treated as authentic when a shared secret is configured
//     and the signature matches. Without that, we never auto-issue tickets (no free tickets).
//   - SINGLE INTEGRATION POINT: when the real Sogepay spec is known, adjust verifySogepaySignature
//     and parseSogepayCallbackPayload here; the route and fulfillment pipeline stay unchanged.

import crypto from 'crypto'

export function isSogepayConfigured(): boolean {
  return String(process.env.SOGEPAY_ENABLED || '').toLowerCase() === 'true'
}

/** Whether we can cryptographically verify server-to-server callbacks. */
export function isSogepayCallbackVerificationConfigured(): boolean {
  return Boolean((process.env.SOGEPAY_WEBHOOK_SECRET || '').trim())
}

/**
 * Verify an HMAC-SHA256 signature over the exact raw request body using SOGEPAY_WEBHOOK_SECRET.
 *
 * This is a standard, widely-used webhook signing scheme and a sensible default. If Sogepay uses
 * a different scheme (e.g. signing a field subset, a different algorithm, or base64 output), adapt
 * this one function.
 *
 * Returns false (fail-closed) when no secret is configured or the signature is missing/invalid.
 */
export function verifySogepaySignature(rawBody: string, signatureHeader: string | null | undefined): boolean {
  const secret = (process.env.SOGEPAY_WEBHOOK_SECRET || '').trim()
  if (!secret) return false

  const provided = String(signatureHeader || '')
    .trim()
    .replace(/^sha256=/i, '')
  if (!provided) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

  // Constant-time comparison; guard against length mismatch (timingSafeEqual throws on it).
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(provided.toLowerCase(), 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface SogepayCallbackData {
  orderId: string | null
  transactionId: string | null
  amount: number | null
  status: string | null
  /** Normalized: true when the parsed status clearly indicates a successful/captured payment. */
  paid: boolean
}

function firstString(payload: Record<string, any>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload?.[key]
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return null
}

const PAID_STATUS_VALUES = new Set([
  'success',
  'successful',
  'paid',
  'completed',
  'complete',
  'approved',
  'captured',
  'ok',
  'true',
  '1',
  '00', // many card gateways use "00" as the approved response code
])

/**
 * Extract the order id, transaction id, amount, and a normalized `paid` flag from a Sogepay
 * callback payload. Tolerant of several common field names since the exact schema isn't pinned.
 */
export function parseSogepayCallbackPayload(payload: Record<string, any>): SogepayCallbackData {
  const orderId = firstString(payload, ['orderId', 'order_id', 'reference', 'ref', 'order', 'merchant_ref'])
  const transactionId = firstString(payload, [
    'transactionId',
    'transaction_id',
    'transId',
    'trans_id',
    'transNumber',
    'payment_id',
    'paymentId',
  ])

  const amountRaw = firstString(payload, ['amount', 'cost', 'total', 'value'])
  const amount = amountRaw != null && amountRaw !== '' && Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null

  const status = firstString(payload, ['status', 'payment_status', 'paymentStatus', 'state', 'result', 'responseCode', 'response_code'])

  const paid = (() => {
    if (status != null && PAID_STATUS_VALUES.has(status.toLowerCase())) return true
    // Some gateways send an explicit boolean field.
    const boolish = payload?.paid ?? payload?.success ?? payload?.is_paid
    if (boolish === true || String(boolish).toLowerCase() === 'true') return true
    return false
  })()

  return { orderId, transactionId, amount, status, paid }
}

/**
 * Whether a Sogepay-reported amount is acceptable for the expected order amount.
 * `verified: false` means it could NOT be checked (no amount reported, or no
 * expected amount): the callback treats that as a refusal (fail closed), since
 * the checkout redirect does not bind the gateway to a signed amount.
 */
export function isSogepayPaidAmountAcceptable(
  expectedAmount: number,
  reportedAmount: number | null | undefined
): { ok: boolean; verified: boolean; expected: number; paid: number | null; tolerance: number } {
  const expected = Number(expectedAmount)
  const paid =
    typeof reportedAmount === 'number' && Number.isFinite(reportedAmount) ? reportedAmount : NaN
  const tolerance = Math.max(1, (Number.isFinite(expected) ? expected : 0) * 0.01)

  if (!Number.isFinite(expected) || expected <= 0) {
    return { ok: true, verified: false, expected, paid: Number.isFinite(paid) ? paid : null, tolerance }
  }
  if (!Number.isFinite(paid)) {
    return { ok: true, verified: false, expected, paid: null, tolerance }
  }
  return { ok: Math.abs(paid - expected) <= tolerance, verified: true, expected, paid, tolerance }
}
