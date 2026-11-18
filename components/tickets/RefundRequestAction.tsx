'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

/**
 * "Request a refund" — deliberately low-emphasis (owner rule 2026-10-10:
 * "Don't make refunds easy… they need a reason — then we investigate, but
 * never automatic").
 *
 * A quiet text link opens a sheet that requires a reason category AND a
 * written explanation, and says plainly that nothing is automatic. Submitting
 * only records a request; the organizer and Tikèm decide. Once a request is
 * open the link is replaced by its status (a dot + label, never a pill).
 *
 * Account holders post to /api/refunds/request; guests post to
 * /api/refunds/request/guest with their ticket-link token.
 */

const REASONS = ['cant_attend', 'event_changed', 'billing_issue', 'other'] as const
type Reason = (typeof REASONS)[number]

export const MIN_DETAILS = 20
const MAX_DETAILS = 1000

/** Refund states meaning "a request is open / being worked". */
const UNDER_REVIEW = new Set(['requested', 'pending', 'admin_review'])
const IN_PROGRESS = new Set(['processing', 'approved', 'manual_required'])

const KNOWN_ERROR_CODES = new Set([
  'reason_required',
  'details_too_short',
  'deadline_passed',
  'already_requested',
  'checked_in',
  'not_live',
  'event_past',
  'event_cancelled',
])

const SHEET_FIELD = 'rounded-lg bg-surface text-fg'
const PRIMARY_BTN =
  'rounded-lg bg-inverse font-bold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-50'

type Props = {
  ticketId: string
  /** The ticket's current refund_status ('' / undefined when none). */
  refundStatus?: string | null
  /** Live and not checked in. */
  eligible: boolean
  /** Event start (ISO); requests close 24 h before it. */
  eventStartIso?: string | null
  /** Present for a guest ticket link; switches to the guest endpoint. */
  guestToken?: string
}

function requestWindowOpen(eventStartIso?: string | null): boolean {
  if (!eventStartIso) return false
  const start = new Date(eventStartIso).getTime()
  if (Number.isNaN(start)) return false
  return Date.now() < start - 24 * 3_600_000
}

export default function RefundRequestAction({ ticketId, refundStatus, eligible, eventStartIso, guestToken }: Props) {
  const { t } = useTranslation('tickets')
  const router = useRouter()
  const [status, setStatus] = useState(String(refundStatus || '').toLowerCase().trim())
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<Reason | null>(null)
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSent, setJustSent] = useState(false)
  const firstRadioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setStatus(String(refundStatus || '').toLowerCase().trim())
  }, [refundStatus])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    firstRadioRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, submitting])

  if (UNDER_REVIEW.has(status) || IN_PROGRESS.has(status) || status === 'denied') {
    const label = UNDER_REVIEW.has(status)
      ? t('refund_request.status_requested')
      : IN_PROGRESS.has(status)
        ? t('refund_request.status_in_progress')
        : t('refund_request.status_denied')
    const dot = status === 'denied' ? 'bg-fg/40' : 'bg-warning'
    return (
      <div className="w-full pt-1 text-center" role="status">
        <p className="inline-flex items-center gap-2 text-sm text-fg-soft">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
          {label}
        </p>
        {UNDER_REVIEW.has(status) && (
          <p className="mt-1 text-xs text-fg-subtle">
            {justSent ? t('refund_request.sent') : t('refund_request.status_requested_detail')}
          </p>
        )}
      </div>
    )
  }

  // Already refunded / cancelled tickets and anything past the deadline show
  // nothing: there is no request to make.
  if (status || !eligible || !requestWindowOpen(eventStartIso)) return null

  const trimmed = details.trim()
  const canSubmit = Boolean(reason) && trimmed.length >= MIN_DETAILS && !submitting

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!reason) {
      setError(t('refund_request.errors.reason_required'))
      return
    }
    if (trimmed.length < MIN_DETAILS) {
      setError(t('refund_request.errors.details_too_short', { min: MIN_DETAILS }))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(guestToken ? '/api/refunds/request/guest' : '/api/refunds/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          reasonCategory: reason,
          details: trimmed,
          ...(guestToken ? { token: guestToken } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = String(data?.code || '')
        if (code === 'already_requested') {
          // Someone (another tab, the app) already asked: show it as open.
          setStatus('requested')
          setOpen(false)
          return
        }
        setError(
          res.status === 429
            ? t('refund_request.errors.too_many')
            : KNOWN_ERROR_CODES.has(code)
              ? t(`refund_request.errors.${code}`, { min: MIN_DETAILS })
              : t('refund_request.errors.generic')
        )
        return
      }
      setStatus('requested')
      setJustSent(true)
      setOpen(false)
      router.refresh()
    } catch {
      setError(t('refund_request.errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full text-center">
      {/* A text link, not a button: the request exists, it is not promoted. */}
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className="pt-1 text-sm text-fg-subtle underline underline-offset-4 decoration-fg-faint transition-colors hover:text-fg-soft"
      >
        {t('refund_request.action')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 sm:items-center sm:p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-request-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl bg-surface-raised-solid p-6 text-left sm:rounded-2xl"
          >
            <h2
              id="refund-request-title"
              className="font-display italic lowercase !text-2xl !leading-[1.04] text-fg mb-5"
            >
              {t('refund_request.title')}
            </h2>

            <form onSubmit={submit} className="space-y-5">
              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-fg-muted">
                  {t('refund_request.reason_label')}
                </legend>
                <div className="space-y-2">
                  {REASONS.map((key, i) => (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-body transition-colors ${
                        reason === key ? 'bg-surface-high text-fg' : 'bg-surface text-fg-soft hover:bg-surface-raised'
                      }`}
                    >
                      <input
                        ref={i === 0 ? firstRadioRef : undefined}
                        type="radio"
                        name="refund-reason"
                        value={key}
                        checked={reason === key}
                        onChange={() => setReason(key)}
                        className="h-4 w-4 accent-white"
                        required
                      />
                      {t(`refund_request.reasons.${key}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="refund-details" className="mb-2 block text-sm font-medium text-fg-muted">
                  {t('refund_request.details_label')}
                </label>
                <textarea
                  id="refund-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={t('refund_request.details_placeholder')}
                  rows={4}
                  maxLength={MAX_DETAILS}
                  minLength={MIN_DETAILS}
                  required
                  className={`${SHEET_FIELD} w-full px-4 py-2.5 text-base placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500`}
                />
                <p className={`mt-1 text-xs ${trimmed.length >= MIN_DETAILS ? 'text-fg-subtle' : 'text-fg-muted'}`}>
                  {t('refund_request.details_hint', { min: MIN_DETAILS, count: Math.min(trimmed.length, MIN_DETAILS) })}
                </p>
              </div>

              <p className="rounded-lg bg-surface-low p-3 text-sm leading-relaxed text-fg-muted">
                {t('refund_request.note')}
              </p>

              {error && (
                <div className="rounded-lg bg-danger-strong/10 p-3 text-sm text-danger-soft" role="alert">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-surface px-4 py-2.5 font-medium text-fg-muted transition-colors hover:bg-surface-high hover:text-fg disabled:opacity-50"
                >
                  {t('refund_request.cancel')}
                </button>
                <button type="submit" disabled={!canSubmit} className={`${PRIMARY_BTN} flex-1 px-4 py-2.5`}>
                  {submitting ? t('refund_request.submitting') : t('refund_request.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
