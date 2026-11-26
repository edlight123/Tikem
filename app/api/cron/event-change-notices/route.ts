/**
 * Every 5 minutes: notice edits to live events and tell ticket holders when the
 * date, time, venue or online link changed (lib/events/change-notices).
 *   1. observe every event edited since the last run;
 *   2. give older published events a baseline (one page per run, until done);
 *   3. claim each change whose 10-minute debounce has passed;
 *   4. deliver open notices, a bounded number of people per run.
 * Secured by CRON_SECRET (fails closed when unset).
 */
import { NextResponse } from 'next/server'
import {
  baselineUpcomingEvents,
  claimDueChanges,
  deliverOpenNotices,
  scanEditedEvents,
} from '@/lib/events/change-notices'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = Date.now()
  const scan = await scanEditedEvents(now).catch((e) => ({ error: String(e?.message || e) }))
  const backfill = await baselineUpcomingEvents(now).catch((e) => ({ error: String(e?.message || e) }))
  const claims = await claimDueChanges(now).catch((e) => ({ error: String(e?.message || e) }))
  const deliveries = await deliverOpenNotices().catch((e) => ({ error: String(e?.message || e) }))
  return NextResponse.json({ ok: true, scan, backfill, claims, deliveries })
}
