import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendDiscretionary } from '@/lib/notifications/campaigns'
import { runThursdayDigest } from '@/lib/notifications/weekly-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Thursday: "this weekend in <your city>" (lib/notifications/weekly-digest),
 * falling back to the old "new events in your city" push. Replaces the
 * Thursday 17:00 UTC city-discovery cron, so a city gets one Thursday message.
 *
 * Scheduled hourly 16:00 to 23:00 UTC on Thursdays (vercel.json): each person
 * is sent at the first run that falls in 17:00 to 21:00 their market's time
 * (Paris at 16:00 or 17:00 UTC, Haiti / New York / Toronto at 21:00 to 22:00
 * UTC). The weekly cap makes the later runs no-ops for them.
 *
 * Hard ceilings so one run cannot scan an unbounded collection (the same as
 * the old city-discovery job). BEFORE the audience outgrows these, this needs a
 * cursor and multiple passes; a truncated run is reported, not hidden.
 */
const MAX_EVENTS_SCANNED = 2000
const MAX_USERS_PER_RUN = 5000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let eventsScanned = 0
  let usersScanned = 0
  try {
    const result = await runThursdayDigest(new Date(), {
      async loadEvents() {
        // Read once and match in memory: a query per person would cost far more.
        const snap = await adminDb.collection('events').where('is_published', '==', true).limit(MAX_EVENTS_SCANNED).get()
        eventsScanned = snap.size
        return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      },
      async loadUsers() {
        // Only people whose city is known (set at push-token registration).
        const snap = await adminDb.collection('users').where('last_seen_city', '!=', null).limit(MAX_USERS_PER_RUN).get()
        usersScanned = snap.size
        return snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }))
      },
      send(userId, plan) {
        return sendDiscretionary({ userId, ...plan })
      },
    })

    const truncated = usersScanned >= MAX_USERS_PER_RUN || eventsScanned >= MAX_EVENTS_SCANNED
    return NextResponse.json({ ok: true, ...result, ...(truncated ? { truncated: true } : {}) })
  } catch (error: any) {
    console.error('[weekly-digest] failed', error)
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 })
  }
}
