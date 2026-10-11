import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'
import {
  freezeOrganizerPayouts,
  unfreezeOrganizerPayouts,
  unpublishOrganizerEvents,
} from '@/lib/moderation/ban'

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return adminError(error || 'Not authenticated', error ? 403 : 401)
    }

    const { organizerId, action } = await request.json()

    if (!organizerId || !action) {
      return adminError('Organizer ID and action are required', 400)
    }

    // Validate action
    // freeze_payouts / unfreeze_payouts: the explicit admin decision on a
    // payout freeze. A ban freezes payouts; an unban does NOT lift that freeze
    // (owner decision: frozen until an admin decides about the money).
    const validActions = ['ban', 'unban', 'disable_posting', 'enable_posting', 'freeze_payouts', 'unfreeze_payouts']
    if (!validActions.includes(action)) {
      return adminError('Invalid action', 400)
    }

    // Get organizer data
    const organizerDocRef = adminDb.collection('users').doc(organizerId)
    const organizerDoc = await organizerDocRef.get()

    if (!organizerDoc.exists) {
      return adminError('Organizer not found', 404)
    }

    const organizerData = organizerDoc.data()

    // Perform action
    const updates: any = {
      updated_at: new Date()
    }

    let successMessage = ''

    switch (action) {
      case 'ban':
        // users.status / can_create_events are what the publish route reads
        // (lib/events/publishGuard isOrganizerBanned) to refuse a republish.
        updates.status = 'banned'
        updates.can_create_events = false
        updates.banned_at = new Date()
        updates.banned_by = user.id
        successMessage = 'Organizer has been banned successfully'
        break
      
      case 'unban':
        updates.status = 'active'
        updates.can_create_events = true
        updates.banned_at = null
        updates.banned_by = null
        successMessage =
          'Organizer has been unbanned. Their payouts stay frozen until you lift the freeze (Unfreeze payouts).'
        break

      case 'freeze_payouts':
        successMessage = 'Payouts are frozen for this organizer'
        break

      case 'unfreeze_payouts':
        successMessage = 'Payouts are unfrozen for this organizer'
        break
      
      case 'disable_posting':
        updates.can_create_events = false
        successMessage = 'Event posting has been disabled for this organizer'
        break
      
      case 'enable_posting':
        updates.can_create_events = true
        successMessage = 'Event posting has been enabled for this organizer'
        break
    }

    // Update the user document
    await organizerDocRef.update(updates)

    // A ban freezes ALL payouts, including money already earned and released
    // (owner decision). Done right after the status flip: every withdraw path
    // also refuses on users.status === 'banned', so there is no window where
    // the ban is visible but money can still leave.
    if (action === 'ban' || action === 'freeze_payouts') {
      await freezeOrganizerPayouts(organizerId, {
        adminId: user.id,
        reason: action === 'ban' ? 'organizer_banned' : 'admin_freeze',
      })
      updates.payouts_frozen = true
    }
    if (action === 'unfreeze_payouts') {
      await unfreezeOrganizerPayouts(organizerId, { adminId: user.id })
      updates.payouts_frozen = false
    }

    // A ban takes the organizer's live events down too — the confirm dialog
    // promises "their events will be hidden", which the status flag alone
    // never did (see lib/moderation/ban.ts).
    if (action === 'ban') {
      updates.events_unpublished = await unpublishOrganizerEvents(organizerId)
    }

    // Log the action
    await adminDb.collection('admin_actions').add({
      admin_id: user.id,
      admin_email: user.email,
      action: action,
      target_user_id: organizerId,
      target_user_email: organizerData?.email,
      timestamp: new Date(),
      details: updates
    })

    const auditAction = (() => {
      if (action === 'ban') return 'user.ban'
      if (action === 'unban') return 'user.unban'
      if (action === 'disable_posting') return 'user.disable_posting'
      if (action === 'freeze_payouts' || action === 'unfreeze_payouts') return 'payout.release_override.update'
      return 'user.enable_posting'
    })()

    await logAdminAction({
      action: auditAction as any,
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceId: organizerId,
      resourceType: 'user',
      details: {
        userEmail: organizerData?.email || null,
        userName: organizerData?.full_name || organizerData?.name || null,
        updates,
      },
    })

    return adminOk({
      message: successMessage
    })

  } catch (error: any) {
    console.error('Error performing organizer action:', error)
    return adminError('Failed to perform action', 500, error?.message || 'Unknown error')
  }
}
