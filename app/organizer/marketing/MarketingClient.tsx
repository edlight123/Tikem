'use client'

import { useTranslation } from 'react-i18next'

import { useMemo, useState } from 'react'
import { format, isValid } from 'date-fns'
import { Users } from 'lucide-react'
import {
  PageHeader,
  SearchInput,
  OrgDataTable,
  OrgEmptyState,
  TableToolbar,
} from '@/components/organizer/ui'
import type { OrgColumn } from '@/components/organizer/ui'
import { EMPTY_VALUE } from '@/lib/format'

interface Attendee {
  id: string
  name: string
  email: string
  phone: string
  ticketCount: number
  spendByCurrency: Record<string, number>
  lastPurchase: string
}

function spendLabel(spend: Record<string, number>) {
  const entries = Object.entries(spend).filter(([, v]) => v > 0)
  if (entries.length === 0) return EMPTY_VALUE
  return entries.map(([cur, v]) => `${cur} ${Number(v).toLocaleString()}`).join(' · ')
}

const COLUMNS: OrgColumn<Attendee>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    render: (a) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{a.name || EMPTY_VALUE}</p>
        <p className="truncate text-xs text-white/45">{a.email || a.phone || ''}</p>
      </div>
    ),
  },
  {
    key: 'contact',
    header: 'Contact',
    hideOnMobile: true,
    render: (a) => (
      <span className="truncate text-white/60">{a.email || a.phone || EMPTY_VALUE}</span>
    ),
  },
  {
    key: 'ticketCount',
    header: 'Tickets',
    align: 'right',
    sortable: true,
    sortAccessor: (a) => a.ticketCount,
    render: (a) => (
      <span className="font-mono font-semibold tabular-nums text-white">{a.ticketCount}</span>
    ),
  },
  {
    key: 'spend',
    header: 'Total spend',
    align: 'right',
    hideOnMobile: true,
    render: (a) => (
      <span className="font-mono tabular-nums text-white/70">{spendLabel(a.spendByCurrency)}</span>
    ),
  },
  {
    key: 'lastPurchase',
    header: 'Last purchase',
    align: 'right',
    sortable: true,
    sortAccessor: (a) => new Date(a.lastPurchase),
    render: (a) => {
      const d = new Date(a.lastPurchase)
      return (
        <span className="font-mono tabular-nums text-white/55">{isValid(d) ? format(d, 'MMM d, yyyy') : EMPTY_VALUE}</span>
      )
    },
  },
]

export default function MarketingClient({ attendees }: { attendees: Attendee[] }) {
  const { t } = useTranslation('organizer')

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return attendees
    return attendees.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.toLowerCase().includes(q)
    )
  }, [attendees, query])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 md:py-10">
      <PageHeader
        eyebrow="Marketing"
        title={t('actions.attendees')}
        subtitle={t('marketing.everyone_bought_ticket')}
        actions={
          attendees.length > 0 ? (
            <span className="rounded-full bg-white/[0.055] px-3.5 py-2 text-sm text-white/70">
              <span className="font-mono tabular-nums">{attendees.length}</span> {attendees.length === 1 ? 'attendee' : 'attendees'}
            </span>
          ) : undefined
        }
      />

      <div className="mt-8">
        <OrgDataTable
          columns={COLUMNS}
          rows={filtered}
          rowKey={(a) => a.id}
          toolbar={
            <TableToolbar>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('marketing.search_name_email_phone')}
                className="w-full sm:max-w-xs"
              />
            </TableToolbar>
          }
          empty={
            <OrgEmptyState
              icon={Users}
              title={
                attendees.length === 0
                  ? 'No attendees yet'
                  : 'No attendees match your search'
              }
              description={
                attendees.length === 0
                  ? 'Once you begin selling tickets, attendee information will appear here.'
                  : 'Try a different name, email, or phone number.'
              }
            />
          }
          renderMobileCard={(a) => {
            const d = new Date(a.lastPurchase)
            return (
              <div className="px-4 py-3.5">
                <p className="truncate font-medium text-white">{a.name}</p>
                <p className="truncate text-xs text-white/45">{a.email || a.phone || EMPTY_VALUE}</p>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  <span className="text-white/60">
                    <span className="font-mono tabular-nums">{a.ticketCount}</span> ticket{a.ticketCount !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono tabular-nums text-white/40">{spendLabel(a.spendByCurrency)}</span>
                  <span className="ml-auto font-mono tabular-nums text-white/40">
                    {isValid(d) ? format(d, 'MMM d') : EMPTY_VALUE}
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
