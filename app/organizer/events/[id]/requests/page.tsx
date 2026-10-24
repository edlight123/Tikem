import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { notFound, redirect } from 'next/navigation'
import RequestsClient from './RequestsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The approval list for one event (docs/specs/approval-lists-and-plus-ones.md).
 * Stitch: 4d0474f2462042c2a23f5eb1dde0fae0. The list itself is loaded by the
 * client from /api/organizer/events/[id]/requests, which re-checks ownership.
 */
export default async function RequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { user, error } = await requireAuth()
  if (error || !user) redirect(`/auth/login?redirect=/organizer/events/${eventId}/requests`)

  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) notFound()
  const data = eventDoc.data() as { organizer_id?: string; requires_approval?: boolean }
  if (data?.organizer_id !== user.id && !(user as any).isAdmin) notFound()

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <RequestsClient eventId={eventId} requiresApproval={data?.requires_approval === true} />
    </div>
  )
}
