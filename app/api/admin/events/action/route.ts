import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { resolveReports } from '@/lib/moderation/reports'

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()

    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const { eventId, action, reason } = await request.json()

    const adminId = user.id
    const effectiveAdminEmail = user.email || 'unknown'

    const eventRef = adminDb.collection('events').doc(eventId)
    const deletedRef = adminDb.collection('events_deleted').doc(eventId)

    const eventDoc = await eventRef.get()

    // Special-case restore: bring back from events_deleted
    if (action === 'restore') {
      const deletedDoc = await deletedRef.get()
      if (!deletedDoc.exists) {
        return adminError('Deleted event backup not found', 404)
      }

      const deletedData = deletedDoc.data() || {}
      const { deletedAt, deletedBy, deletedReason, ...eventData } = deletedData

      await eventRef.set(
        {
          ...eventData,
          restored_at: new Date(),
          restored_by: effectiveAdminEmail,
          updated_at: new Date(),
        },
        { merge: true }
      )
      await deletedRef.delete()

      await logAdminAction({
        action: 'event.restore',
        adminId,
        adminEmail: effectiveAdminEmail,
        resourceId: eventId,
        resourceType: 'event',
        details: { eventTitle: (eventData as any)?.title || deletedData?.title || 'Untitled' },
      })

      return adminOk({ success: true })
    }

    if (!eventDoc.exists) {
      return adminError('Event not found', 404)
    }

    const eventData = eventDoc.data()!

    // Perform action
    switch (action) {
      case 'publish':
        await eventRef.update({
          is_published: true,
          rejected: false,
          updated_at: new Date()
        })
        await logAdminAction({
          action: 'event.publish',
          adminId,
          adminEmail: effectiveAdminEmail,
          resourceId: eventId,
          resourceType: 'event',
          details: { eventTitle: eventData.title }
        })
        break

      case 'unpublish':
        await eventRef.update({
          is_published: false,
          rejected: true,
          rejection_reason: reason,
          updated_at: new Date()
        })
        await logAdminAction({
          action: 'event.unpublish',
          adminId,
          adminEmail: effectiveAdminEmail,
          resourceId: eventId,
          resourceType: 'event',
          details: { eventTitle: eventData.title, reason }
        })
        break

      case 'delete':
        // Backup before deletion to allow recovery from accidents.
        await deletedRef.set(
          {
            ...eventData,
            id: eventId,
            deletedAt: new Date().toISOString(),
            deletedBy: effectiveAdminEmail,
            deletedReason: typeof reason === 'string' ? reason : null,
          },
          { merge: true }
        )
        await eventRef.delete()
        await logAdminAction({
          action: 'event.delete',
          adminId,
          adminEmail: effectiveAdminEmail,
          resourceId: eventId,
          resourceType: 'event',
          details: { eventTitle: eventData.title, reason }
        })
        break

      case 'feature':
        await eventRef.update({
          featured: true,
          updated_at: new Date()
        })
        await logAdminAction({
          action: 'event.feature',
          adminId,
          adminEmail: effectiveAdminEmail,
          resourceId: eventId,
          resourceType: 'event',
          details: { eventTitle: eventData.title }
        })
        break

      case 'unfeature':
        await eventRef.update({
          featured: false,
          updated_at: new Date()
        })
        await logAdminAction({
          action: 'event.unfeature',
          adminId,
          adminEmail: effectiveAdminEmail,
          resourceId: eventId,
          resourceType: 'event',
          details: { eventTitle: eventData.title }
        })
        break
    }

    // Taking a reported event down IS acting on its reports: close them so the
    // event leaves the Reported tab instead of sitting there already handled.
    if ((action === 'unpublish' || action === 'delete') && (Number(eventData.reports_count) || 0) > 0) {
      try {
        await resolveReports({
          kind: 'event',
          targetId: eventId,
          resolution: 'actioned',
          adminId,
          note: typeof reason === 'string' ? reason : null,
        })
      } catch (resolveError) {
        console.error('Failed to close reports after action:', resolveError)
      }
    }

    return adminOk({ success: true })
  } catch (error) {
    console.error('Error performing action:', error)
    return adminError('Internal server error', 500)
  }
}
