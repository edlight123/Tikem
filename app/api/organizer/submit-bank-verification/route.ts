import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { adminStorage } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { notifyAdminsOfVerificationSubmission } from '@/lib/notifications/payout-verification'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

function normalizeBucketName(bucket: string): string {
  if (bucket.startsWith('gs://')) return bucket.slice('gs://'.length)
  return bucket
}

function getStorageBucketName(): string | null {
  const fromEnv = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  return fromEnv ? normalizeBucketName(fromEnv) : null
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

// File validation constants
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]

function validateFile(file: File, context: string): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `${context} exceeds maximum size of 10MB (${(file.size / 1024 / 1024).toFixed(2)}MB provided)`,
    }
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `${context} has invalid type '${file.type}'. Allowed types: JPEG, PNG, WebP, HEIC, PDF`,
    }
  }

  return { valid: true }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const organizerId = user.id

    const formData = await request.formData()
    const proofDocument = formData.get('proofDocument') as File
    const verificationType = formData.get('verificationType') as string // 'bank_statement' | 'void_check' | 'utility_bill'
    const destinationIdRaw = formData.get('destinationId') as string | null
    const destinationId = String(destinationIdRaw || 'bank_primary')

    if (!proofDocument || !verificationType) {
      return NextResponse.json(
        { error: 'Proof document and verification type are required' },
        { status: 400 }
      )
    }

    // Validate file size and type
    const validation = validateFile(proofDocument, 'Bank verification document')
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Ensure Haiti payout profile exists and is configured for bank transfers.
    const haitiProfile = await getPayoutProfile(organizerId, 'haiti')
    if (!haitiProfile || haitiProfile.method !== 'bank_transfer') {
      return NextResponse.json(
        { error: 'Haiti bank transfer payout method must be configured first' },
        { status: 400 }
      )
    }

    // Ensure the destination exists.
    const destinationDoc = await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payoutDestinations')
      .doc(destinationId)
      .get()

    if (!destinationDoc.exists || String((destinationDoc.data() as any)?.type || '') !== 'bank') {
      return NextResponse.json(
        { error: 'Bank destination not found' },
        { status: 404 }
      )
    }

    // Create verification request document
    const verificationRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')
      .doc(`bank_${destinationId}`)

    const bucketName = getStorageBucketName()
    if (!bucketName) {
      return NextResponse.json(
        {
          error: 'Storage bucket not configured',
          hint: 'Set FIREBASE_STORAGE_BUCKET (or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) to your Firebase Storage bucket name.',
        },
        { status: 500 }
      )
    }

    // Upload proof document to Firebase Storage.
    const objectPath = `verifications/bank/${organizerId}/${destinationId}/${Date.now()}_${sanitizeFilename(
      proofDocument.name || 'proof'
    )}`
    const buffer = Buffer.from(await proofDocument.arrayBuffer())
    const bucket = adminStorage.bucket(bucketName)
    const file = bucket.file(objectPath)
    await file.save(buffer, {
      contentType: proofDocument.type || 'application/octet-stream',
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
      },
    })

    const verificationData = {
      type: 'bank',
      destinationId,
      verificationType,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      // Stored in Firebase Storage; admins can fetch a signed URL via /api/admin/verification-image.
      documentPath: objectPath,
      documentName: proofDocument.name,
      documentSize: proofDocument.size,
    }

    await verificationRef.set(verificationData)

    // Notify admins of new verification submission
    try {
      const userDoc = await adminDb.collection('users').doc(organizerId).get()
      const organizerName = userDoc.exists ? (userDoc.data() as any)?.full_name || (userDoc.data() as any)?.email || 'Organizer' : 'Organizer'
      await notifyAdminsOfVerificationSubmission({
        organizerId,
        organizerName,
        verificationType: 'bank',
        destinationId,
      })
    } catch (notifError) {
      console.error('Failed to send admin notification:', notifError)
      // Don't fail the request if notification fails
    }

    return NextResponse.json({
      success: true,
      message: 'Bank account verification submitted successfully. Awaiting admin review.',
      status: 'pending',
    })
  } catch (error: any) {
    console.error('Error submitting bank verification:', error)
    return NextResponse.json(
      { error: 'Failed to submit verification', message: error.message },
      { status: 500 }
    )
  }
}
