import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent } from '@/lib/organizer/context'
import {
  DEFAULT_EVENT_REMINDERS,
  MAX_MINUTES_BEFORE,
  MAX_REMINDERS,
  MIN_MINUTES_BEFORE,
  REMINDER_MESSAGE_MAX,
  resolveEventReminders,
  validateReminders,
} from '@/lib/notifications/event-reminder-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PUT /api/organizer/events/:id/reminders: the event's automatic
 * reminders (events/{id}.reminders; absent = the stock three, see
 * lib/notifications/event-reminder-settings). The organizer side only (owner /
 * org admin / org manager), the same gate as messaging the event's attendees.
 * PUT replaces the whole list: { reminders: [{ id, minutes_before, enabled,
 * message? }] }, or { reset: true } to go back to the stock three.
 */
async function load(params: Promise<{ id: string }>) {
  const { user, error } = await requireAuth()
  if (error || !user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const eventId = String((await params)?.id || '').trim()
  if (!eventId || eventId.length > 200 || eventId.includes('/')) {
    return { res: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }
  const ref = adminDb.collection('events').doc(eventId)
  const snap = await ref.get()
  if (!snap.exists) return { res: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const event = snap.data() as Record<string, any>
  if (!(await canOnEvent(user, event, 'manage_events')).allowed) {
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ref, event, user }
}

const limits = {
  maxReminders: MAX_REMINDERS,
  messageMax: REMINDER_MESSAGE_MAX,
  minMinutesBefore: MIN_MINUTES_BEFORE,
  maxMinutesBefore: MAX_MINUTES_BEFORE,
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await load(params)
    if ('res' in r) return r.res
    return NextResponse.json({
      reminders: resolveEventReminders(r.event),
      custom: Array.isArray(r.event.reminders),
      limits,
    })
  } catch (error) {
    console.error('[organizer/reminders] GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await load(params)
    if ('res' in r) return r.res
    const body = await req.json().catch(() => null)
    if (body?.reset === true) {
      await r.ref.update({
        reminders: FieldValue.delete(),
        reminders_updated_at: new Date().toISOString(),
        reminders_updated_by: r.user.id,
      })
      return NextResponse.json({ reminders: DEFAULT_EVENT_REMINDERS.map((x) => ({ ...x })), custom: false, limits })
    }
    const v = validateReminders(body?.reminders)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    await r.ref.update({
      reminders: v.reminders,
      reminders_updated_at: new Date().toISOString(),
      reminders_updated_by: r.user.id,
    })
    return NextResponse.json({ reminders: v.reminders, custom: true, limits })
  } catch (error) {
    console.error('[organizer/reminders] PUT failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
