import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import Navbar from '@/components/Navbar'
import { isAdmin } from '@/lib/admin'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'

export const revalidate = 0

type StaffEvent = {
  eventId: string
  title: string
  start_datetime?: string
  venue_name?: string
  city?: string
  canCheckIn: boolean
}

type MemberRow = { id: string; data: any }

function toISOString(value: any): string | undefined {
  if (!value) return undefined
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

function isIndexBuildingOrMissing(err: unknown): boolean {
  const anyErr = err as any
  return (
    anyErr?.code === 9 ||
    String(anyErr?.details || anyErr?.message || '').toLowerCase().includes('requires an index') ||
    String(anyErr?.details || anyErr?.message || '').toLowerCase().includes('index is currently building')
  )
}

export default async function StaffHomePage() {
  const { user, error } = await requireAuth()
  if (error || !user) {
    redirect('/auth/login?redirect=/staff')
  }

  // Find events where this user is a staff member (across all events).
  let membersSnap
  try {
    membersSnap = await adminDb
      .collectionGroup('members')
      .where('uid', '==', user.id)
      .where('role', '==', 'staff')
      .get()
  } catch (err) {
    // Composite index may still be building right after deploy. Fall back to uid-only query
    // (single-field index), then filter by role in-memory.
    if (!isIndexBuildingOrMissing(err)) throw err

    membersSnap = await adminDb.collectionGroup('members').where('uid', '==', user.id).get()
  }

  const memberRows: MemberRow[] = membersSnap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, data: d.data() as any }))
    .filter((row: MemberRow) => Boolean(row.data?.eventId))
    .filter((row: MemberRow) => String(row.data?.role || '') === 'staff')

  const uniqueEventIds = Array.from(new Set(memberRows.map((r) => String(r.data.eventId))))

  const events: StaffEvent[] = await Promise.all(
    uniqueEventIds.map(async (eventId) => {
      const member = memberRows.find((r) => String(r.data.eventId) === eventId)?.data
      const canCheckIn = Boolean(member?.permissions?.checkin)

      const eventDoc = await adminDb.collection('events').doc(eventId).get()
      const data = eventDoc.exists ? (eventDoc.data() as any) : null

      return {
        eventId,
        title: data?.title ? String(data.title) : 'Event',
        start_datetime: toISOString(data?.start_datetime),
        venue_name: data?.venue_name ? String(data.venue_name) : undefined,
        city: data?.city ? String(data.city) : undefined,
        canCheckIn,
      }
    })
  )

  const checkInEvents = events.filter((e) => e.canCheckIn)

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-white">Staff</h1>
        <p className="mt-1 text-sm text-white/65">Your assigned events</p>

        {checkInEvents.length === 0 ? (
          <div className="mt-6 bg-white/[0.03] border border-white/10 rounded-xl p-5">
            <p className="text-sm text-white/70">No staff events assigned yet.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {checkInEvents.map((e) => (
              <a
                key={e.eventId}
                href={`/organizer/scan/${encodeURIComponent(e.eventId)}`}
                className="block bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-white/10 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-white truncate">{e.title}</div>
                    <div className="text-xs text-white/65 mt-1">
                      {e.start_datetime ? new Date(e.start_datetime).toLocaleString() : 'Date TBD'}
                      {e.venue_name ? ` • ${e.venue_name}` : ''}
                      {e.city ? ` • ${e.city}` : ''}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-emerald-300 border border-green-200 rounded-full px-2.5 py-1">
                    Scan
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
