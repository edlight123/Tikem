/**
 * Admin moderation of user reports (App Store guideline 1.2).
 *
 * GET  /api/admin/reports?kind=event|organizer&targetId=…
 *      → { reports: [...] } the OPEN reports on one target.
 * POST /api/admin/reports  { kind, targetId, action, note? }
 *      action:
 *        'dismiss'        close the reports, no content action (clears the
 *                         event's hidden_pending_review and reports_count)
 *        'unpublish'      (event only) take the event down, close reports as actioned
 *        'ban_organizer'  ban the organizer (status banned, no posting, all their
 *                         published events unpublished), close reports as actioned
 */
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { listOpenReports, resolveReports, type ReportTargetKind } from '@/lib/moderation/reports'
import { unpublishOrganizerEvents } from '@/lib/moderation/ban'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseKind(v: unknown): ReportTargetKind | null {
  return v === 'event' || v === 'organizer' ? v : null
}

export async function GET(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError('Unauthorized', 401)
  const kind = parseKind(request.nextUrl.searchParams.get('kind'))
  const targetId = String(request.nextUrl.searchParams.get('targetId') || '').trim()
  if (!kind || !targetId) return adminError('kind and targetId are required', 400)
  try {
    return adminOk({ reports: await listOpenReports(kind, targetId) })
  } catch (err: any) {
    console.error('[admin/reports] list failed', err)
    return adminError('Failed to load reports', 500)
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError('Unauthorized', 401)

  let body: any
  try {
    body = await request.json()
  } catch {
    return adminError('Malformed request body', 400)
  }
  const kind = parseKind(body?.kind)
  const targetId = String(body?.targetId || '').trim()
  const action = String(body?.action || '')
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : null
  if (!kind || !targetId) return adminError('kind and targetId are required', 400)
  if (!['dismiss', 'unpublish', 'ban_organizer'].includes(action)) return adminError('Invalid action', 400)
  if (action === 'unpublish' && kind !== 'event') return adminError('Only events can be unpublished', 400)

  const adminEmail = user.email || 'unknown'
  const now = new Date()

  try {
    let organizerId = kind === 'organizer' ? targetId : ''
    let eventTitle = ''
    if (kind === 'event') {
      const snap = await adminDb.collection('events').doc(targetId).get()
      if (!snap.exists) return adminError('Event not found', 404)
      const data = snap.data() || {}
      organizerId = String(data.organizer_id || '')
      eventTitle = String(data.title || '')
    }

    if (action === 'dismiss') {
      const { resolved } = await resolveReports({ kind, targetId, resolution: 'dismissed', adminId: user.id, note, now })
      await logAdminAction({
        action: kind === 'event' ? 'event.reports_dismiss' : 'user.reports_dismiss',
        adminId: user.id,
        adminEmail,
        resourceId: targetId,
        resourceType: kind === 'event' ? 'event' : 'user',
        details: { eventTitle, resolved, note },
      })
      return adminOk({ resolved })
    }

    if (action === 'unpublish') {
      await adminDb.collection('events').doc(targetId).update({
        is_published: false,
        rejected: true,
        rejection_reason: note || 'Removed after user reports',
        updated_at: now,
      })
      const { resolved } = await resolveReports({ kind, targetId, resolution: 'actioned', adminId: user.id, note, now })
      await logAdminAction({
        action: 'event.unpublish',
        adminId: user.id,
        adminEmail,
        resourceId: targetId,
        resourceType: 'event',
        details: { eventTitle, reason: note, resolvedReports: resolved },
      })
      return adminOk({ resolved })
    }

    // ban_organizer
    if (!organizerId) return adminError('This event has no organizer', 409)
    const orgRef = adminDb.collection('users').doc(organizerId)
    const orgSnap = await orgRef.get()
    if (!orgSnap.exists) return adminError('Organizer not found', 404)
    // Same fields as /api/admin/organizer-actions 'ban': the publish route reads
    // status / can_create_events (lib/events/publishGuard) to refuse a republish.
    await orgRef.update({
      status: 'banned',
      can_create_events: false,
      banned_at: now,
      banned_by: user.id,
      updated_at: now,
    })
    const eventsUnpublished = await unpublishOrganizerEvents(organizerId, undefined, now)
    const { resolved } = await resolveReports({ kind, targetId, resolution: 'actioned', adminId: user.id, note, now })
    const orgData = orgSnap.data() || {}
    await logAdminAction({
      action: 'user.ban',
      adminId: user.id,
      adminEmail,
      resourceId: organizerId,
      resourceType: 'user',
      details: {
        userEmail: orgData.email || null,
        userName: orgData.full_name || null,
        viaReport: { kind, targetId },
        eventsUnpublished,
        note,
      },
    })
    return adminOk({ resolved, eventsUnpublished })
  } catch (err: any) {
    console.error('[admin/reports] resolve failed', err)
    return adminError('Failed to resolve reports', 500, err?.message)
  }
}
