import { NextResponse } from 'next/server'
import { runPostEventFollowups } from '@/lib/postEvent/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Hourly. The morning after an event: "how was it?" to checked-in attendees
 * and the recap to the organizer side (lib/postEvent). Each event is handled
 * once (reminder claim) and each person is capped once per event.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runPostEventFollowups(new Date())
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[cron/post-event-followup] failed', error)
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 })
  }
}
