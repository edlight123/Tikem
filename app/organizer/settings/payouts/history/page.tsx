import PayoutHistoryTable, { type PayoutHistoryItem } from './PayoutHistoryTable'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getPayoutHistory } from '@/lib/firestore/payout'
import { serializeData } from '@/lib/utils/serialize'

export default async function PayoutHistoryPage() {
  // Verify authentication
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    redirect('/auth/login?redirect=/organizer/settings/payouts/history')
  }

  let authUser
  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    authUser = decodedClaims
  } catch (error) {
    console.error('Error verifying session:', error)
    redirect('/auth/login?redirect=/organizer/settings/payouts/history')
  }

  // Ensure this user is an organizer (attendees should go through the upgrade flow)
  try {
    const userDoc = await adminDb.collection('users').doc(authUser.uid).get()
    const role = userDoc.exists ? userDoc.data()?.role : null
    if (role !== 'organizer') {
      redirect('/organizer?redirect=/organizer/settings/payouts/history')
    }
  } catch (error) {
    console.error('Error checking user role:', error)
    redirect('/organizer?redirect=/organizer/settings/payouts/history')
  }

  // Fetch payout history
  const payouts = await getPayoutHistory(authUser.uid, 50)
  const serializedPayouts = serializeData(payouts)

  // Transform to expected format
  const transformedPayouts: PayoutHistoryItem[] = serializedPayouts.map((payout: any) => ({
    id: payout.id,
    date: payout.createdAt || new Date().toISOString(),
    amount: payout.amount || 0,
    status:
      payout.status === 'completed'
        ? 'completed'
        : payout.status === 'processing'
          ? 'processing'
          : payout.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
    eventCount: payout.ticketIds?.length || 0,
    method: payout.method || 'bank_transfer'
  }))

  const navbarUser = {
    id: authUser.uid,
    email: authUser.email || '',
    full_name: authUser.name || authUser.email || '',
    role: 'organizer' as const,
  }

  return (
    <div className="bg-canvas">      <PayoutHistoryTable payouts={transformedPayouts} />    </div>
  )
}
