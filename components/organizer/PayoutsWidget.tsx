'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { CreditCard, AlertCircle, CheckCircle, Clock, DollarSign } from 'lucide-react'
import { formatMoneyFromCents } from '@/lib/money'

interface PayoutsWidgetProps {
  status: 'not-setup' | 'setup' | 'pending' | 'active'
  pendingBalance?: number
  currency?: string
  lastPayout?: {
    amount: number
    date: string
  }
  nextPayout?: {
    amount: number
    estimatedDate: string
  }
}

export function PayoutsWidget({ status, pendingBalance = 0, currency = 'HTG', lastPayout, nextPayout }: PayoutsWidgetProps) {
  const { t } = useTranslation('common')
  
  const getStatusInfo = () => {
    switch (status) {
      case 'not-setup':
        return {
          icon: <AlertCircle className="w-5 h-5" />,
          iconBg: 'bg-white/[0.06]',
          iconColor: 'text-red-300',
          title: t('payouts.not_setup_title'),
          description: t('payouts.not_setup_description'),
          ctaText: t('payouts.setup_payouts'),
          ctaHref: '/organizer/settings/payouts',
          ctaColor: 'bg-white text-black hover:bg-white/90'
        }
      case 'setup':
        return {
          icon: <CheckCircle className="w-5 h-5" />,
          iconBg: 'bg-white/[0.06]',
          iconColor: 'text-emerald-300',
          title: t('payouts.ready_title'),
          description: t('payouts.ready_description'),
          ctaText: t('payouts.view_settings'),
          ctaHref: '/organizer/settings/payouts',
          ctaColor: 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
        }
      case 'pending':
        return {
          icon: <Clock className="w-5 h-5" />,
          iconBg: 'bg-white/[0.06]',
          iconColor: 'text-amber-300',
          title: t('payouts.pending_title'),
          description: t('payouts.pending_description'),
          ctaText: t('payouts.view_details'),
          ctaHref: '/organizer/settings/payouts',
          ctaColor: 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
        }
      case 'active':
        return {
          icon: <DollarSign className="w-5 h-5" />,
          iconBg: 'bg-white/[0.06]',
          iconColor: 'text-white',
          title: t('payouts.active_title'),
          description: t('payouts.active_description'),
          ctaText: t('payouts.view_history'),
          ctaHref: '/organizer/settings/payouts/history',
          ctaColor: 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
        }
    }
  }

  const statusInfo = getStatusInfo()

  return (
    <div className="rounded-2xl bg-white/[0.055] p-6 shadow-soft">
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-12 h-12 ${statusInfo.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <div className={statusInfo.iconColor}>
            {statusInfo.icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white mb-0.5">{statusInfo.title}</h3>
          <p className="text-sm text-white/60">{statusInfo.description}</p>
        </div>
      </div>

      {/* Payout Details */}
      {status !== 'not-setup' && (
        <div className="space-y-4 mb-6">
          {/* Pending Balance */}
          <div className="rounded-xl bg-white/[0.06] p-4">
            <p className="label-mono text-xs uppercase mb-1">{t('payouts.pending_balance')}</p>
            <p className="text-2xl font-bold text-white font-mono tabular-nums">
              {formatMoneyFromCents(pendingBalance, currency)}
            </p>
          </div>

          {/* Last Payout */}
          {lastPayout && (
            <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
              <div>
                <p className="text-sm font-semibold text-white">{t('payouts.last_payout')}</p>
                <p className="text-xs text-white/60 font-mono tabular-nums">
                  {new Date(lastPayout.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
              <p className="text-lg font-bold text-emerald-300 font-mono tabular-nums">
                +{formatMoneyFromCents(lastPayout.amount, currency)}
              </p>
            </div>
          )}

          {/* Next Payout Estimate */}
          {nextPayout && nextPayout.amount > 0 && (
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-semibold text-white">{t('payouts.next_payout_est')}</p>
                <p className="text-xs text-white/60 font-mono tabular-nums">
                  {new Date(nextPayout.estimatedDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
              <p className="text-lg font-bold text-white font-mono tabular-nums">
                {formatMoneyFromCents(nextPayout.amount, currency)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* CTA Button */}
      <Link
        href={statusInfo.ctaHref}
        className={`block w-full rounded-full px-4 py-3 text-center font-semibold transition-colors ${statusInfo.ctaColor}`}
      >
        {statusInfo.ctaText}
      </Link>

      {status !== 'not-setup' && (
        <p className="text-xs text-white/50 text-center mt-3">
          {t('payouts.processing_time')}
        </p>
      )}
    </div>
  )
}
