'use client'

import { useTranslation } from 'react-i18next'

import {
  CheckCircle,
  Clock,
  AlertCircle,
  Building2,
  Smartphone,
  CreditCard,
  Settings,
  Wallet,
  TrendingUp,
  Plus,
  History,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { StatusChip } from '@/components/ui/kit'

interface PayoutMethod {
  type: 'bank_transfer' | 'mobile_money' | 'stripe'
  status: 'active' | 'pending' | 'needs_attention'
  details: {
    name: string
    maskedNumber?: string
    provider?: string
    bankName?: string
  }
  verificationStatus?: {
    identity?: 'pending' | 'verified' | 'failed'
    bank?: 'pending' | 'verified' | 'failed'
    phone?: 'pending' | 'verified' | 'failed'
  }
}

interface PayoutsSummaryDashboardProps {
  organizerId: string
  haitiMethod?: PayoutMethod | null
  stripeMethod?: PayoutMethod | null
  upcomingPayout?: {
    amount: number
    currency: string
    date: string
    eventCount: number
  } | null
  totalEarnings?: number
  currency?: string
  onEdit: (profile: 'haiti' | 'stripe_connect') => void
  onSetupNew: () => void
}

export default function PayoutsSummaryDashboard({
  organizerId,
  haitiMethod,
  stripeMethod,
  onEdit,
  onSetupNew,
}: PayoutsSummaryDashboardProps) {
  const { t } = useTranslation('organizer')

  const hasAnyMethod = Boolean(haitiMethod || stripeMethod)

  // Overall account status, derived from the configured methods. This replaces the
  // previous hardcoded "Next payout"/"Total earnings: $0" cards which were always
  // empty (the wrapper never fetched those numbers) and looked broken.
  const overallStatus: 'none' | 'active' | 'pending' | 'needs_attention' = (() => {
    if (!hasAnyMethod) return 'none'
    const statuses = [haitiMethod?.status, stripeMethod?.status].filter(Boolean) as string[]
    if (statuses.includes('needs_attention')) return 'needs_attention'
    if (statuses.includes('pending')) return 'pending'
    return 'active'
  })()

  // Withdrawals need an ACTIVE profile: method saved + identity verified. A
  // saved method waiting on identity is the common case, so name it plainly
  // and link straight to /organizer/verify instead of a vague "in progress".
  const identityStatus = (haitiMethod || stripeMethod)?.verificationStatus?.identity
  const needsIdentity =
    overallStatus !== 'none' && overallStatus !== 'active' && identityStatus !== 'verified'

  const statusHero = {
    none: {
      icon: <Wallet className="h-7 w-7" />,
      ring: 'bg-brand-500/10 border-brand-500/30',
      chip: 'text-brand-300',
      title: 'Set up payouts to get paid',
      description: 'Add a payout method to start receiving earnings from your ticket sales. It only takes a few minutes.',
    },
    active: {
      icon: <CheckCircle className="h-7 w-7" />,
      ring: 'bg-emerald-500/10 border-emerald-500/30',
      chip: 'text-emerald-300',
      title: 'Your payouts are ready',
      description: 'Your payout method is set up and verified. Earnings are paid out according to your schedule.',
    },
    pending: {
      icon: <Clock className="h-7 w-7" />,
      ring: 'bg-amber-500/10 border-amber-500/30',
      chip: 'text-amber-300',
      title: 'Verification in progress',
      description: 'We’re reviewing your payout details. This usually takes 1–2 business days, we’ll notify you once it’s approved.',
    },
    needs_attention: {
      icon: <AlertCircle className="h-7 w-7" />,
      ring: 'bg-red-500/10 border-red-500/30',
      chip: 'text-red-300',
      title: 'Action needed on your payouts',
      description: 'One of your payout methods needs attention before you can receive funds. Open it below to resolve.',
    },
  }[overallStatus]

  if (needsIdentity) {
    statusHero.title = t('verify_to_withdraw.title', { defaultValue: 'Verify your identity to withdraw' })
    statusHero.description =
      identityStatus === 'failed'
        ? t('verify_to_withdraw.body_failed', { defaultValue: 'We couldn’t verify your identity. Resubmit it to start withdrawing. Our team reviews it usually within 1–2 business days.' })
        : t('verify_to_withdraw.body', { defaultValue: 'Your payout method is saved. Withdrawals open once your identity is verified. Our team reviews it usually within 1–2 business days.' })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
      case 'verified':
        return <StatusChip tone="success" icon={CheckCircle}>{t('payouts_summary.active')}</StatusChip>
      case 'pending':
        return <StatusChip tone="warning" icon={Clock}>{t('payouts_summary.pending')}</StatusChip>
      case 'needs_attention':
      case 'failed':
        return <StatusChip tone="danger" icon={AlertCircle}>{t('payouts_summary.needs_attention')}</StatusChip>
      default:
        return null
    }
  }

  const getMethodIcon = (type: string) => {
    switch (type) {
      case 'bank_transfer':
        return <Building2 className="w-5 h-5" />
      case 'mobile_money':
        return <Smartphone className="w-5 h-5" />
      case 'stripe':
        return <CreditCard className="w-5 h-5" />
      default:
        return <Wallet className="w-5 h-5" />
    }
  }

  const renderPayoutMethod = (method: PayoutMethod, profile: 'haiti' | 'stripe_connect') => {
    const iconBgColor = 'text-brand-300'

    return (
      <div 
        key={profile}
        className="bg-white/[0.03] rounded-xl border border-white/10 p-5 transition-colors"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${iconBgColor} flex items-center justify-center`}>
              {getMethodIcon(method.type)}
            </div>
            <div>
              <h3 className="font-semibold text-white">{method.details.name}</h3>
              <p className="text-sm text-white/50">
                {method.type === 'stripe' && 'Stripe Connect'}
                {method.type === 'bank_transfer' && method.details.bankName}
                {method.type === 'mobile_money' && method.details.provider}
              </p>
            </div>
          </div>
          {getStatusBadge(method.status)}
        </div>

        {method.details.maskedNumber && (
          <div className="bg-white/[0.03] rounded-lg px-3 py-2 mb-4 font-mono text-sm text-white/60">
            {method.type === 'mobile_money' ? 'Phone: ' : 'Account: '}
            ****{method.details.maskedNumber}
          </div>
        )}

        <button
          type="button"
          onClick={() => onEdit(profile)}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
            method.status === 'needs_attention'
              ? 'border-red-500/30 text-red-300 hover:bg-red-500/20'
              : 'border-white/10 text-white/70 hover:bg-white/[0.04]'
          }`}
        >
          {method.status === 'needs_attention' ? (
            <><AlertCircle className="w-4 h-4" />{t('payouts_summary.fix_account')}</>
          ) : (
            <><Settings className="w-4 h-4" />{t('payouts_summary.manage')}</>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Account status — accurate, derived from configured methods */}
      <div className={`rounded-2xl border ${statusHero.ring} p-5 sm:p-6`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${statusHero.chip}`}>
              {statusHero.icon}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">{statusHero.title}</h2>
              <p className="mt-1 text-sm text-white/60">{statusHero.description}</p>
            </div>
          </div>
          {needsIdentity && (
            <Link
              href="/organizer/verify"
              className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-brand-800"
            >
              <ShieldCheck className="h-4 w-4" />
              {t('verify_to_withdraw.cta', { defaultValue: 'Verify your identity' })}
            </Link>
          )}
          {overallStatus === 'none' && (
            <button
              type="button"
              onClick={onSetupNew}
              className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-brand-800"
            >
              <Plus className="h-4 w-4" />
              {t('payouts_summary.set_up_payouts')}
            </button>
          )}
        </div>
      </div>

      {/* Payout Methods */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{t('payouts_summary.payout_methods')}</h2>
          {hasAnyMethod && (
            <button
              type="button"
              onClick={onSetupNew}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:text-brand-300"
            >
              <Plus className="h-4 w-4" />
              {t('payouts_summary.add_another')}
            </button>
          )}
        </div>

        {hasAnyMethod ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {haitiMethod && renderPayoutMethod(haitiMethod, 'haiti')}
            {stripeMethod && renderPayoutMethod(stripeMethod, 'stripe_connect')}
          </div>
        ) : (
          <div className="bg-white/[0.03] rounded-xl  p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-white/[0.03] flex items-center justify-center">
              <Wallet className="w-7 h-7 text-white/40" />
            </div>
            <h3 className="font-semibold text-white mb-2">{t('payouts_summary.no_payout_methods')}</h3>
            <p className="text-white/60 mb-4 max-w-sm mx-auto">
              {t('payouts_summary.set_up_payout_method')}
            </p>
            <button
              type="button"
              onClick={onSetupNew}
              className="px-6 py-2.5 bg-brand-700 text-white rounded-lg font-semibold hover:bg-brand-800 transition-all"
            >
              {t('payouts_summary.set_up_payouts_title')}
            </button>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="bg-white/[0.03] rounded-xl  p-5">
        <h3 className="font-semibold text-white mb-4">{t('payouts_summary.manage')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link
            href="/organizer/earnings"
            className="flex items-center gap-3 p-3 rounded-lg  hover:bg-white/[0.04] hover:border-white/10 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-brand-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white">{t('payouts_summary.earnings')}</div>
              <div className="text-sm text-white/50">{t('payouts_summary.balance_withdrawals')}</div>
            </div>
          </Link>

          <Link
            href="/organizer/settings/payouts/history"
            className="flex items-center gap-3 p-3 rounded-lg  hover:bg-white/[0.04] hover:border-white/10 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-white/[0.03] flex items-center justify-center flex-shrink-0">
              <History className="w-5 h-5 text-white/60" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white">{t('payouts_summary.payout_history')}</div>
              <div className="text-sm text-white/50">{t('payouts_summary.past_transfers')}</div>
            </div>
          </Link>

          <Link
            href="/organizer/settings/payouts/fees"
            className="flex items-center gap-3 p-3 rounded-lg  hover:bg-white/[0.04] hover:border-white/10 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-white/[0.03] flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-white/60" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white">{t('payouts_summary.fees_rules')}</div>
              <div className="text-sm text-white/50">{t('payouts_summary.schedule_limits')}</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
