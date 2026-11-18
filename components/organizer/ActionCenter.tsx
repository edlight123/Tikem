'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { AlertCircle, FileText, TrendingUp, CreditCard, ShieldCheck } from 'lucide-react'

interface Alert {
  id: string
  type: 'draft' | 'low-sales' | 'payout' | 'verification'
  title: string
  description: string
  ctaText: string
  ctaHref: string
}

interface ActionCenterProps {
  alerts: Alert[]
}

export function ActionCenter({ alerts }: ActionCenterProps) {
  const { t } = useTranslation('common')
  
  if (alerts.length === 0) {
    return (
      <div className="rounded-2xl bg-surface-low p-6">
        <div className="flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 shrink-0 text-success-soft" />
          <div>
            <h3 className="font-display italic text-xl text-fg mb-1">{t('organizer.action_center.all_caught_up')}</h3>
            <p className="text-sm text-success-soft">{t('organizer.action_center.no_action_items')}</p>
          </div>
        </div>
      </div>
    )
  }

  const getIcon = (type: Alert['type']) => {
    switch (type) {
      case 'draft':
        return <FileText className="w-5 h-5" />
      case 'low-sales':
        return <TrendingUp className="w-5 h-5" />
      case 'payout':
        return <CreditCard className="w-5 h-5" />
      case 'verification':
        return <ShieldCheck className="w-5 h-5" />
      default:
        return <AlertCircle className="w-5 h-5" />
    }
  }

  /**
   * Every one of these used to be `bg: ''` plus a coloured hairline — four
   * outlined boxes stacked down a column with nothing inside them. The row is a
   * fill now; the colour of the icon and the CTA is what says which kind of
   * alert it is, which is where colour was already doing the work.
   */
  const getColor = (type: Alert['type']) => {
    switch (type) {
      case 'draft':
        return { bg: 'bg-surface hover:bg-surface-raised', text: 'text-fg', icon: 'text-brand-300', btn: 'bg-surface-raised text-fg hover:bg-surface-high' }
      case 'low-sales':
        return { bg: 'bg-surface hover:bg-surface-raised', text: 'text-fg', icon: 'text-warning-soft', btn: 'bg-warning-strong/15 text-warning-soft hover:bg-warning-strong/25' }
      case 'payout':
        return { bg: 'bg-surface hover:bg-surface-raised', text: 'text-fg', icon: 'text-brand-300', btn: 'bg-surface-raised text-fg hover:bg-surface-high' }
      case 'verification':
        return { bg: 'bg-surface hover:bg-surface-raised', text: 'text-fg', icon: 'text-warning-soft', btn: 'bg-warning-strong/15 text-warning-soft hover:bg-warning-strong/25' }
      default:
        return { bg: 'bg-surface hover:bg-surface-raised', text: 'text-fg', icon: 'text-fg-muted', btn: 'bg-surface-raised text-fg hover:bg-surface-high' }
    }
  }

  return (
    <div className="rounded-2xl bg-surface-low p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface">
          <AlertCircle className="w-5 h-5 text-danger-soft" />
        </div>
        <div>
          <h3 className="font-display italic text-xl text-fg">{t('organizer.action_center.title')}</h3>
          <p className="text-sm text-fg-muted">
            {alerts.length} {alerts.length !== 1 ? t('organizer.action_center.action_items_plural') : t('organizer.action_center.action_items')}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => {
          const colors = getColor(alert.type)
          return (
            <div
              key={alert.id}
              className={`${colors.bg} rounded-xl p-4 transition-colors`}
            >
              <div className="flex items-start gap-3">
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-raised ${colors.icon}`}>
                  {getIcon(alert.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-semibold ${colors.text} mb-1`}>{alert.title}</h4>
                  <p className={`text-sm ${colors.text} opacity-80 mb-3`}>{alert.description}</p>
                  <Link
                    href={alert.ctaHref}
                    className={`inline-flex items-center gap-2 px-4 py-2 ${colors.btn} rounded font-semibold transition-colors text-sm`}
                  >
                    {alert.ctaText}
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
