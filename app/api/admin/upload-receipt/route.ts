import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb, adminStorage } from '@/lib/firebase/admin'
import { isAdmin as isAdminEmail } from '@/lib/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { sniffRasterImage } from '@/lib/security/sniffImage'

function isRoleAdmin(role: unknown): boolean {
  if (typeof role !== 'string') return false
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === 'admin' || normalized === 'super_admin'
}

async function authenticateAdmin(
  request: NextRequest
): Promise<{ ok: true; userId: string; email: string } | { ok: false; res: Response }> {
  const token = request.headers.get('authorization')?.split('Bearer ')[1]
  if (!token) return { ok: false, res: adminError('Unauthorized', 401) }
  const decodedToken = await adminAuth.verifyIdToken(token)
  const userId = decodedToken.uid
  const userDoc = await adminDb.collection('users').doc(userId).get()
  const userData = userDoc.data()
  const roleIsAdmin = isRoleAdmin(userData?.role)
  // Token email only (users/{uid}.email is client-writable).
  const emailIsAdmin = decodedToken.email_verified === true && isAdminEmail(String(decodedToken.email || ''))
  if (!roleIsAdmin && !emailIsAdmin) {
    return { ok: false, res: adminError('Forbidden - Admin access required', 403) }
  }
  return { ok: true, userId, email: String(userData?.email || decodedToken.email || 'unknown') }
}

/** Receipts are bank/MonCash transfer proofs: private, read via short-lived signed URLs only. */
const SIGNED_URL_TTL_MS = 60 * 60 * 1000

async function signedReceiptUrl(path: string): Promise<string> {
  const [url] = await adminStorage.bucket().file(path).getSignedUrl({
    action: 'read',
    expires: Date.now() + SIGNED_URL_TTL_MS,
  })
  return url
}

/** Storage path of a payout's receipt: the new `receiptPath`, or parsed from a legacy public URL. */
function receiptPathOf(payout: any, bucketName: string): string | null {
  if (typeof payout?.receiptPath === 'string' && payout.receiptPath) return payout.receiptPath
  const legacy = typeof payout?.receiptUrl === 'string' ? payout.receiptUrl : ''
  const parts = legacy.split(`${bucketName}/`)
  return parts.length >= 2 && parts[1] ? decodeURIComponent(parts[1].split('?')[0]) : null
}

function sniffReceipt(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  const img = sniffRasterImage(buf)
  if (img && img.mime !== 'image/gif') return img
  return null
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAdmin(request)
    if (!auth.ok) return auth.res
    const { userId, email: adminEmail } = auth

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const payoutId = formData.get('payoutId') as string
    const organizerId = formData.get('organizerId') as string

    if (!file || !payoutId || !organizerId) {
      return adminError('Missing required fields: file, payoutId, organizerId', 400)
    }

    // Validate file
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!validTypes.includes(file.type)) {
      return adminError('Invalid file type. Must be JPG, PNG, WebP, or PDF', 400)
    }

    if (file.size > 5 * 1024 * 1024) {
      return adminError('File size must be less than 5MB', 400)
    }

    // Verify payout exists
    const payoutRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payouts')
      .doc(payoutId)

    const payoutDoc = await payoutRef.get()
    if (!payoutDoc.exists) {
      return adminError('Payout not found', 404)
    }

    // Content type and extension come from the bytes, not the client.
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffReceipt(fileBuffer)
    if (!sniffed) {
      return adminError('Invalid file type. Must be JPG, PNG, WebP, or PDF', 400)
    }
    const timestamp = Date.now()
    const fileName = `payout-receipts/${organizerId}/${payoutId}/${timestamp}.${sniffed.ext}`

    // Upload to Firebase Storage — PRIVATE. Receipts carry account numbers
    // and names; they used to be makePublic()'d at a guessable URL.
    const bucket = adminStorage.bucket()
    const storageFile = bucket.file(fileName)

    await storageFile.save(fileBuffer, {
      resumable: false,
      metadata: {
        contentType: sniffed.mime,
        cacheControl: 'private, max-age=0, no-transform',
        metadata: {
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          payoutId,
          organizerId
        }
      }
    })

    const receiptUrl = await signedReceiptUrl(fileName)

    // The doc stores the PATH; readers mint a signed URL (GET below).
    // `receiptUrl` is cleared so no long-lived link sits in Firestore.
    await payoutRef.update({
      receiptPath: fileName,
      receiptUrl: null,
      receiptUploadedBy: userId,
      receiptUploadedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    await logAdminAction({
      action: 'payout.receipt.upload',
      adminId: userId,
      adminEmail,
      resourceId: payoutId,
      resourceType: 'payout',
      details: {
        payoutId,
        organizerId,
        fileName,
        contentType: sniffed.mime,
      },
    })

    return adminOk({
      receiptUrl,
      message: 'Receipt uploaded successfully'
    })

  } catch (error: any) {
    console.error('Receipt upload error:', error)
    return adminError('Failed to upload receipt', 500)
  }
}

// Delete receipt
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateAdmin(request)
    if (!auth.ok) return auth.res
    const { userId, email: adminEmail } = auth

    const { searchParams } = new URL(request.url)
    const payoutId = searchParams.get('payoutId')
    const organizerId = searchParams.get('organizerId')

    if (!payoutId || !organizerId) {
      return adminError('Missing required parameters: payoutId, organizerId', 400)
    }

    // Get payout document
    const payoutRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payouts')
      .doc(payoutId)

    const payoutDoc = await payoutRef.get()
    if (!payoutDoc.exists) {
      return adminError('Payout not found', 404)
    }

    const payout = payoutDoc.data()
    const bucket = adminStorage.bucket()
    const filePath = receiptPathOf(payout, bucket.name)
    if (!filePath) {
      return adminError('No receipt found', 404)
    }
    // Only ever delete inside this payout's own receipt folder.
    if (!filePath.startsWith(`payout-receipts/${organizerId}/${payoutId}/`) || filePath.includes('..')) {
      return adminError('Invalid receipt path', 400)
    }

    // Delete from storage
    try {
      await bucket.file(filePath).delete()
    } catch (storageError) {
      console.error('Storage deletion error:', storageError)
      // Continue even if storage deletion fails
    }

    // Remove receipt info from payout document
    await payoutRef.update({
      receiptUrl: null,
      receiptPath: null,
      receiptUploadedBy: null,
      receiptUploadedAt: null,
      updatedAt: new Date().toISOString()
    })

    await logAdminAction({
      action: 'payout.receipt.delete',
      adminId: userId,
      adminEmail,
      resourceId: payoutId,
      resourceType: 'payout',
      details: {
        payoutId,
        organizerId,
        filePath,
      },
    })

    return adminOk({
      message: 'Receipt deleted successfully'
    })

  } catch (error: any) {
    console.error('Receipt deletion error:', error)
    return adminError('Failed to delete receipt', 500)
  }
}

/**
 * A fresh short-lived signed URL for a payout's receipt (admin only).
 * GET ?organizerId=&payoutId=
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAdmin(request)
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(request.url)
    const payoutId = searchParams.get('payoutId')
    const organizerId = searchParams.get('organizerId')
    if (!payoutId || !organizerId) {
      return adminError('Missing required parameters: payoutId, organizerId', 400)
    }
    const payoutDoc = await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payouts')
      .doc(payoutId)
      .get()
    if (!payoutDoc.exists) return adminError('Payout not found', 404)
    const filePath = receiptPathOf(payoutDoc.data(), adminStorage.bucket().name)
    if (!filePath || !filePath.startsWith(`payout-receipts/${organizerId}/${payoutId}/`) || filePath.includes('..')) {
      return adminError('No receipt found', 404)
    }
    return adminOk({ receiptUrl: await signedReceiptUrl(filePath) })
  } catch (error: any) {
    console.error('Receipt URL error:', error)
    return adminError('Failed to get receipt', 500)
  }
}
