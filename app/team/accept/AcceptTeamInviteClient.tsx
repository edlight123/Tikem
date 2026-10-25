'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { onAuthStateChanged } from 'firebase/auth'
import { Loader2 } from 'lucide-react'
import { auth } from '@/lib/firebase/client'
import { TikemWordmark } from '@/components/ui/TikemLogo'

type ErrorCode = 'expired' | 'used' | 'revoked' | 'invalid' | 'own_org' | 'generic'

export type InviteState =
  | { kind: 'working' }
  | { kind: 'joined'; orgName: string; role: string }
  | { kind: 'error'; code: ErrorCode }

const KNOWN_ERRORS: ErrorCode[] = ['expired', 'used', 'revoked', 'invalid', 'own_org']

/**
 * Accepts an organization team invite (docs/specs/org-teams.md). Signed out:
 * off to sign in, coming back to this exact link. Signed in: one POST to
 * /api/organizer/team/accept, which checks the emailed token, adds the
 * account to the team and points the web session at that org.
 */
export default function AcceptTeamInviteClient() {
  const { t } = useTranslation('organizer')
  const router = useRouter()
  const params = useSearchParams()
  const invite = useMemo(() => params.get('invite') || '', [params])
  const token = useMemo(() => params.get('token') || '', [params])
  const [state, setState] = useState<InviteState>({ kind: 'working' })
  // React strict mode runs effects twice in dev; the accept is idempotent for
  // the same account, but one request is still the right number.
  const started = useRef(false)

  useEffect(() => {
    if (!invite || !token) {
      setState({ kind: 'error', code: 'invalid' })
      return
    }
    const back = `/team/accept?invite=${encodeURIComponent(invite)}&token=${encodeURIComponent(token)}`
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    const accept = async () => {
      if (started.current) return
      started.current = true
      try {
        const res = await fetch('/api/organizer/team/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invite, token }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          code?: string
          orgName?: string
          role?: string
        }
        if (cancelled) return
        if (res.status === 401 || body.code === 'unauthenticated') {
          router.replace(`/auth/login?redirect=${encodeURIComponent(back)}`)
          return
        }
        if (!res.ok) {
          const code = KNOWN_ERRORS.includes(body.code as ErrorCode) ? (body.code as ErrorCode) : 'generic'
          setState({ kind: 'error', code })
          return
        }
        setState({ kind: 'joined', orgName: String(body.orgName || ''), role: String(body.role || '') })
      } catch {
        if (!cancelled) setState({ kind: 'error', code: 'generic' })
      }
    }

    // Wait for the stored session before reading a null user as signed out.
    auth
      .authStateReady()
      .catch(() => {})
      .then(() => {
        if (cancelled) return
        unsubscribe = onAuthStateChanged(auth, (user) => {
          if (cancelled) return
          if (!user) {
            router.replace(`/auth/login?redirect=${encodeURIComponent(back)}`)
            return
          }
          void accept()
        })
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [invite, token, router])

  return <InviteCard state={state} />
}

/** The page's one card, per state. Exported for the design preview. */
export function InviteCard({ state }: { state: InviteState }) {
  const { t } = useTranslation('organizer')
  const roleLabel = (role: string) => t(`team_roles.${role}`, { defaultValue: role })

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-black px-4 py-16">
      <Link href="/" className="mb-10 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <TikemWordmark italic className="text-3xl text-white" />
      </Link>

      <div className="w-full max-w-md rounded bg-[#141414] p-6 sm:p-8">
        {state.kind === 'working' && (
          <div className="flex flex-col items-center py-6 text-center" role="status" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin text-white/60" aria-hidden />
            <p className="mt-4 text-sm text-white/60">{t('team_accept.working')}</p>
          </div>
        )}

        {state.kind === 'joined' && (
          <div aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              {t('team_accept.eyebrow')}
            </p>
            <h1 className="mt-3 font-display !text-[30px] lowercase italic !leading-tight text-white">
              {t('team_accept.joined_title')}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-white/75">
              {state.orgName
                ? t('team_accept.joined_body', { org: state.orgName, role: roleLabel(state.role) })
                : t('team_accept.joined_body_no_name', { role: roleLabel(state.role) })}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/50">
              {state.role === 'staff' ? t('team_accept.staff_note') : t('team_accept.member_note')}
            </p>
            <Link
              href={state.role === 'staff' ? '/staff' : '/organizer'}
              className="mt-7 flex h-12 w-full items-center justify-center rounded bg-white text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {state.role === 'staff' ? t('team_accept.open_staff') : t('team_accept.open_dashboard')}
            </Link>
          </div>
        )}

        {state.kind === 'error' && (
          <div aria-live="polite">
            <p className="flex items-center gap-2 text-[13px] text-red-300">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />
              {t('team_accept.error_label')}
            </p>
            <h1 className="mt-3 font-display !text-[30px] lowercase italic !leading-tight text-white">
              {t(`team_accept.error_${state.code}_title`)}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-white/70">{t(`team_accept.error_${state.code}_body`)}</p>
            <Link
              href={state.code === 'own_org' ? '/organizer' : '/'}
              className="mt-7 flex h-12 w-full items-center justify-center rounded bg-white/[0.08] text-sm font-semibold text-white transition-colors hover:bg-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {state.code === 'own_org' ? t('team_accept.open_dashboard') : t('team_accept.go_home')}
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
