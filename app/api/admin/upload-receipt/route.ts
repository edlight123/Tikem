import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb, adminStorage } from '@/lib/firebase/admin'
import { isAdmin as isAdminEmail } from '@/lib/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'

function isRoleAdmin(role: unknown): boolean {
  if (typeof role !== 'string') return false
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === 'admin' || normalized === 'super_admin'
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const token = request.headers.get('authorization')?.split('Bearer ')[1]
    if (!token) {
      return adminError('Unauthorized', 401)
    }

    const decodedToken = await adminAuth.verifyIdToken(token)
    const userId = decodedToken.uid

    // Check if user is admin
    const userDoc = await adminDb.collection('users').doc(userId).get()
    const userData = userDoc.data()

    const roleIsAdmin = isRoleAdmin(userData?.role)
    // Token email only (users/{uid}.email is client-writable).
    const emailIsAdmin = decodedToken.email_verified === true && isAdminEmail(String(decodedToken.email || ''))
    if (!roleIsAdmin && !emailIsAdmin) {
      return adminError('Forbidden - Admin access required', 403)
    }

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

    // Generate unique filename
    const timestamp = Date.now()
    const fileExtension = file.name.split('.').pop()
    const fileName = `payout-receipts/${organizerId}/${payoutId}/${timestamp}.${fileExtension}`

    // Upload to Firebase Storage
    const bucket = adminStorage.bucket()
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const storageFile = bucket.file(fileName)

    await storageFile.save(fileBuffer, {
      metadata: {
        contentType: file.type,
        metadata: {
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          payoutId,
          organizerId
        }
      }
    })

    // Make file publicly accessible
    await storageFile.makePublic()

    // Get public URL
    const receiptUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

    // Update payout document with receipt info
    await payoutRef.update({
      receiptUrl,
      receiptUploadedBy: userId,
      receiptUploadedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    await logAdminAction({
      action: 'payout.receipt.upload',
      adminId: userId,
      adminEmail: String(userData?.email || decodedToken.email || 'unknown'),
      resourceId: payoutId,
      resourceType: 'payout',
      details: {
        payoutId,
        organizerId,
        receiptUrl,
        fileName,
        contentType: file.type,
      },
    })

    return adminOk({
      receiptUrl,
      message: 'Receipt uploaded successfully'
    })

  } catch (error: any) {
    console.error('Receipt upload error:', error)
    return adminError('Failed to upload receipt', 500, error?.message || 'Unknown error')
  }
}

// Delete receipt
export async function DELETE(request: NextRequest) {
  try {
    // Verify admin authentication
    const token = request.headers.get('authorization')?.split('Bearer ')[1]
    if (!token) {
      return adminError('Unauthorized', 401)
    }

    const decodedToken = await adminAuth.verifyIdToken(token)
    const userId = decodedToken.uid

    // Check if user is admin
    const userDoc = await adminDb.collection('users').doc(userId).get()
    const userData = userDoc.data()

    const roleIsAdmin = isRoleAdmin(userData?.role)
    // Token email only (users/{uid}.email is client-writable).
    const emailIsAdmin = decodedToken.email_verified === true && isAdminEmail(String(decodedToken.email || ''))
    if (!roleIsAdmin && !emailIsAdmin) {
      return adminError('Forbidden - Admin access required', 403)
    }

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
    if (!payout?.receiptUrl) {
      return adminError('No receipt found', 404)
    }

    // Extract file path from URL
    const bucket = adminStorage.bucket()
    const urlParts = payout.receiptUrl.split(`${bucket.name}/`)
    if (urlParts.length < 2) {
      return adminError('Invalid receipt URL', 400)
    }

    const filePath = urlParts[1]

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
      receiptUploadedBy: null,
      receiptUploadedAt: null,
      updatedAt: new Date().toISOString()
    })

    await logAdminAction({
      action: 'payout.receipt.delete',
      adminId: userId,
      adminEmail: String(userData?.email || decodedToken.email || 'unknown'),
      resourceId: payoutId,
      resourceType: 'payout',
      details: {
        payoutId,
        organizerId,
        previousReceiptUrl: payout.receiptUrl,
        filePath,
      },
    })

    return adminOk({
      message: 'Receipt deleted successfully'
    })

  } catch (error: any) {
    console.error('Receipt deletion error:', error)
    return adminError('Failed to delete receipt', 500, error?.message || 'Unknown error')
  }
}
