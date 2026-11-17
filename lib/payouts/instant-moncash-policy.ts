/**
 * When an INSTANT (prefunded) MonCash payout may skip the human.
 *
 * The manual rail has an admin look at every request; the prefunded rail sends
 * money the moment the organizer taps withdraw. So instant is allowed only when
 * everything a human would have checked is already proven:
 *
 *  - the MonCash number was confirmed by an SMS code (payee-identity
 *    moncashOtpVerifiedFrom) — the activation gate no longer requires it,
 *    because the manual rail had a human; the instant rail does not;
 *  - the wallet holder name on the profile matches the KYC legal name exactly,
 *    when a KYC name is on file;
 *  - the transfer is within the per-transfer cap, and today's instant total
 *    stays within the daily cap. The caps are the SAME config the admin
 *    prefunded transfer uses (config/payouts.adminTransferCaps), so one setting
 *    bounds how fast the pool can be drained by any path.
 *
 * Anything that fails falls back to the manual queue — never a refusal: the
 * organizer still gets paid, a human just looks first.
 */
import { adminDb } from '@/lib/firebase/admin'
import { exactNameMatch, type KycLegalNames } from '@/lib/payouts/payee-identity'

/** 250,000 HTG per transfer, 1,000,000 HTG per day, unless config says otherwise. */
export const DEFAULT_PER_CALL_CAP_HTG_CENTS = 25_000_000
export const DEFAULT_DAILY_CAP_HTG_CENTS = 100_000_000

/** Daily running total of INSTANT (organizer + promoter) prefunded payouts. */
export const INSTANT_MONCASH_DAYS_COLLECTION = 'instant_moncash_transfer_days'

export type MoncashTransferCaps = { perCall: number; daily: number }

/** Daily running total of prefunded transfers an ADMIN sent by hand (moncash-prefunded/transfer). */
export const ADMIN_MONCASH_DAYS_COLLECTION = 'admin_moncash_transfer_days'

/**
 * Both rails draw on ONE pool and ONE daily cap (payment audit, 2026-11-17):
 * each rail keeps its own day counter, so each check must add the other rail's
 * total or the two together could send twice the cap. Read inside the caller's
 * transaction, before any write.
 */
export async function otherRailSentTodayInTx(tx: any, rail: 'instant' | 'admin', day: string): Promise<number> {
  const col = rail === 'instant' ? ADMIN_MONCASH_DAYS_COLLECTION : INSTANT_MONCASH_DAYS_COLLECTION
  const snap = await tx.get(adminDb.collection(col).doc(day))
  return Math.max(0, Number(snap?.exists ? (snap.data() as any)?.totalHtgCents : 0) || 0)
}

export function capsFromConfig(raw: any): MoncashTransferCaps {
  const caps = raw?.adminTransferCaps
  const pick = (value: unknown, fallback: number) => {
    const n = Math.round(Number(value))
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    perCall: pick(caps?.perCallHtgCents, DEFAULT_PER_CALL_CAP_HTG_CENTS),
    daily: pick(caps?.dailyHtgCents, DEFAULT_DAILY_CAP_HTG_CENTS),
  }
}

/** config/payouts.adminTransferCaps, with the defaults above. */
export async function loadMoncashTransferCaps(): Promise<MoncashTransferCaps> {
  const snap = await adminDb.collection('config').doc('payouts').get()
  return capsFromConfig(snap?.exists ? snap.data() : null)
}

/**
 * MonCash definitively REJECTED a prefunded transfer: no money left the pool,
 * so its share of the day's cap is given back (owner, 2026-11-17: a run of
 * rejections used to exhaust the cap with nothing sent). Once per withdrawal,
 * guarded by `dailyCapReturnedAt` on the row in the same transaction. Only for
 * a definitive rejection — never for an unconfirmed transfer. Never throws.
 */
export async function returnDailyCapForRejectedTransfer(params: {
  withdrawalRef: any
  dailyRef: any
  poolDebitHtgCents: number
}): Promise<boolean> {
  const debit = Math.max(0, Math.round(Number(params.poolDebitHtgCents) || 0))
  if (debit <= 0) return false
  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const [row, day] = await Promise.all([tx.get(params.withdrawalRef), tx.get(params.dailyRef)])
      if (!row.exists || row.data()?.dailyCapReturnedAt) return false
      const total = Math.max(0, Number(day.exists ? day.data()?.totalHtgCents : 0) || 0)
      const count = Math.max(0, Number(day.exists ? day.data()?.count : 0) || 0)
      const now = new Date()
      tx.set(params.dailyRef, { totalHtgCents: Math.max(0, total - debit), count: Math.max(0, count - 1), updatedAt: now }, { merge: true })
      tx.set(params.withdrawalRef, { dailyCapReturnedAt: now, dailyCapReturnedHtgCents: debit }, { merge: true })
      return true
    })
  } catch (err: any) {
    console.error('[prefunded] could not give back the daily cap of a rejected transfer', { message: err?.message })
    return false
  }
}

export function instantDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export type InstantFallbackReason =
  | 'moncash_number_not_otp_verified'
  | 'wallet_name_mismatch'
  | 'above_per_transfer_cap'
  | 'daily_instant_cap_reached'

/**
 * Pure: may this transfer go out instantly? (The daily cap is re-checked inside
 * the reservation transaction with dailyCapAllows.)
 */
export function decideInstantMoncash(args: {
  otpVerified: boolean
  kyc: KycLegalNames
  walletHolderName: unknown
  poolDebitHtgCents: number
  caps: MoncashTransferCaps
}): { instant: true } | { instant: false; reason: InstantFallbackReason } {
  if (!args.otpVerified) return { instant: false, reason: 'moncash_number_not_otp_verified' }
  // Compared only when Tikèm holds a verified name; a profile name that is
  // missing while a KYC name exists cannot be confirmed, so a human looks.
  if (args.kyc.verified && (args.kyc.legalName || args.kyc.organizationName)) {
    const holder = args.walletHolderName
    const matches = exactNameMatch(holder, args.kyc.legalName) || exactNameMatch(holder, args.kyc.organizationName)
    if (!matches) return { instant: false, reason: 'wallet_name_mismatch' }
  }
  if (Math.round(Number(args.poolDebitHtgCents) || 0) > args.caps.perCall) {
    return { instant: false, reason: 'above_per_transfer_cap' }
  }
  return { instant: true }
}

export function dailyCapAllows(sentTodayHtgCents: number, amountHtgCents: number, caps: MoncashTransferCaps): boolean {
  const sent = Math.max(0, Math.round(Number(sentTodayHtgCents) || 0))
  return sent + Math.max(0, Math.round(Number(amountHtgCents) || 0)) <= caps.daily
}
