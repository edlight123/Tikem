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
      <div className="rounded-2xl bg-white/[0.03] p-6">
        <div className="flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 shrink-0 text-emerald-300" />
          <div>
            <h3 className="font-display text-xl text-white mb-1">{t('organizer.action_center.all_caught_up')}</h3>
            <p className="text-sm text-emerald-300">{t('organizer.action_center.no_action_items')}</p>
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
        return { bg: 'bg-white/[0.055] hover:bg-white/[0.08]', text: 'text-white', icon: 'text-brand-300', btn: 'bg-white/[0.07] text-white hover:bg-white/[0.12]' }
      case 'low-sales':
        return { bg: 'bg-white/[0.055] hover:bg-white/[0.08]', text: 'text-white', icon: 'text-amber-300', btn: 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25' }
      case 'payout':
        return { bg: 'bg-white/[0.055] hover:bg-white/[0.08]', text: 'text-white', icon: 'text-brand-300', btn: 'bg-white/[0.07] text-white hover:bg-white/[0.12]' }
      case 'verification':
        return { bg: 'bg-white/[0.055] hover:bg-white/[0.08]', text: 'text-white', icon: 'text-amber-300', btn: 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25' }
      default:
        return { bg: 'bg-white/[0.055] hover:bg-white/[0.08]', text: 'text-white', icon: 'text-white/60', btn: 'bg-white/[0.07] text-white hover:bg-white/[0.12]' }
    }
  }

  return (
    <div className="rounded-2xl bg-white/[0.03] p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
          <AlertCircle className="w-5 h-5 text-red-300" />
        </div>
        <div>
          <h3 className="font-display text-xl text-white">{t('organizer.action_center.title')}</h3>
          <p className="text-sm text-white/60">
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
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.08] ${colors.icon}`}>
                  {getIcon(alert.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-semibold ${colors.text} mb-1`}>{alert.title}</h4>
                  <p className={`text-sm ${colors.text} opacity-80 mb-3`}>{alert.description}</p>
                  <Link
                    href={alert.ctaHref}
                    className={`inline-flex items-center gap-2 px-4 py-2 ${colors.btn} rounded-full font-semibold transition-colors text-sm`}
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
