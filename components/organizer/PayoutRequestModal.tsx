'use client'

import { useTranslation } from 'react-i18next'

import { useState } from 'react'
import { X, Loader2, CheckCircle2, AlertCircle, Wallet, CalendarClock } from 'lucide-react'

interface PayoutRequestModalProps {
  open: boolean
  onClose: () => void
  /** Human-readable available balance, e.g. "HTG 2,250.00". */
  availableLabel: string
  /** The one currency this request pays out — balances are never mixed. */
  currency: string
  /** Optional: name of the destination payout method. */
  methodLabel?: string
}

/**
 * Confirmation modal for requesting a payout. The backend (/api/organizer/request-payout)
 * withdraws the FULL available balance to the configured method and batches it to the
 * next Friday — so this is a clear review/confirm step (not an amount-entry form),
 * which matches the actual money logic. Reuses the existing endpoint as-is.
 */
export function PayoutRequestModal({ open, onClose, availableLabel, currency, methodLabel }: PayoutRequestModalProps) {
  const { t } = useTranslation('organizer')

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [scheduledDate, setScheduledDate] = useState<string | null>(null)

  if (!open) return null

  const close = () => {
    if (status === 'loading') return
    setStatus('idle')
    setMessage('')
    setScheduledDate(null)
    onClose()
  }

  const submit = async () => {
    setStatus('loading')
    setMessage('')
    try {
      const res = await fetch('/api/organizer/request-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.error) {
        setStatus('error')
        setMessage(data?.message || data?.error || 'Could not request payout. Please try again.')
        return
      }
      setScheduledDate(data?.payout?.scheduledDate || null)
      setStatus('success')
    } catch (e: any) {
      setStatus('error')
      setMessage(e?.message || 'Something went wrong. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative w-full max-w-md rounded-2xl bg-[#111] shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="font-display text-xl text-white">{t('actions.request_payout')}</h3>
          <button onClick={close} disabled={status === 'loading'} aria-label={t('actions.close')} className="text-white/40 transition-colors hover:text-white/60 disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        {status === 'success' ? (
          <div className="px-5 py-8 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full text-emerald-300">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h4 className="font-display text-lg text-white">{t('payout_request.payout_requested')}</h4>
            <p className="mx-auto mt-1 max-w-xs text-sm text-white/60">
              {scheduledDate
                ? `Your funds are scheduled for ${new Date(scheduledDate).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.`
                : 'Your request has been received and is being processed.'}
            </p>
            <button onClick={close} className="mt-5 w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <div className="rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/50">
                <Wallet className="h-4 w-4 text-brand-300" /> {t('actions.amount')}
              </div>
              <p className="mt-1 text-2xl font-bold text-white">{availableLabel}</p>
              <p className="text-xs text-white/50">
                Full available balance{methodLabel ? `, sent to ${methodLabel}` : ', sent to your verified payout method'}.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-white/60">
              <li className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                {t('payout_request.batched_note')}
              </li>
              <li className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                Platform &amp; processing fees are already deducted. Minimum payout is $50.
              </li>
            </ul>

            {status === 'error' && (
              <div className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300">{message}</div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={close} disabled={status === 'loading'} className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-50">
                {t('actions.cancel')}
              </button>
              <button onClick={submit} disabled={status === 'loading'} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60">
                {status === 'loading' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Requesting…
                  </>
                ) : (
                  'Confirm payout'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
