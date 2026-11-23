/**
 * Retired. The day-before email goes out from /api/cron/event-reminders, which
 * takes a send-once claim per reminder, sends only to live tickets, sees events
 * whose start is a Timestamp as well as an ISO string, and honours the
 * organizer's own reminder settings (a removed day-before reminder sends no
 * email). This route ran every hour over a two-hour window with no claim, so
 * an attendee could get the same email from it twice, on top of the cron's.
 * It stays as a harmless no-op so a leftover scheduler call sends nothing.
 */
export async function GET(request: Request) {
  // Fails CLOSED when CRON_SECRET is unset.
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json({ success: true, retired: true, emailsSent: 0 })
}
