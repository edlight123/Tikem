'use client'

/**
 * Organizer Requests: pending first, approve / decline one by one or all at once.
 * Stitch: 4d0474f2462042c2a23f5eb1dde0fae0 (built within the house rules: 4px
 * corners, rows on a fill with no border, status as dot + label).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import { EditorialSectionHeading } from '@/components/ui/EditorialHeader'
import { EmptyState } from '@/components/ui/kit'
import { useToast } from '@/components/ui/Toast'
import RequestStatusLabel, { attendErrorKey, toneForStatus } from '@/components/attend-requests/RequestStatusLabel'
import { defaultAvatarUrl } from '@/lib/defaultAvatar'
import { intlLocaleFor } from '@/lib/dateLocale'

type Row = {
  id: string
  status: 'pending' | 'approving' | 'approved' | 'declined'
  name: string
  email: string
  avatar_url: string | null
  plus_ones: Array<{ first_name: string; phone: string | null }>
  note: string
  quantity: number
  created_at: string | null
  last_error: string | null
}

type Tab = 'pending' | 'approved' | 'declined'

function relativeTime(iso: string | null, locale: string): string {
  const then = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(then)) return ''
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const s = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return rtf.format(s, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url || defaultAvatarUrl(name || '')}
      alt=""
      className="h-11 w-11 shrink-0 rounded-full object-cover"
    />
  )
}

export default function RequestsClient({ eventId, requiresApproval }: { eventId: string; requiresApproval: boolean }) {
  const { t, i18n } = useTranslation('common')
  const { showToast } = useToast()
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  // Which row has a call in flight ('*' = approve all). One call at a time.
  const [busy, setBusy] = useState<string | null>(null)
  const locale = intlLocaleFor(i18n.language)

  const api = `/api/organizer/events/${encodeURIComponent(eventId)}/requests`

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch(api, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setRows(Array.isArray(data?.requests) ? data.requests : [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => {
    const g: Record<Tab, Row[]> = { pending: [], approved: [], declined: [] }
    for (const r of rows) g[toneForStatus(r.status)].push(r)
    return g
  }, [rows])

  async function act(body: Record<string, unknown>, key: string) {
    if (busy) return
    setBusy(key)
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast({ type: 'error', title: t(attendErrorKey(data?.code)) })
      } else if (body.action === 'approve_all') {
        const approved = Number(data?.approved || 0)
        const failed = Number(data?.failed || 0)
        showToast({
          type: failed > 0 ? 'warning' : 'success',
          title:
            failed > 0
              ? t('attend_requests.organizer.approve_all_partial', { approved, failed })
              : t('attend_requests.organizer.approve_all_done', { count: approved }),
          ...(data?.stoppedBecause ? { message: t(attendErrorKey(data.stoppedBecause)) } : {}),
        })
      } else {
        showToast({
          type: 'success',
          title: t(body.action === 'approve' ? 'attend_requests.organizer.approved_toast' : 'attend_requests.organizer.declined_toast'),
        })
      }
    } catch {
      showToast({ type: 'error', title: t('attend_requests.errors.generic') })
    } finally {
      // Always re-read: the server is the only source of truth for statuses.
      await load()
      setBusy(null)
      // Refresh the layout's pending count on the tab.
      router.refresh()
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'pending', label: t('attend_requests.organizer.tab_pending') },
    { id: 'approved', label: t('attend_requests.organizer.tab_approved') },
    { id: 'declined', label: t('attend_requests.organizer.tab_declined') },
  ]
  const visible = groups[tab]
  const pendingCount = groups.pending.length

  return (
    <div className="space-y-6">
      <EditorialSectionHeading
        title={t('attend_requests.organizer.title')}
        description={t('attend_requests.organizer.subtitle')}
        actions={
          pendingCount > 0 ? (
            <button
              type="button"
              onClick={() => act({ action: 'approve_all' }, '*')}
              disabled={busy !== null}
              className="rounded bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
            >
              {t('attend_requests.organizer.approve_all', { count: pendingCount })}
            </button>
          ) : null
        }
      />

      {!requiresApproval && (
        <p className="rounded bg-white/[0.03] px-4 py-3 text-sm text-white/60">{t('attend_requests.organizer.not_enabled')}</p>
      )}

      <div role="tablist" className="inline-flex gap-1 rounded bg-white/[0.03] p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={`rounded px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition-colors sm:px-4 ${
              tab === tb.id ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tb.label} ({groups[tb.id].length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded bg-white/[0.03]" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          title={t('attend_requests.organizer.load_failed')}
          action={
            <button type="button" onClick={load} className="rounded bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.12]">
              {t('attend_requests.organizer.retry')}
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t(`attend_requests.organizer.empty_${tab}`)}
          description={tab === 'pending' ? t('attend_requests.organizer.empty_pending_desc') : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => {
            const tone = toneForStatus(r.status)
            const plusLine =
              r.plus_ones.length > 0
                ? `+${r.plus_ones.length}: ${r.plus_ones
                    .map((p) => (p.phone ? `${p.first_name} · ${p.phone}` : p.first_name))
                    .join(', ')}`
                : t('attend_requests.organizer.solo')
            const rowBusy = busy === r.id || busy === '*'
            return (
              <li key={r.id} className="flex flex-col gap-4 rounded bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="flex min-w-0 flex-1 gap-4">
                  <Avatar name={r.name} url={r.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="font-semibold text-white">{r.name || r.email}</p>
                      {r.email && r.name && <p className="truncate text-xs text-white/45">{r.email}</p>}
                    </div>
                    <p className="mt-1 text-sm text-white/70">{plusLine}</p>
                    {r.note && <p className="mt-1.5 text-sm italic text-white/55">&ldquo;{r.note}&rdquo;</p>}
                    {r.last_error && tone === 'pending' && (
                      <p className="mt-1.5 text-xs text-amber-300">
                        {t('attend_requests.organizer.last_error', { reason: t(attendErrorKey(r.last_error)) })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <RequestStatusLabel tone={tone} label={t(`attend_requests.organizer.status_${tone}`)} />
                  <span className="text-xs text-white/40">{relativeTime(r.created_at, locale)}</span>
                  {tone === 'pending' && (
                    <div className="ml-auto flex gap-2 sm:ml-2">
                      <button
                        type="button"
                        onClick={() => act({ action: 'decline', requestId: r.id }, r.id)}
                        disabled={busy !== null}
                        className="rounded bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                      >
                        {t('attend_requests.organizer.decline')}
                      </button>
                      <button
                        type="button"
                        onClick={() => act({ action: 'approve', requestId: r.id }, r.id)}
                        disabled={busy !== null}
                        aria-busy={rowBusy}
                        className="rounded bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
                      >
                        {t('attend_requests.organizer.approve')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
