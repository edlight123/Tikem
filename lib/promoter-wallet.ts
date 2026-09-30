/**
 * The promoter wallet: funded commission a claimed promoter can actually
 * withdraw, and the withdrawal itself.
 *
 * Availability is LINKED TO THE ORGANIZER'S RELEASE STATE by design: a
 * commission becomes withdrawable exactly when its event's funds release to the
 * organizer (the same pure release ladder, asked through previewRelease). Until
 * then it shows as pending. This kills the obvious fraud loop — a fake
 * organizer's "promoter" cashing out stolen-card sales before review — because
 * the commission is held by the very ladder that holds the organizer.
 *
 * Money model:
 *  - Only FUNDED promoter_sales count (rows written since withholding shipped;
 *    older tallies are settled organizer-to-promoter directly).
 *  - Balances accrue per event currency. Withdrawals pay out in HTG over
 *    MonCash: HTG balances directly, USD balances converted at withdrawal time
 *    (same fetchUsdToHtgRate the organizer instant path uses). Other currencies
 *    are shown but not withdrawable on this rail.
 *  - The promoter pays the 3% prefunding fee, mirroring organizer instant
 *    withdrawals.
 */

import { adminDb } from '@/lib/firebase/admin'
import { previewRelease } from '@/lib/payouts/withdrawal-gate'
import { getEventEarnings } from '@/lib/earnings'
import {
  computePrefundedPayout,
  executePrefundedTransfer,
  normalizeMoncashReceiver,
  prefundedBalanceCovers,
} from '@/lib/payouts/moncash-prefunded'
import { fetchUsdToHtgRate } from '@/lib/currency'

export const PROMOTER_WITHDRAWAL_FEE_PERCENT = 0.03
/** 500 HTG — small enough for street-team amounts, big enough to be worth a transfer. */
export const PROMOTER_MIN_WITHDRAWAL_HTG_CENTS = 50_000

const WITHDRAWABLE_CURRENCIES = new Set(['HTG', 'USD'])

export interface WalletEventLine {
  eventId: string
  eventTitle: string
  currency: string
  commissionCents: number
  released: boolean
  availableAt: string | null
}

export interface PromoterWalletView {
  /** Released commission minus what was already withdrawn, per currency. */
  availableByCurrency: Record<string, number>
  /** Commission still held with its event, per currency. */
  pendingByCurrency: Record<string, number>
  /** Non-HTG/USD released amounts — visible, not withdrawable on this rail. */
  unsupportedByCurrency: Record<string, number>
  withdrawnByCurrency: Record<string, number>
  events: WalletEventLine[]
  moncashPhone: string | null
  feePercent: number
  minWithdrawalHtgCents: number
}

/**
 * Pure bucket math, split out for tests: released lines net of prior
 * withdrawals become available; unreleased lines are pending.
 */
export function computeWalletBuckets(
  lines: Array<Pick<WalletEventLine, 'currency' | 'commissionCents' | 'released'>>,
  withdrawnByCurrency: Record<string, number>
): {
  availableByCurrency: Record<string, number>
  pendingByCurrency: Record<string, number>
  unsupportedByCurrency: Record<string, number>
} {
  const released: Record<string, number> = {}
  const pending: Record<string, number> = {}
  for (const line of lines) {
    const currency = String(line.currency || 'HTG').toUpperCase()
    const cents = Math.max(0, Math.round(Number(line.commissionCents) || 0))
    if (cents <= 0) continue
    if (line.released) released[currency] = (released[currency] || 0) + cents
    else pending[currency] = (pending[currency] || 0) + cents
  }

  const available: Record<string, number> = {}
  const unsupported: Record<string, number> = {}
  for (const [currency, cents] of Object.entries(released)) {
    const net = Math.max(0, cents - Math.max(0, Number(withdrawnByCurrency[currency]) || 0))
    if (net <= 0) continue
    if (WITHDRAWABLE_CURRENCIES.has(currency)) available[currency] = net
    else unsupported[currency] = net
  }
  return { availableByCurrency: available, pendingByCurrency: pending, unsupportedByCurrency: unsupported }
}

/** The 3% fee and net payout for a gross HTG amount. Promoter pays the fee. */
export function computeWithdrawalFee(grossHtgCents: number): {
  feeCents: number
  payoutCents: number
} {
  const gross = Math.max(0, Math.round(Number(grossHtgCents) || 0))
  const feeCents = Math.round(gross * PROMOTER_WITHDRAWAL_FEE_PERCENT)
  return { feeCents, payoutCents: Math.max(0, gross - feeCents) }
}

async function walletRef(uid: string) {
  return adminDb.collection('promoter_wallets').doc(String(uid))
}

/** Funded, accrued commission grouped per event for everything this account claimed. */
async function loadFundedLines(uid: string): Promise<Array<{ eventId: string; currency: string; commissionCents: number }>> {
  const promotersSnap = await adminDb
    .collection('event_promoters')
    .where('claimed_by_uid', '==', uid)
    .limit(100)
    .get()

  const perEvent = new Map<string, { eventId: string; currency: string; commissionCents: number }>()
  await Promise.all(
    promotersSnap.docs.map(async (d: any) => {
      const salesSnap = await adminDb
        .collection('promoter_sales')
        .where('promoter_id', '==', d.id)
        .where('funded', '==', true)
        .get()
      salesSnap.docs.forEach((saleDoc: any) => {
        const s = saleDoc.data()
        if (s.status !== 'accrued') return
        const cents = Math.max(0, Number(s.commission_cents) || 0)
        if (cents <= 0) return
        const eventId = String(s.event_id)
        const currency = String(s.currency || 'HTG').toUpperCase()
        const key = `${eventId}|${currency}`
        const line = perEvent.get(key) || { eventId, currency, commissionCents: 0 }
        line.commissionCents += cents
        perEvent.set(key, line)
      })
    })
  )
  return Array.from(perEvent.values())
}

/** Ask the organizer's release ladder whether this event's funds are out. */
async function isEventReleased(eventId: string): Promise<{ released: boolean; availableAt: string | null; title: string }> {
  try {
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    const eventData = eventDoc.exists ? (eventDoc.data() as any) : {}
    const earnings = await getEventEarnings(eventId)
    const availableMinor = Math.max(
      0,
      Number((earnings as any)?.netAmount || 0) - Number((earnings as any)?.withdrawnAmount || 0)
    )
    const release = await previewRelease({
      eventId,
      organizerId: String(eventData?.organizer_id || (earnings as any)?.organizerId || ''),
      eventData,
      grossMinor: Number((earnings as any)?.grossSales || 0),
      currency: String((earnings as any)?.currency || eventData?.currency || 'HTG'),
      availableMinor,
    })
    return {
      released: Boolean(release?.releasedNow),
      availableAt: release?.availableAt || null,
      title: String(eventData?.title || 'Event'),
    }
  } catch (err: any) {
    // Fail CLOSED: a release check that cannot run must hold the money.
    console.error('[promoter-wallet] release check failed; holding', { eventId, message: err?.message })
    return { released: false, availableAt: null, title: 'Event' }
  }
}

export async function getPromoterWalletView(uid: string): Promise<PromoterWalletView> {
  const [lines, walletSnap] = await Promise.all([loadFundedLines(uid), (await walletRef(uid)).get()])
  const wallet = walletSnap.exists ? (walletSnap.data() as any) : {}
  const withdrawnByCurrency: Record<string, number> = { ...(wallet?.withdrawn_by_currency || {}) }

  const releaseByEvent = new Map<string, { released: boolean; availableAt: string | null; title: string }>()
  await Promise.all(
    Array.from(new Set(lines.map((l) => l.eventId))).map(async (eventId) => {
      releaseByEvent.set(eventId, await isEventReleased(eventId))
    })
  )

  const events: WalletEventLine[] = lines.map((l) => {
    const release = releaseByEvent.get(l.eventId) || { released: false, availableAt: null, title: 'Event' }
    return {
      eventId: l.eventId,
      eventTitle: release.title,
      currency: l.currency,
      commissionCents: l.commissionCents,
      released: release.released,
      availableAt: release.availableAt,
    }
  })

  const buckets = computeWalletBuckets(events, withdrawnByCurrency)
  return {
    ...buckets,
    withdrawnByCurrency,
    events,
    moncashPhone: wallet?.moncash_phone ? String(wallet.moncash_phone) : null,
    feePercent: PROMOTER_WITHDRAWAL_FEE_PERCENT,
    minWithdrawalHtgCents: PROMOTER_MIN_WITHDRAWAL_HTG_CENTS,
  }
}

export type PromoterWithdrawalResult =
  | {
      ok: true
      withdrawalId: string
      instant: boolean
      /** Sent over the prefunded rail but not confirmed; held for an admin. */
      confirming?: boolean
      grossHtgCents: number
      feeCents: number
      payoutHtgCents: number
    }
  | { ok: false; code: 'below_minimum' | 'nothing_available' | 'invalid_phone' | 'conflict' | 'transfer_failed'; error: string }

/**
 * Withdraw the promoter's ENTIRE available balance to their MonCash number.
 * Instant over the prefunded pool when the platform has it on; otherwise a
 * pending withdrawal_requests row for the admin queue (no fee on that path,
 * matching organizer standard withdrawals).
 */
export async function executePromoterWithdrawal(uid: string, rawPhone: string): Promise<PromoterWithdrawalResult> {
  // Digicel's Transfert wants 509XXXXXXXX; "+509 3700 7294" must not reach it verbatim.
  const phone = normalizeMoncashReceiver(rawPhone)
  if (!phone) {
    return { ok: false, code: 'invalid_phone', error: 'Enter a valid MonCash phone number.' }
  }

  const view = await getPromoterWalletView(uid)
  const htgCents = Math.max(0, Number(view.availableByCurrency.HTG) || 0)
  const usdCents = Math.max(0, Number(view.availableByCurrency.USD) || 0)
  if (htgCents <= 0 && usdCents <= 0) {
    return { ok: false, code: 'nothing_available', error: 'Nothing is available to withdraw yet.' }
  }

  const usdToHtgRate = usdCents > 0 ? await fetchUsdToHtgRate() : 1
  const grossHtgCents = htgCents + Math.round((usdCents / 100) * usdToHtgRate * 100)
  if (grossHtgCents < PROMOTER_MIN_WITHDRAWAL_HTG_CENTS) {
    return {
      ok: false,
      code: 'below_minimum',
      error: `Minimum withdrawal is ${(PROMOTER_MIN_WITHDRAWAL_HTG_CENTS / 100).toLocaleString()} HTG.`,
    }
  }

  // Instant only when the platform prefunding pool is on and stocked.
  const configDoc = await adminDb.collection('config').doc('payouts').get()
  const prefunding = configDoc.exists ? (configDoc.data() as any)?.prefunding : null
  // The cron's `available` is up to 15 minutes old; check the pool covers THIS
  // transfer plus Digicel's 3% before promising an instant payout.
  const instantPricing = computePrefundedPayout(grossHtgCents)
  const instant =
    Boolean(prefunding?.enabled) &&
    Boolean(prefunding?.available) &&
    (await prefundedBalanceCovers(instantPricing.poolDebitHtgCents))

  // Promoter pays the 3% on the instant rail; the manual/admin rail is free,
  // exactly like organizer withdrawals.
  const { feeCents, payoutCents } = instant
    ? computeWithdrawalFee(grossHtgCents)
    : { feeCents: 0, payoutCents: grossHtgCents }

  const ref = await walletRef(uid)
  const withdrawalRef = adminDb.collection('withdrawal_requests').doc()
  const now = new Date()

  // Reserve first: bump withdrawn counters under optimistic concurrency so a
  // double-tap cannot pay twice. The view's withdrawn snapshot is the guard.
  try {
    await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const stored = snap.exists ? (snap.data() as any)?.withdrawn_by_currency || {} : {}
      for (const currency of Object.keys({ ...stored, ...view.withdrawnByCurrency })) {
        if ((Number(stored[currency]) || 0) !== (Number(view.withdrawnByCurrency[currency]) || 0)) {
          throw new Error('conflict')
        }
      }
      tx.set(
        ref,
        {
          withdrawn_by_currency: {
            ...stored,
            ...(htgCents > 0 ? { HTG: (Number(stored.HTG) || 0) + htgCents } : {}),
            ...(usdCents > 0 ? { USD: (Number(stored.USD) || 0) + usdCents } : {}),
          },
          moncash_phone: phone,
          updated_at: now.toISOString(),
        },
        { merge: true }
      )
      tx.set(withdrawalRef, {
        payee_type: 'promoter',
        promoter_uid: uid,
        // Kept for the admin queue's rendering; for a promoter row this is the
        // PAYEE's uid, not an organizer.
        organizerId: uid,
        eventId: null,
        amount: grossHtgCents,
        currency: 'HTG',
        method: 'moncash',
        status: instant ? 'processing' : 'pending',
        moncashNumber: phone,
        feeCents: feeCents || undefined,
        payoutAmountCents: payoutCents,
        payoutCurrency: 'HTG',
        payoutAmountHtgCents: payoutCents,
        usdToHtgRateUsed: usdCents > 0 ? usdToHtgRate : undefined,
        prefundingUsed: instant || undefined,
        prefundingFeePercent: instant ? PROMOTER_WITHDRAWAL_FEE_PERCENT : undefined,
        // Digicel's own 3% on the amount sent — Tikèm's cost, kept apart from feeCents.
        prefundingProviderFeeHtgCents: instant ? instantPricing.providerFeeHtgCents : undefined,
        prefundingPoolDebitHtgCents: instant ? instantPricing.poolDebitHtgCents : undefined,
        prefundingPlatformNetHtgCents: instant ? feeCents - instantPricing.providerFeeHtgCents : undefined,
        // What was debited from the wallet, per currency — the admin
        // reject/fail path credits exactly this back.
        walletDebits: {
          ...(htgCents > 0 ? { HTG: htgCents } : {}),
          ...(usdCents > 0 ? { USD: usdCents } : {}),
        },
        createdAt: now,
        updatedAt: now,
      })
    })
  } catch (err: any) {
    if (String(err?.message) === 'conflict') {
      return { ok: false, code: 'conflict', error: 'Your balance changed — reload and try again.' }
    }
    throw err
  }

  if (!instant) {
    return { ok: true, withdrawalId: withdrawalRef.id, instant: false, grossHtgCents, feeCents, payoutHtgCents: payoutCents }
  }

  const outcome = await executePrefundedTransfer({
    amount: Number((payoutCents / 100).toFixed(2)),
    receiver: phone,
    desc: 'Tikèm promoter commission withdrawal',
    reference: withdrawalRef.id,
  })

  if (outcome.outcome === 'completed') {
    await withdrawalRef.set(
      {
        status: 'completed',
        completedAt: new Date(),
        processedAt: new Date(),
        moncashTransactionId: outcome.transactionId,
        prefundingTransferRaw: outcome.raw,
        confirmedVia: outcome.confirmedVia,
        updatedAt: new Date(),
      },
      { merge: true }
    )
    return { ok: true, withdrawalId: withdrawalRef.id, instant: true, grossHtgCents, feeCents, payoutHtgCents: payoutCents }
  }

  if (outcome.outcome === 'unconfirmed') {
    // The money MAY have moved: keep the wallet debit (restoring it would allow
    // a second withdrawal of the same money) and leave it for an admin.
    console.error('[promoter-wallet] prefunded transfer outcome unknown; held for reconciliation', {
      withdrawalId: withdrawalRef.id,
      reason: outcome.reason,
      statusCheck: outcome.statusCheck,
    })
    await withdrawalRef.set(
      {
        status: 'processing',
        needsReconciliation: true,
        reconciliationReason: outcome.reason,
        reconciliationStatusCheck: outcome.statusCheck,
        updatedAt: new Date(),
      },
      { merge: true }
    )
    return {
      ok: true,
      withdrawalId: withdrawalRef.id,
      instant: false,
      confirming: true,
      grossHtgCents,
      feeCents,
      payoutHtgCents: payoutCents,
    }
  }

  // Definitively rejected by MonCash: nothing moved, put the money back.
  await refundPromoterWalletDebits(uid, { ...(htgCents > 0 ? { HTG: htgCents } : {}), ...(usdCents > 0 ? { USD: usdCents } : {}) })
  await withdrawalRef.set(
    { status: 'failed', failureReason: outcome.reason || 'MonCash transfer failed', updatedAt: new Date() },
    { merge: true }
  )
  return { ok: false, code: 'transfer_failed', error: 'The MonCash transfer failed. Your balance was restored — try again shortly.' }
}

/** Credit wallet debits back (failed transfer, or admin reject/fail). */
export async function refundPromoterWalletDebits(uid: string, debits: Record<string, number>): Promise<void> {
  const ref = await walletRef(uid)
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const stored = snap.exists ? (snap.data() as any)?.withdrawn_by_currency || {} : {}
    const next: Record<string, number> = { ...stored }
    for (const [currency, cents] of Object.entries(debits)) {
      next[currency] = Math.max(0, (Number(stored[currency]) || 0) - Math.max(0, Number(cents) || 0))
    }
    tx.set(ref, { withdrawn_by_currency: next, updated_at: new Date().toISOString() }, { merge: true })
  })
}
