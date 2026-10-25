'use client'

import { useTranslation } from 'react-i18next'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Mail, User, CreditCard, Calendar, Check, AlertCircle, QrCode, AlertTriangle, Send } from 'lucide-react'
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
import { EMPTY_VALUE } from '@/lib/format'
import {
  ticketDisplayKey,
  ticketDisplayLabelKey,
  ticketDisplayTone,
  ticketIsActionable,
} from '@/lib/organizer/ticketStatusDisplay'

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
  checked_in?: boolean
  checked_in_at?: string | null
  ticket_type?: string
  source?: string
  is_guest?: boolean
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

type FilterStatus = 'all' | 'checked-in' | 'not-checked-in' | 'refunded' | 'cancelled'

const STATUS_FILTERS: { value: FilterStatus; labelKey: string }[] = [
  { value: 'all', labelKey: 'event_tools.filter_all' },
  { value: 'checked-in', labelKey: 'event_tools.status_checked_in' },
  { value: 'not-checked-in', labelKey: 'event_tools.filter_not_in' },
  { value: 'refunded', labelKey: 'event_tools.filter_refunds' },
  { value: 'cancelled', labelKey: 'event_tools.status_cancelled' },
]

const isIn = (t: Ticket) => Boolean(t.checked_in_at) || t.checked_in === true
const keyOf = (t: Ticket) => ticketDisplayKey(t.status, isIn(t))

function matchesFilter(t: Ticket, f: FilterStatus): boolean {
  const k = keyOf(t)
  if (f === 'checked-in') return k === 'checked_in'
  if (f === 'not-checked-in') return k === 'valid'
  if (f === 'refunded') return k === 'refunded' || k === 'refund_pending'
  if (f === 'cancelled') return k === 'cancelled' || k === 'not_valid'
  return true
}

function TicketStatus({ t, tx }: { t: Ticket; tx: (k: string) => string }) {
  const k = keyOf(t)
  return <StatusChip className="!normal-case" tone={ticketDisplayTone(k)}>{tx(ticketDisplayLabelKey(k))}</StatusChip>
}

// Built per render rather than defined once: the status cells are translated,
// and a module-level constant has no hook to read them from.
const buildColumns = (tx: (k: string) => string): OrgColumn<Ticket>[] => [
  {
    key: 'attendee',
    header: tx('event_tools.col_attendee'),
    sortable: true,
    sortAccessor: (t: Ticket) => t.attendee?.full_name || '',
    render: (t: Ticket) => (
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.08]">
          <User className="h-4 w-4 text-brand-300" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{t.attendee?.full_name || t.attendee?.email || tx('event_tools.guest')}</p>
          <p className="truncate text-xs text-white/70 sm:hidden">{t.attendee?.full_name ? t.attendee?.email || '' : ''}</p>
        </div>
      </div>
    ),
  },
  {
    key: 'email',
    header: tx('actions.email'),
    sortable: true,
    sortAccessor: (t: Ticket) => t.attendee?.email || '',
    render: (t: Ticket) => (
      <span className="text-sm text-white/70">{t.attendee?.email || EMPTY_VALUE}</span>
    ),
    cellClassName: 'hidden sm:table-cell',
    headerClassName: 'hidden sm:table-cell',
  },
  {
    key: 'status',
    header: tx('event_tools.col_status'),
    render: (t: Ticket) => (
      <div>
        <TicketStatus t={t} tx={tx} />
        {t.checked_in_at && keyOf(t) === 'checked_in' && (
          <p className="mt-0.5 font-mono tabular-nums text-xs text-white/70">
            {format(new Date(t.checked_in_at), 'MMM d, h:mm a')}
          </p>
        )}
      </div>
    ),
  },
  {
    key: 'purchased_at',
    header: tx('attendees.purchased'),
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
    const count = (f: FilterStatus) => tickets.filter((t) => matchesFilter(t, f)).length
    return {
      all: tickets.length,
      'checked-in': count('checked-in'),
      'not-checked-in': count('not-checked-in'),
      refunded: count('refunded'),
      cancelled: count('cancelled'),
    } as Record<FilterStatus, number>
  }, [tickets])
  const liveCount = stats['checked-in'] + stats['not-checked-in']

  const filteredTickets = useMemo(() => {
    let filtered = tickets.filter((t) => matchesFilter(t, filterStatus))

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

  // Who an update reaches: one email per address, live tickets only.
  const updateRecipients = useMemo(() => {
    const emails = new Set<string>()
    for (const t of tickets) {
      if (!ticketIsActionable(t.status)) continue
      const e = (t.attendee?.email || '').trim().toLowerCase()
      if (e) emails.add(e)
    }
    return emails.size
  }, [tickets])
  const [composeOpen, setComposeOpen] = useState(false)

  const handleExportCSV = () => {
    const csv = toCsv([
      ['Name', 'Email', 'Phone', 'Ticket ID', 'Status', 'Checked In', 'Purchase Date'],
      ...filteredTickets.map((t) => [
        t.attendee?.full_name || 'N/A',
        t.attendee?.email || 'N/A',
        t.attendee?.phone_number || 'N/A',
        t.id,
        tx(ticketDisplayLabelKey(keyOf(t))),
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
        <p className="truncate font-medium text-white">{t.attendee?.full_name || t.attendee?.email || tx('event_tools.guest')}</p>
        <p className="truncate text-xs text-white/70">{t.attendee?.full_name ? t.attendee?.email || '' : ''}</p>
      </div>
      <div>
        <TicketStatus t={t} tx={tx} />
      </div>
    </button>
  )

  return (
    <>
      {ticketsError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-red-500/10 px-4 py-3">
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

      {/* KPI row: live tickets only; refunds are counted apart, never as attendees. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: tx('event_tools.kpi_valid'), value: liveCount, color: 'text-white' },
          { label: tx('event_tools.status_checked_in'), value: stats['checked-in'], color: 'text-emerald-300' },
          { label: tx('event_tools.filter_not_in'), value: stats['not-checked-in'], color: 'text-white/80' },
          { label: tx('event_tools.kpi_refunded_cancelled'), value: stats.refunded + stats.cancelled, color: 'text-red-300' },
        ].map((k) => (
          <div key={k.label} className="rounded bg-white/[0.055] p-4">
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
            className="inline-flex h-11 items-center gap-2 rounded bg-white/[0.08] px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tx('attendees.export_csv')}</span>
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            disabled={updateRecipients === 0}
            className="inline-flex h-11 items-center gap-2 rounded bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">{tx('event_tools.email_attendees')}</span>
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
            count={stats[f.value]}
          >
            {tx(f.labelKey)}
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
            title={searchQuery || filterStatus !== 'all' ? tx('event_tools.no_match') : tx('event_tools.no_attendees')}
            description={
              searchQuery || filterStatus !== 'all'
                ? tx('event_tools.no_match_desc')
                : tx('event_tools.no_attendees_desc')
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
          selectedTicket ? (
            ticketIsActionable(selectedTicket.status) ? (
              <AttendeeActions ticket={selectedTicket} eventId={eventId} />
            ) : (
              <p className="text-sm text-white/60">{tx('event_tools.no_actions_for_status')}</p>
            )
          ) : undefined
        }
      >
        {selectedTicket && <AttendeeDetail ticket={selectedTicket} />}
      </Drawer>

      <EmailAttendeesSheet
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        eventId={eventId}
        recipients={updateRecipients}
      />
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
          <InfoRow icon={<User className="h-4 w-4" />} label={tx('event_tools.name')}>
            {ticket.attendee?.full_name || EMPTY_VALUE}
          </InfoRow>
          <InfoRow icon={<Mail className="h-4 w-4" />} label={tx('actions.email')}>
            {ticket.attendee?.email || EMPTY_VALUE}
          </InfoRow>
          <InfoRow
            icon={
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            }
            label={tx('actions.phone')}
          >
            {ticket.attendee?.phone_number || EMPTY_VALUE}
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
          <InfoRow icon={<Check className="h-4 w-4" />} label={tx('event_tools.col_status')}>
            <TicketStatus t={ticket} tx={tx} />
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(String(data?.error || '') || tx('event_tools.generic_error'))
      }
      showToast({ type: 'success', title: tx('event_tools.resent_title'), message: tx('event_tools.resent_body') })
    } catch (err: any) {
      showToast({ type: 'error', title: tx('event_tools.resend_failed'), message: err?.message || tx('event_tools.generic_error') })
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
      if (!res.ok) {
        // The route says why (not refundable, already refunded, balance, ...).
        const data = await res.json().catch(() => ({}))
        const skip = String(data?.skipped?.[0]?.reason || '')
        const why =
          String(data?.failed?.[0]?.reason || '') ||
          (skip === 'checked_in' ? tx('event_tools.refund_skip_checked_in') : '') ||
          (skip ? `${data?.error || ''} (${skip.replace(/_/g, ' ')})` : '') ||
          String(data?.error || data?.message || '')
        throw new Error(why || tx('event_tools.generic_error'))
      }
      if (res.status === 202) {
        // Not covered by the remaining balance, or a Haiti event (every refund
        // is approved by Tikèm): a Tikèm admin decides.
        const data = await res.json().catch(() => ({}))
        showToast({
          type: 'info',
          title: tx('attendees.refund_review_title'),
          message:
            data?.reviewReason === 'haiti_manual_approval'
              ? tx('attendees.refund_review_haiti_body')
              : tx('attendees.refund_review_body'),
        })
      } else {
        showToast({ type: 'success', title: tx('event_tools.refund_done_title'), message: tx('event_tools.refund_done_body') })
      }
      router.refresh()
    } catch (err: any) {
      showToast({ type: 'error', title: tx('event_tools.refund_failed'), message: err?.message || tx('event_tools.generic_error') })
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
        className="flex w-full items-center justify-center gap-2 rounded bg-white px-4 py-2.5 font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
      >
        <Mail className="h-4 w-4" />
        {tx('attendees.resend_ticket_email')}
      </button>

      {confirmingRefund ? (
        <div className="rounded bg-red-500/[0.14] p-3">
          <p className="text-sm text-white">{tx('attendees.refund_confirm')}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingRefund(false)}
              disabled={loading}
              className="h-11 flex-1 rounded bg-white/[0.10] text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white disabled:opacity-50"
            >
              {tx('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleRefund}
              disabled={loading}
              className="h-11 flex-1 rounded bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? tx('event_tools.refunding') : tx('event_tools.confirm_refund')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingRefund(true)}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded bg-red-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          <CreditCard className="h-4 w-4" />
          {tx('attendees.process_refund')}
        </button>
      )}
    </div>
  )
}

/**
 * "Email attendees": a message sent by Tikèm to every live ticket holder, one
 * email each (POST /api/email/send-event-update). It used to open a mailto:
 * with every buyer in To:, which showed each buyer everyone else's address and
 * broke on long lists.
 */
function EmailAttendeesSheet({
  open,
  onClose,
  eventId,
  recipients,
}: {
  open: boolean
  onClose: () => void
  eventId: string
  recipients: number
}) {
  const { t: tx } = useTranslation('organizer')
  const { showToast } = useToast()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (sending) return
    setError(null)
    onClose()
  }

  const send = async () => {
    const text = message.trim()
    if (!text) {
      setError(tx('event_tools.compose_empty'))
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/email/send-event-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, updateMessage: text, updateType: 'important' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String(data?.error || tx('event_tools.generic_error')))
        return
      }
      showToast({
        type: Number(data?.failed) > 0 ? 'info' : 'success',
        title: tx('event_tools.compose_sent_title'),
        message: tx('event_tools.compose_sent_body', { sent: Number(data?.sent) || 0, failed: Number(data?.failed) || 0 }),
      })
      setMessage('')
      onClose()
    } catch {
      setError(tx('event_tools.generic_error'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title={tx('event_tools.email_attendees')}
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tx('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || recipients === 0}
            className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Send className="h-4 w-4" />
            {sending ? tx('event_tools.compose_sending') : tx('event_tools.compose_send', { count: recipients })}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-6">
        <p className="text-sm text-white/70">{tx('event_tools.compose_intro', { count: recipients })}</p>
        <label htmlFor="attendee-update" className="block text-xs text-white/70">
          {tx('event_tools.compose_label')}
        </label>
        <textarea
          id="attendee-update"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
          rows={8}
          placeholder={tx('event_tools.compose_placeholder')}
          className="w-full rounded bg-white/[0.06] px-4 py-3 text-[16px] sm:text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
        />
        <p className="text-right font-mono text-xs tabular-nums text-white/40">{message.length} / 2000</p>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    </Drawer>
  )
}
