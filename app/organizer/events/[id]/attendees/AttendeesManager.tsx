'use client'

import { useTranslation } from 'react-i18next'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Mail, User, CreditCard, Calendar, Check, AlertCircle, QrCode, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { formatMoneyFromCents, normalizeCurrency } from '@/lib/money'
import { useToast } from '@/components/ui/Toast'
import {
  SearchInput,
  FilterBar,
  FilterChip,
  OrgDataTable,
  OrgEmptyState,
  Drawer,
  StatusChip,
} from '@/components/organizer/ui'
import type { OrgColumn } from '@/components/organizer/ui'
import { toCsv } from '@/lib/csv'

interface Ticket {
  id: string
  qr_code_data: string
  status: string
  attendee_id: string
  event_id: string
  ticket_tier_id?: string
  price_paid: number
  currency?: string | null
  quantity: number
  checked_in_at?: string | null
  purchased_at: string
  attendee?: {
    id: string
    full_name?: string
    email?: string
    phone_number?: string
  } | null
}

interface AttendeesManagerProps {
  eventId: string
  eventTitle: string
  tickets: Ticket[]
  ticketsError?: boolean
}

type FilterStatus = 'all' | 'checked-in' | 'not-checked-in' | 'cancelled'

const STATUS_FILTERS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'checked-in', label: 'Checked In' },
  { value: 'not-checked-in', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
]

// Built per render rather than defined once: the status cells are translated,
// and a module-level constant has no hook to read them from.
const buildColumns = (tx: (k: string) => string): OrgColumn<Ticket>[] => [
  {
    key: 'attendee',
    header: 'Attendee',
    sortable: true,
    sortAccessor: (t: Ticket) => t.attendee?.full_name || '',
    render: (t: Ticket) => (
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.08]">
          <User className="h-4 w-4 text-brand-300" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{t.attendee?.full_name || 'Unknown'}</p>
          <p className="truncate text-xs text-white/70 sm:hidden">{t.attendee?.email || ''}</p>
        </div>
      </div>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    sortable: true,
    sortAccessor: (t: Ticket) => t.attendee?.email || '',
    render: (t: Ticket) => (
      <span className="text-sm text-white/70">{t.attendee?.email || ', '}</span>
    ),
    cellClassName: 'hidden sm:table-cell',
    headerClassName: 'hidden sm:table-cell',
  },
  {
    key: 'status',
    header: 'Status',
    render: (t: Ticket) => {
      if (t.checked_in_at) {
        return (
          <div>
            <StatusChip tone="success">{tx('attendees.checked_in')}</StatusChip>
            <p className="mt-0.5 font-mono tabular-nums text-xs text-white/70">
              {format(new Date(t.checked_in_at), 'MMM d, h:mm a')}
            </p>
          </div>
        )
      }
      if (t.status === 'cancelled') return <StatusChip tone="danger">{tx('attendees.cancelled')}</StatusChip>
      return <StatusChip tone="warning">{tx('attendees.pending')}</StatusChip>
    },
  },
  {
    key: 'purchased_at',
    header: 'Purchased',
    sortable: true,
    sortAccessor: (t: Ticket) => t.purchased_at,
    render: (t: Ticket) => (
      <span className="font-mono tabular-nums text-sm text-white/60">
        {format(new Date(t.purchased_at), 'MMM d, yyyy')}
      </span>
    ),
    cellClassName: 'hidden lg:table-cell',
    headerClassName: 'hidden lg:table-cell',
  },
]

export function AttendeesManager({ eventId, eventTitle, tickets, ticketsError = false }: AttendeesManagerProps) {
  const { t: tx } = useTranslation('organizer')

  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)

  const stats = useMemo(() => {
    const total = tickets.length
    const checkedIn = tickets.filter((t) => t.checked_in_at).length
    const notCheckedIn = tickets.filter((t) => !t.checked_in_at && t.status !== 'cancelled').length
    const cancelled = tickets.filter((t) => t.status === 'cancelled').length
    return { total, checkedIn, notCheckedIn, cancelled }
  }, [tickets])

  const statusCount: Record<FilterStatus, number> = {
    all: stats.total,
    'checked-in': stats.checkedIn,
    'not-checked-in': stats.notCheckedIn,
    cancelled: stats.cancelled,
  }

  const filteredTickets = useMemo(() => {
    let filtered = tickets

    if (filterStatus === 'checked-in') filtered = filtered.filter((t) => t.checked_in_at)
    else if (filterStatus === 'not-checked-in')
      filtered = filtered.filter((t) => !t.checked_in_at && t.status !== 'cancelled')
    else if (filterStatus === 'cancelled') filtered = filtered.filter((t) => t.status === 'cancelled')

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (t) =>
          t.attendee?.full_name?.toLowerCase().includes(q) ||
          t.attendee?.email?.toLowerCase().includes(q) ||
          t.attendee?.phone_number?.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      )
    }

    return filtered
  }, [tickets, filterStatus, searchQuery])

  const handleExportCSV = () => {
    const csv = toCsv([
      ['Name', 'Email', 'Phone', 'Ticket ID', 'Status', 'Checked In', 'Purchase Date'],
      ...filteredTickets.map((t) => [
        t.attendee?.full_name || 'N/A',
        t.attendee?.email || 'N/A',
        t.attendee?.phone_number || 'N/A',
        t.id,
        t.status,
        t.checked_in_at
          ? format(new Date(t.checked_in_at), 'MMM d, yyyy h:mm a')
          : 'Not checked in',
        format(new Date(t.purchased_at), 'MMM d, yyyy'),
      ]),
    ])

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${eventTitle}-attendees-${format(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  const handleEmailAttendees = () => {
    const emails = filteredTickets
      .map((t) => t.attendee?.email)
      .filter(Boolean)
      .join(',')
    window.location.href = `mailto:${emails}?subject=${encodeURIComponent(`Update: ${eventTitle}`)}`
  }

  const mobileCard = (t: Ticket) => (
    <button
      key={t.id}
      type="button"
      onClick={() => setSelectedTicket(t)}
      className="flex w-full items-center gap-3 p-4 text-left hover:bg-white/[0.06] active:bg-white/[0.10]"
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.08]">
        <User className="h-5 w-5 text-brand-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-white">{t.attendee?.full_name || 'Unknown'}</p>
        <p className="truncate text-xs text-white/70">{t.attendee?.email || ''}</p>
      </div>
      <div>
        {t.checked_in_at ? (
          <StatusChip tone="success">In</StatusChip>
        ) : t.status === 'cancelled' ? (
          <StatusChip tone="danger">{tx('attendees.cancelled')}</StatusChip>
        ) : (
          <StatusChip tone="warning">{tx('attendees.pending')}</StatusChip>
        )}
      </div>
    </button>
  )

  return (
    <>
      {ticketsError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Couldn&apos;t load attendees</p>
            <p className="mt-0.5 text-sm text-white/70">
              Something went wrong fetching tickets for this event.{' '}
              <button
                type="button"
                onClick={() => router.refresh()}
                className="font-semibold text-brand-300 underline underline-offset-2 hover:text-brand-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {tx('actions.try_again')}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-white', bg: 'border-white/10' },
          { label: 'Checked In', value: stats.checkedIn, color: 'text-emerald-300', bg: 'border-emerald-500/30' },
          { label: 'Pending', value: stats.notCheckedIn, color: 'text-amber-300', bg: 'border-amber-500/30' },
          { label: 'Cancelled', value: stats.cancelled, color: 'text-red-300', bg: 'border-red-500/30' },
        ].map((k) => (
          <div key={k.label} className={`rounded-xl border bg-white/[0.03] p-4 ${k.bg}`}>
            <p className="label-mono uppercase text-white/70">{k.label}</p>
            <p className={`mt-1 font-mono tabular-nums text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={tx('attendees.search_placeholder')}
          className="flex-1"
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-white/[0.08] px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tx('attendees.export_csv')}</span>
          </button>
          <button
            type="button"
            onClick={handleEmailAttendees}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">{tx('attendees.email_all')}</span>
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <FilterBar className="mb-4">
        {STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={filterStatus === f.value}
            onClick={() => setFilterStatus(f.value)}
            count={statusCount[f.value]}
          >
            {f.label}
          </FilterChip>
        ))}
      </FilterBar>

      {/* Table */}
      <OrgDataTable<Ticket>
        columns={buildColumns(tx)}
        rows={filteredTickets}
        rowKey={(t) => t.id}
        onRowClick={(t) => setSelectedTicket(t)}
        renderMobileCard={mobileCard}
        empty={
          <OrgEmptyState
            icon={User}
            title={searchQuery || filterStatus !== 'all' ? 'No attendees match' : 'No attendees yet'}
            description={
              searchQuery || filterStatus !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'No tickets have been sold for this event yet.'
            }
          />
        }
      />

      {/* Detail drawer */}
      <Drawer
        open={selectedTicket !== null}
        onClose={() => setSelectedTicket(null)}
        title={tx('attendees.attendee_details')}
        size="md"
        footer={
          selectedTicket && selectedTicket.status !== 'cancelled' ? (
            <AttendeeActions ticket={selectedTicket} eventId={eventId} />
          ) : undefined
        }
      >
        {selectedTicket && <AttendeeDetail ticket={selectedTicket} />}
      </Drawer>
    </>
  )
}

function AttendeeDetail({ ticket }: { ticket: Ticket }) {
  const { t: tx } = useTranslation('organizer')

  return (
    <div className="space-y-6 p-6">
      {/* Attendee info */}
      <section>
        <p className="label-mono uppercase mb-3 text-white/70">
          {tx('attendees.attendee_information')}
        </p>
        <div className="space-y-3">
          <InfoRow icon={<User className="h-4 w-4" />} label="Name">
            {ticket.attendee?.full_name || ', '}
          </InfoRow>
          <InfoRow icon={<Mail className="h-4 w-4" />} label={tx('actions.email')}>
            {ticket.attendee?.email || ', '}
          </InfoRow>
          <InfoRow
            icon={
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            }
            label={tx('actions.phone')}
          >
            {ticket.attendee?.phone_number || ', '}
          </InfoRow>
        </div>
      </section>

      {/* Ticket info */}
      <section>
        <p className="label-mono uppercase mb-3 text-white/70">
          {tx('attendees.ticket_information')}
        </p>
        <div className="space-y-3">
          <InfoRow icon={<QrCode className="h-4 w-4" />} label={tx('attendees.ticket_id')}>
            <span className="font-mono text-sm">{ticket.id}</span>
          </InfoRow>
          <InfoRow icon={<Calendar className="h-4 w-4" />} label={tx('attendees.purchased')}>
            <span className="font-mono tabular-nums">{format(new Date(ticket.purchased_at), 'MMMM d, yyyy h:mm a')}</span>
          </InfoRow>
          <InfoRow
            icon={
              ticket.checked_in_at ? (
                <Check className="h-4 w-4 text-emerald-300" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-300" />
              )
            }
            label={tx('attendees.check_in')}
          >
            {ticket.checked_in_at ? (
              <span className="font-mono tabular-nums text-emerald-300">
                {format(new Date(ticket.checked_in_at), 'MMM d, h:mm a')}
              </span>
            ) : (
              <span className="text-amber-300">{tx('attendees.not_checked_in')}</span>
            )}
          </InfoRow>
          <InfoRow icon={<CreditCard className="h-4 w-4" />} label={tx('attendees.price_paid')}>
            <span className="font-mono tabular-nums text-brand-300">{formatMoneyFromCents(
              Math.round(Number(ticket.price_paid || 0) * 100),
              normalizeCurrency(ticket.currency, 'HTG')
            )}</span>
          </InfoRow>
        </div>
      </section>
    </div>
  )
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-white/40">{icon}</span>
      <div>
        <p className="text-xs text-white/70">{label}</p>
        <p className="font-medium text-white">{children}</p>
      </div>
    </div>
  )
}

function AttendeeActions({ ticket, eventId }: { ticket: Ticket; eventId: string }) {
  const { t: tx } = useTranslation('organizer')

  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [confirmingRefund, setConfirmingRefund] = useState(false)

  const handleResendTicket = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/resend-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id }),
      })
      if (!res.ok) throw new Error()
      showToast({ type: 'success', title: 'Ticket resent', message: 'The ticket email is on its way.' })
    } catch {
      showToast({ type: 'error', title: 'Failed to resend', message: 'Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const handleRefund = async () => {
    setConfirmingRefund(false)
    setLoading(true)
    try {
      const res = await fetch('/api/refund-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id }),
      })
      if (!res.ok) throw new Error()
      if (res.status === 202) {
        // Not covered by the remaining balance: a Tikèm admin decides.
        showToast({ type: 'info', title: tx('attendees.refund_review_title'), message: tx('attendees.refund_review_body') })
      } else {
        showToast({ type: 'success', title: 'Refund processed', message: 'The ticket has been refunded.' })
      }
      router.refresh()
    } catch {
      showToast({ type: 'error', title: 'Refund failed', message: 'Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3 p-4">
      <button
        type="button"
        onClick={handleResendTicket}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-50"
      >
        <Mail className="h-4 w-4" />
        {tx('attendees.resend_ticket_email')}
      </button>

      {confirmingRefund ? (
        <div className="rounded-xl bg-red-500/[0.14] p-3">
          <p className="text-sm text-white">{tx('attendees.refund_confirm')}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingRefund(false)}
              disabled={loading}
              className="h-11 flex-1 rounded-[10px] bg-white/[0.10] text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white disabled:opacity-50"
            >
              {tx('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleRefund}
              disabled={loading}
              className="h-11 flex-1 rounded-[10px] bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? 'Refunding…' : 'Confirm refund'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingRefund(true)}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          <CreditCard className="h-4 w-4" />
          {tx('attendees.process_refund')}
        </button>
      )}
    </div>
  )
}
