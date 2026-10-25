'use client'

import { EMPTY_VALUE } from '@/lib/format'
import { useTranslation } from 'react-i18next'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase/client'
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

  useEffect(() => {
    if (!authReady) return
    if (!authUid) {
      // Not signed in yet (or session-only auth); avoid starting listeners that will permission-deny.
      setInvites([])
      setMembers([])
      setMemberProfiles({})
      setListenerError(null)
      return
    }

    setListenerError(null)

    const invitesRef = collection(db, 'events', eventId, 'invites')
    const membersRef = collection(db, 'events', eventId, 'members')

    const unsubInvites = onSnapshot(
      query(invitesRef, orderBy('createdAt', 'desc')),
      (snap) => {
        const next: EventInvite[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        setInvites(next)
      },
      (error) => {
        // Prevent unhandled snapshot errors from crashing the page.
        console.error('Invites listener error:', error)
        setListenerError('Unable to load invites. You may not have permission for this event.')
      }
    )

    const unsubMembers = onSnapshot(
      query(membersRef, orderBy('createdAt', 'desc')),
      (snap) => {
        const next: EventMember[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        setMembers(next)
      },
      (error) => {
        console.error('Members listener error:', error)
        setListenerError('Unable to load staff members. You may not have permission for this event.')
      }
    )

    return () => {
      unsubInvites()
      unsubMembers()
    }
  }, [authReady, authUid, eventId])

  useEffect(() => {
    if (!authReady || !authUid) return
    if (members.length === 0) {
      setMemberProfiles({})
      return
    }

    const missingUids = Array.from(
      new Set(
        members
          .map((m) => m.id)
          .filter((uid) => uid && !memberProfiles[uid])
      )
    )

    if (missingUids.length === 0) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/staff/members/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, uids: missingUids }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          console.error('Failed to resolve profiles:', json?.error || res.statusText)
          return
        }

        const profiles = (json as any)?.profiles as Record<string, MemberProfile> | undefined
        if (!profiles || cancelled) return

        setMemberProfiles((prev) => ({ ...prev, ...profiles }))
      } catch (e) {
        console.error('Failed to resolve member profiles:', e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authReady, authUid, eventId, members, memberProfiles])

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
    } catch (err: any) {
      showToast({ title: 'Error', message: err?.message || 'Failed to create invite', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }, [canSubmit, closeInviteModal, eventId, method, showToast, targetEmail, targetPhone, viewAttendees])

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
      } catch (err: any) {
        showToast({ title: 'Error', message: err?.message || 'Failed to revoke invite', type: 'error' })
      }
    },
    [eventId, showToast]
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
      } catch (err: any) {
        showToast({ title: 'Error', message: err?.message || 'Failed to remove member', type: 'error' })
      }
    },
    [eventId, showToast]
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
        <div className="bg-red-500/10 text-red-300 px-4 py-3 rounded-lg text-sm">
          {listenerError}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded transition-colors"
        >
          {tx('event_staff.invite_staff')}
        </button>
      </div>

      <div className="bg-white/[0.055] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{tx('event_staff.staff_members')}</h3>
          <p className="text-sm text-white/70">{tx('event_staff.event_scoped_access')}</p>
        </div>
        {members.length === 0 ? (
          <div className="px-6 py-8 text-sm text-white/70">{tx('event_staff.no_staff_yet')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.03] border-b border-white/10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/70 uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/70 uppercase tracking-wider">{tx('event_staff.permissions')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-white/70 uppercase tracking-wider">{tx('event_staff.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {members.map((m) => {
                  const profile = memberProfiles[m.id]
                  const displayName = profile?.full_name || profile?.email || m.id
                  const showEmail = profile?.full_name && profile?.email

                  return (
                    <tr key={m.id} className="hover:bg-white/[0.04]">
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{displayName}</div>
                        <div className="text-sm text-white/70">{m.role || 'staff'}</div>
                        {showEmail && (
                          <div className="text-xs text-white/70 mt-0.5">{profile.email}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-white/70">
                        <div className="space-y-2">
                          <div className="text-white/70">{tx('event_staff.can_check_in')}</div>
                          {m.role === 'owner' ? (
                            <div className="text-white/70">
                              Can view attendee list: {m.permissions?.viewAttendees ? 'Yes' : 'No'}
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <span className="text-white/70">{tx('event_staff.can_view_attendee_list')}</span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(m.permissions?.viewAttendees)}
                                aria-label={tx('event_staff.can_view_attendee_list')}
                                disabled={Boolean(permBusy[m.id])}
                                onClick={() => handleToggleViewAttendees(m.id, !m.permissions?.viewAttendees)}
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${
                                  m.permissions?.viewAttendees ? 'bg-brand-500' : 'bg-white/15'
                                }`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    m.permissions?.viewAttendees ? 'translate-x-6' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
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
                          className="text-sm font-medium text-red-300 transition-colors hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
                        >
                          {tx('actions.remove')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white/[0.055] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h3 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{tx('event_staff.invites')}</h3>
          <p className="text-sm text-white/70">{tx('event_staff.invite_links_one_time')}</p>
        </div>
        {invites.length === 0 ? (
          <div className="px-6 py-8 text-sm text-white/70">{tx('event_staff.no_invites_yet')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.03] border-b border-white/10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/70 uppercase tracking-wider">{tx('event_staff.method')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/70 uppercase tracking-wider">{tx('event_staff.target')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-white/70 uppercase tracking-wider">{tx('event_staff.status')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-white/70 uppercase tracking-wider">{tx('event_staff.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {invites.map((inv) => {
                  const status = inv.revokedAt
                    ? 'Revoked'
                    : inv.usedAt
                      ? 'Claimed'
                      : 'Pending'

                  const target = inv.method === 'email' ? inv.targetEmail : inv.method === 'phone' ? inv.targetPhone : 'Link'

                  return (
                    <tr key={inv.id} className="hover:bg-white/[0.04]">
                      <td className="px-6 py-4 text-sm text-white">{inv.method}</td>
                      <td className="px-6 py-4 text-sm text-white/70">{target || ''}</td>
                      <td className="px-6 py-4 text-sm text-white/70">{status}</td>
                      <td className="px-6 py-4 text-right">
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
                            className="text-sm font-medium text-red-300 transition-colors hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
                          >
                            {tx('actions.revoke')}
                          </button>
                        ) : (
                          <span className="text-sm text-white/70">{EMPTY_VALUE}</span>
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
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={closeInviteModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-staff-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1c1c1c] rounded-2xl max-w-md w-full p-6"
          >
            <h3 id="invite-staff-title" className="font-display text-xl text-white mb-4">{tx('event_staff.invite_staff')}</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="invite-method" className="block text-sm font-medium text-white/70 mb-2">{tx('event_staff.method')}</label>
                <select
                  id="invite-method"
                  ref={inviteMethodRef}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as InviteMethod)}
                  className="w-full px-4 py-2.5 bg-white/[0.06] rounded-lg text-white focus:ring-2 focus:ring-brand-500/60"
                >
                  <option value="link">Link</option>
                  <option value="email">{tx('actions.email')}</option>
                  <option value="phone">{tx('actions.phone')}</option>
                </select>
              </div>

              {method === 'email' && (
                <div>
                  <label htmlFor="invite-email" className="block text-sm font-medium text-white/70 mb-2">{tx('actions.email')}</label>
                  <input
                    id="invite-email"
                    type="email"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/[0.06] rounded-lg text-white placeholder-white/30 focus:ring-2 focus:ring-brand-500/60"
                    placeholder="staff@example.com"
                  />
                </div>
              )}

              {method === 'phone' && (
                <div>
                  <label htmlFor="invite-phone" className="block text-sm font-medium text-white/70 mb-2">{tx('actions.phone')}</label>
                  <input
                    id="invite-phone"
                    type="tel"
                    value={targetPhone}
                    onChange={(e) => setTargetPhone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/[0.06] rounded-lg text-white placeholder-white/30 focus:ring-2 focus:ring-brand-500/60"
                    placeholder="+509..."
                  />
                </div>
              )}

              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{tx('event_staff.allow_viewing_attendee_details')}</p>
                  <p className="text-xs text-white/70">{tx('event_staff.let_staff_see_contacts')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={viewAttendees}
                  aria-label={tx('event_staff.allow_viewing_attendee_details')}
                  onClick={() => setViewAttendees((v) => !v)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    viewAttendees ? 'bg-brand-500' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      viewAttendees ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeInviteModal}
                  className="flex-1 px-4 py-2.5 text-white/70 font-medium rounded hover:bg-white/[0.12] transition-colors bg-white/[0.07]"
                >
                  {tx('actions.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!canSubmit || isSubmitting}
                  onClick={handleCreateInvite}
                  className="flex-1 px-4 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded disabled:opacity-50 transition-colors"
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
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !confirmBusy && setPendingConfirm(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-confirm-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1c1c1c] rounded-2xl max-w-md w-full p-6"
          >
            <h3 id="staff-confirm-title" className="font-display text-xl text-white mb-2">{pendingConfirm.title}</h3>
            <p className="text-sm text-white/70 mb-6">{pendingConfirm.message}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={confirmBusy}
                className="flex-1 px-4 py-2.5 text-white/70 font-medium rounded hover:bg-white/[0.12] transition-colors disabled:opacity-50 bg-white/[0.07]"
              >
                {tx('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={runPendingConfirm}
                disabled={confirmBusy}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
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
