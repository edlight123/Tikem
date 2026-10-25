'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import type { OrgRole } from '@/lib/organizer/teamRoles'
import { useOrgRole } from './OrgRoleProvider'

export interface SwitchableOrg {
  orgId: string
  orgName: string
  role: OrgRole
}

function initialOf(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

/**
 * "Freddy Events · Manager" in the organizer top bar, and the menu to act for
 * another org when the account can run more than one (its own + teams it is
 * on as admin/manager). Switching sets the tikem_org cookie server-side
 * (POST /api/organizer/orgs) and reloads /organizer, so every page and API
 * then answers for the chosen org.
 *
 * Also refreshes the list once per session from GET /api/organizer/orgs,
 * which accepts open invites sent to a verified email, so a new seat shows up
 * without a manual step.
 */
export function OrgSwitcher({ orgs: initialOrgs, staleOrgCookie = false }: { orgs: SwitchableOrg[]; staleOrgCookie?: boolean }) {
  const { t } = useTranslation('organizer')
  const router = useRouter()
  const active = useOrgRole()
  const [orgs, setOrgs] = useState<SwitchableOrg[]>(initialOrgs)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => setOrgs(initialOrgs), [initialOrgs])

  // A stale cookie (staff-only seat or removed membership): point it back at
  // the org the portal is actually acting for.
  useEffect(() => {
    if (!staleOrgCookie || !active) return
    fetch('/api/organizer/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: active.orgId }),
    }).catch(() => {})
  }, [staleOrgCookie, active])

  // Once per browser session: claim invites to a verified email and pick up new seats.
  useEffect(() => {
    let seen = false
    try {
      seen = sessionStorage.getItem('tikem_orgs_checked') === '1'
      sessionStorage.setItem('tikem_orgs_checked', '1')
    } catch {
      /* private mode: just check */
    }
    if (seen) return
    let cancelled = false
    fetch('/api/organizer/orgs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const next: SwitchableOrg[] = [
          ...(data.own ? [{ orgId: data.own.orgId, orgName: data.own.orgName, role: 'owner' as const }] : []),
          ...((data.memberships || []) as SwitchableOrg[]).filter((m) => m.role === 'admin' || m.role === 'manager'),
        ]
        if (next.length > orgs.length) {
          setOrgs(next)
          router.refresh()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!active) return null
  const canSwitch = orgs.length > 1
  // An owner with no other org has nothing to choose and nothing to disambiguate.
  if (!canSwitch && active.isOwner) return null

  const roleLabel = (role: OrgRole) => t(`team_roles.${role}`)
  const activeName = active.orgName || t('org_switcher.this_org')

  const switchTo = async (orgId: string) => {
    if (orgId === active.orgId) {
      setOpen(false)
      return
    }
    setBusy(orgId)
    setError(null)
    try {
      const res = await fetch('/api/organizer/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setOpen(false)
      // Full navigation: every server component and cached fetch answers for the new org.
      window.location.assign('/organizer')
    } catch {
      setError(t('org_switcher.switch_failed'))
      setBusy(null)
    }
  }

  const label = (
    <>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.14] text-xs font-bold text-white">
        {initialOf(activeName)}
      </span>
      <span className="hidden min-w-0 flex-col text-left leading-tight md:flex">
        <span className="max-w-[160px] truncate text-[13px] font-semibold text-white">{activeName}</span>
        <span className="text-[11px] text-white/50">{roleLabel(active.role)}</span>
      </span>
    </>
  )

  if (!canSwitch) {
    return (
      <div
        className="flex h-9 items-center gap-2 rounded px-1.5 md:pr-3"
        title={`${activeName} · ${roleLabel(active.role)}`}
        aria-label={t('org_switcher.acting_for_label', { org: activeName, role: roleLabel(active.role) })}
      >
        {label}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('org_switcher.acting_for_label', { org: activeName, role: roleLabel(active.role) })}
        className={`flex h-9 items-center gap-2 rounded px-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:pr-2 ${
          open ? 'bg-white/[0.12]' : 'hover:bg-white/[0.08]'
        }`}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('org_switcher.switch_org')}
          // Phone: pinned under the bar across the screen (the trigger sits mid-bar,
          // so a right-anchored panel ran off the left edge). Wider: under the trigger.
          className="fixed inset-x-4 top-14 z-50 mt-1 rounded bg-[#1c1c1c] p-1.5 shadow-2xl shadow-black/60 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72"
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
            {t('org_switcher.acting_for')}
          </p>
          {orgs.map((org) => {
            const isActive = org.orgId === active.orgId
            const name = org.orgName || t('org_switcher.this_org')
            return (
              <button
                key={org.orgId}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                disabled={busy !== null}
                onClick={() => switchTo(org.orgId)}
                className={`flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60 ${
                  isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.12] text-xs font-bold text-white">
                  {initialOf(name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{name}</span>
                  <span className="block text-xs text-white/50">
                    {busy === org.orgId ? t('org_switcher.switching') : roleLabel(org.role)}
                  </span>
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />}
              </button>
            )
          })}
          {error && <p className="px-2.5 py-2 text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  )
}
