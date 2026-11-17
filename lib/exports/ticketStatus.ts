import { ticketDisplayKey, type TicketDisplayKey } from '@/lib/organizer/ticketStatusDisplay'
import type { ExportLang } from './labels'
import type { StatusValue, StatusTone } from './types'

/**
 * A ticket's state for an export cell (dot + label), using the same display
 * vocabulary as the organizer list (lib/organizer/ticketStatusDisplay) and
 * the same words as public/locales/<lang>/organizer.json event_tools.status_*.
 */
const LABELS: Record<ExportLang, Record<TicketDisplayKey, string>> = {
  en: { valid: 'Valid', checked_in: 'Checked in', refund_pending: 'Refund pending', refunded: 'Refunded', cancelled: 'Cancelled', not_valid: 'Not valid' },
  fr: { valid: 'Valide', checked_in: 'Entré', refund_pending: 'Remboursement en cours', refunded: 'Remboursé', cancelled: 'Annulé', not_valid: 'Non valide' },
  ht: { valid: 'Valab', checked_in: 'Antre', refund_pending: 'Ranbousman ap fèt', refunded: 'Ranbouse', cancelled: 'Anile', not_valid: 'Pa valab' },
}

const TONE: Record<TicketDisplayKey, StatusTone> = {
  valid: 'positive',
  checked_in: 'positive',
  refund_pending: 'warning',
  refunded: 'negative',
  cancelled: 'negative',
  not_valid: 'neutral',
}

export function ticketStatusCell(status: unknown, checkedIn: boolean, lang: ExportLang): StatusValue {
  const key = ticketDisplayKey(status, checkedIn)
  return { label: LABELS[lang][key], tone: TONE[key] }
}
