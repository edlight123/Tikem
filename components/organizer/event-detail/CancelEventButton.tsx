'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Drawer } from '@/components/organizer/ui/Drawer'
import { useToast } from '@/components/ui/Toast'

type Outcome = {
  refundsSucceeded?: number
  refundsQueuedManual?: number
  refundsSentToReview?: number
  freeTicketsVoided?: number
  notified?: number
}

/**
 * "Cancel event" with a confirmation. Calls the existing server flow
 * (POST /api/events/[id]/cancel → lib/events/cancel.ts cancelEventWithRefunds):
 * every live ticket is refunded or voided, every holder is emailed and pushed,
 * and the event's payouts are frozen. Same route and same rules as the app's
 * Cancel event (OrganizerEventManagementScreen); the web also takes an optional
 * reason, which ticket holders see in their email.
 */
export function CancelEventButton({
  eventId,
  eventTitle,
  status,
  compact = false,
}: {
  eventId: string
  eventTitle: string
  status?: string
  compact?: boolean
}) {
  const { t } = useTranslation('events')
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (String(status || '').toLowerCase() === 'cancelled') return null

  // Typing CANCEL (in the reader's language) is the confirmation: a button
  // that refunds every buyer should not be one stray click away.
  const word = t('cancelEvent.confirmWord')
  const confirmed = typed.trim().toLowerCase() === word.toLowerCase()

  const close = () => {
    if (busy) return
    setOpen(false)
    setError(null)
    setTyped('')
  }

  const cancel = async () => {
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      })
      const data: Outcome & { error?: string; code?: string } = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = typeof data?.code === 'string' ? data.code : ''
        setError(
          code
            ? t(`cancelEvent.errors.${code}`, { defaultValue: data?.error || t('cancelEvent.failed') })
            : data?.error || t('cancelEvent.failed')
        )
        return
      }
      showToast({
        type: 'success',
        title: t('cancelEvent.doneTitle'),
        message: t('cancelEvent.doneBody', {
          refunded: Number(data.refundsSucceeded || 0),
          manual: Number(data.refundsQueuedManual || 0) + Number(data.refundsSentToReview || 0),
          notified: Number(data.notified || 0),
        }),
        duration: 8000,
      })
      setOpen(false)
      router.refresh()
    } catch {
      setError(t('cancelEvent.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? 'text-xs font-semibold text-danger-soft underline underline-offset-4'
            : 'flex h-10 w-full items-center justify-center rounded text-sm font-medium text-danger-soft transition-colors hover:bg-danger-strong/10'
        }
      >
        {t('cancelEvent.button')}
      </button>
      <Drawer
        open={open}
        onClose={close}
        title={t('cancelEvent.title', { event: eventTitle })}
        size="md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={close}
              className="h-10 w-full whitespace-nowrap rounded bg-surface px-4 text-sm font-semibold text-fg-muted hover:bg-surface-high sm:w-auto"
            >
              {t('cancelEvent.keep')}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy || !confirmed}
              className="h-10 w-full whitespace-nowrap rounded bg-danger-strong px-4 text-sm font-semibold text-fg hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {busy ? t('cancelEvent.working') : t('cancelEvent.confirm')}
            </button>
          </div>
        }
      >
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-fg-soft">{t('cancelEvent.body')}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>{t('cancelEvent.point1')}</li>
            <li>{t('cancelEvent.point2')}</li>
            <li>{t('cancelEvent.point3')}</li>
          </ul>
          <label htmlFor="cancel-reason" className="block text-xs text-fg-muted">
            {t('cancelEvent.reasonLabel')}
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={3}
            placeholder={t('cancelEvent.reasonPlaceholder')}
            className="w-full rounded bg-surface px-3.5 py-3 text-base text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-danger-soft/50"
          />
          <label htmlFor="cancel-confirm" className="block text-xs text-fg-muted">
            {t('cancelEvent.typeToConfirm', { word })}
          </label>
          <input
            id="cancel-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="w-full rounded bg-surface px-3.5 py-3 text-base text-fg focus:outline-none focus:ring-2 focus:ring-danger-soft/50"
          />
          {error && (
            <p className="text-sm text-danger-soft" role="alert">
              {error}
            </p>
          )}
        </div>
      </Drawer>
    </>
  )
}
