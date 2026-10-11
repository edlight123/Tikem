import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()

    // Only allow admin users
    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const { organizerId, isVerified } = await request.json()

    if (!organizerId || typeof isVerified !== 'boolean') {
      return adminError('Invalid request data', 400)
    }

    const userDoc = await adminDb.collection('users').doc(organizerId).get()
    if (!userDoc.exists) {
      return adminError('User not found', 404)
    }

    const targetUser = userDoc.data() as any

    const role = String(targetUser?.role || '').toLowerCase()
    const legacyOrganizerDoc = await adminDb.collection('organizers').doc(organizerId).get()
    const isOrganizer = role === 'organizer' || legacyOrganizerDoc.exists

    if (!isOrganizer) {
      return adminError('Target user is not an organizer', 400)
    }

    if (isVerified && organizerId === user.id) {
      return adminError('You cannot verify your own account', 403)
    }

    // Identity is ONE record: the approved verification_requests doc with an
    // ID and selfie on file (lib/kyc/identity.ts). This override can no longer
    // mark anyone verified without it:
    //  - verify  -> only re-instates an approved request (flags back in sync),
    //               or one this route revoked whose documents are unchanged;
    //  - remove  -> flags false (identity.ts reads that as revoked, so payouts
    //               stop at once) and the request moves to changes_requested so
    //               the organizer can resubmit.
    const requestRef = adminDb.collection('verification_requests').doc(organizerId)
    const nowIso = new Date().toISOString()
    const outcome = await adminDb.runTransaction(async (tx: any) => {
      const reqSnap = await tx.get(requestRef)
      const req = reqSnap.exists ? reqSnap.data() || {} : null
      const status = String(req?.status || '').toLowerCase()
      const evidenceKey = evidenceFingerprint(req)

      if (isVerified) {
        const reinstatable =
          !!req &&
          !!evidenceKey &&
          (status === 'approved' ||
            (status === 'changes_requested' && req?.revocation?.evidence === evidenceKey))
        if (!reinstatable) return { ok: false as const }
        tx.set(
          requestRef,
          {
            status: 'approved',
            revocation: null,
            reviewedBy: user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            reviewed_by: user.id,
            reviewed_at: new Date(),
            updated_at: new Date(),
          },
          { merge: true }
        )
      } else if (req && status === 'approved') {
        tx.set(
          requestRef,
          {
            status: 'changes_requested',
            reviewNotes: 'Your verification was removed by the Tikèm team. Please review your documents and submit again.',
            revocation: { by: user.id, at: nowIso, evidence: evidenceKey },
            updatedAt: FieldValue.serverTimestamp(),
            updated_at: new Date(),
          },
          { merge: true }
        )
      }

      const verification_status = isVerified ? 'approved' : reqSnap.exists && status === 'approved' ? 'changes_requested' : 'none'
      const mirror = { is_verified: isVerified, verification_status, updated_at: nowIso }
      tx.set(adminDb.collection('users').doc(organizerId), mirror, { merge: true })
      tx.set(adminDb.collection('organizers').doc(organizerId), mirror, { merge: true })
      return { ok: true as const, verification_status }
    })

    if (!outcome.ok) {
      return adminError(
        'This organizer has no approved verification with an ID and selfie on file. Review their verification request in Trust instead.',
        409
      )
    }
    const verification_status = outcome.verification_status

    await logAdminAction({
      action: isVerified ? 'user.verify' : 'user.unverify',
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceId: organizerId,
      resourceType: 'user',
      details: {
        userEmail: targetUser?.email || null,
        userName: targetUser?.full_name || targetUser?.name || null,
        verification_status,
      },
    })

    return adminOk({
      message: `Organizer ${isVerified ? 'verified' : 'unverified'} successfully`,
    })
  } catch (error) {
    console.error('Admin verification error:', error)
    return adminError('Internal server error', 500)
  }
}

/** The stored evidence paths of a request, as one comparable string ('' when none). */
function evidenceFingerprint(req: any): string {
  if (!req) return ''
  const front = req?.files?.governmentId?.front || req?.id_front_url || ''
  const selfie = req?.files?.selfie?.path || req?.face_photo_url || ''
  if (!front || !selfie) return ''
  const back = req?.files?.governmentId?.back || req?.id_back_url || ''
  const liveness = req?.files?.liveness?.path || ''
  return [front, back, selfie, liveness].join('|')
}
