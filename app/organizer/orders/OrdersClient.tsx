'use client'

import { useTranslation } from 'react-i18next'

import { useMemo, useState } from 'react'
import { format, isValid } from 'date-fns'
import { ShoppingBag } from 'lucide-react'
import {
  PageHeader,
  SearchInput,
  OrgDataTable,
  OrgEmptyState,
  StatusChip,
  statusTone,
  TableToolbar,
} from '@/components/organizer/ui'
import type { OrgColumn } from '@/components/organizer/ui'
import { EMPTY_VALUE } from '@/lib/format'

interface Order {
  id: string
  eventTitle: string
  attendeeName: string
  attendeeEmail: string
  amount: number
  currency: string
  status: string
  purchasedAt: string
}

function money(amount: number, currency: string) {
  if (!amount) return 'Free'
  return `${currency} ${Number(amount).toLocaleString()}`
}

const COLUMNS: OrgColumn<Order>[] = [
  {
    key: 'attendee',
    header: 'Attendee',
    sortable: true,
    sortAccessor: (o) => o.attendeeName,
    render: (o) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{o.attendeeName || EMPTY_VALUE}</p>
        {o.attendeeEmail && (
          <p className="truncate text-xs text-white/45">{o.attendeeEmail}</p>
        )}
      </div>
    ),
  },
  {
    key: 'eventTitle',
    header: 'Event',
    sortable: true,
    hideOnMobile: true,
    render: (o) => (
      <span className="truncate font-display italic text-white/70">{o.eventTitle}</span>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    sortable: true,
    sortAccessor: (o) => o.amount,
    render: (o) => (
      <span className="font-mono font-semibold tabular-nums text-white">
        {money(o.amount, o.currency)}
      </span>
    ),
  },
  {
    key: 'purchasedAt',
    header: 'Date',
    sortable: true,
    sortAccessor: (o) => new Date(o.purchasedAt),
    hideOnMobile: true,
    render: (o) => {
      const d = new Date(o.purchasedAt)
      return (
        <span className="font-mono tabular-nums text-white/55">
          {isValid(d) ? format(d, 'MMM d, yyyy') : EMPTY_VALUE}
        </span>
      )
    },
  },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (o) => (
      <StatusChip tone={statusTone(o.status)}>
        {o.status.replace(/_/g, ' ')}
      </StatusChip>
    ),
  },
]

export default function OrdersClient({ orders }: { orders: Order[] }) {
  const { t } = useTranslation('organizer')

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(
      (o) =>
        o.eventTitle.toLowerCase().includes(q) ||
        o.attendeeName.toLowerCase().includes(q) ||
        o.attendeeEmail.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
    )
  }, [orders, query])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 md:py-10">
      <PageHeader
        eyebrow="Finance"
        title={t('orders.orders')}
        subtitle={t('orders.every_ticket_sold')}
        actions={
          orders.length > 0 ? (
            <span className="rounded bg-white/[0.055] px-3.5 py-2 text-sm text-white/70">
              <span className="font-mono tabular-nums">{orders.length}</span> order{orders.length !== 1 ? 's' : ''}
            </span>
          ) : undefined
        }
      />

      <div className="mt-8">
        <OrgDataTable
          columns={COLUMNS}
          rows={filtered}
          rowKey={(o) => o.id}
          toolbar={
            <TableToolbar>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('orders.search_orders')}
                className="w-full sm:max-w-xs"
              />
            </TableToolbar>
          }
          empty={
            <OrgEmptyState
              icon={ShoppingBag}
              title={
                orders.length === 0
                  ? 'No orders yet'
                  : 'No orders match your search'
              }
              description={
                orders.length === 0
                  ? "Orders will appear here as you sell tickets."
                  : 'Try a different event name, attendee, or order number.'
              }
            />
          }
          renderMobileCard={(o) => {
            const d = new Date(o.purchasedAt)
            return (
              <div className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate font-medium text-white">{o.attendeeName || EMPTY_VALUE}</p>
                  <StatusChip tone={statusTone(o.status)}>
                    {o.status.replace(/_/g, ' ')}
                  </StatusChip>
                </div>
                <p className="mt-0.5 truncate font-display italic text-xs text-white/45">{o.eventTitle}</p>
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {money(o.amount, o.currency)}
                  </span>
                  <span className="font-mono tabular-nums text-white/40">
                    {isValid(d) ? format(d, 'MMM d, yyyy') : EMPTY_VALUE}
                  </span>
                </div>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
