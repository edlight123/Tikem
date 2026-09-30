/**
 * The one place an instant (prefunded) MonCash payout decides what happened.
 *
 * `POST /Api/v1/Transfert` moves real, irreversible money. The dangerous case is
 * not "it failed" but "we don't know": a timeout, a dropped connection, a 5xx or
 * a 2xx we can't parse can all arrive AFTER Digicel has already paid the
 * receiver. Treating those as failures and restoring the balance lets the
 * payee withdraw the same money a second time.
 *
 * So a transfer error is split in two:
 *  - `rejected`: MonCash (or our own token step) definitively refused before
 *    any money could move — a 4xx on the transfer, or no token at all. Safe to
 *    restore the reservation.
 *  - anything else is ambiguous, and we ask `PrefundedTransactionStatus` about
 *    our own `reference`. Only an explicit "successful" completes it. Every
 *    other answer (including the status call failing) leaves the reservation
 *    in place as `unconfirmed` for an admin to settle — never an auto-refund.
 */
import {
  moncashPrefundedBalance,
  moncashPrefundedTransactionStatus,
  moncashPrefundedTransfer,
} from '@/lib/moncash'

/** What the payee pays Tikèm for an instant payout, as a share of the GROSS withdrawn. */
export const PREFUNDING_FEE_PERCENT = 0.03

/**
 * What Digicel charges Tikèm per prefunded transfer, as a share of the amount
 * SENT, debited from the prefunded pool on top of that amount (so a transfer of
 * N costs the pool N x 1.03).
 */
export const DIGICEL_PREFUNDED_FEE_PERCENT = 0.03

export type PrefundedPayoutQuote = {
  /** Gross debited from the payee's earnings, in the earnings currency (minor units). */
  amountCents: number
  /** Tikèm's instant fee, same currency as amountCents: round(G x 3%). */
  feeCents: number
  /** G - fee, same currency as amountCents. */
  payoutAmountCents: number
  /** What is SENT to /v1/Transfert, in HTG minor units (net, never the gross). */
  payoutAmountHtgCents: number
  /** Digicel's fee on that transfer, HTG minor units: round(N x 3%). A cost to Tikèm, not revenue. */
  providerFeeHtgCents: number
  /** Total the pool is debited for this transfer: N + Digicel fee. The live balance must cover this. */
  poolDebitHtgCents: number
}

/**
 * The fee math for one instant payout, shared by the quote, the withdrawal and
 * the promoter wallet so the three can never drift apart.
 *
 * With G gross, fee = round(0.03 G) and the transfer N = G - fee = 0.97 G.
 * Digicel then takes 0.03 N = 0.0291 G from the pool, so the 3% collected
 * covers Digicel's cost with a 0.09%-of-G margin (fee - providerFee >= 0 for any
 * G). The exact break-even — collecting only Digicel's cost — would be
 * N = G / 1.03 (fee = 2.913% of G); we deliberately keep the flat 3% the payee
 * is shown. If Digicel instead deducted its 3% from the RECEIVER's side, the
 * payee would get 0.97 N — test that against the real account before launch.
 */
export function computePrefundedPayout(amountCents: number, usdToHtgRate = 1): PrefundedPayoutQuote {
  const gross = Math.max(0, Math.round(Number(amountCents) || 0))
  const feeCents = Math.max(0, Math.round(gross * PREFUNDING_FEE_PERCENT))
  const payoutAmountCents = Math.max(0, gross - feeCents)
  const rate = Number.isFinite(usdToHtgRate) && usdToHtgRate > 0 ? usdToHtgRate : 1
  const payoutAmountHtgCents = Math.max(0, Math.round(payoutAmountCents * rate))
  const providerFeeHtgCents = Math.max(0, Math.round(payoutAmountHtgCents * DIGICEL_PREFUNDED_FEE_PERCENT))
  return {
    amountCents: gross,
    feeCents,
    payoutAmountCents,
    payoutAmountHtgCents,
    providerFeeHtgCents,
    poolDebitHtgCents: payoutAmountHtgCents + providerFeeHtgCents,
  }
}

/**
 * Normalize a Haitian MonCash number to the 11-digit form Digicel's prefunded
 * docs use for `receiver` ("50937007294"). Accepts 8 local digits, +509 / 509 /
 * 00509 prefixes and any spacing or punctuation. Returns null for anything that
 * is not a Haitian mobile number — the transfer must never be sent to a guess.
 */
export function normalizeMoncashReceiver(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (/^\d{8}$/.test(digits)) return `509${digits}`
  if (/^509\d{8}$/.test(digits)) return digits
  if (/^00509\d{8}$/.test(digits)) return digits.slice(2)
  return null
}

/** True when two numbers are the same MonCash wallet (either may be un-normalized). */
export function sameMoncashNumberLast4(candidate: string, savedLast4: unknown): boolean {
  const last4 = String(savedLast4 ?? '').replace(/\D/g, '')
  if (last4.length !== 4) return false
  return candidate.replace(/\D/g, '').endsWith(last4)
}

export type PrefundedFailureKind = 'rejected' | 'ambiguous'

/**
 * Statuses on the transfer call that still leave the outcome unknown: a
 * timeout (408), a conflict — which on a payment API usually means "that
 * reference already exists", i.e. it may already be paid (409) — and 425.
 */
const AMBIGUOUS_4XX = new Set([408, 409, 425])

export function classifyPrefundedTransferError(err: unknown): PrefundedFailureKind {
  const message = String((err as any)?.message || err || '')

  // Token acquisition happens before the transfer request is ever sent.
  if (
    /Failed to get MonCash token/i.test(message) ||
    /MonCash credentials not configured/i.test(message) ||
    /MonCash prefunded credentials are not configured/i.test(message) ||
    /MonCash prefunded auth failed/i.test(message)
  ) {
    return 'rejected'
  }

  const m = /MonCash REST request failed \((\d{3})\)/.exec(message)
  if (m) {
    const status = Number(m[1])
    if (status >= 400 && status < 500 && !AMBIGUOUS_4XX.has(status)) return 'rejected'
    return 'ambiguous'
  }

  // Network errors, aborts, unparseable 2xx ("Unexpected ... response"), and
  // anything unrecognised: the money may have moved.
  return 'ambiguous'
}

export type PrefundedTransferOutcome =
  | { outcome: 'completed'; transactionId: string; raw: any; confirmedVia: 'transfer' | 'status_check' }
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'unconfirmed'; reason: string; statusCheck: string }

export async function executePrefundedTransfer(params: {
  amount: number
  receiver: string
  desc: string
  reference: string
}): Promise<PrefundedTransferOutcome> {
  try {
    const result = await moncashPrefundedTransfer(params)
    return { outcome: 'completed', transactionId: result.transactionId, raw: result.raw, confirmedVia: 'transfer' }
  } catch (err: any) {
    const reason = String(err?.message || err || 'MonCash transfer failed')
    if (classifyPrefundedTransferError(err) === 'rejected') {
      return { outcome: 'rejected', reason }
    }

    try {
      const status = await moncashPrefundedTransactionStatus(params.reference)
      // Read the transaction's own status field. The wrapper falls back to the
      // envelope's `message`, which is "successful" whenever the API CALL
      // succeeded — that must not be mistaken for the transfer succeeding.
      const transStatus = String(status.raw?.transStatus ?? '').trim()
      if (/^successful$/i.test(transStatus)) {
        const transactionId = String(
          status.raw?.transaction_id || status.raw?.transactionId || status.raw?.transfer?.transaction_id || ''
        )
        return { outcome: 'completed', transactionId, raw: status.raw, confirmedVia: 'status_check' }
      }
      return { outcome: 'unconfirmed', reason, statusCheck: transStatus || JSON.stringify(status.raw ?? null) }
    } catch (statusErr: any) {
      return {
        outcome: 'unconfirmed',
        reason,
        statusCheck: `status check failed: ${String(statusErr?.message || statusErr)}`,
      }
    }
  }
}

/**
 * Live check that the prefunded pool can cover this payout. Pass the POOL
 * debit (transfer + Digicel's fee) in HTG minor units — the balance endpoint
 * reports major units. The 15-minute cron's `available` flag says the pool had
 * money at some point; this says it has enough for THIS transfer. Any failure
 * reads as "no" so the caller files a manual request instead.
 */
export async function prefundedBalanceCovers(poolDebitHtgCents: number): Promise<boolean> {
  try {
    const { balance } = await moncashPrefundedBalance()
    return Number.isFinite(balance) && balance > 0 && Math.round(balance * 100) >= poolDebitHtgCents
  } catch (err: any) {
    console.warn('[moncash-prefunded] live balance check failed; using manual rail', err?.message || err)
    return false
  }
}
