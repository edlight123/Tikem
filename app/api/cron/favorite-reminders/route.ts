import { NextResponse } from 'next/server'
import { runFavoriteReminders } from '@/lib/notifications/favorite-reminders'

export const dynamic = 'force-dynamic'

/**
 * Saved-event reminder cron (vercel.json, daily).
 *
 * Reminds people about events they saved (event_favorites) that start within
 * 7 days and that they hold no live ticket for. Once per person per event, and
 * subject to their reminder switch and quiet hours: see
 * lib/notifications/favorite-reminders.ts.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const result = await runFavoriteReminders(now)
    return NextResponse.json({ success: true, ...result, timestamp: now.toISOString() })
  } catch (error: any) {
    console.error('Favorite reminders cron error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to process favorite reminders' },
      { status: 500 }
    )
  }
}
