'use client'

import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/Toast'
import { ExportButtons } from '@/components/exports/ExportButtons'
import { downloadExport } from '@/lib/exports/download'
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
  completed: 'bg-success',
  processing: 'bg-warning-soft',
  pending: 'bg-warning-soft',
  failed: 'bg-danger',
  cancelled: 'bg-fg/40',
}

function asCode(c: string): 'HTG' | 'USD' | 'CAD' | 'EUR' {
  return c === 'USD' || c === 'CAD' || c === 'EUR' ? c : 'HTG'
}

/**
 * The org's recent payouts, read-only: amount, how, when, state. Shown on the
 * finance page to the owner and to admins the owner granted read-only
 * finances (the export is /api/organizer/export-payouts, Excel or PDF, gated by
 * requireFinanceView). No destination details ever reach this component.
 */
export default function FinancePayoutHistory({ payouts }: { payouts: FinancePayoutRow[] }) {
  const { t, i18n } = useTranslation('organizer')
  const { showToast } = useToast()

  return (
    <section className="mt-10">
      <SectionHeader
        title={t('finance_view.payout_history_title')}
        description={t('finance_view.payout_history_desc')}
        actions={
          payouts.length > 0 ? (
            <ExportButtons
              size="sm"
              onExport={(format) =>
                downloadExport(
                  `/api/organizer/export-payouts?format=${format}&lang=${encodeURIComponent((i18n.language || 'en').slice(0, 2))}`,
                  undefined,
                  `Tikem payouts.${format}`
                )
              }
              labels={{ pdf: t('exports.pdf'), excel: t('exports.excel'), group: t('finance_view.payout_history_title') }}
              onError={(e: any) => showToast({ type: 'error', title: t('exports.failed'), message: e?.message || '' })}
            />
          ) : null
        }
      />
      <div className="mt-4 overflow-hidden rounded bg-surface">
        {payouts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-fg-subtle">{t('finance_view.payout_history_empty')}</p>
        ) : (
          payouts.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${i > 0 ? 'border-t border-line-soft' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  {p.method === 'bank_transfer' ? t('finance_view.method_bank') : p.method === 'balance_offset' ? t('finance_view.method_balance_offset') : t('finance_view.method_moncash')}
                </p>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-fg-subtle">
                  {new Date(p.createdAt).toLocaleDateString(i18n.language || undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold tabular-nums text-fg">
                  {formatCurrency(p.amount, asCode(p.currency))}
                </p>
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[p.status] || 'bg-fg/40'}`} aria-hidden />
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
