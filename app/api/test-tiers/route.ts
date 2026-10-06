import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAdmin()
    if (authError || !user) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')

    console.log('=== TEST ENDPOINT ===')
    console.log('Testing direct Firestore access for eventId:', eventId)

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID required' }, { status: 400 })
    }

    // Try direct Firestore query
    const snapshot = await adminDb
      .collection('ticket_tiers')
      .where('event_id', '==', eventId)
      .get()

    console.log('Direct Firestore query succeeded')
    console.log('Found documents:', snapshot.docs.length)

    const tiers = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }))

    console.log('Tiers:', tiers)

    return NextResponse.json({
      success: true,
      count: tiers.length,
      tiers
    })
  } catch (error: any) {
    // Server log only: a stack trace in the response maps the server's file
    // layout and dependency versions for whoever reads it.
    console.error('Test endpoint error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
