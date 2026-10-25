'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { UserPlus, Users, Trash2, ShieldCheck, User, Briefcase, Crown, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import { useConfirm } from '@/components/ui/ConfirmProvider'
import type { TeamRole } from '@/lib/organizer/teamRoles'

/** One roster row, as GET /api/organizer/team returns it. */
export interface TeamRow {
  /** Team doc id (the member's uid) or "invite:<inviteId>" for an open invite. */
  id: string
  uid: string | null
  email: string
  name: string | null
  role: string
  status: 'active' | 'invited'
  joined_at: string | null
  /** Admin the owner granted read-only finances (lib/organizer/teamRoles canViewFinances). */
  finance_view?: boolean
}

/** The owner renders as the first row; never sent to the API. */
type Row = TeamRow & { isOwner?: boolean }

interface OrgTeamClientProps {
  ownerName: string
  ownerEmail: string
  /** The signed-in account is the org owner (vs. an org admin). */
  viewerIsOwner: boolean
  viewerId: string
  members: TeamRow[]
  loadError?: boolean
}

// The three roles a team member can hold (lib/organizer/teamRoles.ts).
const ROLES: { value: TeamRole; icon: LucideIcon }[] = [
  { value: 'admin', icon: ShieldCheck },
  { value: 'manager', icon: Briefcase },
  { value: 'staff', icon: User },
]

// The access explainer: what each role can really do (docs/specs/org-teams.md).
const ACCESS: { role: 'owner' | TeamRole; icon: LucideIcon }[] = [
  { role: 'owner', icon: Crown },
  { role: 'admin', icon: ShieldCheck },
  { role: 'manager', icon: Briefcase },
  { role: 'staff', icon: User },
]

const OWNER_ROW_ID = '__owner__'

function initialOf(s: string): string {
  return (s || '?').trim().charAt(0).toUpperCase() || '?'
}

function RoleTiles({
  value,
  onChange,
  label,
}: {
  value: TeamRole
  onChange: (role: TeamRole) => void
  label: string
}) {
  const { t } = useTranslation('organizer')
  return (
    // Tiles, not a native <select>: the browser drew its option list white
    // under white text (owner feedback 2026-10-25). The chosen tile is the one
    // pure white fill, like every choice in the app.
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {ROLES.map((r) => {
        const active = value === r.value
        const Icon = r.icon
        return (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(r.value)}
            className={`flex items-start gap-3 rounded px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              active ? 'bg-white text-black' : 'bg-white/[0.06] text-white hover:bg-white/[0.1]'
            }`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-black/70' : 'text-white/60'}`} />
            <span>
              <span className="block text-sm font-semibold">{t(`team_roles.${r.value}`)}</span>
              <span className={`mt-0.5 block text-xs ${active ? 'text-black/60' : 'text-white/50'}`}>
                {t(`org_team.tile_${r.value}`)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * "Can see finances (read only)": the owner's grant to one admin. A switch row
 * (the circle is the toggle's own shape), shown only to the owner and only
 * while Admin is the picked role. Never withdrawals or payout details.
 */
function FinanceToggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTranslation('organizer')
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded bg-white/[0.06] px-4 py-3 text-left transition-colors hover:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{t('finance_view.toggle_label')}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/50">{t('finance_view.toggle_desc')}</span>
      </span>
      <span
        aria-hidden
        className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-white' : 'bg-white/[0.16]'
        }`}
      >
        <span
          className={`absolute h-5 w-5 rounded-full transition-transform ${
            checked ? 'translate-x-[18px] bg-black' : 'translate-x-0.5 bg-white/70'
          }`}
        />
      </span>
    </button>
  )
}

export default function OrgTeamClient({
  ownerName,
  ownerEmail,
  viewerIsOwner,
  viewerId,
  members: initialMembers,
  loadError = false,
}: OrgTeamClientProps) {
  const { t } = useTranslation('organizer')
  const confirm = useConfirm()

  const [members, setMembers] = useState<TeamRow[]>(initialMembers)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<TeamRole>('manager')
  // Read-only finances for an invited admin (owner only).
  const [finance, setFinance] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  // Role change: the row being edited and the role picked for it.
  const [editing, setEditing] = useState<TeamRow | null>(null)
  const [editRole, setEditRole] = useState<TeamRole>('manager')
  const [editFinance, setEditFinance] = useState(false)

  const roleLabel = (r: string) => t(`team_roles.${r}`, { defaultValue: r })

  const reset = () => {
    setEmail('')
    setName('')
    setRole('manager')
    setFinance(false)
    setError(null)
  }

  const handleInvite = () => {
    if (!email.trim()) {
      setError(t('org_team.email_required'))
      return
    }
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/organizer/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            name: name.trim(),
            role,
            // Only the owner may grant it, and only to an admin (the API checks too).
            ...(viewerIsOwner ? { finance_view: role === 'admin' && finance } : {}),
          }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string; member?: TeamRow }
        if (!res.ok || !body.member) throw new Error(body.error || t('org_team.invite_failed'))
        const member = body.member
        // Re-inviting an address replaces its row (the API revokes the older invite
        // or just re-roles an existing member).
        setMembers((prev) => [member, ...prev.filter((m) => m.id !== member.id && m.email !== member.email)])
        setOpen(false)
        reset()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('org_team.something_wrong'))
      }
    })
  }

  const handleRemove = async (m: TeamRow) => {
    const who = m.name || m.email
    const ok = await confirm({
      title: m.status === 'invited' ? t('org_team.revoke_title', { who }) : t('org_team.remove_title', { who }),
      description: m.status === 'invited' ? t('org_team.revoke_desc') : t('org_team.remove_desc'),
      confirmLabel: m.status === 'invited' ? t('org_team.revoke_cta') : t('org_team.remove_cta'),
      cancelLabel: t('actions.cancel'),
      variant: 'danger',
    })
    if (!ok) return
    setBusyId(m.id)
    setRowError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/organizer/team?memberId=${encodeURIComponent(m.id)}`, { method: 'DELETE' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || t('org_team.remove_failed'))
        }
        setMembers((prev) => prev.filter((x) => x.id !== m.id))
        // Removing yourself ends your access to this org.
        if (m.uid && m.uid === viewerId) window.location.assign('/organizer')
      } catch (err) {
        setRowError(err instanceof Error ? err.message : t('org_team.remove_failed'))
      } finally {
        setBusyId(null)
      }
    })
  }

  const openRoleEditor = (m: TeamRow) => {
    setEditing(m)
    setEditRole((['admin', 'manager', 'staff'].includes(m.role) ? m.role : 'staff') as TeamRole)
    setEditFinance(m.role === 'admin' && m.finance_view === true)
    setError(null)
  }

  const handleRoleSave = () => {
    if (!editing) return
    const target = editing
    const nextFinance = editRole === 'admin' && editFinance
    const financeChanged = viewerIsOwner && nextFinance !== (target.role === 'admin' && target.finance_view === true)
    if (editRole === target.role && !financeChanged) {
      setEditing(null)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/organizer/team', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memberId: target.id,
            role: editRole,
            ...(viewerIsOwner ? { finance_view: nextFinance } : {}),
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || t('org_team.role_failed'))
        }
        setMembers((prev) =>
          prev.map((x) =>
            x.id === target.id
              ? { ...x, role: editRole, finance_view: viewerIsOwner ? nextFinance : editRole === 'admin' && x.finance_view === true }
              : x,
          ),
        )
        setEditing(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('org_team.role_failed'))
      }
    })
  }

  const ownerRow: Row = {
    id: OWNER_ROW_ID,
    uid: null,
    email: ownerEmail,
    name: ownerName || null,
    role: 'owner',
    status: 'active',
    joined_at: null,
    isOwner: true,
  }
  const rows: Row[] = [ownerRow, ...members]

  const columns: OrgColumn<Row>[] = [
    {
      key: 'name',
      header: t('org_team.col_member'),
      render: (m) => {
        const you = m.isOwner ? viewerIsOwner : !!m.uid && m.uid === viewerId
        return (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.12] text-sm font-semibold text-white">
              {initialOf(m.name || m.email)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-white">
                {m.name || m.email || EMPTY_VALUE}
                {you && <span className="ml-2 text-xs font-normal text-white/40">{t('org_team.you')}</span>}
              </p>
              {m.name && m.email && <p className="truncate text-xs text-white/50">{m.email}</p>}
            </div>
          </div>
        )
      },
    },
    {
      key: 'role',
      header: t('org_team.role'),
      render: (m) =>
        m.isOwner ? (
          <span className="text-sm font-semibold text-white">{roleLabel('owner')}</span>
        ) : (
          <button
            type="button"
            onClick={() => openRoleEditor(m)}
            aria-label={t('org_team.change_role_for', { who: m.name || m.email })}
            className="-mx-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {roleLabel(m.role)}
            <ChevronDown className="h-3.5 w-3.5 text-white/40" aria-hidden />
            {m.role === 'admin' && m.finance_view && (
              // Dot + label, not a pill (no-status-pills rule).
              <span className="ml-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-white/55">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                {t('finance_view.row_marker')}
              </span>
            )}
          </button>
        ),
    },
    {
      key: 'status',
      header: t('actions.status'),
      render: (m) =>
        m.status === 'active' ? (
          <StatusChip tone="success" className="normal-case">{t('org_team.status_active')}</StatusChip>
        ) : (
          <StatusChip tone="warning" className="normal-case">{t('org_team.status_invited')}</StatusChip>
        ),
    },
    {
      key: 'joined_at',
      header: t('org_team.col_added'),
      hideOnMobile: true,
      render: (m) => m.isOwner ? null : (
        <span className="font-mono tabular-nums text-sm text-white/40">
          {m.joined_at
            ? new Date(m.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : EMPTY_VALUE}
        </span>
      ),
    },
    {
      key: 'id',
      header: '',
      align: 'right',
      render: (m) =>
        m.isOwner ? null : (
          <button
            type="button"
            onClick={() => handleRemove(m)}
            disabled={busyId === m.id}
            aria-label={
              m.status === 'invited'
                ? t('org_team.revoke_title', { who: m.name || m.email })
                : t('org_team.remove_title', { who: m.name || m.email })
            }
            className="inline-flex h-8 w-8 items-center justify-center rounded text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ),
    },
  ]

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title={t('org_team.people')} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <UserPlus className="h-4 w-4" />
          {t('org_team.invite_member')}
        </button>
      </div>

      {loadError && (
        <p className="mb-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{t('org_team.load_failed')}</p>
      )}
      {rowError && <p className="mb-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{rowError}</p>}

      <OrgDataTable rows={rows} columns={columns} rowKey={(m) => m.id} />

      {members.length === 0 && !loadError && (
        <div className="mt-4">
          <OrgEmptyState
            icon={Users}
            title={t('org_team.no_team_members')}
            description={t('org_team.invite_desc')}
          />
        </div>
      )}

      {/* What each role can really do: the same table as lib/organizer/teamRoles.ts. */}
      <section className="mt-10">
        <SectionHeader title={t('org_team.access_levels')} className="mb-3" />
        <div className="overflow-hidden rounded bg-white/[0.055]">
          {ACCESS.map(({ role: r, icon: Icon }, i) => (
            <div
              key={r}
              className={`flex items-start gap-3 px-4 py-4 sm:px-5 ${i > 0 ? 'border-t border-white/[0.06]' : ''}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/50" aria-hidden />
              <div className="min-w-0 sm:flex sm:flex-1 sm:gap-6">
                <p className="text-sm font-semibold text-white sm:w-28 sm:shrink-0">{roleLabel(r)}</p>
                <div className="mt-0.5 sm:mt-0">
                  <p className="text-[13px] leading-relaxed text-white/60">{t(`org_team.access_${r}`)}</p>
                  {r === 'admin' && (
                    <p className="mt-1 text-[13px] leading-relaxed text-white/45">{t('finance_view.access_note')}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

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
              {isPending ? t('org_team.inviting') : t('org_team.send_invite')}
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
              className="bg-white/[0.06] w-full rounded px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </FormField>
          <FormField label={t('org_team.name')} htmlFor="team-name">
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('org_team.optional')}
              className="bg-white/[0.06] w-full rounded px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </FormField>
          <FormField label={t('org_team.role')}>
            <RoleTiles value={role} onChange={setRole} label={t('org_team.role')} />
          </FormField>
          {viewerIsOwner && role === 'admin' && <FinanceToggle checked={finance} onChange={setFinance} />}
          <p className="text-xs leading-relaxed text-white/45">{t('org_team.invite_note')}</p>
          {error && open && (
            <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}
        </FormSection>
      </Drawer>

      {/* Role change drawer */}
      <Drawer
        open={editing !== null}
        onClose={() => { setEditing(null); setError(null) }}
        title={t('org_team.change_role')}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setEditing(null); setError(null) }}
              className="rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleRoleSave}
              disabled={isPending}
              className="rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {isPending ? t('org_team.saving') : t('org_team.save_role')}
            </button>
          </div>
        }
      >
        {editing && (
          <FormSection title={editing.name || editing.email}>
            <RoleTiles value={editRole} onChange={setEditRole} label={t('org_team.role')} />
            {viewerIsOwner && editRole === 'admin' && <FinanceToggle checked={editFinance} onChange={setEditFinance} />}
            {error && !open && (
              <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
            )}
          </FormSection>
        )}
      </Drawer>
    </>
  )
}
