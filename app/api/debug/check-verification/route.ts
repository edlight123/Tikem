import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireDevTools } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireDevTools()
    if (error || !user) {
      return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
    }

    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')

    if (!email) {
      return adminError('Email parameter required', 400)
    }

    // Find user by email
    const usersSnapshot = await adminDb
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get()

    if (usersSnapshot.empty) {
      return adminError('User not found', 404)
    }

    const userDoc = usersSnapshot.docs[0]
    const userId = userDoc.id
    const userData = userDoc.data()

    // Check verification_requests collection
    const verificationRequestDoc = await adminDb
      .collection('verification_requests')
      .doc(userId)
      .get()

    // Check organizers payout config
    const payoutConfigDoc = await adminDb
      .collection('organizers')
      .doc(userId)
      .collection('payoutConfig')
      .doc('main')
      .get()

    // Check verification documents
    const verificationDocsSnapshot = await adminDb
      .collection('organizers')
      .doc(userId)
      .collection('verificationDocuments')
      .get()

    const verificationDocs: any = {}
    verificationDocsSnapshot.docs.forEach((doc: any) => {
      verificationDocs[doc.id] = doc.data()
    })

    return adminOk({
      userId,
      email,
      user: {
        role: userData.role,
        verification_status: userData.verification_status,
        full_name: userData.full_name,
      },
      verification_request: {
        exists: verificationRequestDoc.exists,
        data: verificationRequestDoc.exists ? verificationRequestDoc.data() : null,
      },
      payout_config: {
        exists: payoutConfigDoc.exists,
        data: payoutConfigDoc.exists ? payoutConfigDoc.data() : null,
      },
      verification_documents: verificationDocs,
    })
  } catch (error: any) {
    console.error('Error checking verification:', error)
    return adminError('Failed to check verification', 500, error?.message || String(error))
  }
}
