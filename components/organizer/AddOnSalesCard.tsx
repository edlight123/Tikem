'use client'

/**
 * Organizer dashboard: add-on sales (lib/addons/addOns.ts) — sold, picked up
 * and face revenue per add-on and option, from GET /api/organizer/events/[id]/add-ons.
 * Renders nothing for an event that sells no add-ons, and for a team member
 * without the finance permission (the route answers 403 no_finance).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoneyFromCents } from '@/lib/money'

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
  const money = (n: number) => formatMoneyFromCents(Math.round(n * 100), summary.currency)

  return (
    <section className="rounded-lg bg-surface-low p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base lowercase italic leading-none text-fg">
          {t('addOns.dashboard.title', { defaultValue: 'Add-on sales' })}
        </h3>
        <span className="text-caption tabular-nums text-fg-subtle">{money(summary.totalRevenue)}</span>
      </div>
      {summary.rows.length === 0 ? (
        <p className="py-2 text-meta text-fg-subtle">{t('addOns.dashboard.none', { defaultValue: 'No add-ons sold yet.' })}</p>
      ) : (
        <>
          <ul>
            {summary.rows.map((r) => (
              <li key={`${r.id}-${r.option ?? ''}`} className="flex min-h-10 items-center justify-between gap-3 text-meta">
                <span className="min-w-0 truncate text-fg">
                  {r.name}
                  {r.option ? <span className="text-fg-subtle"> · {r.option}</span> : null}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-fg-muted">
                  {t('addOns.dashboard.soldPicked', {
                    defaultValue: '{{sold}} sold · {{picked}} picked up',
                    sold: r.sold,
                    picked: r.pickedUp,
                  })}{' '}
                  · {money(r.revenue)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-caption text-fg-subtle">
            {t('addOns.dashboard.totals', {
              defaultValue: '{{sold}} sold in total, {{picked}} picked up',
              sold: summary.totalSold,
              picked: summary.totalPickedUp,
            })}
          </p>
        </>
      )}
    </section>
  )
}
