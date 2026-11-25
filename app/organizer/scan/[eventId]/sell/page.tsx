import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { requireSellerAccess } from '@/lib/physical/access'
import SellClient from './SellClient'

export const dynamic = 'force-dynamic'

/**
 * Web "sell a printed ticket": the seller types the serial (or pastes the
 * scanned code), the buyer's name, phone and payment method. Same API as the
 * app's scanner (/api/staff/events/:id/physical/activate). Open to the event's
 * org managers and to org sellers (their ranges only, enforced server-side).
 */
export default async function SellPrintedPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/auth/login?redirect=${encodeURIComponent(`/organizer/scan/${eventId}/sell`)}`)
  const gate = await requireSellerAccess(eventId)
  if (!gate.ok) notFound()
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <SellClient eventId={eventId} eventTitle={String(gate.event.title || '')} isSeller={gate.actor.role === 'seller'} />
    </div>
  )
}
