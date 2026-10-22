'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { UserPlus, Users, Trash2, ShieldCheck, User } from 'lucide-react'
import {
  OrgDataTable,
  OrgEmptyState,
  OrgColumn,
  StatusChip,
  Drawer,
  FormSection,
  FormField,
} from '@/components/organizer/ui'

interface Member {
  id: string
  email: string
  name: string
  role: string
  joined_at: string | null
}

interface OrgTeamClientProps {
  organizerId: string
  ownerName: string
  ownerEmail: string
  members: Member[]
}

type Role = 'admin' | 'staff'

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Full access to all events and settings' },
  { value: 'staff', label: 'Staff', description: 'Assigned per event for check-in access' },
]

function roleTone(role: string): 'success' | 'warning' | 'neutral' {
  if (role === 'admin') return 'warning'
  return 'neutral'
}

const columns: OrgColumn<Member>[] = [
  {
    key: 'name',
    header: 'Member',
    sortable: true,
    render: (m) => (
      <div>
        <p className="font-medium text-white">{m.name || m.email}</p>
        {m.name && <p className="text-xs text-white/50">{m.email}</p>}
      </div>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (m) => (
      <StatusChip tone={roleTone(m.role)}>
        {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
      </StatusChip>
    ),
  },
  {
    key: 'joined_at',
    header: 'Added',
    render: (m) => (
      <span className="font-mono tabular-nums text-sm text-white/40">
        {m.joined_at
          ? new Date(m.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : EMPTY_VALUE}
      </span>
    ),
  },
]

export default function OrgTeamClient({
  organizerId,
  ownerName,
  ownerEmail,
  members: initialMembers,
}: OrgTeamClientProps) {
  const { t } = useTranslation('organizer')

  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const ownerInitial = (ownerName || ownerEmail || 'O').trim().charAt(0).toUpperCase()

  const reset = () => {
    setEmail('')
    setName('')
    setRole('staff')
    setError(null)
  }

  const handleInvite = () => {
    if (!email.trim()) {
      setError('Email address is required.')
      return
    }
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch(`/api/organizer/team`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            name: name.trim(),
            role,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error || 'Failed to invite member')
        }
        const { member } = (await res.json()) as { member: Member }
        setMembers((prev) => [member, ...prev])
        setOpen(false)
        reset()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    })
  }

  const handleRemove = (id: string) => {
    setRemoving(id)
    startTransition(async () => {
      try {
        await fetch(`/api/organizer/team/${id}`, { method: 'DELETE' })
        setMembers((prev) => prev.filter((m) => m.id !== id))
      } finally {
        setRemoving(null)
      }
    })
  }

  const columnsWithActions: OrgColumn<Member>[] = [
    ...columns,
    {
      key: 'id',
      header: '',
      align: 'right',
      render: (m) => (
        <button
          type="button"
          onClick={() => handleRemove(m.id)}
          disabled={removing === m.id}
          aria-label={`Remove ${m.name || m.email} from team`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg  text-white/40 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ]

  return (
    <>
      {/* Owner card */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/[0.12] font-semibold text-white">
            {ownerInitial}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-white">{ownerName}</p>
              <StatusChip tone="success">{t('actions.owner')}</StatusChip>
            </div>
            <p className="text-sm text-white/50">{ownerEmail}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <UserPlus className="h-4 w-4" />
          {t('org_team.invite_member')}
        </button>
      </div>

      {/* Members table */}
      {members.length === 0 ? (
        <OrgEmptyState
          icon={Users}
          title={t('org_team.no_team_members')}
          description={t('org_team.invite_desc')}
          action={
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded bg-white/[0.07] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <UserPlus className="h-4 w-4" />
              {t('org_team.invite_team_member')}
            </button>
          }
        />
      ) : (
        <OrgDataTable
          rows={members}
          columns={columnsWithActions}
          rowKey={(m) => m.id}
        />
      )}

      {/* Guidelines */}
      <div className="mt-8 rounded-2xl bg-white/[0.055] p-5">
        <h3 className="mb-3 font-display lowercase italic !text-[22px] !leading-snug text-white">{t('org_team.access_levels')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.06] p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/60" />
            <div>
              <p className="text-sm font-semibold text-white">{t('actions.admin')}</p>
              <p className="mt-0.5 text-xs text-white/50">{t('org_team.full_access')}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.06] p-4">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
            <div>
              <p className="text-sm font-semibold text-white">{t('actions.staff')}</p>
              <p className="mt-0.5 text-xs text-white/50">{t('org_team.assigned_per_event')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Invite drawer */}
      <Drawer
        open={open}
        onClose={() => { setOpen(false); reset() }}
        title={t('org_team.invite_team_member')}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setOpen(false); reset() }}
              className="rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleInvite}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <UserPlus className="h-4 w-4" />
              {isPending ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
        }
      >
        <FormSection title={t('org_team.member_details')}>
          <FormField label={t('org_team.email_address')} htmlFor="team-email" required>
            <input
              id="team-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="bg-white/[0.06] w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </FormField>
          <FormField label="Name" htmlFor="team-name">
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('org_team.optional')}
              className="bg-white/[0.06] w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </FormField>
          <FormField label="Role" htmlFor="team-role">
            <select
              id="team-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="bg-white/[0.06] w-full rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}, {r.description}
                </option>
              ))}
            </select>
          </FormField>
          {error && (
            <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
        </FormSection>
      </Drawer>
    </>
  )
}
