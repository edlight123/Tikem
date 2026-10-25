import { isLiveTicketStatus } from '@/lib/tickets/status'

/**
 * How an organizer list shows one ticket's state (dot + label). Client-safe.
 *
 * Vocabulary (lib/tickets/status.ts, lib/tickets/refundExecution.ts):
 * live = valid | confirmed | active (or a legacy empty status); a refund writes
 * `refund_pending` then `refunded`; `cancelled` is a voided ticket; a legacy
 * door write may have set `checked_in`. Anything else (e.g. `pending` payment)
 * is shown as not valid.
 */
export type TicketDisplayKey = 'checked_in' | 'valid' | 'refund_pending' | 'refunded' | 'cancelled' | 'not_valid'

export function ticketDisplayKey(status: unknown, checkedIn: boolean): TicketDisplayKey {
  const s = String(status ?? '').toLowerCase().trim()
  if (s === 'refunded') return 'refunded'
  if (s === 'refund_pending') return 'refund_pending'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s === 'checked_in') return 'checked_in'
  if (isLiveTicketStatus(s)) return checkedIn ? 'checked_in' : 'valid'
  return 'not_valid'
}

export function ticketDisplayTone(key: TicketDisplayKey): 'success' | 'warning' | 'danger' | 'neutral' | 'brand' {
  switch (key) {
    case 'checked_in':
      return 'success'
    case 'valid':
      return 'brand'
    case 'refund_pending':
      return 'warning'
    case 'refunded':
    case 'cancelled':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Refund / resend only make sense for a ticket that still admits someone. */
export function ticketIsActionable(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase().trim()
  return isLiveTicketStatus(s) || s === 'checked_in'
}

/** i18n key (organizer namespace) for the label. */
export function ticketDisplayLabelKey(key: TicketDisplayKey): string {
  return `event_tools.status_${key}`
}
