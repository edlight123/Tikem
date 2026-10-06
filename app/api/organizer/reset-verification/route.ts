/**
 * Reset Verification Request
 * Deletes the existing verification request so a new one will be created with updated structure
 */

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export async function POST(request: NextRequest) {
  try {
    // Get the authorization token
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    
    // Verify the token
    const decodedToken = await adminAuth.verifyIdToken(token)
    const userId = decodedToken.uid

    // An approved request is the record behind the organizer's verified badge
    // and payout eligibility; deleting it would erase the review trail and let
    // an approved organizer swap in different documents. Only an unapproved
    // request (draft, in progress, rejected) may be started over.
    const ref = adminDb.collection('verification_requests').doc(userId)
    const reset = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return { ok: true as const }
      const status = String(snap.data()?.status || '').toLowerCase()
      if (status === 'approved' || status === 'verified') return { ok: false as const }
      tx.delete(ref)
      return { ok: true as const }
    })
    if (!reset.ok) {
      return NextResponse.json(
        { error: 'An approved verification cannot be reset.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Verification request reset. Please refresh the page.' 
    })
  } catch (error: any) {
    console.error('Error resetting verification:', error)
    return NextResponse.json(
      { error: 'Failed to reset verification' },
      { status: 500 }
    )
  }
}
