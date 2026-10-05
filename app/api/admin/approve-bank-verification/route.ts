import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { sendEmail, getBankVerificationDecisionEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return adminError('Not authenticated', 401)
    }

    if (typeof (adminDb as any)?.collection !== 'function' || typeof (adminDb as any)?.runTransaction !== 'function') {
      return adminError(
        'Firestore admin client not initialized',
        500,
        'Missing Firebase Admin credentials/config in this environment.'
      )
    }

    const { organizerId, decision, reason, destinationId } = await request.json()

    if (!organizerId || !decision) {
      return adminError('Organization ID and decision are required', 400)
    }

    if (decision !== 'approve' && decision !== 'reject') {
      return adminError('Decision must be "approve" or "reject"', 400)
    }

    const newStatus = decision === 'approve' ? 'verified' : 'failed'

    const resolvedDestinationId = destinationId ? String(destinationId).trim() : ''

    // New schema uses verification doc id: bank_<destinationId>
    // Legacy primary used doc id: bank
    // Many deployments have BOTH patterns in the wild (especially for bank_primary),
    // so resolve by checking which document exists.
    // Document IDs are formatted as: bank_<destinationId>
    // e.g., destinationId="bank_primary" -> docId="bank_bank_primary"
    const candidateDocIds = (() => {
      const ids: string[] = []
      if (!resolvedDestinationId) {
        ids.push('bank')
        return ids
      }

      // Primary candidate: bank_<destinationId>
      // Even if destinationId already has "bank_" prefix, the doc ID will be "bank_bank_primary"
      ids.push(`bank_${resolvedDestinationId}`)

      // If destinationId doesn't have bank_ prefix, also try it as-is
      // (for cases where the full doc ID was passed)
      if (!resolvedDestinationId.startsWith('bank_')) {
        ids.push(resolvedDestinationId)
      }

      // Legacy fallback: the old 'bank' document (only for primary bank)
      const normalized = resolvedDestinationId.toLowerCase()
      if (normalized === 'bank_primary' || normalized === 'primary' || normalized === 'bank') {
        ids.push('bank')
      }

      return Array.from(new Set(ids))
    })()

    const verificationDocsRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')

    const txResult = await adminDb.runTransaction(async (tx: any) => {
      let snap: any = null
      let resolvedDocId: string | null = null

      for (const candidate of candidateDocIds) {
        const candidateRef = verificationDocsRef.doc(candidate)
        const candidateSnap = await tx.get(candidateRef)
        if (candidateSnap.exists) {
          snap = candidateSnap
          resolvedDocId = candidate
          break
        }
      }

      if (!snap || !snap.exists || !resolvedDocId) {
        return { notFound: true, attemptedDocIds: candidateDocIds }
      }

      const before = snap.data() as any
      const beforeStatus = String(before?.status || 'pending')

      if (beforeStatus === newStatus) {
        return { idempotent: true, beforeStatus, afterStatus: beforeStatus, docId: resolvedDocId }
      }

      tx.update(verificationDocsRef.doc(resolvedDocId), {
        status: newStatus,
        reviewedAt: new Date().toISOString(),
        reviewedBy: user.id,
        rejectionReason: decision === 'reject' ? reason : null,
      })

      return { idempotent: false, beforeStatus, afterStatus: newStatus, docId: resolvedDocId }
    })

    if ((txResult as any)?.notFound) {
      return adminError('Bank verification not found', 404)
    }

    const updatedDocId = String((txResult as any)?.docId || '')

    const idempotent = Boolean((txResult as any)?.idempotent)

    if (!idempotent) {
      logAdminAction({
        action: decision === 'approve' ? 'bank_verification.approve' : 'bank_verification.reject',
        adminId: user.id,
        adminEmail: user.email || 'unknown',
        resourceType: 'bank_verification',
        resourceId: `${organizerId}:${updatedDocId || resolvedDestinationId || 'bank'}`,
        details: {
          organizerId,
          destinationId,
          verificationDocId: updatedDocId,
          decision,
          reason: decision === 'reject' ? reason : null,
          beforeStatus: (txResult as any)?.beforeStatus,
          afterStatus: (txResult as any)?.afterStatus,
        },
      }).catch(() => {})
    }

    // Notify the organizer of the decision (non-blocking — don't fail the request if email fails)
    try {
      const organizerDoc = await adminDb.collection('users').doc(organizerId).get()
      const organizerData = organizerDoc.data()
      if (organizerData?.email) {
        const html = getBankVerificationDecisionEmail({
          organizerName: organizerData.full_name || organizerData.email,
          decision,
          reason: decision === 'reject' ? reason : undefined,
        })
        await sendEmail({
          to: organizerData.email,
          subject: decision === 'approve'
            ? 'Your bank account has been verified | Tikèm'
            : 'Bank verification update | Tikèm',
          html,
        })
      }
    } catch (emailErr) {
      console.error('[approve-bank-verification] Failed to send notification email:', emailErr)
    }

    return adminOk({
      message: `Bank verification ${decision}d successfully`,
      status: newStatus,
      idempotent,
    })
  } catch (error: any) {
    console.error('Error processing bank verification:', error)
    return adminError('Failed to process verification', 500, error?.message)
  }
}
