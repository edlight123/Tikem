'use client'

/**
 * Organizer dashboard: add-on sales (lib/addons/addOns.ts) — sold, picked up
 * and face revenue per add-on and option, from GET /api/organizer/events/[id]/add-ons.
 * Renders nothing for an event that sells no add-ons, and for a team member
 * without the finance permission (the route answers 403 no_finance).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/money'

interface Row {
  id: string
  name: string
  option: string | null
  sold: number
  pickedUp: number
  revenue: number
}

interface Summary {
  currency: string
  rows: Row[]
  totalSold: number
  totalPickedUp: number
  totalRevenue: number
  stock: Array<{ id: string; name: string; quantity: number | null }>
}

export default function AddOnSalesCard({ eventId }: { eventId: string }) {
  const { t } = useTranslation('events')
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/add-ons`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setSummary(data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [eventId])

  if (!summary || (summary.stock.length === 0 && summary.rows.length === 0)) return null
  const money = (n: number) => formatMoney(n, summary.currency)

  // Same rows as the app's sales card: the name on line one, "sold · picked
  // up" muted under it, the revenue on the right. Nothing truncates at 375px.
  const row = (key: string, name: string, sub: string, revenue: number, bold = false) => (
    <li key={key} className="flex min-h-[3.25rem] items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className={`text-body text-fg ${bold ? 'font-bold' : 'font-semibold'}`}>{name}</div>
        <div className="text-caption tabular-nums text-fg-muted">{sub}</div>
      </div>
      <div className={`shrink-0 text-body tabular-nums text-fg ${bold ? 'font-bold' : ''}`}>{money(revenue)}</div>
    </li>
  )

  return (
    <section className="rounded-lg bg-surface-low px-4 py-3">
      <h3 className="mb-1 font-display text-base lowercase italic leading-none text-fg">
        {t('addOns.dashboard.title', { defaultValue: 'Add-on sales' })}
      </h3>
      {summary.rows.length === 0 ? (
        <div className="py-2 text-meta text-fg-subtle">{t('addOns.dashboard.none', { defaultValue: 'No add-ons sold yet.' })}</div>
      ) : (
        <ul>
          {summary.rows.map((r) =>
            row(
              `${r.id}-${r.option ?? ''}`,
              r.option ? `${r.name} (${r.option})` : r.name,
              t('addOns.dashboard.soldPicked', { defaultValue: '{{sold}} sold · {{picked}} picked up', sold: r.sold, picked: r.pickedUp }),
              r.revenue
            )
          )}
          {row(
            '_total',
            t('addOns.dashboard.total', { defaultValue: 'Total' }),
            t('addOns.dashboard.soldPicked', {
              defaultValue: '{{sold}} sold · {{picked}} picked up',
              sold: summary.totalSold,
              picked: summary.totalPickedUp,
            }),
            summary.totalRevenue,
            true
          )}
        </ul>
      )}
    </section>
  )
}
