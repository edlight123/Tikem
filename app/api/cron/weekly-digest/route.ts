import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendDiscretionary } from '@/lib/notifications/campaigns'
import { DISCOVERY_HORIZON_DAYS, runThursdayDigest } from '@/lib/notifications/weekly-digest'
import { readPublishedEventsInWindow } from '@/lib/events/published-in-window'

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

  let eventsTruncated = false
  let usersScanned = 0
  const now = new Date()
  try {
    const result = await runThursdayDigest(now, {
      async loadEvents() {
        // Read once and match in memory: a query per person would cost far more.
        // Only the digest's own window (next DISCOVERY_HORIZON_DAYS), soonest
        // first, both start_datetime types: an unordered limit() over every
        // published event returned an arbitrary slice that could miss them.
        const { events, truncated } = await readPublishedEventsInWindow(
          adminDb,
          now,
          new Date(now.getTime() + DISCOVERY_HORIZON_DAYS * 24 * 60 * 60 * 1000),
          MAX_EVENTS_SCANNED
        )
        eventsTruncated = truncated
        return events
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

    const truncated = usersScanned >= MAX_USERS_PER_RUN || eventsTruncated
    return NextResponse.json({ ok: true, ...result, ...(truncated ? { truncated: true } : {}) })
  } catch (error: any) {
    console.error('[weekly-digest] failed', error)
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 })
  }
}
