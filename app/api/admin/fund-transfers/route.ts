import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import {
  FUND_TRANSFERS_COLLECTION,
  FundTransferInputSchema,
  buildFundTransferDoc,
  fundTransferFromDoc,
  payoutDocIdForWithdrawal,
} from '@/lib/payouts/fund-transfers'
import { loadFundTransfers } from '@/lib/payouts/money-map-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function gate() {
  const { user, error } = await requireAdmin()
  if (error || !user) {
    return { user: null, response: adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403) }
  }
  return { user, response: null }
}

/** GET: the ledger, newest first. Admin only. */
export async function GET() {
  const { user, response } = await gate()
  if (!user) return response!
  try {
    return adminOk({ transfers: await loadFundTransfers() })
  } catch (e: any) {
    console.error('[admin/fund-transfers] list failed', e?.message || e)
    return adminError('Could not load transfers', 500)
  }
}

/**
 * POST: record one movement or organizer payout. Append-only — a mistake is
 * corrected by recording the reverse movement. Nothing moves money here.
 *
 * An organizer payout may name the bank withdrawal request it settles; the
 * withdrawal is read (it must be a bank withdrawal, not failed, not already
 * settled by another payout) and snapshotted, so the money map can match the
 * HTG the organizer received against what their balance was debited.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await gate()
  if (!user) return response!

  const parsed = FundTransferInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return adminError(first?.message || 'Invalid transfer', 400, first?.path?.join('.'))
  }
  const doc = buildFundTransferDoc(parsed.data)

  let withdrawal: { amountMinor: number; currency: string; status: string; eventId: string | null } | null = null
  if (doc.kind === 'organizer_payout' && doc.withdrawalId) {
    const wSnap = await adminDb.collection('withdrawal_requests').doc(doc.withdrawalId).get()
    if (!wSnap.exists) return adminError('Withdrawal not found', 404)
    const w = (wSnap.data() as any) || {}
    if (String(w.method || '').toLowerCase() !== 'bank') {
      return adminError('That withdrawal is not a bank withdrawal', 409)
    }
    if (String(w.status || '').toLowerCase() === 'failed') {
      return adminError('That withdrawal failed: its balance went back to the organizer', 409)
    }
    const organizerId = String(w.organizerId || w.promoter_uid || '')
    if (doc.organizerId && organizerId && doc.organizerId !== organizerId) {
      return adminError('That withdrawal belongs to another organizer', 409)
    }
    doc.organizerId = doc.organizerId || organizerId || null
    withdrawal = {
      amountMinor: Math.round(Number(w.amount) || 0),
      currency: String(w.currency || 'HTG').toUpperCase(),
      status: String(w.status || ''),
      eventId: w.eventId ? String(w.eventId) : null,
    }
  }

  try {
    // A payout for a withdrawal has a deterministic id and is CREATED, so a
    // second payout for the same withdrawal fails atomically (no read-then-write race).
    const ref = doc.withdrawalId
      ? adminDb.collection(FUND_TRANSFERS_COLLECTION).doc(payoutDocIdForWithdrawal(doc.withdrawalId))
      : adminDb.collection(FUND_TRANSFERS_COLLECTION).doc()
    const nowIso = new Date().toISOString()
    const stored = {
      ...doc,
      withdrawal,
      createdAt: nowIso,
      createdBy: user.id,
      createdByEmail: user.email || null,
    }
    try {
      await ref.create(stored)
    } catch (e: any) {
      if (e?.code === 6 || /already exists/i.test(String(e?.message || ''))) {
        return adminError('A payout is already recorded for that withdrawal', 409)
      }
      throw e
    }
    await logAdminAction({
      action: doc.kind === 'organizer_payout' ? 'money.organizer_payout.record' : 'money.fund_transfer.record',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: ref.id,
      resourceType: 'fund_transfer',
      details: {
        from: doc.fromAccount,
        to: doc.toAccount,
        amountMinor: doc.amountMinor,
        currency: doc.currency,
        toAmountMinor: doc.toAmountMinor,
        toCurrency: doc.toCurrency,
        feeMinor: doc.feeMinor,
        reference: doc.reference,
        withdrawalId: doc.withdrawalId,
      },
    })
    return adminOk({ transfer: fundTransferFromDoc(ref.id, stored) }, 201)
  } catch (e: any) {
    console.error('[admin/fund-transfers] record failed', e?.message || e)
    return adminError('Could not record the transfer', 500)
  }
}
