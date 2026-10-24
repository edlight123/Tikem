'use client'

/**
 * "Request to join" for an approval-list event (docs/specs/approval-lists-and-plus-ones.md).
 * Stitch: sheet 83599c799500480c9d85c6380f67e656, states 3d94ae23570d41ccb95b15d7888e9f86.
 *
 * Replaces the claim button when `requires_approval` is on. A signed-in guest
 * sends a request (named plus-ones + a short note); their state comes back from
 * GET /api/events/[id]/attend-request: pending, approved (tickets issued) or
 * declined. Signed-out visitors are sent to sign in: a request has to land in an
 * account to be approved and notified.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'
import { useToast } from '@/components/ui/Toast'
import RequestStatusLabel, { attendErrorKey } from '@/components/attend-requests/RequestStatusLabel'
import { ATTEND_NOTE_MAX, PLUS_ONE_NAME_MAX } from '@/lib/events/approval'

type OwnRequest = {
  id: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  plus_ones: Array<{ first_name: string; phone: string | null }>
  quantity: number
}

const field =
  'w-full rounded bg-white/[0.055] px-4 py-3 text-[16px] text-white placeholder:text-white/35 focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50 sm:text-[15px]'

export default function RequestToJoin({
  eventId,
  userId,
  isPasswordProtected = false,
  compact = false,
}: {
  eventId: string
  userId: string | null
  isPasswordProtected?: boolean
  /** The phone's sticky buy bar: one row (status left, action right). */
  compact?: boolean
}) {
  const { t } = useTranslation('common')
  const { showToast } = useToast()
  const [loaded, setLoaded] = useState(false)
  const [request, setRequest] = useState<OwnRequest | null>(null)
  const [allowed, setAllowed] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guests, setGuests] = useState<Array<{ firstName: string; phone: string }>>([])
  const [note, setNote] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [code, setCode] = useState('')

  const load = useCallback(async () => {
    if (!userId) {
      setLoaded(true)
      return
    }
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attend-request`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setRequest(data?.request && data.request.status !== 'cancelled' ? data.request : null)
        setAllowed(Math.max(0, Number(data?.allowedPlusOnes) || 0))
      }
    } catch {
      /* the CTA still works; the POST answers with the real state */
    } finally {
      setLoaded(true)
    }
  }, [eventId, userId])

  useEffect(() => {
    load()
  }, [load])

  const loginHref = `/auth/login?redirect=${encodeURIComponent(`/events/${eventId}`)}`

  function openSheet() {
    setError(null)
    setNeedsCode(false)
    setOpen(true)
  }

  async function unlock(): Promise<boolean> {
    const res = await fetch('/api/events/verify-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, code: code.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.ok) return true
    setError(
      res.status === 429
        ? t('events.password_throttled', { defaultValue: 'Too many attempts. Please try again later.' })
        : t('events.password_incorrect', { defaultValue: 'Incorrect access code. Please try again.' })
    )
    return false
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (guests.some((g) => !g.firstName.trim())) {
      setError(t('attend_requests.errors.plus_one_name_required'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (needsCode) {
        if (!code.trim() || !(await unlock())) return
        setNeedsCode(false)
      }
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attend-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plusOnes: guests.map((g) => ({ firstName: g.firstName.trim(), phone: g.phone.trim() || undefined })),
          note: note.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.code === 'access_code_required' && isPasswordProtected) setNeedsCode(true)
        setError(t(attendErrorKey(data?.code)))
        return
      }
      setRequest(data.request)
      setOpen(false)
      showToast({ type: 'success', title: t('attend_requests.state.sent_toast'), duration: 4000 })
    } catch {
      setError(t('attend_requests.errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attend-request`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast({ type: 'error', title: t(attendErrorKey(data?.code)) })
        await load()
        return
      }
      setRequest(null)
      showToast({ type: 'info', title: t('attend_requests.state.cancelled') })
    } catch {
      showToast({ type: 'error', title: t('attend_requests.errors.generic') })
    } finally {
      setBusy(false)
    }
  }

  const primary =
    'block w-full min-h-12 rounded bg-white px-5 py-2.5 text-center text-[15px] font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50'
  const secondary =
    'block w-full min-h-12 rounded bg-white/[0.08] px-5 py-2.5 text-center text-[15px] font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-50'

  if (!userId) {
    return (
      <Link href={loginHref} className={primary}>
        {t('attend_requests.cta.sign_in')}
      </Link>
    )
  }

  if (!loaded) {
    return <div className="h-12 w-full animate-pulse rounded bg-white/[0.06]" aria-hidden="true" />
  }

  if (compact && request && request.status !== 'cancelled') {
    const tone = request.status === 'approved' ? 'approved' : request.status === 'declined' ? 'declined' : 'pending'
    return (
      <div className="flex min-h-12 items-center justify-between gap-3">
        <RequestStatusLabel tone={tone} label={t(`attend_requests.state.${tone}_label`)} />
        {tone === 'pending' && (
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="shrink-0 rounded bg-white/[0.08] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.12] disabled:opacity-50"
          >
            {t('attend_requests.state.cancel')}
          </button>
        )}
        {tone === 'approved' && (
          <Link
            href={`/tickets/event/${eventId}`}
            className="shrink-0 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
          >
            {t('attend_requests.state.view_tickets')}
          </Link>
        )}
      </div>
    )
  }

  if (request?.status === 'pending') {
    const extra = Math.max(0, Number(request.quantity || 1) - 1)
    return (
      <div className="space-y-3">
        <div>
          <RequestStatusLabel tone="pending" label={t('attend_requests.state.pending_label')} />
          <p className="mt-1.5 text-sm text-white/60">
            {extra > 0
              ? t('attend_requests.state.pending_body_plus', { count: extra })
              : t('attend_requests.state.pending_body')}
          </p>
        </div>
        <button type="button" onClick={cancel} disabled={busy} className={secondary}>
          {t('attend_requests.state.cancel')}
        </button>
      </div>
    )
  }

  if (request?.status === 'approved') {
    return (
      <div className="space-y-3">
        <div>
          <RequestStatusLabel tone="approved" label={t('attend_requests.state.approved_label')} />
          <p className="mt-1.5 text-sm text-white/60">{t('attend_requests.state.approved_body')}</p>
        </div>
        <Link href={`/tickets/event/${eventId}`} className={primary}>
          {t('attend_requests.state.view_tickets')}
        </Link>
      </div>
    )
  }

  if (request?.status === 'declined') {
    return (
      <div>
        <RequestStatusLabel tone="declined" label={t('attend_requests.state.declined_label')} />
        <p className="mt-1.5 text-sm text-white/60">{t('attend_requests.state.declined_body')}</p>
      </div>
    )
  }

  return (
    <>
      <button type="button" onClick={openSheet} className={primary}>
        {t('attend_requests.cta.request')}
      </button>
      <BottomSheet isOpen={open} onClose={() => !busy && setOpen(false)}>
        <form onSubmit={send} className="space-y-6 pb-2">
          <div>
            <h2 className="font-display lowercase italic !text-[30px] !leading-[1.05] text-white">
              {t('attend_requests.sheet.title')}
            </h2>
            <p className="mt-1.5 text-sm text-white/60">{t('attend_requests.sheet.subtitle')}</p>
          </div>

          {allowed > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">
                  {t('attend_requests.sheet.bringing')}
                </span>
                <div className="flex items-center gap-3 rounded bg-white/[0.055] px-2 py-1.5">
                  <button
                    type="button"
                    aria-label={t('attend_requests.sheet.decrease')}
                    disabled={guests.length === 0 || busy}
                    onClick={() => setGuests((g) => g.slice(0, -1))}
                    className="grid h-8 w-8 place-items-center rounded bg-white/[0.08] text-white hover:bg-white/[0.14] disabled:opacity-40"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[96px] text-center text-sm text-white">
                    {t('attend_requests.sheet.guests', { count: guests.length })}
                    <span className="text-white/45"> · {t('attend_requests.sheet.max', { count: allowed })}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={t('attend_requests.sheet.increase')}
                    disabled={guests.length >= allowed || busy}
                    onClick={() => setGuests((g) => [...g, { firstName: '', phone: '' }])}
                    className="grid h-8 w-8 place-items-center rounded bg-white/[0.08] text-white hover:bg-white/[0.14] disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {guests.map((g, i) => (
                <div key={i} className="space-y-2">
                  <label className="block text-sm text-white/70">
                    {t('attend_requests.sheet.first_name')}
                    <input
                      value={g.firstName}
                      maxLength={PLUS_ONE_NAME_MAX}
                      required
                      autoComplete="off"
                      onChange={(e) =>
                        setGuests((all) => all.map((x, j) => (j === i ? { ...x, firstName: e.target.value } : x)))
                      }
                      placeholder={t('attend_requests.sheet.first_name_placeholder')}
                      className={`${field} mt-1.5`}
                    />
                  </label>
                  <label className="block text-sm text-white/70">
                    {t('attend_requests.sheet.phone')}
                    <input
                      value={g.phone}
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      onChange={(e) =>
                        setGuests((all) => all.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))
                      }
                      placeholder="+509"
                      className={`${field} mt-1.5`}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor={`attend-note-${eventId}`} className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">
                {t('attend_requests.sheet.note')}
              </label>
              <span className="text-xs tabular-nums text-white/40">
                {note.length}/{ATTEND_NOTE_MAX}
              </span>
            </div>
            <textarea
              id={`attend-note-${eventId}`}
              value={note}
              maxLength={ATTEND_NOTE_MAX}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('attend_requests.sheet.note_placeholder')}
              className={`${field} mt-2 resize-none`}
            />
          </div>

          {needsCode && (
            <div>
              <p className="text-sm text-white/70">{t('attend_requests.sheet.code_title')}</p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('attend_requests.sheet.code_placeholder')}
                autoComplete="off"
                className={`${field} mt-2`}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button type="submit" disabled={busy} className={primary}>
              {busy ? t('attend_requests.sheet.sending') : needsCode ? t('attend_requests.sheet.unlock') : t('attend_requests.sheet.send')}
            </button>
            <p className="text-center text-xs text-white/45">{t('attend_requests.sheet.footnote')}</p>
          </div>
        </form>
      </BottomSheet>
    </>
  )
}
