'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { useOrgClientAuth } from '@/lib/organizer/useOrgClientAuth'

type InviteMethod = 'link' | 'email' | 'phone'

type EventInvite = {
  id: string
  method: InviteMethod
  targetEmail: string | null
  targetPhone: string | null
  expiresAt: any
  revokedAt: any
  usedAt: any
  usedBy: string | null
  createdAt: any
}

type EventMember = {
  id: string
  role: string
  /** 'tikem_door_team': Tikèm's own door crew (lib/doorTeam), managed by Tikèm only. */
  source?: string
  first_name?: string
  permissions: { checkin?: boolean; viewAttendees?: boolean }
  createdAt: any
}

type MemberProfile = {
  email: string | null
  full_name: string | null
}

export default function EventStaffManager({ eventId }: { eventId: string }) {
  const { t: tx } = useTranslation('organizer')

  const { showToast } = useToast()
  // The page (server) already checked this account may manage the event's
  // org; here we only wait for the browser session.
  const { firebaseUser, loading: authLoading } = useOrgClientAuth(`/organizer/events/${eventId}/staff`)

  const authReady = !authLoading
  const authUid = firebaseUser?.uid || null

  const [invites, setInvites] = useState<EventInvite[]>([])
  const [members, setMembers] = useState<EventMember[]>([])
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberProfile>>({})
  const [listenerError, setListenerError] = useState<string | null>(null)

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [method, setMethod] = useState<InviteMethod>('link')
  const [targetEmail, setTargetEmail] = useState('')
  const [targetPhone, setTargetPhone] = useState('')
  const [viewAttendees, setViewAttendees] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'revoke' | 'remove'; id: string; title: string; message: string; cta: string }
    | null
  >(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [permBusy, setPermBusy] = useState<Record<string, boolean>>({})

  const inviteMethodRef = useRef<HTMLSelectElement | null>(null)

  const closeInviteModal = useCallback(() => {
    setShowInviteModal(false)
    setTargetEmail('')
    setTargetPhone('')
    setViewAttendees(false)
    setMethod('link')
  }, [])

  // Focus first field when the invite modal opens.
  useEffect(() => {
    if (showInviteModal) {
      const t = setTimeout(() => inviteMethodRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [showInviteModal])

  // Close modal / confirm on Escape.
  useEffect(() => {
    if (!showInviteModal && !pendingConfirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingConfirm) setPendingConfirm(null)
        else if (showInviteModal) closeInviteModal()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showInviteModal, pendingConfirm, closeInviteModal])

  const canSubmit = useMemo(() => {
    if (method === 'email') return Boolean(targetEmail.trim())
    if (method === 'phone') return Boolean(targetPhone.trim())
    return true
  }, [method, targetEmail, targetPhone])

  // The staff list comes from the server (GET /api/organizer/events/:id/staff),
  // never a direct Firestore read of events/{id}/members: that route redacts
  // Tikèm's door crew (first name + "Tikèm crew", no uid / email / request id)
  // and resolves the organizer's own staff profiles in the same call. It is
  // refetched after every action and polled while the tab is visible, so the
  // list stays as live as the old listener for invite redemptions.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/staff`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListenerError('Unable to load staff members. You may not have permission for this event.')
        return
      }
      const apiMembers: any[] = Array.isArray(json?.members) ? json.members : []
      setInvites(Array.isArray(json?.invites) ? json.invites : [])
      setMembers(
        apiMembers.map((m) => ({
          id: String(m.id),
          role: String(m.role || 'staff'),
          permissions: m.permissions || {},
          createdAt: m.createdAt || null,
          ...(m.tikemCrew ? { source: 'tikem_door_team', first_name: String(m.profile?.full_name || '') } : {}),
        }))
      )
      const profiles: Record<string, MemberProfile> = {}
      for (const m of apiMembers) {
        if (!m.tikemCrew) profiles[String(m.id)] = { email: m.profile?.email ?? null, full_name: m.profile?.full_name ?? null }
      }
      setMemberProfiles(profiles)
      setListenerError(null)
    } catch (err) {
      console.error('Staff list load failed:', err)
      setListenerError('Unable to load staff members. Check your connection and try again.')
    }
  }, [eventId])

  useEffect(() => {
    if (!authReady) return
    if (!authUid) {
      setInvites([])
      setMembers([])
      setMemberProfiles({})
      setListenerError(null)
      return
    }
    void refresh()
    const poll = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh()
    }, 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authReady, authUid, refresh])

  const handleCreateInvite = useCallback(async () => {
    if (!canSubmit) return

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/staff/invites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        eventId,
        method,
        ...(method === 'email' ? { targetEmail: targetEmail.trim() } : {}),
        ...(method === 'phone' ? { targetPhone: targetPhone.trim() } : {}),
        permissions: { viewAttendees },
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = String(json?.error || 'Failed to create invite')
        showToast({ title: 'Error', message, type: 'error' })
        return
      }

      const inviteUrl = (json as any)?.inviteUrl as string | undefined
      if (inviteUrl) {
        try {
          await navigator.clipboard.writeText(inviteUrl)
          showToast({ title: 'Invite link copied', message: 'Share it with your staff member.', type: 'success' })
        } catch {
          showToast({ title: 'Invite created', message: inviteUrl, type: 'success' })
        }
      } else {
        showToast({ title: 'Invite created', message: 'Share the invite link with your staff member.', type: 'success' })
      }

      closeInviteModal()
      void refresh()
    } catch (err: any) {
      showToast({ title: 'Error', message: err?.message || 'Failed to create invite', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, closeInviteModal, eventId, method, refresh, showToast, targetEmail, targetPhone, viewAttendees])

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      try {
        const res = await fetch('/api/staff/invites/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, inviteId }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          showToast({ title: 'Error', message: String(json?.error || 'Failed to revoke invite'), type: 'error' })
          return
        }
        showToast({ title: 'Invite revoked', message: 'The link can no longer be used.', type: 'success' })
        void refresh()
      } catch (err: any) {
        showToast({ title: 'Error', message: err?.message || 'Failed to revoke invite', type: 'error' })
      }
    },
    [eventId, refresh, showToast]
  )

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      try {
        const res = await fetch('/api/staff/members/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, memberId }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          showToast({ title: 'Error', message: String(json?.error || 'Failed to remove member'), type: 'error' })
          return
        }
        showToast({ title: 'Member removed', message: 'Staff access removed.', type: 'success' })
        // Drop the row now; the refetch confirms it.
        setMembers((prev) => prev.filter((m) => m.id !== memberId))
        void refresh()
      } catch (err: any) {
        showToast({ title: 'Error', message: err?.message || 'Failed to remove member', type: 'error' })
      }
    },
    [eventId, refresh, showToast]
  )

  const handleToggleViewAttendees = useCallback(
    async (memberId: string, next: boolean) => {
      const applyValue = (value: boolean) =>
        setMembers((prev) =>
          prev.map((m) =>
            m.id === memberId
              ? { ...m, permissions: { ...m.permissions, viewAttendees: value } }
              : m
          )
        )

      // Optimistic update; revert if the request fails.
      setPermBusy((prev) => ({ ...prev, [memberId]: true }))
      applyValue(next)

      try {
        const res = await fetch('/api/staff/members/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, memberId, permissions: { viewAttendees: next } }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          applyValue(!next)
          showToast({ title: 'Error', message: String(json?.error || 'Failed to update permissions'), type: 'error' })
          return
        }
        showToast({
          title: 'Permissions updated',
          message: next ? 'They can now view the attendee list.' : 'They can no longer view the attendee list.',
          type: 'success',
        })
      } catch (err: any) {
        applyValue(!next)
        showToast({ title: 'Error', message: err?.message || 'Failed to update permissions', type: 'error' })
      } finally {
        setPermBusy((prev) => {
          const nextState = { ...prev }
          delete nextState[memberId]
          return nextState
        })
      }
    },
    [eventId, showToast]
  )

  const runPendingConfirm = useCallback(async () => {
    if (!pendingConfirm) return
    setConfirmBusy(true)
    try {
      if (pendingConfirm.kind === 'revoke') {
        await handleRevokeInvite(pendingConfirm.id)
      } else {
        await handleRemoveMember(pendingConfirm.id)
      }
    } finally {
      setConfirmBusy(false)
      setPendingConfirm(null)
    }
  }, [pendingConfirm, handleRevokeInvite, handleRemoveMember])

  return (
    <div className="space-y-6">
      {listenerError ? (
        <div className="bg-danger-strong/10 text-danger-soft px-4 py-3 rounded-lg text-sm">
          {listenerError}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex h-10 w-full items-center justify-center gap-2 px-4 bg-inverse hover:bg-inverse-hover text-on-inverse font-semibold rounded transition-colors sm:w-auto"
        >
          {tx('event_staff.invite_staff')}
        </button>
      </div>

      <div className="bg-surface rounded overflow-hidden">
        <div className="px-6 py-4 border-b border-line">
          <h3 className="font-display lowercase italic !text-section !leading-snug text-fg">{tx('event_staff.staff_members')}</h3>
        </div>
        {members.length === 0 ? (
          <div className="px-6 py-8 text-sm text-fg-muted">{tx('event_staff.no_staff_yet')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="block w-full sm:table">
              <thead className="hidden border-b border-line bg-surface-low sm:table-header-group">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">{tx('event_staff.permissions')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider">{tx('event_staff.actions')}</th>
                </tr>
              </thead>
              <tbody className="block divide-y divide-line sm:table-row-group">
                {members.map((m) => {
                  // Tikèm's door crew: first name only, read-only (managed by Tikèm).
                  const tikemCrew = m.source === 'tikem_door_team'
                  const profile = tikemCrew ? undefined : memberProfiles[m.id]
                  const displayName = tikemCrew ? m.first_name || tx('event_staff.tikem_crew') : profile?.full_name || profile?.email || m.id
                  const showEmail = profile?.full_name && profile?.email

                  return (
                    <tr key={m.id} className="block py-2 hover:bg-surface-low sm:table-row sm:py-0">
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4">
                        <div className="font-medium text-fg">{displayName}</div>
                        <div className="text-sm text-fg-muted">{tikemCrew ? tx('event_staff.tikem_crew') : m.role || 'staff'}</div>
                        {showEmail && (
                          <div className="text-xs text-fg-muted mt-0.5">{profile.email}</div>
                        )}
                      </td>
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4 text-sm text-fg-muted">
                        <div className="space-y-2">
                          <div className="text-fg-muted">{tx('event_staff.can_check_in')}</div>
                          {m.role === 'owner' || tikemCrew ? (
                            <div className="text-fg-muted">
                              Can view attendee list: {m.permissions?.viewAttendees ? 'Yes' : 'No'}
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <span className="text-fg-muted">{tx('event_staff.can_view_attendee_list')}</span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(m.permissions?.viewAttendees)}
                                aria-label={tx('event_staff.can_view_attendee_list')}
                                disabled={Boolean(permBusy[m.id])}
                                onClick={() => handleToggleViewAttendees(m.id, !m.permissions?.viewAttendees)}
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${
                                  m.permissions?.viewAttendees ? 'bg-brand-500' : 'bg-surface-high'
                                }`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full bg-inverse transition-transform ${
                                    m.permissions?.viewAttendees ? 'translate-x-6' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4 sm:text-right">
                        {!tikemCrew && (
                        <button
                          onClick={() =>
                            setPendingConfirm({
                              kind: 'remove',
                              id: m.id,
                              title: 'Remove staff member?',
                              message: 'This revokes their event-scoped access. They can be re-invited later.',
                              cta: 'Remove',
                            })
                          }
                          className="text-sm font-medium text-danger-soft transition-colors hover:text-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-strong rounded"
                        >
                          {tx('actions.remove')}
                        </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-surface rounded overflow-hidden">
        <div className="px-6 py-4 border-b border-line">
          <h3 className="font-display lowercase italic !text-section !leading-snug text-fg">{tx('event_staff.invites')}</h3>
        </div>
        {invites.length === 0 ? (
          <div className="px-6 py-8 text-sm text-fg-muted">{tx('event_staff.no_invites_yet')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="block w-full sm:table">
              <thead className="hidden border-b border-line bg-surface-low sm:table-header-group">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">{tx('event_staff.method')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">{tx('event_staff.target')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">{tx('event_staff.status')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider">{tx('event_staff.actions')}</th>
                </tr>
              </thead>
              <tbody className="block divide-y divide-line sm:table-row-group">
                {invites.map((inv) => {
                  const status = inv.revokedAt
                    ? 'Revoked'
                    : inv.usedAt
                      ? 'Claimed'
                      : 'Pending'

                  const target = inv.method === 'email' ? inv.targetEmail : inv.method === 'phone' ? inv.targetPhone : 'Link'

                  return (
                    <tr key={inv.id} className="block py-2 hover:bg-surface-low sm:table-row sm:py-0">
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4 text-sm text-fg">{inv.method}</td>
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4 text-sm text-fg-muted">{target || ''}</td>
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4 text-sm text-fg-muted">{status}</td>
                      <td className="block px-4 py-1.5 sm:table-cell sm:px-6 sm:py-4 sm:text-right">
                        {!inv.revokedAt && !inv.usedAt ? (
                          <button
                            onClick={() =>
                              setPendingConfirm({
                                kind: 'revoke',
                                id: inv.id,
                                title: 'Revoke this invite?',
                                message: 'The invite link will stop working immediately.',
                                cta: 'Revoke',
                              })
                            }
                            className="text-sm font-medium text-danger-soft transition-colors hover:text-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-strong rounded"
                          >
                            {tx('actions.revoke')}
                          </button>
                        ) : (
                          <span className="text-sm text-fg-muted">{EMPTY_VALUE}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInviteModal && (
        <div
          className="fixed inset-0 bg-scrim-light z-50 flex items-center justify-center p-4"
          onClick={closeInviteModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-staff-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-raised-solid rounded-2xl max-w-md w-full p-6"
          >
            <h3 id="invite-staff-title" className="font-display italic text-xl text-fg mb-4">{tx('event_staff.invite_staff')}</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="invite-method" className="block text-sm font-medium text-fg-muted mb-2">{tx('event_staff.method')}</label>
                <select
                  id="invite-method"
                  ref={inviteMethodRef}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as InviteMethod)}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg text-fg focus:ring-2 focus:ring-brand-500/60"
                >
                  <option value="link">Link</option>
                  <option value="email">{tx('actions.email')}</option>
                </select>
              </div>

              {method === 'email' && (
                <div>
                  <label htmlFor="invite-email" className="block text-sm font-medium text-fg-muted mb-2">{tx('actions.email')}</label>
                  <input
                    id="invite-email"
                    type="email"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface rounded-lg text-fg placeholder-fg-faint focus:ring-2 focus:ring-brand-500/60"
                    placeholder="staff@example.com"
                  />
                </div>
              )}

              {method === 'phone' && (
                <div>
                  <label htmlFor="invite-phone" className="block text-sm font-medium text-fg-muted mb-2">{tx('actions.phone')}</label>
                  <input
                    id="invite-phone"
                    type="tel"
                    value={targetPhone}
                    onChange={(e) => setTargetPhone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface rounded-lg text-fg placeholder-fg-faint focus:ring-2 focus:ring-brand-500/60"
                    placeholder="+509..."
                  />
                </div>
              )}

              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-fg">{tx('event_staff.allow_viewing_attendee_details')}</p>
                  <p className="text-xs text-fg-muted">{tx('event_staff.let_staff_see_contacts')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={viewAttendees}
                  aria-label={tx('event_staff.allow_viewing_attendee_details')}
                  onClick={() => setViewAttendees((v) => !v)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    viewAttendees ? 'bg-brand-500' : 'bg-surface-high'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-inverse transition-transform ${
                      viewAttendees ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeInviteModal}
                  className="flex-1 px-4 py-2.5 text-fg-muted font-medium rounded hover:bg-surface-high transition-colors bg-surface-raised"
                >
                  {tx('actions.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!canSubmit || isSubmitting}
                  onClick={handleCreateInvite}
                  className="flex-1 px-4 py-2.5 bg-inverse hover:bg-inverse-hover text-on-inverse font-semibold rounded disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Creating…' : 'Create Invite'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <div
          className="fixed inset-0 bg-scrim-light z-50 flex items-center justify-center p-4"
          onClick={() => !confirmBusy && setPendingConfirm(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-confirm-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-raised-solid rounded-2xl max-w-md w-full p-6"
          >
            <h3 id="staff-confirm-title" className="font-display italic text-xl text-fg mb-2">{pendingConfirm.title}</h3>
            <p className="text-sm text-fg-muted mb-6">{pendingConfirm.message}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={confirmBusy}
                className="flex-1 px-4 py-2.5 text-fg-muted font-medium rounded hover:bg-surface-high transition-colors disabled:opacity-50 bg-surface-raised"
              >
                {tx('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={runPendingConfirm}
                disabled={confirmBusy}
                className="flex-1 px-4 py-2.5 bg-danger-strong hover:bg-danger-strong text-fg font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {confirmBusy ? 'Working…' : pendingConfirm.cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
