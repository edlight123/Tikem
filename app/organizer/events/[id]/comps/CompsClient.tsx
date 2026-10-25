'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Gift, Ticket } from 'lucide-react'
import {
  OrgDataTable,
  OrgEmptyState,
  OrgColumn,
  StatusChip,
  Drawer,
  FormSection,
  FormField,
  SectionHeader,
} from '@/components/organizer/ui'
import { CopyTicketLink } from '@/components/organizer/CopyTicketLink'
import { ticketDisplayKey, ticketDisplayLabelKey, ticketDisplayTone } from '@/lib/organizer/ticketStatusDisplay'

interface Comp {
  id: string
  recipient_name: string
  recipient_email: string
  ticket_type: string
  quantity: number
  note: string
  status: string
  checked_in: boolean
  created_at: string | null
}

interface CompsClientProps {
  eventId: string
  eventTitle: string
  comps: Comp[]
  tiers: Array<{ id: string; name: string }>
}

type Outcome = { count: number; email: string; emailed: boolean; emailLimited: boolean; link: string | null }

const buildColumns = (tx: (k: string, o?: any) => string): OrgColumn<Comp>[] => [
  {
    key: 'recipient_name',
    header: tx('comps.recipient'),
    sortable: true,
    render: (c) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{c.recipient_name || EMPTY_VALUE}</p>
        <p className="truncate text-xs text-white/50">{c.recipient_email || tx('event_tools.gl_no_email_short')}</p>
      </div>
    ),
  },
  {
    key: 'ticket_type',
    header: tx('comps.ticket_type'),
    render: (c) => <span className="text-sm text-white/70">{c.ticket_type}</span>,
  },
  {
    key: 'status',
    header: tx('event_tools.col_status'),
    render: (c) => {
      const key = ticketDisplayKey(c.status, c.checked_in)
      return <StatusChip className="!normal-case" tone={ticketDisplayTone(key)}>{tx(ticketDisplayLabelKey(key))}</StatusChip>
    },
  },
  {
    key: 'note',
    header: tx('comps.internal_note'),
    hideOnMobile: true,
    render: (c) => <span className="text-sm text-white/50">{c.note || EMPTY_VALUE}</span>,
  },
]

export default function CompsClient({ eventId, comps, tiers }: CompsClientProps) {
  const { t: tx } = useTranslation('organizer')
  const router = useRouter()
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setEmail('')
    setTierId(tiers[0]?.id ?? '')
    setQuantity(1)
    setNote('')
    setError(null)
    setOutcome(null)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  const handleIssue = () => {
    if (!name.trim()) {
      setError(tx('event_tools.comp_name_required'))
      return
    }
    if (quantity < 1 || quantity > 20) {
      setError(tx('event_tools.comp_quantity_range'))
      return
    }
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch(`/api/organizer/events/${eventId}/comps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_name: name.trim(),
            recipient_email: email.trim(),
            tier_id: tierId,
            quantity,
            note: note.trim(),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(String(data?.error || tx('event_tools.generic_error')))
          return
        }
        setOutcome({
          count: Number(data?.count) || quantity,
          email: email.trim(),
          emailed: data?.emailed === true,
          emailLimited: data?.emailLimited === true,
          link: typeof data?.ticketLink === 'string' ? data.ticketLink : null,
        })
        router.refresh()
      } catch {
        setError(tx('event_tools.generic_error'))
      }
    })
  }

  // Live comps only: a cancelled or refunded comp no longer holds a seat.
  const issuedCount = comps
    .filter((c) => ['valid', 'checked_in'].includes(ticketDisplayKey(c.status, c.checked_in)))
    .reduce((s, c) => s + c.quantity, 0)

  const issueButton = (primary: boolean) => (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`inline-flex items-center gap-2 rounded px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        primary ? 'bg-white text-black hover:bg-white/90' : 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
      }`}
    >
      <Gift className="h-4 w-4" />
      {tx('comps.issue_comp')}
    </button>
  )

  return (
    <>
      <SectionHeader
        className="mb-6"
        title={tx('comps.complimentary_tickets')}
        description={
          comps.length > 0 ? tx('event_tools.comp_summary', { count: issuedCount }) : tx('event_tools.comp_intro')
        }
        // The empty state below carries the white button while the list is empty.
        actions={issueButton(comps.length > 0)}
      />

      {comps.length === 0 ? (
        <OrgEmptyState
          icon={Ticket}
          title={tx('comps.no_comps_issued')}
          description={tx('comps.issue_comps_desc')}
          action={issueButton(true)}
        />
      ) : (
        <OrgDataTable rows={comps} columns={buildColumns(tx)} rowKey={(c) => c.id} />
      )}

      <Drawer
        open={open}
        onClose={close}
        title={tx('comps.issue_comp_ticket')}
        size="sm"
        footer={
          outcome ? (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {tx('event_tools.comp_issue_another')}
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {tx('event_tools.done')}
              </button>
            </div>
          ) : (
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
              onClick={handleIssue}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Gift className="h-4 w-4" />
              {isPending ? tx('event_tools.issuing') : tx('event_tools.comp_submit')}
            </button>
          </div>
          )
        }
      >
        {outcome ? (
          <div className="space-y-4 p-6">
            <StatusChip className="!normal-case" tone={outcome.emailed ? 'success' : 'warning'}>
              {outcome.emailed ? tx('event_tools.ticket_issued') : tx('event_tools.ticket_issued_not_sent')}
            </StatusChip>
            <p className="text-sm text-white/80">
              {outcome.emailed
                ? tx('event_tools.comp_result_emailed', { count: outcome.count, email: outcome.email })
                : outcome.emailLimited
                  ? tx('event_tools.result_email_limited')
                  : outcome.email
                    ? tx('event_tools.result_email_failed')
                    : tx('event_tools.comp_result_no_email')}
            </p>
            {!outcome.emailed && outcome.link && <CopyTicketLink url={outcome.link} full />}
          </div>
        ) : (
        <>
        <FormSection title={tx('comps.recipient')}>
          <FormField label={tx('comps.full_name')} required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded px-4 py-3 text-[16px] sm:text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
          <FormField label={tx('event_tools.email_optional')} hint={tx('event_tools.comp_email_hint')}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded px-4 py-3 text-[16px] sm:text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
        </FormSection>

        <FormSection title={tx('comps.ticket')}>
          {tiers.length > 0 && (
            <FormField label={tx('comps.ticket_type')} htmlFor="comp-tier">
              <select
                id="comp-tier"
                value={tierId}
                onChange={(e) => setTierId(e.target.value)}
                className="w-full rounded px-4 py-3 text-[16px] sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
              >
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label={tx('comps.quantity')} htmlFor="comp-qty">
            <input
              id="comp-qty"
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full rounded px-4 py-3 text-[16px] sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
          <FormField label={tx('comps.internal_note')}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tx('event_tools.comp_note_placeholder')}
              className="w-full rounded px-4 py-3 text-[16px] sm:text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </FormSection>
        </>
        )}
      </Drawer>
    </>
  )
}
