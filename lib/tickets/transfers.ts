import { adminDb } from '@/lib/firebase/admin'

/**
 * Ticket transfer helpers.
 *
 * A transfer link lives 24 hours (`expires_at`). Nothing flips an unaccepted
 * transfer to 'expired' on a timer: only the recipient opening the link did.
 * So a `status: 'pending'` row past its expiry is NOT pending, and every reader
 * that asks "does this ticket have a transfer in flight?" must ask it here.
 */

export const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000

function toDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** True when the transfer's link has run out (no expiry recorded = never). */
export function isTransferExpired(transfer: { expires_at?: unknown } | null | undefined, now = new Date()): boolean {
  const exp = toDate(transfer?.expires_at)
  return Boolean(exp && exp.getTime() <= now.getTime())
}

export interface LivePendingTransfer {
  id: string
  ticket_id: string
  from_user_id: string
  to_email: string
  transfer_token: string
  expires_at: string | null
}

/**
 * The ticket's pending, unexpired transfer, or null. Stale rows (pending but
 * past expiry) are marked 'expired' on the way through, best-effort, so the
 * collection converges without a cron.
 */
export async function findLivePendingTransfer(ticketId: string, now = new Date()): Promise<LivePendingTransfer | null> {
  const snap = await adminDb
    .collection('ticket_transfers')
    .where('ticket_id', '==', ticketId)
    .where('status', '==', 'pending')
    .limit(10)
    .get()

  let live: LivePendingTransfer | null = null
  for (const doc of snap.docs) {
    const data = doc.data() || {}
    if (isTransferExpired(data, now)) {
      doc.ref
        .update({ status: 'expired', updated_at: now.toISOString() })
        .catch((e: any) => console.warn('[transfers] could not mark expired', { id: doc.id, message: e?.message }))
      continue
    }
    if (!live) {
      const exp = toDate(data.expires_at)
      live = {
        id: doc.id,
        ticket_id: String(data.ticket_id || ticketId),
        from_user_id: String(data.from_user_id || ''),
        to_email: String(data.to_email || ''),
        transfer_token: String(data.transfer_token || ''),
        expires_at: exp ? exp.toISOString() : null,
      }
    }
  }
  return live
}
