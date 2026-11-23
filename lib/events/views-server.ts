import 'server-only'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { teamSeatIn } from '@/lib/organizer/context'
import { marketTimezone } from '@/lib/notifications/policy'
import {
  eventViewTimezone,
  viewDayKey,
  type EventViewStats,
  type RecordViewDeps,
} from '@/lib/events/views'

/** See lib/events/views.ts for the model. Admin SDK only. */
const STATS = 'event_view_stats'
const SEEN = 'event_view_seen'

function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || err?.code === 'already-exists' || /already exists/i.test(String(err?.message || ''))
}

export const firestoreViewDeps: RecordViewDeps = {
  async loadEvent(eventId) {
    const snap = await adminDb.collection('events').doc(eventId).get()
    return snap.exists ? snap.data() || {} : null
  },
  async isTeamMember(orgId, uid) {
    try {
      return Boolean(await teamSeatIn(orgId, uid))
    } catch {
      return false
    }
  },
  async claimDedupe(id, expiresAt) {
    try {
      await adminDb.collection(SEEN).doc(id).create({ expires_at: expiresAt })
      return true
    } catch (err) {
      if (isAlreadyExists(err)) return false
      throw err
    }
  },
  async increment(eventId, day) {
    const statsRef = adminDb.collection(STATS).doc(eventId)
    const batch = adminDb.batch()
    batch.set(statsRef, { total: FieldValue.increment(1), updated_at: new Date() }, { merge: true })
    batch.set(statsRef.collection('days').doc(day), { count: FieldValue.increment(1), day }, { merge: true })
    await batch.commit()
  },
  marketTimezone,
}

/** Total views and today's (event timezone). Zeros when nothing was counted yet or on error. */
export async function readEventViewStats(eventId: string, event: Record<string, any> | null | undefined): Promise<EventViewStats> {
  try {
    const statsRef = adminDb.collection(STATS).doc(eventId)
    const day = viewDayKey(new Date(), eventViewTimezone(event, marketTimezone))
    const [totalSnap, daySnap] = await Promise.all([statsRef.get(), statsRef.collection('days').doc(day).get()])
    const total = Number(totalSnap.exists ? totalSnap.data()?.total || 0 : 0)
    const today = Number(daySnap.exists ? daySnap.data()?.count || 0 : 0)
    return { total: Number.isFinite(total) ? total : 0, today: Number.isFinite(today) ? today : 0 }
  } catch (err: any) {
    console.warn('[event-views] read failed', err?.message)
    return { total: 0, today: 0 }
  }
}
