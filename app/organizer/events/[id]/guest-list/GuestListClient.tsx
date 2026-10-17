'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Users, CheckCircle2, Clock, Mail } from 'lucide-react'
import {
  OrgDataTable,
  OrgEmptyState,
  OrgColumn,
  StatusChip,
  Drawer,
  FormSection,
  FormField,
} from '@/components/organizer/ui'

interface Guest {
  id: string
  name: string
  email: string
  status: string
  plus_one: boolean
  invited_at: string | null
  checked_in: boolean
}

interface GuestListClientProps {
  eventId: string
  eventTitle: string
  guests: Guest[]
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'accepted') return 'success'
  if (status === 'invited') return 'warning'
  return 'neutral'
}

// Built per render: two cells are translated, and a module-level constant has
// no hook to read them from.
const buildColumns = (t: (k: string) => string): OrgColumn<Guest>[] => [
  {
    key: 'name',
    header: 'Guest',
    sortable: true,
    render: (g) => (
      <div>
        <p className="font-medium text-white">{g.name || EMPTY_VALUE}</p>
        <p className="text-xs text-white/50">{g.email}</p>
      </div>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (g) => (
      <StatusChip tone={statusTone(g.status)}>
        {g.status.charAt(0).toUpperCase() + g.status.slice(1)}
      </StatusChip>
    ),
  },
  {
    key: 'plus_one',
    header: '+1',
    render: (g) => (
      <span className="text-sm text-white/60">{g.plus_one ? 'Yes' : EMPTY_VALUE}</span>
    ),
  },
  {
    key: 'checked_in',
    header: 'Checked in',
    render: (g) =>
      g.checked_in ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-400" role="img" aria-label={t('guest_list.checked_in')} />
      ) : (
        <Clock className="h-4 w-4 text-white/40" role="img" aria-label={t('guest_list.not_checked_in')} />
      ),
  },
]

export default function GuestListClient({ eventId, eventTitle, guests }: GuestListClientProps) {
  const { t } = useTranslation('organizer')

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [plusOne, setPlusOne] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const reset = () => {
    setName('')
    setEmail('')
    setPlusOne(false)
    setError(null)
  }

  const handleInvite = () => {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.')
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
        if (!res.ok) throw new Error('Failed to invite guest')
        setOpen(false)
        reset()
        // Refresh server data without a full reload
        router.refresh()
      } catch {
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{t('guest_list.guest_list')}</h1>
          <p className="mt-0.5 text-sm text-white/50">
            {guests.length > 0
              ? `${guests.length} guest${guests.length !== 1 ? 's' : ''} invited`
              : 'Invite guests by name and email'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <UserPlus className="h-4 w-4" />
          {t('guest_list.invite_guest')}
        </button>
      </div>

      {guests.length === 0 ? (
        <OrgEmptyState
          icon={Users}
          title={t('guest_list.no_guests_yet')}
          description={t('guest_list.add_vip_desc')}
          action={
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <UserPlus className="h-4 w-4" />
              {t('guest_list.invite_guest')}
            </button>
          }
        />
      ) : (
        <OrgDataTable
          rows={guests}
          columns={buildColumns(t)}
          rowKey={(g) => g.id}
        />
      )}

      <Drawer
        open={open}
        onClose={() => { setOpen(false); reset() }}
        title={t('guest_list.invite_guest')}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setOpen(false); reset() }}
              className="rounded-xl  px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleInvite}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Mail className="h-4 w-4" />
              {isPending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        }
      >
        <FormSection title={t('guest_list.guest_details')}>
          <FormField label={t('guest_list.full_name')} required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </FormField>
          <FormField label={t('guest_list.email_address')} required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </FormField>
          <FormField label={t('guest_list.allow_plus_one')}>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={plusOne}
                onChange={(e) => setPlusOne(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/10 text-brand-600 accent-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-white/70">{t('guest_list.allow_plus_one_desc')}</span>
            </label>
          </FormField>
          {error && (
            <p className="rounded-lg px-3 py-2 text-sm text-red-400">{error}</p>
          )}
        </FormSection>
      </Drawer>
    </>
  )
}
