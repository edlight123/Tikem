'use client'

import { useTranslation } from 'react-i18next'

import { useMemo, useState } from 'react'
import { format, isValid } from 'date-fns'
import { ShoppingBag } from 'lucide-react'
import {
  OrgDataTable,
  OrgEmptyState,
  SearchInput,
  StatusChip,
  statusTone,
  TableToolbar,
} from '@/components/organizer/ui'
import type { OrgColumn } from '@/components/organizer/ui'
import { EMPTY_VALUE } from '@/lib/format'

interface Order {
  id: string
  attendeeName: string
  attendeeEmail: string
  tierName: string
  amount: string
  status: string
  purchasedAt: string
  checkedInAt: string
}

const COLUMNS: OrgColumn<Order>[] = [
  {
    key: 'attendee',
    header: 'Attendee',
    sortable: true,
    sortAccessor: (o) => o.attendeeName,
    render: (o) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">{o.attendeeName}</p>
        {o.attendeeEmail && (
          <p className="truncate text-xs text-fg-muted">{o.attendeeEmail}</p>
        )}
      </div>
    ),
  },
  {
    key: 'tierName',
    header: 'Tier',
    hideOnMobile: true,
    render: (o) => <span className="text-fg-muted">{o.tierName}</span>,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    render: (o) => (
      <span className="font-mono font-semibold tabular-nums text-fg">{o.amount}</span>
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
        <span className="font-mono tabular-nums text-fg-muted">
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

export default function EventOrdersClient({ orders }: { orders: Order[] }) {
  const { t } = useTranslation('organizer')

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(
      (o) =>
        o.attendeeName.toLowerCase().includes(q) ||
        o.attendeeEmail.toLowerCase().includes(q) ||
        o.tierName.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
    )
  }, [orders, query])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <OrgDataTable
        columns={COLUMNS}
        rows={filtered}
        rowKey={(o) => o.id}
        toolbar={
          <TableToolbar>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t('orders.search_orders_tier')}
              className="w-full sm:max-w-xs"
            />
          </TableToolbar>
        }
        empty={
          <OrgEmptyState
            variant="quiet"
            icon={ShoppingBag}
            title={orders.length === 0 ? t('orders.no_orders_yet') : t('orders.no_orders_match')}
          />
        }
        renderMobileCard={(o) => {
          const d = new Date(o.purchasedAt)
          return (
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate font-medium text-fg">{o.attendeeName}</p>
                <StatusChip tone={statusTone(o.status)}>
                  {o.status.replace(/_/g, ' ')}
                </StatusChip>
              </div>
              <p className="mt-0.5 truncate text-xs text-fg-muted">{o.attendeeEmail}</p>
              <div className="mt-2 flex items-center gap-3 text-sm">
                <span className="font-mono font-semibold text-fg tabular-nums">{o.amount}</span>
                <span className="text-fg-muted">{o.tierName}</span>
                <span className="ml-auto font-mono tabular-nums text-fg-muted">
                  {isValid(d) ? format(d, 'MMM d') : EMPTY_VALUE}
                </span>
              </div>
            </div>
          )
        }}
      />
    </div>
  )
}
