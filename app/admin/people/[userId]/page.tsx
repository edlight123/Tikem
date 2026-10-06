import { requireAdmin } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import AdminUserDetailsClient from './AdminUserDetailsClient'
import { updateUserRole } from '@/lib/firestore/user-profile-server'
import { revalidatePath } from 'next/cache'


function serializeFirestoreValue(value: any): any {
  if (value === null || value === undefined) return value

  if (typeof value?.toDate === 'function') {
    try {
      const d: any = value.toDate()
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString()
    } catch {
      // fall through
    }
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((v) => serializeFirestoreValue(v))
  }

  if (typeof value === 'object') {
    if (typeof (value as any)?.path === 'string') {
      return (value as any).path
    }

    if (typeof (value as any)?.latitude === 'number' && typeof (value as any)?.longitude === 'number') {
      return { latitude: (value as any).latitude, longitude: (value as any).longitude }
    }

    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeFirestoreValue(v)
    }
    return out
  }

  return value
}

async function computeAttendeeStats(userId: string): Promise<{
  ticketsConfirmed: number
  ticketsCheckedIn: number
  eventsAttended: number
}> {
  const [confirmedSnap, checkedInSnap] = await Promise.all([
    adminDb
      .collection('tickets')
      .where('attendee_id', '==', userId)
      .where('status', '==', 'confirmed')
      .count()
      .get()
      .catch(() => null as any),
    adminDb
      .collection('tickets')
      .where('attendee_id', '==', userId)
      .where('checked_in', '==', true)
      .count()
      .get()
      .catch(() => null as any),
  ])

  // Distinct events attended (by confirmed tickets)
  const eventIds = new Set<string>()
  const PAGE_SIZE = 500
  const MAX_SCAN = 5000

  let scanned = 0
  let q: any = adminDb
    .collection('tickets')
    .where('attendee_id', '==', userId)
    .where('status', '==', 'confirmed')
    .orderBy('__name__')

  let lastDoc: any = null

  while (true) {
    let pageQ: any = q.limit(PAGE_SIZE)
    if (lastDoc) pageQ = pageQ.startAfter(lastDoc)

    const snap = await pageQ.get().catch(() => null as any)
    if (!snap || !snap.docs?.length) break

    for (const doc of snap.docs) {
      const data = doc.data() || {}
      const eventId = typeof data.event_id === 'string' ? data.event_id : ''
      if (eventId) eventIds.add(eventId)
      scanned += 1
      if (scanned >= MAX_SCAN) break
    }

    if (scanned >= MAX_SCAN) break

    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < PAGE_SIZE) break
  }

  return {
    ticketsConfirmed: confirmedSnap ? Number(confirmedSnap.data().count) : 0,
    ticketsCheckedIn: checkedInSnap ? Number(checkedInSnap.data().count) : 0,
    eventsAttended: eventIds.size,
  }
}

async function computeOrganizerStats(organizerId: string): Promise<{
  totalEvents: number
  publishedEvents: number
  ticketsSold: number
}> {
  const [eventsSnap, publishedEventsSnap, ticketsSnap] = await Promise.all([
    adminDb.collection('events').where('organizer_id', '==', organizerId).count().get().catch(() => null as any),
    adminDb
      .collection('events')
      .where('organizer_id', '==', organizerId)
      .where('status', '==', 'published')
      .count()
      .get()
      .catch(() => null as any),
    adminDb.collection('tickets').where('organizer_id', '==', organizerId).count().get().catch(() => null as any),
  ])

  return {
    totalEvents: eventsSnap ? Number(eventsSnap.data().count) : 0,
    publishedEvents: publishedEventsSnap ? Number(publishedEventsSnap.data().count) : 0,
    ticketsSold: ticketsSnap ? Number(ticketsSnap.data().count) : 0,
  }
}

async function promoteToOrganizer(formData: FormData) {
  'use server'

  // A server action is its own POST endpoint: anyone holding the action id can
  // call it without ever rendering this page, so the page's requireAdmin does
  // not protect it. It must check for itself.
  const { user: admin, error } = await requireAdmin()
  if (error || !admin) throw new Error('Unauthorized')

  const userId = String(formData.get('userId') || '').trim()
  if (!userId) return

  await updateUserRole(userId, 'organizer')
  await adminDb.collection('admin_actions').add({
    admin_id: admin.id,
    admin_email: admin.email,
    action: 'promote_to_organizer',
    target_user_id: userId,
    timestamp: new Date(),
  })
  revalidatePath(`/admin/people/${userId}`)
  revalidatePath('/admin/people')
  revalidatePath('/admin/people/organizers')
}

export default async function AdminUserDetailsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { user, error } = await requireAdmin()

  if (error || !user) {
    redirect('/')
  }

  const userId = String((await params)?.userId || '').trim()
  if (!userId) redirect('/admin/people')

  const userDoc = await adminDb.collection('users').doc(userId).get()
  if (!userDoc.exists) redirect('/admin/people')

  const userDataRaw = userDoc.data() || {}
  const userData = serializeFirestoreValue(userDataRaw)

  const isOrganizer = userDataRaw.role === 'organizer' || Boolean(userDataRaw.is_organizer)

  const [attendeeStats, organizerStats] = await Promise.all([
    computeAttendeeStats(userId),
    isOrganizer ? computeOrganizerStats(userId) : Promise.resolve(null),
  ])

  const showPromoteToOrganizer = !isOrganizer && (Boolean(userDataRaw.is_verified) || Boolean(userDataRaw.is_organizer))

  const details = {
    id: userId,
    user: {
      id: userId,
      email: userData.email || '',
      full_name: userData.full_name || userData.name || '',
      name: userData.name || '',
      role: userData.role || 'attendee',
      is_verified: Boolean(userDataRaw.is_verified),
      status: userData.status || 'active',
    },
    attendeeStats,
    organizerStats,
    isOrganizer,
  }

  return (
    <AdminUserDetailsClient
      details={details}
      showPromoteToOrganizer={showPromoteToOrganizer}
      promoteToOrganizer={promoteToOrganizer}
    />
  )
}
