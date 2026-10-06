'use client'

// The promoter's money: what is withdrawable now, what is still held with its
// event (same release ladder as the organizer's own funds), and the withdraw
// action itself. Full-balance withdrawals only — street-team amounts don't need
// partial-amount ceremony.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface WalletData {
  availableByCurrency: Record<string, number>
  pendingByCurrency: Record<string, number>
  unsupportedByCurrency: Record<string, number>
  owedByCurrency?: Record<string, number>
  moncashPhone: string | null
  moncashPhoneAvailableAt?: string | null
  feePercent: number
  minWithdrawalHtgCents: number
}

interface WithdrawalRow {
  id: string
  status: string
  grossCents: number
  feeCents: number
  payoutHtgCents: number
  instant: boolean
  createdAt: string | null
}

function fmtMoney(cents: number, currency: string): string {
  return `${(Math.round(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

function fmtBuckets(buckets: Record<string, number>): string {
  const parts = Object.entries(buckets)
    .filter(([, cents]) => cents > 0)
    .map(([currency, cents]) => fmtMoney(cents, currency))
  return parts.length ? parts.join(' + ') : '0 HTG'
}

export default function PromoterWalletCard() {
  const { t } = useTranslation('common')
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  // A new MonCash number is confirmed with the emailed step-up code (the same
  // one organizers use for payout changes), then held 24h by the server.
  const [needsCode, setNeedsCode] = useState(false)
  const [code, setCode] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/promoter/wallet')
      if (!res.ok) return
      const data = await res.json()
      setWallet(data.wallet)
      setWithdrawals(data.withdrawals || [])
      if (data.wallet?.moncashPhone) setPhone(data.wallet.moncashPhone)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading || !wallet) return null

  const hasAvailable = Object.values(wallet.availableByCurrency).some((c) => c > 0)
  const hasPending = Object.values(wallet.pendingByCurrency).some((c) => c > 0)
  const hasAnything = hasAvailable || hasPending || withdrawals.length > 0
  if (!hasAnything) return null

  const handleWithdraw = async () => {
    setWorking(true)
    setMessage(null)
    try {
      const res = await fetch('/api/promoter/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.requiresVerification) {
          await fetch('/api/organizer/payout-details-change/send-email-code', { method: 'POST' }).catch(() => null)
          setNeedsCode(true)
          setMessage({ kind: 'ok', text: t('promoter.wallet_code_prompt', 'We emailed you a 6-digit code. Enter it to confirm this MonCash number.') })
          return
        }
        setMessage({ kind: 'error', text: data?.error || t('promoter.wallet_error_generic', 'Withdrawal failed.') })
        if (data?.code === 'destination_on_hold') await load()
        return
      }
      setMessage({
        kind: 'ok',
        text: data.instant
          ? t('promoter.wallet_success_instant', {
              defaultValue: 'Sent! {{amount}} is on its way to your MonCash (after the {{fee}}% instant fee).',
              amount: fmtMoney(data.payoutHtgCents, 'HTG'),
              fee: Math.round((wallet.feePercent || 0.03) * 100),
            })
          : t('promoter.wallet_success_pending', {
              defaultValue: 'Requested. {{amount}} will be sent to your MonCash shortly. No fee on this path.',
              amount: fmtMoney(data.payoutHtgCents, 'HTG'),
            }),
      })
      await load()
    } catch {
      setMessage({ kind: 'error', text: t('promoter.wallet_error_network', 'Could not reach Tikèm. Nothing was sent.') })
    } finally {
      setWorking(false)
    }
  }

  const handleConfirmCode = async () => {
    setWorking(true)
    setMessage(null)
    try {
      const res = await fetch('/api/organizer/payout-details-change/verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ kind: 'error', text: data?.error || t('promoter.wallet_error_generic', 'Withdrawal failed.') })
        return
      }
      setNeedsCode(false)
      setCode('')
    } catch {
      setMessage({ kind: 'error', text: t('promoter.wallet_error_network', 'Could not reach Tikèm. Nothing was sent.') })
      return
    } finally {
      setWorking(false)
    }
    // Verified: retry, which saves the number (and reports its 24h hold).
    await handleWithdraw()
  }

  const owed = wallet.owedByCurrency || {}
  const hasOwed = Object.values(owed).some((c) => c > 0)
  const holdUntilMs = wallet.moncashPhoneAvailableAt ? Date.parse(wallet.moncashPhoneAvailableAt) : NaN
  const numberOnHold = Number.isFinite(holdUntilMs) && holdUntilMs > Date.now()

  return (
    <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="label-mono text-[11px] uppercase tracking-widest text-brand-400 mb-3">{t('promoter.wallet_title', 'Your wallet')}</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xl font-bold text-white">{fmtBuckets(wallet.availableByCurrency)}</p>
          <p className="text-[11px] uppercase tracking-wider text-white/50 mt-1">{t('promoter.wallet_available', 'Available now')}</p>
        </div>
        <div>
          <p className="text-xl font-bold text-white/70">{fmtBuckets(wallet.pendingByCurrency)}</p>
          <p className="text-[11px] uppercase tracking-wider text-white/50 mt-1">{t('promoter.wallet_pending', 'Pending release')}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-white/40 leading-relaxed">
        {t('promoter.wallet_note', {
          defaultValue:
            "Commission unlocks when the event's funds release to the organizer, the same schedule their own payout follows. Instant MonCash withdrawals carry a {{fee}}% fee; minimum {{min}}.",
          fee: Math.round((wallet.feePercent || 0.03) * 100),
          min: fmtMoney(wallet.minWithdrawalHtgCents, 'HTG'),
        })}
      </p>

      {hasOwed && (
        <p className="mt-3 text-xs text-amber-200">
          {t('promoter.wallet_owed', { defaultValue: 'Owed back from reversed commission: {{amount}}', amount: fmtBuckets(owed) })}
        </p>
      )}

      {numberOnHold && (
        <p className="mt-3 text-xs text-white/60">
          {t('promoter.wallet_number_on_hold', {
            defaultValue: 'This MonCash number can receive withdrawals from {{date}}.',
            date: new Date(holdUntilMs).toLocaleString(),
          })}
        </p>
      )}

      {hasAvailable && needsCode && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('promoter.wallet_code_placeholder', '6-digit code')}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          <button
            type="button"
            onClick={handleConfirmCode}
            disabled={working || code.length !== 6}
            className="rounded-xl bg-white hover:bg-white/90 px-5 py-3 text-sm font-medium text-black transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {t('promoter.wallet_code_confirm', 'Confirm')}
          </button>
        </div>
      )}

      {hasAvailable && !needsCode && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('promoter.wallet_phone_placeholder', 'MonCash number (e.g. 509 XX XX XX XX)')}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={working || !phone.trim()}
            className="rounded-xl bg-white hover:bg-white/90 px-5 py-3 text-sm font-medium text-black transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {working ? t('promoter.wallet_sending', 'Sending…') : t('promoter.wallet_withdraw_btn', 'Withdraw to MonCash')}
          </button>
        </div>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
          {message.text}
        </p>
      )}

      {withdrawals.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4 space-y-2">
          {withdrawals.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-white/60">
                {w.createdAt ? new Date(w.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ', '}
                {' · '}
                {fmtMoney(w.payoutHtgCents, 'HTG')}
                {w.instant ? ` · ${t('promoter.wallet_instant_label', 'instant')}` : ''}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/50">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    w.status === 'completed'
                      ? 'bg-emerald-400'
                      : w.status === 'failed'
                      ? 'bg-red-400'
                      : 'bg-amber-400'
                  }`}
                />
                {w.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
