import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { runNationalDayPush } from '@/lib/notifications/national-day-push'
import type { NationalDayConfig } from '@/lib/nationalDays'

export const dynamic = 'force-dynamic'

/**
 * The national-day push (lib/notifications/national-day-push): hourly, and on
 * a holiday each user hears once, at 09:00 their time. Most runs return after
 * one config read.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Read the remote config directly, not through the homepage's cached
  // read-with-timeout: that one falls back to the built-in calendar on a slow
  // read, which is right for a banner and wrong for a push. A day switched off
  // remotely must not go out because Firestore was slow, so an unreadable
  // config skips the run (the next hour tries again; caps make that safe).
  let config: NationalDayConfig | null
  try {
    const snap = await adminDb.collection('config').doc('national_days').get()
    config = snap.exists ? ((snap.data() as NationalDayConfig) ?? null) : null
  } catch (error: any) {
    console.error('[national-day-push] config unreadable, skipping run', error)
    return NextResponse.json({ error: 'config unreadable' }, { status: 503 })
  }

  try {
    return NextResponse.json(await runNationalDayPush(new Date(), config))
  } catch (error: any) {
    console.error('[national-day-push] failed', error)
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 })
  }
}
