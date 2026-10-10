/**
 * Tell admins a report needs review — the "act within 24 hours" half of App
 * Store guideline 1.2. Same three channels as the withdrawal escalation
 * (lib/notifications/withdrawal-outcome.ts): in-app bell + push to every
 * users/{uid} with role admin|super_admin, and email to ADMIN_EMAILS.
 *
 * Not every report pages admins: only the FIRST open report on a target (it has
 * just entered the queue) and the one that auto-hid an event. Later reports on
 * a target already in the queue just raise its count in the Reported tab.
 * Best-effort throughout; never throws, so a notification fault cannot fail the
 * report that was already stored.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { getAdminEmails } from '@/lib/admin'
import { sendEmail } from '@/lib/email'
import { renderEmail, title as titleBlock, p as para, gap, button, rowsBlock, quote, appUrl } from '@/lib/email-kit/layout'
import { AUTO_HIDE_THRESHOLD, type ReportReason, type ReportTargetKind } from './reports'

export function shouldNotifyAdmins(openCount: number, autoHidden: boolean): boolean {
  return openCount === 1 || autoHidden
}

export function reportAdminUrl(kind: ReportTargetKind, targetId: string): string {
  return kind === 'event' ? `/admin/events?tab=reported&event=${encodeURIComponent(targetId)}` : `/admin/people/organizers/${encodeURIComponent(targetId)}`
}

export function reportAdminCopy(p: {
  kind: ReportTargetKind
  targetTitle: string
  reason: ReportReason
  openCount: number
  autoHidden: boolean
}): { title: string; message: string } {
  const what = p.kind === 'event' ? `Event "${p.targetTitle}"` : `Organizer ${p.targetTitle}`
  if (p.autoHidden) {
    return {
      title: 'Reported event hidden from discovery',
      message: `${what} reached ${AUTO_HIDE_THRESHOLD} reports and was hidden from Explore pending review. Review it within 24 hours.`,
    }
  }
  return {
    title: p.kind === 'event' ? 'Event reported' : 'Organizer reported',
    message: `${what} was reported (${p.reason.replace(/_/g, ' ')}). Review it within 24 hours.`,
  }
}

export async function notifyAdminsOfReport(p: {
  kind: ReportTargetKind
  targetId: string
  targetTitle: string
  reason: ReportReason
  details: string
  openCount: number
  autoHidden: boolean
}): Promise<void> {
  if (!shouldNotifyAdmins(p.openCount, p.autoHidden)) return
  try {
    const { title, message } = reportAdminCopy(p)
    const actionUrl = reportAdminUrl(p.kind, p.targetId)
    const meta = { kind: p.kind, targetId: p.targetId, reason: p.reason }

    const snaps = await Promise.all(
      ['admin', 'super_admin'].map((role) => adminDb.collection('users').where('role', '==', role).get())
    )
    const adminIds = Array.from(new Set(snaps.flatMap((s: any) => s.docs.map((d: any) => String(d.id)))))

    await Promise.all(
      adminIds.map(async (adminId) => {
        try {
          await createNotification(adminId, 'content_reported', title, message, actionUrl, meta)
        } catch (err) {
          console.error('[moderation] admin in-app failed', { adminId, err })
        }
        try {
          await sendPushNotification(adminId, title, message, actionUrl, { type: 'content_reported', ...meta })
        } catch (err) {
          console.error('[moderation] admin push failed', { adminId, err })
        }
      })
    )

    const html = renderEmail({
      lang: 'en',
      title,
      preheader: message,
      status: { label: p.autoHidden ? 'Auto-hidden' : 'Needs review', tone: p.autoHidden ? 'red' : 'amber' },
      footer: 'account',
      blocks: [
        titleBlock(title, 34),
        gap(14),
        para(message),
        gap(4),
        rowsBlock([
          { label: 'Reason', value: p.reason.replace(/_/g, ' ') },
          { label: 'Open reports', value: String(p.openCount) },
        ]),
        p.details ? gap(12) : '',
        p.details ? quote('Details', p.details) : '',
        gap(24),
        button('Open in the admin console', `${appUrl()}${actionUrl}`),
      ],
    })
    await Promise.all(
      getAdminEmails().map((to) =>
        sendEmail({ to, subject: `[Tikèm] ${title}: ${p.targetTitle}`, html }).catch((err) => {
          console.error('[moderation] admin email failed', { to, message: err?.message })
        })
      )
    )
  } catch (err) {
    console.error('[moderation] admin report notify failed', { kind: p.kind, targetId: p.targetId, err })
  }
}
