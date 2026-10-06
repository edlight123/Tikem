import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { reviewWithdrawalDestination } from '@/lib/firestore/payout'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'
    const limit = parseInt(searchParams.get('limit') || '50')

    // Fetch withdrawal requests
    let query = adminDb
      .collection('withdrawal_requests')
      .orderBy('createdAt', 'desc')
      .limit(limit)

    if (status !== 'all') {
      query = query.where('status', '==', status) as any
    }

    const snapshot = await query.get()

    const normalizeAmountToCents = (raw: any): number => {
      const n = Number(raw)
      if (!Number.isFinite(n)) return 0
      // Legacy: some records stored dollars. New: cents.
      // Heuristic: valid withdrawals are >= 5000 cents ($50.00). If integer < 5000, treat as dollars.
      if (!Number.isInteger(n)) return Math.round(n * 100)
      if (n > 0 && n < 5000) return n * 100
      return n
    }

    const withdrawals = await Promise.all(
      snapshot.docs.map(async (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = doc.data()
        const amount = normalizeAmountToCents(data.amount)
        
        // Fetch event details
        // Promoter withdrawals carry eventId: null — doc(null) throws and would
        // take the whole admin list down with it.
        const eventDoc = data.eventId ? await adminDb.collection('events').doc(String(data.eventId)).get() : null
        const event = eventDoc?.exists ? eventDoc.data() : null

        // Fetch organizer details
        const organizerDoc = data.organizerId ? await adminDb.collection('users').doc(String(data.organizerId)).get() : null
        const organizer = organizerDoc?.exists ? organizerDoc.data() : null

        // Is the number on this row still the payee's saved, verified MonCash
        // destination? 'mismatch' / 'unverified' must be checked before paying.
        const destinationReview = await reviewWithdrawalDestination(data)
        const flags: string[] = Array.isArray((data as any).reviewFlags) ? [...(data as any).reviewFlags] : []
        if (destinationReview === 'mismatch') flags.push('destination_mismatch')
        if (destinationReview === 'unverified') flags.push('destination_unverified')
        // The admin viewing the queue is the payee: someone else must act on it.
        if (String(data.organizerId || '') === user.id || String((data as any).promoter_uid || '') === user.id) {
          flags.push('own_account')
        }

        return {
          id: doc.id,
          ...data,
          amount,
          destinationReview,
          reviewFlags: flags,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
          processedAt: data.processedAt?.toDate?.()?.toISOString() || data.processedAt,
          completedAt: data.completedAt?.toDate?.()?.toISOString() || data.completedAt,
          event: event ? {
            id: data.eventId,
            title: event.title,
            date: event.start_datetime || event.date_time
          } : null,
          organizer: organizer ? {
            id: data.organizerId,
            name: organizer.full_name || organizer.name,
            email: organizer.email
          } : null
        }
      })
    )

    return NextResponse.json({ withdrawals })
  } catch (err: any) {
    console.error('Error fetching withdrawals:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to fetch withdrawals' },
      { status: 500 }
    )
  }
}
