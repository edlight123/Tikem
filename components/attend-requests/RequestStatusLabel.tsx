/**
 * Status of a request-to-attend, as a dot + uppercase label (house rule: no
 * status pills). Amber = pending, emerald = approved, grey = declined.
 */

export type RequestTone = 'pending' | 'approved' | 'declined'

const DOT: Record<RequestTone, string> = {
  pending: 'bg-warning',
  approved: 'bg-success',
  declined: 'bg-fg/40',
}

const TEXT: Record<RequestTone, string> = {
  pending: 'text-warning-soft',
  approved: 'text-success-soft',
  declined: 'text-fg-subtle',
}

export default function RequestStatusLabel({ tone, label, className = '' }: { tone: RequestTone; label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-eyebrow font-bold uppercase tracking-[0.12em] ${TEXT[tone]} ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  )
}

/** Map a stored request status onto the three visible tones. */
export function toneForStatus(status: string | null | undefined): RequestTone {
  if (status === 'approved') return 'approved'
  if (status === 'declined') return 'declined'
  return 'pending'
}

/** Every refusal `code` the approval-list routes return, localized; unknown codes fall back to generic. */
const KNOWN_ERROR_CODES = new Set([
  'auth_required',
  'approval_not_enabled',
  'approval_paid_event',
  'approval_required',
  'access_code_required',
  'too_many_plus_ones',
  'plus_one_name_required',
  'note_too_long',
  'already_claimed',
  'request_declined',
  'request_not_pending',
  'request_not_found',
  'not_event_owner',
  'no_tickets_available',
  'busy_try_again',
])

export function attendErrorKey(code: string | null | undefined): string {
  const c = String(code || '')
  return `attend_requests.errors.${KNOWN_ERROR_CODES.has(c) ? c : 'generic'}`
}
