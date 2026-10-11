import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import {
  notifyOrganizerVerificationApproved,
  notifyOrganizerVerificationRejected,
  notifyOrganizerVerificationNeedsInfo,
} from '@/lib/notifications/payout-verification'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return adminError(error || 'Admin access required', 403)
    }

    const body = await request.json()
    const { organizerId, verificationType, documentId, status, reason } = body

    if (!organizerId || !verificationType || !documentId || !status) {
      return adminError('Missing required fields', 400)
    }

    if (!['verified', 'rejected', 'needs_info'].includes(status)) {
      return adminError('Invalid status', 400)
    }

    // Identity is decided ONLY by an approved verification_requests record
    // (/api/admin/review-verification; lib/kyc/identity.ts). An
    // organizers/{id}/verificationDocuments/identity doc is no longer read by
    // anything, and this route must not be a second way to "verify" a person.
    if (String(verificationType).toLowerCase() === 'identity' || String(documentId).toLowerCase() === 'identity') {
      return adminError('Identity is reviewed from the organizer verification request in Trust', 400)
    }

    // Update verification document
    const verificationRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')
      .doc(documentId)

    await verificationRef.update({
      status: status === 'needs_info' ? 'pending' : status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: user.id,
      reviewNotes: reason || null,
    })

    // Send appropriate notification to organizer
    const destinationId = documentId.startsWith('bank_') ? documentId.slice(5) : undefined

    if (status === 'verified') {
      await notifyOrganizerVerificationApproved({
        organizerId,
        verificationType,
        destinationId,
      })
    } else if (status === 'rejected') {
      await notifyOrganizerVerificationRejected({
        organizerId,
        verificationType,
        reason,
        destinationId,
      })
    } else if (status === 'needs_info') {
      await notifyOrganizerVerificationNeedsInfo({
        organizerId,
        verificationType,
        message: reason || 'Additional information is required for your verification.',
        destinationId,
      })
    }

    const auditAction = (() => {
      const isBank = String(verificationType).toLowerCase() === 'bank'

      if (status === 'verified') return isBank ? 'bank_verification.approve' : 'verification.approve'
      if (status === 'rejected') return isBank ? 'bank_verification.reject' : 'verification.reject'
      return isBank ? 'bank_verification.needs_info' : 'verification.needs_info'
    })()

    await logAdminAction({
      action: auditAction as any,
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceId: documentId,
      resourceType: 'verification_document',
      details: {
        organizerId,
        verificationType,
        documentId,
        status,
        reason: reason || null,
        destinationId: destinationId || null,
      },
    })

    return adminOk({ success: true })
  } catch (e: any) {
    console.error('Error updating verification status:', e)
    return adminError('Failed to update verification', 500, e?.message || String(e))
  }
}
