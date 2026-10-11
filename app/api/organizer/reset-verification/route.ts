/**
 * Restart the caller's KYC request.
 *
 * Allowed from `rejected` and `changes_requested` (review-verification turns an
 * admin "reject" into changes_requested), and from a draft. Never from an
 * approved request (it is the record behind payouts and the verified badge) or
 * one awaiting review (its evidence is frozen until an admin decides).
 *
 * The request is reset to a blank in_progress draft server-side — the client
 * cannot do it: status and review fields are server-owned in firestore.rules,
 * and Storage no longer lets the owner delete KYC uploads, so the previous
 * attempt's files are removed here with the Admin SDK.
 */

import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getCurrentUser } from '@/lib/auth'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { isOwnedVerificationPath } from '@/lib/kyc/identity'
import { blankVerificationSteps, RESTARTABLE_STATUSES } from '@/lib/kyc/request-template'

function storedPaths(files: any): string[] {
  const out = [
    files?.governmentId?.front,
    files?.governmentId?.back,
    files?.selfie?.path,
    files?.liveness?.path,
    files?.businessDocs?.registration,
    files?.businessDocs?.taxId,
  ]
  return out.filter((p): p is string => typeof p === 'string' && !!p)
}

export async function POST(_request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const ref = adminDb.collection('verification_requests').doc(userId)
    const result = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return { ok: true as const, oldPaths: [] as string[] }
      const data = snap.data() || {}
      const status = String(data.status || '').trim().toLowerCase()
      if (status === 'approved' || status === 'verified') {
        return { ok: false as const, status: 409, code: 'already_verified', error: 'An approved verification cannot be reset.' }
      }
      if (!(RESTARTABLE_STATUSES as readonly string[]).includes(status)) {
        return {
          ok: false as const,
          status: 409,
          code: 'under_review',
          error: 'Your verification is under review and cannot be restarted until a decision is made.',
        }
      }
      tx.set(ref, {
        userId,
        status: 'in_progress',
        steps: blankVerificationSteps(),
        files: {},
        reviewNotes: null,
        reasonCodes: null,
        reviewedAt: null,
        reviewedBy: null,
        submittedAt: null,
        restartedAt: FieldValue.serverTimestamp(),
        restartedFrom: status || null,
        createdAt: data.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true as const, oldPaths: storedPaths(data.files) }
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    }

    // Best-effort cleanup of the previous attempt's uploads (own prefix only).
    const toDelete = (result.oldPaths as string[]).filter((p: string) => isOwnedVerificationPath(p, userId))
    if (toDelete.length) {
      try {
        const bucket = adminStorage.bucket()
        await Promise.allSettled(toDelete.map((p: string) => bucket.file(p).delete({ ignoreNotFound: true })))
      } catch (e: any) {
        console.warn('[reset-verification] storage cleanup skipped', { message: e?.message })
      }
    }

    return NextResponse.json({ success: true, message: 'Verification restarted.' })
  } catch (error: any) {
    console.error('Error resetting verification:', error)
    return NextResponse.json({ error: 'Failed to reset verification' }, { status: 500 })
  }
}
