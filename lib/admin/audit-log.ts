import { adminDb } from '@/lib/firebase/admin'

export type AuditAction = 
  | 'event.publish'
  | 'event.unpublish'
  | 'event.cancel'
  | 'event.delete'
  | 'event.restore'
  | 'event.feature'
  | 'event.unfeature'
  | 'event.export_financials'
  | 'admin.backfill'
  | 'admin.search_index.rebuild'
  | 'user.verify'
  | 'user.unverify'
  | 'user.ban'
  | 'user.unban'
  | 'user.disable_posting'
  | 'user.enable_posting'
  | 'event.reports_dismiss'
  | 'user.reports_dismiss'
  | 'ticket.refund'
  | 'verification.approve'
  | 'verification.reject'
  | 'verification.needs_info'
  | 'bank_verification.approve'
  | 'bank_verification.reject'
  | 'bank_verification.needs_info'
  | 'payout.release_config.update'
  | 'payout.release_override.update'
  | 'payout.manual_schedule.backfill'
  | 'payout.release.manual'
  | 'payout.release.hold'
  | 'payout.approve'
  | 'payout.decline'
  | 'payout.mark_paid'
  | 'payout.prefunding.update'
  | 'payout.receipt.upload'
  | 'payout.receipt.delete'
  | 'moncash.prefunded.transfer'
  | 'suspicious_activity.review'
  | 'withdrawal.approve'
  | 'withdrawal.reject'
  | 'withdrawal.complete'
  | 'withdrawal.fail'

function toIsoTimestamp(value: unknown): string {
  if (!value) return ''

  // Firestore Timestamp (admin SDK)
  const maybeTimestamp = value as any
  if (maybeTimestamp?.toDate && typeof maybeTimestamp.toDate === 'function') {
    try {
      return maybeTimestamp.toDate().toISOString()
    } catch {
      return ''
    }
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  }

  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toISOString() : ''
  }

  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toISOString() : ''
  }

  return ''
}

interface LogAuditParams {
  action: AuditAction
  adminId: string
  adminEmail: string
  resourceId?: string
  resourceType?: string
  details?: Record<string, any>
}

/**
 * Log an admin action to the audit trail
 */
export async function logAdminAction({
  action,
  adminId,
  adminEmail,
  resourceId,
  resourceType,
  details = {}
}: LogAuditParams): Promise<void> {
  try {
    const nowIso = new Date().toISOString()
    await adminDb.collection('admin_audit_log').add({
      action,
      adminId,
      adminEmail,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
      details,
      timestamp: nowIso,
      timestampMs: Date.now(),
      createdAt: nowIso
    })
  } catch (error) {
    console.error('Error logging admin action:', error)
    // Don't throw - audit logging shouldn't break the main action
  }
}

/**
 * Map an audit action code to an activity category used by the feed UI.
 */
function getActivityType(
  action: string
): 'verification' | 'payment' | 'event' | 'security' | 'user_action' | 'system' {
  if (action.startsWith('event.')) return 'event'
  if (action.startsWith('user.')) return 'user_action'
  if (action.startsWith('verification.') || action.startsWith('bank_verification.')) return 'verification'
  if (
    action.startsWith('payout.') ||
    action.startsWith('withdrawal.') ||
    action.startsWith('moncash.') ||
    action === 'ticket.refund'
  )
    return 'payment'
  if (action.startsWith('suspicious_activity.')) return 'security'
  return 'system'
}

/**
 * Build a deep-link for an activity so admins can jump to the relevant page.
 */
function getActivityLink(
  action: string,
  resourceId?: string | null
): string | undefined {
  if (action.startsWith('verification.')) return '/admin/trust'
  if (action.startsWith('bank_verification.')) return '/admin/trust/bank'
  if (action.startsWith('payout.')) return '/admin/money/disbursements'
  if (action.startsWith('withdrawal.')) return '/admin/money/withdrawals'
  if (action.startsWith('suspicious_activity.')) return '/admin/trust/security'
  if (action.startsWith('user.')) return resourceId ? `/admin/people/${resourceId}` : '/admin/people'
  if (action.startsWith('event.')) return resourceId ? `/events/${resourceId}` : '/admin/events'
  return undefined
}

/**
 * Derive a friendly display name for the admin who performed the action.
 */
function getActorName(adminEmail?: string, adminName?: string): string {
  if (adminName && adminName.trim()) return adminName.trim()
  if (adminEmail && adminEmail.trim()) {
    // Show the local-part of the email for a cleaner, shorter label.
    return adminEmail.split('@')[0]
  }
  return 'System'
}

/**
 * Get recent admin activities
 */
export async function getRecentAdminActivities(limit: number = 10) {
  try {
    const snapshot = await adminDb
      .collection('admin_audit_log')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get()

    return snapshot.docs.map((doc: any) => {
      const data = doc.data()
      const ts =
        toIsoTimestamp(data.timestamp) ||
        toIsoTimestamp(data.createdAt) ||
        toIsoTimestamp(data.timestampMs) ||
        ''
      const action = String(data.action || '')
      const details = data.details || {}
      const actorName = getActorName(data.adminEmail, data.adminName)
      const title = getActionDescription(action, details)

      const metadata =
        details && (details.amount != null || details.currency)
          ? { amount: details.amount, currency: details.currency }
          : undefined

      return {
        id: doc.id,
        // Rich fields consumed by AdminActivityFeed
        type: getActivityType(action),
        title,
        description: `by ${actorName}`,
        actor: {
          name: actorName,
          email: data.adminEmail || undefined,
          role: 'admin' as const,
        },
        timestamp: ts,
        link: getActivityLink(action, data.resourceId),
        metadata,
        // Legacy fields kept for backward compatibility with other consumers
        action: title,
        user: actorName,
        icon: getActionIcon(action),
      }
    })
  } catch (error) {
    console.error('Error fetching admin activities:', error)
    return []
  }
}

/**
 * Convert action code to human-readable description
 */
function getActionDescription(action: string, details: any = {}): string {
  // Resolve a human target (user/organizer) without ever printing "Unknown".
  const userTarget = details.userName || details.userEmail || ''
  const orgTarget = details.organizerName || details.organizerEmail || ''
  const forUser = userTarget ? ` ${userTarget}` : ''
  const forUserPhrase = userTarget ? ` for ${userTarget}` : ''
  const forOrgPhrase = orgTarget ? ` for ${orgTarget}` : ''

  const descriptions: Record<string, string> = {
    'event.publish': `Published event "${details.eventTitle || 'Untitled'}"`,
    'event.cancel': `Cancelled event "${details.eventTitle || 'Untitled'}" and refunded ${details.ticketsAffected ?? 0} ticket(s)`,
    'event.unpublish': `Unpublished event "${details.eventTitle || 'Untitled'}"`,
    'event.delete': `Deleted event "${details.eventTitle || 'Untitled'}"`,
    'event.restore': `Restored event "${details.eventTitle || 'Untitled'}"`,
    'admin.backfill': `Backfilled ${details?.name || 'data'} (${details?.updated ?? 0} updated)`,
    'admin.search_index.rebuild': `Rebuilt admin search index (${details?.type || 'all'})`,
    'user.verify': `Verified user${forUser}`.trim(),
    'user.unverify': `Unverified user${forUser}`.trim(),
    'user.ban': `Banned user${forUser}`.trim(),
    'user.unban': `Unbanned user${forUser}`.trim(),
    'user.disable_posting': userTarget ? `Disabled posting for ${userTarget}` : 'Disabled posting',
    'user.enable_posting': userTarget ? `Enabled posting for ${userTarget}` : 'Enabled posting',
    'event.reports_dismiss': `Dismissed ${details.resolved ?? 0} report(s) on "${details.eventTitle || 'Untitled'}"`,
    'user.reports_dismiss': `Dismissed ${details.resolved ?? 0} report(s)${forUserPhrase}`.trim(),
    'ticket.refund': `Refunded ticket #${details.ticketId || ''}`.trim(),
    'verification.approve': `Approved verification${forUserPhrase}`.trim(),
    'verification.reject': `Rejected verification${forUserPhrase}`.trim(),
    'verification.needs_info': userTarget ? `Requested more info for ${userTarget}` : 'Requested verification info',
    'bank_verification.approve': `Approved bank verification${forOrgPhrase}`.trim(),
    'bank_verification.reject': `Rejected bank verification${forOrgPhrase}`.trim(),
    'bank_verification.needs_info': orgTarget ? `Requested more info for ${orgTarget}` : 'Requested bank info',
    'payout.release_config.update': `Updated payout release thresholds (${(details.changed || []).join(', ') || 'no change'})`,
    'payout.release_override.update': 'Updated payout release overrides for an organizer',
    'payout.manual_schedule.backfill': `Set ${details.updated ?? 0} connected account(s) to manual payouts`,
    'payout.release.manual': 'Released a held payout early',
    'payout.release.hold': 'Held a payout for review',
    'payout.approve': `Approved payout ${details.payoutId || ''}`.trim(),
    'payout.decline': `Declined payout ${details.payoutId || ''}`.trim(),
    'payout.mark_paid': `Marked payout paid ${details.payoutId || ''}`.trim(),
    'payout.prefunding.update': `Updated payout prefunding settings`,
    'payout.receipt.upload': `Uploaded payout receipt ${details.payoutId || ''}`.trim(),
    'payout.receipt.delete': `Deleted payout receipt ${details.payoutId || ''}`.trim(),
    'moncash.prefunded.transfer': `MonCash prefunded transfer ${details.amount || ''}`.trim(),
    'suspicious_activity.review': `Reviewed suspicious activity ${details.activityId || ''}`.trim(),
    'withdrawal.approve': `Approved withdrawal ${details.withdrawalId || ''}`.trim(),
    'withdrawal.reject': `Rejected withdrawal ${details.withdrawalId || ''}`.trim(),
    'withdrawal.complete': `Completed withdrawal ${details.withdrawalId || ''}`.trim(),
    'withdrawal.fail': `Failed withdrawal ${details.withdrawalId || ''}`.trim(),
  }

  return descriptions[action] || action
}

/**
 * Get icon emoji for action type
 */
function getActionIcon(action: string): string {
  const icons: Record<string, string> = {
    'event.publish': '✅',
    'event.unpublish': '⏸️',
    'event.delete': '🗑️',
    'event.restore': '♻️',
    'admin.backfill': '🧹',
    'admin.search_index.rebuild': '🧭',
    'user.verify': '✓',
    'user.unverify': '⛔',
    'user.ban': '🚫',
    'user.unban': '✓',
    'user.disable_posting': '⛔',
    'user.enable_posting': '✓',
    'ticket.refund': '💰',
    'verification.approve': '✅',
    'verification.reject': '❌',
    'verification.needs_info': '📝',
    'bank_verification.approve': '✅',
    'bank_verification.reject': '❌',
    'bank_verification.needs_info': '📝',
    'payout.approve': '✅',
    'payout.decline': '❌',
    'payout.mark_paid': '💸',
    'payout.prefunding.update': '⚙️',
    'payout.receipt.upload': '📎',
    'payout.receipt.delete': '🗑️',
    'moncash.prefunded.transfer': '💸',
    'suspicious_activity.review': '🛡️',
    'withdrawal.approve': '✅',
    'withdrawal.reject': '❌',
    'withdrawal.complete': '💸',
    'withdrawal.fail': '⚠️',
  }

  return icons[action] || '📝'
}
