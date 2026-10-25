'use client'

import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { SectionHeader } from '@/components/organizer/ui'
import { formatCurrency } from '@/lib/fees'

export interface FinancePayoutRow {
  id: string
  /** Minor units. */
  amount: number
  currency: string
  status: string
  /** 'mobile_money' | 'bank_transfer' (getPayoutHistory). Never the destination itself. */
  method: string
  createdAt: string
}

const DOT: Record<string, string> = {
  completed: 'bg-emerald-400',
  processing: 'bg-amber-300',
  pending: 'bg-amber-300',
  failed: 'bg-red-400',
  cancelled: 'bg-white/40',
}

function asCode(c: string): 'HTG' | 'USD' | 'CAD' | 'EUR' {
  return c === 'USD' || c === 'CAD' || c === 'EUR' ? c : 'HTG'
}

/**
 * The org's recent payouts, read-only: amount, how, when, state. Shown on the
 * finance page to the owner and to admins the owner granted read-only
 * finances (the export is the same /api/organizer/export-payouts CSV, gated by
 * requireFinanceView). No destination details ever reach this component.
 */
export default function FinancePayoutHistory({ payouts }: { payouts: FinancePayoutRow[] }) {
  const { t, i18n } = useTranslation('organizer')

  return (
    <section className="mt-10">
      <SectionHeader
        title={t('finance_view.payout_history_title')}
        description={t('finance_view.payout_history_desc')}
        actions={
          payouts.length > 0 ? (
            <a
              href="/api/organizer/export-payouts?format=csv"
              className="inline-flex h-10 items-center gap-2 rounded bg-white/[0.08] px-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t('finance_view.export_csv')}
            </a>
          ) : null
        }
      />
      <div className="mt-4 overflow-hidden rounded bg-white/[0.055]">
        {payouts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-white/50">{t('finance_view.payout_history_empty')}</p>
        ) : (
          payouts.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${i > 0 ? 'border-t border-white/[0.06]' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {p.method === 'bank_transfer' ? t('finance_view.method_bank') : t('finance_view.method_moncash')}
                </p>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-white/45">
                  {new Date(p.createdAt).toLocaleDateString(i18n.language || undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold tabular-nums text-white">
                  {formatCurrency(p.amount, asCode(p.currency))}
                </p>
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-white/55">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[p.status] || 'bg-white/40'}`} aria-hidden />
                  {t(`finance_view.status_${p.status}`, { defaultValue: p.status })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
