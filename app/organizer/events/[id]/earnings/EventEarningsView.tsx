'use client'

import { useTranslation } from 'react-i18next'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/fees'
import type { EventEarnings } from '@/types/earnings'
import type { EventTierSalesBreakdownRow } from '@/lib/earnings'
import { MetricCard, StatusChip, type ChipTone } from '@/components/organizer/ui'
import { DollarSign, TrendingUp, Wallet } from 'lucide-react'
import {
  MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
  type MoncashMinimumInfo,
} from '@/lib/payouts/moncash-withdrawal-minimum'

/** Haiti bank-transfer floor, as enforced by /api/organizer/withdraw-bank (unchanged). */
const BANK_MIN_WITHDRAWAL_MINOR = 5000

interface EventEarningsViewProps {
  event: any
  earnings: EventEarnings | null
  organizerId: string
  tierBreakdown?: EventTierSalesBreakdownRow[]
  /** The MonCash 1,000 HTG floor in this event's currency, from the server. */
  moncashMinimum?: MoncashMinimumInfo | null
}

export default function EventEarningsView({ event, earnings, organizerId, tierBreakdown, moncashMinimum }: EventEarningsViewProps) {
  const { t } = useTranslation('organizer')
  const router = useRouter()
  const { showToast } = useToast()
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [withdrawMethod, setWithdrawMethod] = useState<'moncash' | 'bank' | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [payoutChangeVerificationRequired, setPayoutChangeVerificationRequired] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [isSendingVerificationCode, setIsSendingVerificationCode] = useState(false)
  const [isVerifyingVerificationCode, setIsVerifyingVerificationCode] = useState(false)
  const [pendingEndpoint, setPendingEndpoint] = useState<string | null>(null)
  const [pendingPayload, setPendingPayload] = useState<any | null>(null)
  const [debugVerificationCode, setDebugVerificationCode] = useState<string | null>(null)
  
  // Form states
  const [moncashNumber, setMoncashNumber] = useState('')

  const [prefunding, setPrefunding] = useState<{ enabled: boolean; available: boolean } | null>(null)
  const [allowInstantMoncash, setAllowInstantMoncash] = useState(false)
  const [moncashQuote, setMoncashQuote] = useState<null | {
    amountCents: number
    currency: 'HTG' | 'USD'
    instantAvailable: boolean
    prefundingFeePercent: number
    feeCents: number
    payoutAmountCents: number
    payoutCurrency: 'HTG'
    payoutAmountHtgCents: number
    usdToHtgRate: number | null
  }>(null)

  type BankDestination = {
    id: string
    bankName: string
    accountName: string
    accountNumberLast4: string
    isPrimary: boolean
  }

  const [bankDestinations, setBankDestinations] = useState<BankDestination[] | null>(null)
  const [bankDestinationsError, setBankDestinationsError] = useState<string | null>(null)
  const [bankMode, setBankMode] = useState<'on_file' | 'saved' | 'new'>('on_file')
  const [selectedBankDestinationId, setSelectedBankDestinationId] = useState<string>('')
  const [saveNewBankDestination, setSaveNewBankDestination] = useState(true)

  const [bankDetails, setBankDetails] = useState({
    accountNumber: '',
    bankName: '',
    accountHolder: '',
    swiftCode: '',
    routingNumber: ''
  })

  // Held for admin review: the withdraw routes refuse it, so show nothing withdrawable.
  const withdrawalBlocked = Boolean(earnings?.withdrawalBlocked)

  const availableToWithdraw = useMemo(() => {
    if (!earnings) return 0
    if (earnings.withdrawalBlocked) return 0
    if (earnings.settlementStatus !== 'ready') return 0
    // The server's figure (lib/payouts/availability.ts), release ladder applied —
    // what withdraw-moncash / withdraw-bank will accept. Recomputing net −
    // withdrawn here ignored the post-event hold and offered money too early.
    return Math.max(0, Number(earnings.availableToWithdraw || 0))
  }, [earnings])

  const isInstantPrefundingAvailable = useMemo(() => {
    return Boolean(prefunding?.enabled && prefunding?.available && allowInstantMoncash)
  }, [prefunding, allowInstantMoncash])

  // Same floor the MonCash route enforces: 1,000 HTG, measured in HTG (a USD
  // balance converted at the server's rate). Unknown minimum on a USD event →
  // let the server decide rather than block.
  const moncashMinMinor = useMemo(() => {
    const cur = String(earnings?.currency || 'HTG').toUpperCase()
    if (moncashMinimum && Number.isFinite(moncashMinimum.minimumMinor)) return moncashMinimum.minimumMinor
    return cur === 'USD' ? 0 : MONCASH_MIN_WITHDRAWAL_HTG_CENTS
  }, [earnings?.currency, moncashMinimum])
  const moncashMeetsMinimum = availableToWithdraw >= moncashMinMinor
  const bankMeetsMinimum = availableToWithdraw >= BANK_MIN_WITHDRAWAL_MINOR
  const moncashMinLabel = useMemo(() => {
    const htg = formatCurrency(MONCASH_MIN_WITHDRAWAL_HTG_CENTS, 'HTG')
    if (String(earnings?.currency || 'HTG').toUpperCase() === 'USD' && moncashMinMinor > 0) {
      return `${htg} (≈ ${formatCurrency(moncashMinMinor, 'USD')})`
    }
    return htg
  }, [earnings?.currency, moncashMinMinor])

  const prefundingFeeCents = useMemo(() => {
    if (!isInstantPrefundingAvailable) return 0
    return Math.max(0, Math.round(availableToWithdraw * 0.03))
  }, [availableToWithdraw, isInstantPrefundingAvailable])

  const prefundingPayoutCents = useMemo(() => {
    if (!isInstantPrefundingAvailable) return 0
    return Math.max(0, availableToWithdraw - prefundingFeeCents)
  }, [availableToWithdraw, prefundingFeeCents, isInstantPrefundingAvailable])

  const selectedBankDestination = useMemo(() => {
    if (!bankDestinations || !selectedBankDestinationId) return null
    return bankDestinations.find((d) => d.id === selectedBankDestinationId) || null
  }, [bankDestinations, selectedBankDestinationId])

  useEffect(() => {
    if (!showWithdrawModal || !withdrawMethod) return

    const run = async () => {
      setError(null)
      setVerificationError(null)
      setVerificationMessage(null)
      setDebugVerificationCode(null)

      if (withdrawMethod === 'bank') {
        setBankDestinationsError(null)
        try {
          const res = await fetch('/api/organizer/payout-destinations/bank', { cache: 'no-store' as any })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to load bank accounts')

          const destinations = (data?.destinations || []) as BankDestination[]
          setBankDestinations(destinations)

          const primary = destinations.find((d) => d.isPrimary)
          if (primary) {
            setBankMode('on_file')
            setSelectedBankDestinationId(primary.id)
          } else if (destinations.length > 0) {
            setBankMode('saved')
            setSelectedBankDestinationId(destinations[0].id)
          } else {
            setBankMode('new')
            setSelectedBankDestinationId('')
          }
        } catch (e: any) {
          setBankDestinations(null)
          setBankDestinationsError(e?.message || 'Failed to load bank accounts')
          setBankMode('new')
          setSelectedBankDestinationId('')
        }
      }

      if (withdrawMethod === 'moncash') {
        try {
          const [prefundingRes, configRes] = await Promise.all([
            fetch('/api/organizer/payout-prefunding-status', { cache: 'no-store' as any }),
            fetch('/api/organizer/payout-config-summary', { cache: 'no-store' as any }),
          ])

          const prefundingData = await prefundingRes.json().catch(() => ({}))
          const configData = await configRes.json().catch(() => ({}))

          if (prefundingRes.ok) {
            setPrefunding(prefundingData?.prefunding || { enabled: false, available: false })
          } else {
            setPrefunding({ enabled: false, available: false })
          }

          if (configRes.ok) {
            setAllowInstantMoncash(Boolean(configData?.allowInstantMoncash))
          } else {
            setAllowInstantMoncash(false)
          }
        } catch {
          setPrefunding({ enabled: false, available: false })
          setAllowInstantMoncash(false)
        }
      }

      if (withdrawMethod === 'moncash') {
        try {
          const res = await fetch(`/api/organizer/withdraw-moncash/quote?eventId=${encodeURIComponent(String(event.id))}`, {
            cache: 'no-store' as any,
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to load MonCash payout quote')
          setMoncashQuote(data?.quote || null)
        } catch {
          setMoncashQuote(null)
        }
      }
    }

    void run()
  }, [event?.id, showWithdrawModal, withdrawMethod])

  if (!earnings) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link href="/organizer/earnings" className="text-brand-300 hover:underline mb-4 inline-block">
          ← Back to All Earnings
        </Link>
        
        <div className="rounded-xl bg-white/[0.03] p-8 text-center">
          <span className="text-6xl mb-4 block">💰</span>
          <h2 className="font-display text-2xl text-white mb-2">{t('event_earnings.no_earnings_yet')}</h2>
          <p className="text-white/60 mb-6">
            This event hasn&apos;t generated any earnings yet. Earnings are recorded when attendees purchase tickets.
          </p>
          <Link 
            href={`/events/${event.id}`}
            className="inline-block px-6 py-3 bg-brand-700 text-white rounded-lg hover:bg-brand-800 transition-colors"
          >
            {t('event_earnings.view_event_page')}
          </Link>
        </div>
      </div>
    )
  }

  const eventDateRaw = event.end_datetime || event.endDateTime || event.start_datetime || event.startDateTime || event.date_time || event.date || event.created_at
  const eventDate = eventDateRaw ? new Date(eventDateRaw) : null

  // The release date comes from the server's release rules (availableAt). No
  // local fallback: the old one added the 0-day settlement hold to the event
  // date and promised a day the release ladder would then refuse.
  const settlementDate = earnings.settlementReadyDate ? new Date(earnings.settlementReadyDate) : null

  const settlementTone: Record<string, ChipTone> = {
    ready: 'success',
    pending: 'warning',
    locked: 'neutral',
  }

  const getStatusBadge = (status: string) => {
    if (!settlementTone[status]) return null
    const label = status === 'ready' ? '✓ Ready' : status === 'pending' ? '⏳ Pending' : '🔒 Locked'
    return <StatusChip tone={settlementTone[status]}>{label}</StatusChip>
  }

  const handleWithdraw = (method: 'moncash' | 'bank') => {
    setWithdrawMethod(method)
    setShowWithdrawModal(true)
    setError(null)
    setPayoutChangeVerificationRequired(false)
    setPendingEndpoint(null)
    setPendingPayload(null)
  }

  const sendVerificationCode = async () => {
    setIsSendingVerificationCode(true)
    setVerificationError(null)
    setVerificationMessage(null)
    setDebugVerificationCode(null)

    try {
      const res = await fetch('/api/organizer/payout-details-change/send-email-code', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to send code')
      setVerificationMessage('Verification code sent. Check your email.')
      if (data?.debugCode) setDebugVerificationCode(String(data.debugCode))
    } catch (e: any) {
      setVerificationError(e?.message || 'Failed to send verification code')
    } finally {
      setIsSendingVerificationCode(false)
    }
  }

  const verifyCode = async () => {
    setIsVerifyingVerificationCode(true)
    setVerificationError(null)

    try {
      const res = await fetch('/api/organizer/payout-details-change/verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to verify code')

      setPayoutChangeVerificationRequired(false)
      setVerificationMessage('Verified. Continuing…')

      // Retry the pending action once verified.
      if (pendingEndpoint && pendingPayload) {
        const endpoint = pendingEndpoint
        const payload = pendingPayload
        setPendingEndpoint(null)
        setPendingPayload(null)
        setVerificationCode('')
        await attemptWithdrawal(endpoint, payload)
      }
    } catch (e: any) {
      setVerificationError(e?.message || 'Invalid verification code')
    } finally {
      setIsVerifyingVerificationCode(false)
    }
  }

  const attemptWithdrawal = async (endpoint: string, payload: any) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      if (data?.requiresVerification || data?.code === 'PAYOUT_CHANGE_VERIFICATION_REQUIRED') {
        setPendingEndpoint(endpoint)
        setPendingPayload(payload)
        setPayoutChangeVerificationRequired(true)
        setVerificationMessage(
          data?.message ||
            'For your security, confirm this withdrawal change with the code we email you.'
        )
        return
      }
      throw new Error(data?.error || data?.message || 'Failed to submit withdrawal')
    }

    // Success — toast, close the modal, and refresh to show the updated balance.
    if (withdrawMethod === 'moncash' && data?.instant) {
      const payoutCurrency = String(data?.payoutCurrency || '').toUpperCase() === 'HTG' ? 'HTG' : null
      const payoutAmountHtgCents = typeof data?.payoutAmountHtgCents === 'number' ? data.payoutAmountHtgCents : null
      const received =
        payoutCurrency && payoutAmountHtgCents != null
          ? formatCurrency(payoutAmountHtgCents, payoutCurrency)
          : formatCurrency(data?.payoutAmountCents || 0, earnings.currency)
      showToast({
        type: 'success',
        title: 'Instant MonCash sent',
        message: `Fee ${formatCurrency(data?.feeCents || 0, earnings.currency)} · You receive ${received}.`,
        duration: 5000,
      })
    } else {
      showToast({
        type: 'success',
        title: 'Withdrawal requested',
        message: `You'll receive your funds within ${withdrawMethod === 'moncash' ? '24 hours' : '3 to 5 business days'}.`,
        duration: 5000,
      })
    }
    setShowWithdrawModal(false)
    router.refresh()
  }

  const submitWithdrawal = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const endpoint = withdrawMethod === 'moncash' 
        ? '/api/organizer/withdraw-moncash'
        : '/api/organizer/withdraw-bank'

      let payload: any
      if (withdrawMethod === 'moncash') {
        payload = { eventId: event.id, amount: availableToWithdraw, moncashNumber }
      } else {
        if (bankMode === 'new') {
          payload = {
            eventId: event.id,
            amount: availableToWithdraw,
            bankDetails,
            saveDestination: saveNewBankDestination,
          }
        } else {
          payload = {
            eventId: event.id,
            amount: availableToWithdraw,
            bankDestinationId: selectedBankDestinationId,
          }
        }
      }

      await attemptWithdrawal(endpoint, payload)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <Link href="/organizer/earnings" className="text-brand-300 hover:underline mb-4 inline-block">
        ← Back to All Earnings
      </Link>

      <div className="mb-6">
        <h1 className="font-display italic text-[clamp(28px,4vw,40px)] leading-[1.04] text-white mb-2">{event.title || 'Event'}</h1>
        <div className="flex items-center gap-2 text-white/60">
          <span className="font-mono tabular-nums">📅 {eventDate ? eventDate.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          }) : 'Date TBD'}</span>
          <span className="mx-2">•</span>
          {getStatusBadge(earnings.settlementStatus)}
        </div>
        <div className="mt-1 text-xs text-white/70">
          Revenue source: {earnings.dataSource === 'availability' ? 'Ticket sales (platform fee and refunds excluded)' : earnings.dataSource === 'tickets_derived' ? 'Derived from tickets' : earnings.dataSource === 'event_earnings' ? 'event_earnings record' : 'Unknown'}
          {earnings.lastCalculatedAt ? ` • Last calculated: ${new Date(earnings.lastCalculatedAt).toLocaleString('en-US')}` : ''}
        </div>
      </div>

      {/* Earnings Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <MetricCard
          icon={DollarSign}
          label={t('event_earnings.gross_revenue')}
          value={formatCurrency(earnings.grossSales, earnings.currency)}
          sublabel={`${earnings.ticketsSold} tickets sold`}
        />
        <MetricCard
          icon={TrendingUp}
          label={t('event_earnings.net_earnings')}
          value={formatCurrency(earnings.netAmount, earnings.currency)}
          sublabel={earnings.withdrawnAmount > 0 ? `${formatCurrency(earnings.withdrawnAmount, earnings.currency)} withdrawn` : 'Not withdrawn yet'}
        />
        <MetricCard
          icon={Wallet}
          label={t('event_earnings.available_to_withdraw')}
          value={<span className="text-emerald-300">{formatCurrency(availableToWithdraw, earnings.currency)}</span>}
          sublabel={earnings.settlementStatus === 'ready' ? 'Ready now' : 'After settlement'}
        />
      </div>

      {/* Ticket Tier Breakdown */}
      <div className="rounded-xl bg-white/[0.03] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl text-white">🎟️ Ticket Tier Breakdown</h2>
            <p className="text-sm text-white/60">{t('event_earnings.totals_note')}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/api/organizer/events/${event.id}/earnings/audit?format=csv`}
              className="text-sm text-brand-300 hover:underline"
            >
              {t('event_earnings.download_audit_csv')}
            </a>
          </div>
        </div>

        {!tierBreakdown || tierBreakdown.length === 0 ? (
          <div className="text-white/60 text-sm">{t('event_earnings.no_ticket_sales_yet')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/70 border-b">
                  <th className="py-2 pr-4 font-medium">Tier</th>
                  <th className="py-2 pr-4 font-medium">{t('event_earnings.listed_unit_price')}</th>
                  <th className="py-2 pr-4 font-medium">{t('event_earnings.tickets_sold')}</th>
                  <th className="py-2 font-medium">{t('event_earnings.gross_listed')}</th>
                </tr>
              </thead>
              <tbody>
                {tierBreakdown.map((row) => (
                  <tr
                    key={`${String(row.tierId || row.tierName)}::${row.listedUnitPriceCents}::${row.listedCurrency}`}
                    className="border-b last:border-b-0"
                  >
                    <td className="py-3 pr-4 font-medium text-white">{row.tierName}</td>
                    <td className="py-3 pr-4 font-mono tabular-nums text-white/70">{formatCurrency(row.listedUnitPriceCents, row.listedCurrency)}</td>
                    <td className="py-3 pr-4 font-mono tabular-nums text-white/70">{row.ticketsSold}</td>
                    <td className="py-3 font-mono tabular-nums text-white">{formatCurrency(row.grossSales, row.listedCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Settlement Status */}
      {earnings.settlementStatus !== 'ready' && (
        <div className="border border-amber-500/30 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">ℹ️</span>
            <div>
              <h3 className="font-bold text-amber-300 mb-1">
                {earnings.settlementStatus === 'pending' ? 'Settlement Pending' : 'Funds Locked'}
              </h3>
              <p className="text-amber-300 text-sm mb-2">
                {earnings.settlementStatus === 'pending'
                  ? 'Funds are held for 7 days after your event to allow for refunds and disputes.'
                  : 'Funds will become available 7 days after your event ends.'}
              </p>
              {settlementDate && (
                <p className="text-amber-300 text-sm font-medium">
                  {t('event_earnings.available_for_withdrawal')}<span className="font-mono tabular-nums">{settlementDate.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal Section */}
      {withdrawalBlocked && (
        <div className="rounded-xl bg-amber-500/10 p-4 mb-6">
          <p className="text-amber-200 text-sm">{t('event_earnings.needs_admin_review')}</p>
        </div>
      )}

      {!withdrawalBlocked && earnings.settlementStatus === 'ready' && availableToWithdraw > 0 && (
        <div className="rounded-xl bg-white/[0.03] p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-xl text-white">💸 Request Withdrawal</h2>
              <p className="text-white/60 text-sm">{t('event_earnings.available_label')}<span className="font-mono tabular-nums">{formatCurrency(availableToWithdraw, earnings.currency)}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <button
                onClick={() => handleWithdraw('moncash')}
                disabled={!moncashMeetsMinimum}
                aria-disabled={!moncashMeetsMinimum}
                className="w-full border-2 border-brand-500/30 rounded-xl p-4 hover:border-brand-400 hover:shadow-md transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-brand-500/30"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center group-hover:bg-brand-200 transition-colors">
                    <span className="text-2xl">📱</span>
                  </div>
                  <div>
                    <div className="font-bold text-white">{t('event_earnings.moncash')}</div>
                    <div className="text-sm text-white/70">{t('event_earnings.instant_transfer')}</div>
                  </div>
                </div>
                <div className="text-xs text-white/70">{t('event_earnings.processed_24h')}</div>
              </button>
              {!moncashMeetsMinimum && (
                <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {t('event_earnings.moncash_below_minimum', {
                    min: moncashMinLabel,
                    balance: formatCurrency(availableToWithdraw, earnings.currency),
                  })}
                </p>
              )}
            </div>

            <div>
              <button
                onClick={() => handleWithdraw('bank')}
                disabled={!bankMeetsMinimum}
                aria-disabled={!bankMeetsMinimum}
                className="w-full border-2 border-brand-500/30 rounded-xl p-4 hover:border-brand-400 hover:shadow-md transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-brand-500/30"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center group-hover:bg-brand-500/15 transition-colors">
                    <span className="text-2xl">🏦</span>
                  </div>
                  <div>
                    <div className="font-bold text-white">{t('event_earnings.bank_transfer')}</div>
                    <div className="text-sm text-white/70">{t('event_earnings.direct_deposit')}</div>
                  </div>
                </div>
                <div className="text-xs text-white/70">{t('event_earnings.processed_3_5_days')}</div>
              </button>
              {!bankMeetsMinimum && (
                <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {t('event_earnings.bank_below_minimum', {
                    min: formatCurrency(BANK_MIN_WITHDRAWAL_MINOR, earnings.currency),
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal History */}
      {earnings.withdrawnAmount > 0 && (
        <div className="rounded-xl bg-white/[0.03] p-6">
          <h2 className="font-display text-xl text-white mb-4">📋 Withdrawal History</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <div>
                <div className="font-medium text-white">{t('event_earnings.total_withdrawn')}</div>
                <div className="text-sm text-white/70">{t('event_earnings.from_this_event')}</div>
              </div>
              <span className="font-mono tabular-nums font-bold text-white">{formatCurrency(earnings.withdrawnAmount, earnings.currency)}</span>
            </div>
            {!withdrawalBlocked && earnings.netAmount - earnings.withdrawnAmount > 0 && (
              <div className="flex justify-between items-center py-3">
                <div>
                  <div className="font-medium text-white">{t('event_earnings.remaining_balance')}</div>
                  <div className="text-sm text-white/70">Available {earnings.settlementStatus === 'ready' ? 'now' : 'after settlement'}</div>
                </div>
                <span className="font-mono tabular-nums font-bold text-brand-300">{formatCurrency(earnings.netAmount - earnings.withdrawnAmount, earnings.currency)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Withdrawal Modal */}
      {showWithdrawModal && withdrawMethod && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="rounded-xl bg-[#171717] max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-xl text-white mb-4">
              Request {withdrawMethod === 'moncash' ? 'MonCash' : 'Bank'} Withdrawal
            </h3>
            
            <div className="mb-6">
              <div className="rounded-lg bg-white/[0.06] p-4 mb-4">
                <div className="flex justify-between mb-2">
                  <span className="text-white/60">{t('event_earnings.amount_label')}</span>
                  <span className="font-mono tabular-nums font-bold text-white">{formatCurrency(availableToWithdraw, earnings.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">{t('event_earnings.method_label')}</span>
                  <span className="font-medium text-white">
                    {withdrawMethod === 'moncash' ? '📱 MonCash' : '🏦 Bank Transfer'}
                  </span>
                </div>
              </div>

              {/* MonCash Form */}
              {withdrawMethod === 'moncash' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      {t('event_earnings.moncash_phone_number')}
                    </label>
                    <input
                      type="tel"
                      value={moncashNumber}
                      onChange={(e) => setMoncashNumber(e.target.value)}
                      placeholder="+509 1234 5678"
                      className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.08] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                      required
                    />
                  </div>
                  {moncashQuote ? (
                    <div
                      className={
                        moncashQuote.instantAvailable
                          ? 'rounded-lg bg-white/[0.08] p-3 ring-1 ring-inset ring-brand-400/50'
                          : 'rounded-lg bg-white/[0.06] p-3'
                      }
                    >
                      <p
                        className={
                          moncashQuote.instantAvailable
                            ? 'text-sm font-medium text-brand-300'
                            : 'text-sm font-medium text-white'
                        }
                      >
                        {moncashQuote.instantAvailable ? 'Instant MonCash (prefunding)' : 'MonCash payout'}
                      </p>
                      <p
                        className={
                          moncashQuote.instantAvailable
                            ? 'text-xs text-brand-300 mt-1'
                            : 'text-xs text-white/60 mt-1'
                        }
                      >
                        {moncashQuote.instantAvailable
                          ? 'Sent instantly using platform prefunding.'
                          : 'Sent to your MonCash account (typically within 24 hours).'}
                      </p>

                      <div
                        className={
                          moncashQuote.instantAvailable
                            ? 'mt-2 text-xs text-brand-300 space-y-1'
                            : 'mt-2 text-xs text-white/90 space-y-1'
                        }
                      >
                        <div className="flex justify-between">
                          <span>Fee (<span className="font-mono tabular-nums">{moncashQuote.prefundingFeePercent}%</span>)</span>
                          <span className="font-mono tabular-nums">-{formatCurrency(moncashQuote.feeCents, moncashQuote.currency)}</span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span>{t('event_earnings.you_receive')}</span>
                          <span className="font-mono tabular-nums">
                            {moncashQuote.payoutCurrency === 'HTG' && typeof moncashQuote.payoutAmountHtgCents === 'number'
                              ? formatCurrency(moncashQuote.payoutAmountHtgCents, 'HTG')
                              : formatCurrency(moncashQuote.payoutAmountCents, moncashQuote.currency)}
                          </span>
                        </div>
                        {moncashQuote.currency === 'USD' && typeof moncashQuote.usdToHtgRate === 'number' ? (
                          <div className="flex justify-between">
                            <span>Rate</span>
                            <span className="font-mono tabular-nums">1 USD ≈ {moncashQuote.usdToHtgRate.toFixed(2)} HTG</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : isInstantPrefundingAvailable ? (
                    <div className="border border-brand-500/30 rounded-lg p-3">
                      <p className="text-sm font-medium text-brand-300">{t('event_earnings.instant_moncash_prefunding')}</p>
                      <p className="text-xs text-brand-300 mt-1">
                        {t('event_earnings.prefunding_instant_note')}
                      </p>
                      <div className="mt-2 text-xs text-brand-300 space-y-1">
                        <div className="flex justify-between">
                          <span>{t('event_earnings.prefunding_fee')}</span>
                          <span className="font-mono tabular-nums">-{formatCurrency(prefundingFeeCents, earnings.currency)}</span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span>{t('event_earnings.you_receive')}</span>
                          <span className="font-mono tabular-nums">{formatCurrency(prefundingPayoutCents, earnings.currency)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-white/60">
                      {t('event_earnings.moncash_note')}
                    </p>
                  )}
                </div>
              )}

              {/* Bank Form */}
              {withdrawMethod === 'bank' && (
                <div className="space-y-4">
                  {bankDestinationsError ? (
                    <div className="border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
                      {bankDestinationsError}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-sm text-white">
                      <input
                        type="radio"
                        checked={bankMode === 'on_file'}
                        onChange={() => setBankMode('on_file')}
                        disabled={!bankDestinations?.some((d) => d.isPrimary)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-semibold">{t('event_earnings.use_bank_on_file')}</span>
                        <span className="block text-xs text-white/70">
                          {bankDestinations?.some((d) => d.isPrimary)
                            ? 'Uses your primary bank from payout settings.'
                            : 'No bank on file yet. Add a bank account below.'}
                        </span>
                      </span>
                    </label>

                    {bankDestinations && bankDestinations.length > 1 ? (
                      <label className="flex items-start gap-2 text-sm text-white">
                        <input
                          type="radio"
                          checked={bankMode === 'saved'}
                          onChange={() => setBankMode('saved')}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-semibold">{t('event_earnings.use_saved_bank')}</span>
                          <span className="block text-xs text-white/70">{t('event_earnings.choose_saved_accounts')}</span>
                        </span>
                      </label>
                    ) : null}

                    <label className="flex items-start gap-2 text-sm text-white">
                      <input
                        type="radio"
                        checked={bankMode === 'new'}
                        onChange={() => setBankMode('new')}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-semibold">{t('event_earnings.use_new_bank')}</span>
                        <span className="block text-xs text-white/70">
                          {t('event_earnings.new_bank_needs_verification')}
                        </span>
                      </span>
                    </label>
                  </div>

                  {(bankMode === 'on_file' || bankMode === 'saved') && bankDestinations ? (
                    <div className="rounded-lg bg-white/[0.06] p-3">
                      {bankMode === 'saved' ? (
                        <div className="mb-2">
                          <label className="block text-xs font-medium text-white/60 mb-1">{t('event_earnings.select_account')}</label>
                          <select
                            value={selectedBankDestinationId}
                            onChange={(e) => setSelectedBankDestinationId(e.target.value)}
                            className="w-full px-3 py-3 rounded-[10px] text-[16px] bg-white/[0.08] text-white placeholder:text-white/35 focus:outline-none"
                          >
                            {bankDestinations.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.isPrimary ? 'Primary, ' : ''}{d.bankName} (****{d.accountNumberLast4})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}

                      {selectedBankDestination ? (
                        <div className="text-sm text-white">
                          <div className="font-semibold">{selectedBankDestination.bankName}</div>
                          <div className="text-xs text-white/60">
                            {selectedBankDestination.accountName} • ****{selectedBankDestination.accountNumberLast4}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-white/60">{t('event_earnings.select_a_bank_account')}</div>
                      )}
                    </div>
                  ) : null}

                  {bankMode === 'new' ? (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-white/[0.06] p-3">
                        <p className="text-sm text-white font-medium">{t('event_earnings.verification_required')}</p>
                        <p className="text-xs text-white/60 mt-1">
                          {t('event_earnings.new_bank_needs_verification_long')}
                        </p>
                      </div>

                      <label className="flex items-center gap-2 text-sm text-white">
                        <input
                          type="checkbox"
                          checked={saveNewBankDestination}
                          onChange={(e) => setSaveNewBankDestination(e.target.checked)}
                          className="w-4 h-4"
                        />
                        {t('event_earnings.save_second_bank')}
                      </label>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">{t('event_earnings.account_holder_name')}</label>
                        <input
                          type="text"
                          value={bankDetails.accountHolder}
                          onChange={(e) => setBankDetails({ ...bankDetails, accountHolder: e.target.value })}
                          placeholder={t('event_earnings.full_name_on_account')}
                          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.08] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">{t('event_earnings.bank_name')}</label>
                        <input
                          type="text"
                          value={bankDetails.bankName}
                          onChange={(e) => setBankDetails({ ...bankDetails, bankName: e.target.value })}
                          placeholder="e.g., Unibank"
                          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.08] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">{t('event_earnings.account_number')}</label>
                        <input
                          type="text"
                          value={bankDetails.accountNumber}
                          onChange={(e) => setBankDetails({ ...bankDetails, accountNumber: e.target.value })}
                          placeholder={t('event_earnings.account_number_placeholder')}
                          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.08] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">{t('event_earnings.routing_number_optional')}</label>
                        <input
                          type="text"
                          value={bankDetails.routingNumber}
                          onChange={(e) => setBankDetails({ ...bankDetails, routingNumber: e.target.value })}
                          placeholder={t('event_earnings.for_international_transfers')}
                          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.08] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">{t('event_earnings.swift_code_optional')}</label>
                        <input
                          type="text"
                          value={bankDetails.swiftCode}
                          onChange={(e) => setBankDetails({ ...bankDetails, swiftCode: e.target.value })}
                          placeholder={t('event_earnings.for_international_transfers')}
                          className="w-full px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.08] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                        />
                      </div>
                    </div>
                  ) : null}

                  <p className="text-sm text-white/60">
                    {t('event_earnings.bank_deposit_note')}
                  </p>
                </div>
              )}

              {payoutChangeVerificationRequired ? (
                <div className="mt-4 border border-brand-500/30 rounded-lg p-3">
                  <p className="text-sm font-semibold text-brand-300">{t('event_earnings.email_verification')}</p>
                  <p className="text-xs text-brand-300 mt-1">
                    {verificationMessage || 'For your security, confirm this change with the code we email you.'}
                  </p>

                  {debugVerificationCode ? (
                    <p className="text-xs text-brand-300 mt-2">Dev code: {debugVerificationCode}</p>
                  ) : null}

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={sendVerificationCode}
                      disabled={isSendingVerificationCode}
                      className="px-3 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium disabled:bg-brand-300"
                    >
                      {isSendingVerificationCode ? 'Sending…' : 'Send code'}
                    </button>
                    <input
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      placeholder="6-digit code"
                      className="flex-1 px-3 py-2 border border-brand-500/30 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={verifyCode}
                      disabled={isVerifyingVerificationCode || !/^\d{6}$/.test(verificationCode)}
                      className="px-3 py-2 bg-white/[0.03] border border-brand-400 text-brand-300 rounded-lg text-sm font-medium hover:bg-white/10 disabled:opacity-50"
                    >
                      {isVerifyingVerificationCode ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>

                  {verificationError ? (
                    <div className="mt-2 text-sm text-red-300">{verificationError}</div>
                  ) : null}
                </div>
              ) : null}

              {error && (
                <div className="border border-red-500/30 rounded-lg p-3 mt-4">
                  <p className="text-red-300 text-sm">❌ {error}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={submitWithdrawal}
                disabled={
                  isSubmitting ||
                  (withdrawMethod === 'moncash' && !moncashNumber) ||
                  (withdrawMethod === 'bank' &&
                    ((bankMode === 'new' && (!bankDetails.accountHolder || !bankDetails.bankName || !bankDetails.accountNumber)) ||
                      (bankMode !== 'new' && !selectedBankDestinationId)))
                }
                className="flex-1 px-4 py-3 bg-brand-700 text-white rounded-lg hover:bg-brand-800 transition-colors font-medium disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : 'Confirm Withdrawal'}
              </button>
              <button
                onClick={() => {
                  setShowWithdrawModal(false)
                  setError(null)
                  setPayoutChangeVerificationRequired(false)
                  setPendingEndpoint(null)
                  setPendingPayload(null)
                  setVerificationCode('')
                  setVerificationMessage(null)
                  setVerificationError(null)
                  setDebugVerificationCode(null)
                  setMoncashNumber('')
                  setBankDetails({
                    accountNumber: '',
                    bankName: '',
                    accountHolder: '',
                    swiftCode: '',
                    routingNumber: ''
                  })
                }}
                disabled={isSubmitting}
                className="px-4 py-3 rounded-[10px] bg-white/[0.08] text-white/80 hover:bg-white/10 transition-colors font-medium disabled:cursor-not-allowed"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
