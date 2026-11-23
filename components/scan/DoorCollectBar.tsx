'use client'

// Pay at the door at the scanner: "Collect HTG 500" with a Mark paid button,
// shown over the scan result while the ticket still owes. Records the payment
// through /api/staff/events/:id/door-payment. The cash is the organizer's own:
// Tikem never handles it and takes no fee on it.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { doorMoney } from '@/lib/tickets/pay-at-door'

export function DoorCollectBar({
  eventId,
  ticketId,
  owes,
  currency,
  paid,
  onChange,
}: {
  eventId: string
  ticketId: string
  owes: number
  currency: string
  paid: boolean
  onChange: (paid: boolean) => void
}) {
  const { t, i18n } = useTranslation('organizer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const money = doorMoney(owes, currency, i18n.language)

  const send = async (next: boolean) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/staff/events/${encodeURIComponent(eventId)}/door-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, paid: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onChange(next)
    } catch {
      setError(t('door.payment_needs_connection', { defaultValue: 'Needs a connection to record the payment.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] bg-surface-raised px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 text-fg">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <div className="min-w-0">
          {/* Dot + label status, never a pill. */}
          <p className="flex items-center gap-1.5 text-eyebrow font-bold uppercase tracking-[0.12em] text-fg-muted">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${paid ? 'bg-success' : 'bg-warning'}`} />
            {paid
              ? t('door.paid_at_door', { defaultValue: 'Paid at the door' })
              : t('door.pay_at_door', { defaultValue: 'Pay at the door' })}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {paid ? money : t('door.collect_amount', { amount: money, defaultValue: 'Collect {{amount}}' })}
          </p>
          {error && <p className="mt-1 text-xs text-danger-soft">{error}</p>}
        </div>
        {paid ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => send(false)}
            className="h-10 shrink-0 rounded bg-surface-high px-4 text-sm font-semibold text-fg hover:bg-surface disabled:opacity-60"
          >
            {t('door.undo_payment', { defaultValue: 'Undo' })}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => send(true)}
            className="h-10 shrink-0 rounded bg-inverse px-5 text-sm font-semibold text-on-inverse hover:bg-inverse-hover disabled:opacity-60"
          >
            {t('door.mark_paid', { defaultValue: 'Mark paid' })}
          </button>
        )}
      </div>
    </div>
  )
}
