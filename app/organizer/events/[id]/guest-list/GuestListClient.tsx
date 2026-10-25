'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Users, Ticket } from 'lucide-react'
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
import type { GuestRecord } from '@/lib/guest-list'

interface GuestListClientProps {
  eventId: string
  eventTitle: string
  guests: GuestRecord[]
}

type Outcome = { name: string; email: string; emailed: boolean; link: string | null }

const inputCls =
  'w-full rounded px-4 py-3 text-[16px] sm:text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/60 bg-white/[0.06]'

/** What happened to the guest's ticket, as a dot + label. */
function TicketCell({ g, t }: { g: GuestRecord; t: (k: string, o?: any) => string }) {
  if (g.ticket_status === 'none') return <StatusChip className="!normal-case" tone="neutral">{t('event_tools.gl_status_no_ticket')}</StatusChip>
  if (g.ticket_status === 'cancelled') return <StatusChip className="!normal-case" tone="danger">{t('event_tools.status_cancelled')}</StatusChip>
  const count = g.ticket_ids.length
  return (
    <div className="space-y-1.5">
      {g.email_sent ? (
        <StatusChip className="!normal-case" tone="success">{t('event_tools.gl_status_emailed', { count })}</StatusChip>
      ) : g.email ? (
        <StatusChip className="!normal-case" tone="warning">{t('event_tools.gl_status_email_failed')}</StatusChip>
      ) : (
        <StatusChip className="!normal-case" tone="warning">{t('event_tools.gl_status_no_email')}</StatusChip>
      )}
      {!g.email_sent && g.ticket_link && (
        <div>
          <CopyTicketLink url={g.ticket_link} />
        </div>
      )}
    </div>
  )
}

function CheckInCell({ g, t }: { g: GuestRecord; t: (k: string, o?: any) => string }) {
  const total = g.ticket_ids.length
  if (total > 1) {
    return g.checked_in_count > 0 ? (
      <StatusChip className="!normal-case" tone="success">{t('event_tools.gl_in_count', { count: g.checked_in_count, total })}</StatusChip>
    ) : (
      <StatusChip className="!normal-case" tone="neutral">{t('event_tools.gl_not_in')}</StatusChip>
    )
  }
  return g.checked_in ? (
    <StatusChip className="!normal-case" tone="success">{t('guest_list.checked_in')}</StatusChip>
  ) : (
    <StatusChip className="!normal-case" tone="neutral">{t('event_tools.gl_not_in')}</StatusChip>
  )
}

// Built per render: the cells are translated, and a module-level constant has
// no hook to read them from.
const buildColumns = (t: (k: string, o?: any) => string): OrgColumn<GuestRecord>[] => [
  {
    key: 'name',
    header: t('event_tools.gl_col_guest'),
    sortable: true,
    render: (g) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-white">
          {g.name || EMPTY_VALUE}
          {g.plus_one && <span className="ml-2 font-mono text-xs text-white/50">+1</span>}
        </p>
        <p className="truncate text-xs text-white/50">{g.email || t('event_tools.gl_no_email_short')}</p>
      </div>
    ),
  },
  {
    key: 'ticket',
    header: t('event_tools.gl_col_ticket'),
    render: (g) => <TicketCell g={g} t={t} />,
  },
  {
    key: 'checked_in',
    header: t('event_tools.gl_col_checkin'),
    render: (g) => <CheckInCell g={g} t={t} />,
  },
]

export default function GuestListClient({ eventId, guests }: GuestListClientProps) {
  const { t } = useTranslation('organizer')

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [plusOne, setPlusOne] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const router = useRouter()

  const reset = () => {
    setName('')
    setEmail('')
    setPlusOne(false)
    setError(null)
    setOutcome(null)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  const handleAdd = () => {
    if (!name.trim()) {
      setError(t('event_tools.gl_name_required'))
      return
    }
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch(`/api/organizer/events/${eventId}/guests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), email: email.trim(), plus_one: plusOne }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(String(data?.error || t('event_tools.generic_error')))
          return
        }
        setOutcome({
          name: name.trim(),
          email: email.trim(),
          emailed: data?.emailed === true,
          link: typeof data?.ticketLink === 'string' ? data.ticketLink : null,
        })
        router.refresh()
      } catch {
        setError(t('event_tools.generic_error'))
      }
    })
  }

  const issuedCount = guests.reduce((sum, g) => sum + (g.ticket_status === 'issued' ? g.ticket_ids.length : 0), 0)

  const addButton = (primary: boolean) => (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`inline-flex items-center gap-2 rounded px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        primary ? 'bg-white text-black hover:bg-white/90' : 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
      }`}
    >
      <UserPlus className="h-4 w-4" />
      {t('event_tools.gl_add_guest')}
    </button>
  )

  return (
    <>
      <SectionHeader
        className="mb-6"
        title={t('guest_list.guest_list')}
        description={
          guests.length > 0
            ? t('event_tools.gl_summary', { guests: guests.length, tickets: issuedCount })
            : t('event_tools.gl_intro')
        }
        // The empty state below carries the white button while the list is empty.
        actions={addButton(guests.length > 0)}
      />

      {guests.length === 0 ? (
        <OrgEmptyState
          icon={Users}
          title={t('guest_list.no_guests_yet')}
          description={t('event_tools.gl_empty_desc')}
          action={addButton(true)}
        />
      ) : (
        <OrgDataTable rows={guests} columns={buildColumns(t)} rowKey={(g) => g.id} />
      )}

      <Drawer
        open={open}
        onClose={close}
        title={t('event_tools.gl_add_guest')}
        size="sm"
        footer={
          outcome ? (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {t('event_tools.gl_add_another')}
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {t('event_tools.done')}
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Ticket className="h-4 w-4" />
                {isPending ? t('event_tools.issuing') : t('event_tools.gl_submit')}
              </button>
            </div>
          )
        }
      >
        {outcome ? (
          <div className="space-y-4 p-6">
            <StatusChip className="!normal-case" tone={outcome.emailed ? 'success' : 'warning'}>
              {outcome.emailed ? t('event_tools.ticket_issued') : t('event_tools.ticket_issued_not_sent')}
            </StatusChip>
            <p className="text-sm text-white/80">
              {outcome.emailed
                ? t('event_tools.gl_result_emailed', { email: outcome.email })
                : outcome.email
                  ? t('event_tools.result_email_failed')
                  : t('event_tools.gl_result_no_email', { name: outcome.name })}
            </p>
            {!outcome.emailed && outcome.link && <CopyTicketLink url={outcome.link} full />}
          </div>
        ) : (
          <FormSection title={t('guest_list.guest_details')}>
            <FormField label={t('guest_list.full_name')} required>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className={inputCls}
              />
            </FormField>
            <FormField label={t('event_tools.email_optional')} hint={t('event_tools.gl_email_hint')}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className={inputCls}
              />
            </FormField>
            <FormField label={t('guest_list.allow_plus_one')}>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={plusOne}
                  onChange={(e) => setPlusOne(e.target.checked)}
                  className="h-4 w-4 rounded-sm bg-white/10 accent-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-white/70">{t('event_tools.gl_plus_one_desc')}</span>
              </label>
            </FormField>
            <p className="text-xs text-white/50">{t('event_tools.gl_free_note')}</p>
            {error && <p className="text-sm text-red-300">{error}</p>}
          </FormSection>
        )}
      </Drawer>
    </>
  )
}
