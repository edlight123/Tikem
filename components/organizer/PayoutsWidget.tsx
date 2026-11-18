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
          iconBg: 'bg-surface',
          iconColor: 'text-danger-soft',
          title: t('payouts.not_setup_title'),
          description: t('payouts.not_setup_description'),
          ctaText: t('payouts.setup_payouts'),
          ctaHref: '/organizer/settings/payouts',
          ctaColor: 'bg-inverse text-on-inverse hover:bg-inverse-hover'
        }
      case 'setup':
        return {
          icon: <CheckCircle className="w-5 h-5" />,
          iconBg: 'bg-surface',
          iconColor: 'text-success-soft',
          title: t('payouts.ready_title'),
          description: t('payouts.ready_description'),
          ctaText: t('payouts.view_settings'),
          ctaHref: '/organizer/settings/payouts',
          ctaColor: 'bg-surface-raised text-fg hover:bg-surface-high'
        }
      case 'pending':
        return {
          icon: <Clock className="w-5 h-5" />,
          iconBg: 'bg-surface',
          iconColor: 'text-warning-soft',
          title: t('payouts.pending_title'),
          description: t('payouts.pending_description'),
          ctaText: t('payouts.view_details'),
          ctaHref: '/organizer/settings/payouts',
          ctaColor: 'bg-surface-raised text-fg hover:bg-surface-high'
        }
      case 'active':
        return {
          icon: <DollarSign className="w-5 h-5" />,
          iconBg: 'bg-surface',
          iconColor: 'text-fg',
          title: t('payouts.active_title'),
          description: t('payouts.active_description'),
          ctaText: t('payouts.view_history'),
          ctaHref: '/organizer/settings/payouts/history',
          ctaColor: 'bg-surface-raised text-fg hover:bg-surface-high'
        }
    }
  }

  const statusInfo = getStatusInfo()

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-soft">
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-12 h-12 ${statusInfo.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <div className={statusInfo.iconColor}>
            {statusInfo.icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display lowercase italic !text-section !leading-snug text-fg mb-0.5">{statusInfo.title}</h3>
          <p className="text-sm text-fg-muted">{statusInfo.description}</p>
        </div>
      </div>

      {/* Payout Details */}
      {status !== 'not-setup' && (
        <div className="space-y-4 mb-6">
          {/* Pending Balance */}
          <div className="rounded-xl bg-surface p-4">
            <p className="label-mono text-xs uppercase mb-1">{t('payouts.pending_balance')}</p>
            <p className="text-2xl font-bold text-fg font-mono tabular-nums">
              {formatMoneyFromCents(pendingBalance, currency)}
            </p>
          </div>

          {/* Last Payout */}
          {lastPayout && (
            <div className="flex items-center justify-between py-2 border-b border-line-soft">
              <div>
                <p className="text-sm font-semibold text-fg">{t('payouts.last_payout')}</p>
                <p className="text-xs text-fg-muted font-mono tabular-nums">
                  {new Date(lastPayout.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
              <p className="text-lg font-bold text-success-soft font-mono tabular-nums">
                +{formatMoneyFromCents(lastPayout.amount, currency)}
              </p>
            </div>
          )}

          {/* Next Payout Estimate */}
          {nextPayout && nextPayout.amount > 0 && (
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-semibold text-fg">{t('payouts.next_payout_est')}</p>
                <p className="text-xs text-fg-muted font-mono tabular-nums">
                  {new Date(nextPayout.estimatedDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
              <p className="text-lg font-bold text-fg font-mono tabular-nums">
                {formatMoneyFromCents(nextPayout.amount, currency)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* CTA Button */}
      <Link
        href={statusInfo.ctaHref}
        className={`block w-full rounded px-4 py-3 text-center font-semibold transition-colors ${statusInfo.ctaColor}`}
      >
        {statusInfo.ctaText}
      </Link>

      {status !== 'not-setup' && (
        <p className="text-xs text-fg-subtle text-center mt-3">
          {t('payouts.processing_time')}
        </p>
      )}
    </div>
  )
}
