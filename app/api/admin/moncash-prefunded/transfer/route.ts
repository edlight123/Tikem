import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { executePrefundedTransfer, normalizeMoncashReceiver } from '@/lib/payouts/moncash-prefunded'
import { finalizeWithdrawalCompleted } from '@/lib/payouts/withdrawal-finalize'
import { reviewWithdrawalDestination } from '@/lib/firestore/payout'
import { notifyWithdrawalOutcome } from '@/lib/notifications/withdrawal-outcome'

/**
 * Pay ONE approved MonCash withdrawal request over the prefunded pool.
 *
 * This used to send any amount to any free-form receiver for any admin. Now:
 *  - super admins only;
 *  - the only input is a withdrawal_requests id: amount and receiver come from
 *    that server record (status 'processing' = approved, MonCash, not already
 *    sent), and the receiver must still be the payee's saved destination;
 *  - per-call and per-day caps (config/payouts.adminTransferCaps, HTG minor
 *    units), counted in the same transaction that marks the row as sent, so a
 *    double click or two admins cannot pay the same row twice;
 *  - never on a withdrawal paid to the acting admin.
 * The row then follows the instant rail's lifecycle (prefundingUsed), so the
 * reconcile cron settles an unconfirmed outcome.
 */

const BodySchema = z.object({ withdrawalId: z.string().min(3).max(128) })

/** 250,000 HTG per transfer, 1,000,000 HTG per day, unless config says lower/higher. */
const DEFAULT_PER_CALL_CAP_HTG_CENTS = 25_000_000
const DEFAULT_DAILY_CAP_HTG_CENTS = 100_000_000

class Refused extends Error {
  constructor(message: string, public status = 409) {
    super(message)
  }
}

async function loadCaps(): Promise<{ perCall: number; daily: number }> {
  const snap = await adminDb.collection('config').doc('payouts').get()
  const caps = snap.exists ? (snap.data() as any)?.adminTransferCaps : null
  const pick = (raw: unknown, fallback: number) => {
    const n = Math.round(Number(raw))
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    perCall: pick(caps?.perCallHtgCents, DEFAULT_PER_CALL_CAP_HTG_CENTS),
    daily: pick(caps?.dailyHtgCents, DEFAULT_DAILY_CAP_HTG_CENTS),
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireSuperAdmin()
    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const json = await request.json().catch(() => null)
    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return adminError('Invalid request body', 400, 'Send { withdrawalId } of an approved MonCash withdrawal.')
    }
    const withdrawalId = parsed.data.withdrawalId
    const withdrawalRef = adminDb.collection('withdrawal_requests').doc(withdrawalId)

    const preSnap = await withdrawalRef.get()
    if (!preSnap.exists) return adminError('Withdrawal not found', 404)
    const pre = preSnap.data() as any
    if (String(pre?.organizerId || '') === user.id || String(pre?.promoter_uid || '') === user.id) {
      return adminError('You cannot pay a withdrawal to your own account. Ask another admin.', 403)
    }
    if ((await reviewWithdrawalDestination(pre)) !== 'match') {
      return adminError(
        "This MonCash number is not verified as the payee's saved payout number",
        409,
        'Pay it by hand after confirming with the payee.'
      )
    }

    const caps = await loadCaps()
    const day = new Date().toISOString().slice(0, 10)
    const dailyRef = adminDb.collection('admin_moncash_transfer_days').doc(day)

    let receiver = ''
    let amountHtgCents = 0
    try {
      await adminDb.runTransaction(async (tx: any) => {
        const [snap, dailySnap] = await Promise.all([tx.get(withdrawalRef), tx.get(dailyRef)])
        if (!snap.exists) throw new Refused('Withdrawal not found', 404)
        const row = snap.data() as any
        if (String(row?.method || '') !== 'moncash') throw new Refused('Not a MonCash withdrawal')
        if (String(row?.status || '') !== 'processing') throw new Refused('Approve the withdrawal first')
        if (row?.prefundingUsed === true || row?.adminTransferAt) throw new Refused('This withdrawal was already sent')
        if (!row?.reservedAt && row?.payee_type !== 'promoter') {
          throw new Refused('This withdrawal has no recorded reservation; pay it by hand')
        }
        const to = normalizeMoncashReceiver(row?.moncashNumber)
        if (!to) throw new Refused('The withdrawal has no valid MonCash number')
        const amount = Math.round(Number(row?.payoutAmountHtgCents ?? (row?.currency === 'HTG' ? row?.amount : NaN)))
        if (!Number.isFinite(amount) || amount <= 0) throw new Refused('The withdrawal has no HTG payout amount')
        if (amount > caps.perCall) {
          throw new Refused(`Above the per-transfer cap of ${(caps.perCall / 100).toFixed(2)} HTG; pay it by hand`)
        }
        const sentToday = Math.max(0, Number(dailySnap.exists ? (dailySnap.data() as any)?.totalHtgCents : 0) || 0)
        if (sentToday + amount > caps.daily) {
          throw new Refused(`Today's admin transfer cap of ${(caps.daily / 100).toFixed(2)} HTG would be exceeded`)
        }
        const now = new Date()
        tx.set(
          dailyRef,
          { totalHtgCents: sentToday + amount, count: (Number(dailySnap.data?.()?.count) || 0) + 1, updatedAt: now },
          { merge: true }
        )
        // From here the row is an instant transfer in flight: the reconcile
        // cron and the admin fail path treat it as possibly paid.
        tx.set(
          withdrawalRef,
          { prefundingUsed: true, adminTransferAt: now, adminTransferBy: user.id, updatedAt: now },
          { merge: true }
        )
        receiver = to
        amountHtgCents = amount
      })
    } catch (e: any) {
      if (e instanceof Refused) return adminError(e.message, e.status)
      throw e
    }

    const outcome = await executePrefundedTransfer({
      amount: Number((amountHtgCents / 100).toFixed(2)),
      receiver,
      desc: `Tikèm payout (${withdrawalId})`,
      reference: withdrawalId,
    })

    await logAdminAction({
      action: 'moncash.prefunded.transfer',
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceType: 'moncash',
      resourceId: withdrawalId,
      details: { withdrawalId, amountHtgCents, receiver, outcome: outcome.outcome },
    })

    if (outcome.outcome === 'completed') {
      const done = await finalizeWithdrawalCompleted(withdrawalId, {
        transactionId: outcome.transactionId,
        raw: outcome.raw,
        confirmedVia: outcome.confirmedVia,
      })
      if (done.changed) await notifyWithdrawalOutcome(withdrawalId, 'completed', { row: done.row })
      return adminOk({ success: true, outcome: 'completed', transactionId: outcome.transactionId })
    }

    if (outcome.outcome === 'unconfirmed') {
      await withdrawalRef.set(
        {
          needsReconciliation: true,
          reconciliationReason: outcome.reason,
          reconciliationStatusCheck: outcome.statusCheck,
          updatedAt: new Date(),
        },
        { merge: true }
      )
      return adminOk({ success: true, outcome: 'unconfirmed', message: 'Sent but not confirmed; the reconcile job will settle it.' })
    }

    // Rejected: nothing moved. Back to an approved manual row (the daily total
    // is not refunded, deliberately conservative).
    await withdrawalRef.set(
      { prefundingUsed: false, adminTransferAt: null, adminTransferRejectedReason: outcome.reason, updatedAt: new Date() },
      { merge: true }
    )
    return adminError('MonCash rejected the transfer', 502, outcome.reason)
  } catch (error: any) {
    console.error('admin moncash-prefunded transfer error:', error)
    return adminError('Failed to transfer via MonCash prefunded', 500, error?.message || String(error))
  }
}
