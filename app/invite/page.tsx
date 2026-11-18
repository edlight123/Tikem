'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { auth } from '@/lib/firebase/client'
import { onAuthStateChanged } from 'firebase/auth'

type Status = 'loading' | 'ready' | 'success' | 'error'

export default function InvitePage() {
  const { t } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const eventId = useMemo(() => searchParams.get('eventId') || '', [searchParams])
  const token = useMemo(() => searchParams.get('token') || '', [searchParams])
  const appInviteUrl = useMemo(() => {
    if (!eventId || !token) return ''
    return `tikem://invite?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`
  }, [eventId, token])

  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  }, [])

  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    if ((!eventId || !token) && typeof window !== 'undefined') {
      // If the query params were lost (common after auth redirects), recover the invite from storage.
      try {
        const raw = window.localStorage.getItem('eh:pendingInvite')
        if (raw) {
          const parsed = JSON.parse(raw) as { eventId?: string; token?: string; createdAt?: number }
          const storedEventId = String(parsed?.eventId || '')
          const storedToken = String(parsed?.token || '')
          if (storedEventId && storedToken) {
            router.replace(
              `/invite?eventId=${encodeURIComponent(storedEventId)}&token=${encodeURIComponent(storedToken)}`
            )
            return
          }
        }
      } catch {
        // ignore
      }
    }

    if (!eventId || !token) {
      setStatus('error')
      setMessage(t('invite.invalid_link', 'Invalid invite link.'))
      return
    }

    // Persist the invite so a login roundtrip can continue without re-pasting the link.
    // This is safe because the token is already present in the URL.
    try {
      if (typeof window !== 'undefined') {
        const redirect = `/invite?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`
        window.localStorage.setItem('eh:pendingRedirect', redirect)
        window.localStorage.setItem(
          'eh:pendingInvite',
          JSON.stringify({ eventId, token, createdAt: Date.now() })
        )
      }
    } catch {
      // ignore storage failures
    }

    // Wait for the persisted session to be restored before treating a null
    // user as signed out — onAuthStateChanged's first emission is null while
    // that restore is still running, and redirecting on it sent already
    // signed-in people to the login screen from an invite link.
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    auth
      .authStateReady()
      .catch(() => {})
      .then(() => {
        if (!cancelled) unsubscribe = onAuthStateChanged(auth, onUser)
      })

    async function onUser(user: import('firebase/auth').User | null) {
      if (cancelled) return
      if (!user) {
        const redirect = `/invite?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`
        router.replace(`/auth/login?redirect=${encodeURIComponent(redirect)}`)
        return
      }

      setStatus('ready')
      try {
        const res = await fetch('/api/staff/invites/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, token }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          const code = String(json?.code || '')
          const friendly =
            code === 'already-exists'
              ? t('invite.error_already_claimed', 'This invite was already claimed.')
              : code === 'deadline-exceeded'
                ? t('invite.error_expired', 'This invite has expired.')
                : code === 'permission-denied'
                  ? t('invite.error_restricted', 'This invite is restricted to a different account.')
                  : code === 'not-found'
                    ? t('invite.error_not_found', 'Invite not found.')
                    : String(json?.error || t('invite.error_generic', 'Failed to redeem invite.'))

          setStatus('error')
          setMessage(friendly)
          return
        }

        setStatus('success')
        setMessage(t('invite.success_message', 'Invite accepted. Redirecting…'))
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('eh:pendingRedirect')
            window.localStorage.removeItem('eh:pendingInvite')
          }
        } catch {
          // ignore
        }
        router.replace(`/organizer/scan/${encodeURIComponent(eventId)}`)
      } catch (err: any) {
        setStatus('error')
        setMessage(err?.message || t('invite.error_generic', 'Failed to redeem invite.'))
      }
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // `t` is deliberately NOT a dependency. Its identity changes when the
    // language does, and re-running this effect would POST the redeem endpoint
    // a second time for an invite already claimed. It is only read to phrase an
    // error, so a stale closure costs a message in the previous language —
    // cheaper than a duplicate redeem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, token, router, isMobile])

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md bg-surface-low border border-line rounded-xl p-6 shadow-sm">
        <h1 className="text-xl font-bold text-fg">{t('invite.title', 'Event Invite')}</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {status === 'loading' && t('invite.loading', 'Loading…')}
          {status === 'ready' && t('invite.accepting', 'Accepting invite…')}
          {status === 'success' && message}
          {status === 'error' && message}
        </p>

        {isMobile && status !== 'error' && appInviteUrl ? (
          <div className="mt-5 space-y-3">
            <a
              href={appInviteUrl}
              className="block w-full text-center px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-fg font-medium rounded-lg transition-colors"
            >
              {t('invite.open_in_app', 'Open in app')}
            </a>
            <p className="text-xs text-fg-subtle">
              {t('invite.install_note', "If you don't have the app installed, you can still accept on desktop.")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
