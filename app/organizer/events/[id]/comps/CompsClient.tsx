'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { Gift, Ticket, CheckCircle2, XCircle } from 'lucide-react'
import {
  OrgDataTable,
  OrgEmptyState,
  OrgColumn,
  StatusChip,
  Drawer,
  FormSection,
  FormField,
} from '@/components/organizer/ui'

interface Comp {
  id: string
  recipient_name: string
  recipient_email: string
  ticket_type: string
  quantity: number
  note: string
  status: string
  created_at: string | null
}

interface CompsClientProps {
  eventId: string
  eventTitle: string
  comps: Comp[]
  tiers: Array<{ id: string; name: string }>
}

function statusTone(status: string): 'success' | 'danger' | 'neutral' {
  if (status === 'issued') return 'success'
  if (status === 'revoked') return 'danger'
  return 'neutral'
}

const columns: OrgColumn<Comp>[] = [
  {
    key: 'recipient_name',
    header: 'Recipient',
    sortable: true,
    render: (c) => (
      <div>
        <p className="font-medium text-white">{c.recipient_name || EMPTY_VALUE}</p>
        <p className="text-xs text-white/50">{c.recipient_email}</p>
      </div>
    ),
  },
  {
    key: 'ticket_type',
    header: 'Ticket type',
    render: (c) => <span className="text-sm text-white/70">{c.ticket_type}</span>,
  },
  {
    key: 'quantity',
    header: 'Qty',
    render: (c) => <span className="font-mono tabular-nums text-sm text-white/70">{c.quantity}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (c) => (
      <StatusChip tone={statusTone(c.status)}>
        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
      </StatusChip>
    ),
  },
  {
    key: 'note',
    header: 'Note',
    render: (c) => <span className="text-sm text-white/40 italic">{c.note || EMPTY_VALUE}</span>,
  },
]

export default function CompsClient({ eventId, eventTitle, comps, tiers }: CompsClientProps) {
  const { t: tx } = useTranslation('organizer')

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
  }

  const handleIssue = () => {
    if (!name.trim() || !email.trim()) {
      setError('Recipient name and email are required.')
      return
    }
    if (quantity < 1 || quantity > 20) {
      setError('Quantity must be between 1 and 20.')
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
        if (!res.ok) throw new Error('Failed to issue comp')
        setOpen(false)
        reset()
        window.location.reload()
      } catch {
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{tx('comps.complimentary_tickets')}</h1>
          <p className="mt-0.5 text-sm text-white/50">
            {comps.length > 0
              ? `${comps.reduce((s, c) => s + c.quantity, 0)} comp ticket${comps.reduce((s, c) => s + c.quantity, 0) !== 1 ? 's' : ''} issued`
              : 'Issue free tickets to guests'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-2 rounded px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            // The empty state below carries the white pill while the list is empty.
            comps.length > 0 ? 'bg-white text-black hover:bg-white/90' : 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
          }`}
        >
          <Gift className="h-4 w-4" />
          {tx('comps.issue_comp')}
        </button>
      </div>

      {comps.length === 0 ? (
        <OrgEmptyState
          icon={Ticket}
          title={tx('comps.no_comps_issued')}
          description={tx('comps.issue_comps_desc')}
          action={
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Gift className="h-4 w-4" />
              {tx('comps.issue_comp_ticket')}
            </button>
          }
        />
      ) : (
        <OrgDataTable rows={comps} columns={columns} rowKey={(c) => c.id} />
      )}

      <Drawer
        open={open}
        onClose={() => { setOpen(false); reset() }}
        title={tx('comps.issue_comp_ticket')}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setOpen(false); reset() }}
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
              {isPending ? 'Issuing…' : 'Issue ticket'}
            </button>
          </div>
        }
      >
        <FormSection title={tx('comps.recipient')}>
          <FormField label={tx('comps.full_name')} required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
          <FormField label={tx('comps.email_address')} required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
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
                className="w-full rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
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
              className="w-full rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
          <FormField label={tx('comps.internal_note')}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Press pass, sponsor, VIP"
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]"
            />
          </FormField>
          {error && (
            <p className="rounded-lg px-3 py-2 text-sm text-red-400">{error}</p>
          )}
        </FormSection>
      </Drawer>
    </>
  )
}
