'use client'

import { ChevronRight, CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { StatusChip } from '@/components/ui/kit'

/**
 * The payout-history table.
 *
 * Split out of page.tsx so it can be a CLIENT component and therefore call
 * useTranslation. It was already written as a presentational function taking
 * `payouts` — it just shared a file with the server page, which made it a server
 * component by association and left its column headers and empty state in
 * English.
 */
export interface PayoutHistoryItem {
  id: string
  date: string
  amount: number
  status: 'completed' | 'processing' | 'failed' | 'cancelled'
  eventCount: number
  method: string
}

export default function PayoutHistoryClient({ payouts }: { payouts: PayoutHistoryItem[] }) {
  const { t } = useTranslation('organizer')

  const formatCurrency = (amount: number) => {
    const normalized = amount / 100
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(normalized)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getStatusBadge = (status: PayoutHistoryItem['status']) => {
    const tone = {
      completed: 'success',
      processing: 'warning',
      failed: 'danger',
      cancelled: 'neutral'
    } as const

    const icons = {
      completed: CheckCircle,
      processing: Clock,
      failed: XCircle,
      cancelled: AlertCircle
    }

    const labels = {
      completed: t('payout_history.paid'),
      processing: t('payout_history.processing'),
      failed: t('payout_history.failed'),
      cancelled: t('payout_history.cancelled')
    }

    return (
      <StatusChip tone={tone[status]} icon={icons[status]}>
        {labels[status]}
      </StatusChip>
    )
  }

  return (
    <div className="bg-[#0a0a0a]">
      {/* Header */}
      <div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
            <Link href="/organizer/settings" className="hover:text-white">
              {t('actions.settings')}
            </Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/organizer/settings/payouts" className="hover:text-white">
              {t('actions.payouts')}
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white font-medium">{t('payout_history.payout_history')}</span>
          </div>

          {/* Title */}
          <h1 className="font-display lowercase italic !text-[clamp(28px,4vw,40px)] !leading-[1.04] text-white mb-2">
            {t('payout_history.payout_history')}
          </h1>
          <p className="text-white/60">
            {t('payout_history.view_all_payouts')}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-2xl bg-white/[0.055] overflow-hidden">
          
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-white/[0.06]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-white/50 uppercase tracking-wider">
                    {t('actions.amount')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                    {t('actions.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                    {t('actions.events')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                    {t('actions.method')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {payouts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-white/50">
                      <div className="flex flex-col items-center gap-2">
                        <AlertCircle className="w-12 h-12 text-white/50" />
                        <p>{t('payout_history.no_history_yet')}</p>
                        <p className="text-sm">
                          {t('payout_history.payouts_appear_after')}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  payouts.map((payout) => (
                    <tr
                      key={payout.id}
                      className="hover:bg-white/[0.04]"
                    >
                      <td className="px-6 py-4 text-sm text-white">
                        {formatDate(payout.date)}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-white text-right">
                        {formatCurrency(payout.amount)}
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(payout.status)}
                      </td>
                      <td className="px-6 py-4 text-sm text-white/60">
                        {payout.eventCount} {payout.eventCount === 1 ? 'event' : 'events'}
                      </td>
                      <td className="px-6 py-4 text-sm text-white/60 capitalize">
                        {payout.method}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {payouts.length === 0 ? (
              <div className="px-6 py-12 text-center text-white/50">
                <div className="flex flex-col items-center gap-2">
                  <AlertCircle className="w-12 h-12 text-white/50" />
                  <p>{t('payout_history.no_history_yet')}</p>
                  <p className="text-sm">
                    {t('payout_history.payouts_appear_after')}
                  </p>
                </div>
              </div>
            ) : (
              payouts.map((payout) => (
                <div
                  key={payout.id}
                  className="w-full p-6 text-left hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-sm text-white/50">
                      {formatDate(payout.date)}
                    </div>
                    {getStatusBadge(payout.status)}
                  </div>
                  <div className="text-lg font-semibold text-white mb-2">
                    {formatCurrency(payout.amount)}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-white/60">
                    <span>{payout.eventCount} {payout.eventCount === 1 ? 'event' : 'events'}</span>
                    <span>·</span>
                    <span className="capitalize">{payout.method}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Back Link */}
        <div className="pt-6">
          <Link
            href="/organizer/settings/payouts"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-300 hover:text-brand-300"
          >
            ← Back to Payouts
          </Link>
        </div>
      </div>
    </div>
  )
}

