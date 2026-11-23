'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/organizer/ui'
import { intlLocaleFor } from '@/lib/dateLocale'
import { buttonPrimary, buttonQuiet, DoneList, PickList, useWhen, type Created } from './ImportParts'

type Tier = { name: string; price: number; quantity: number }
type Ev = { id: string; title: string; start: string; venue: string; online: boolean; currency: string | null; tiers: Tier[] }
type EbState = { available: boolean; connected: boolean; expired?: boolean; events: Ev[] }
type SyncResult = { ok: boolean; reason?: string | null; created: number; updated: number; needs_review?: number; rate_limited: boolean }
type Sync = { connected: boolean; auto_sync: boolean; last_synced_at: string | null; last_sync_result: SyncResult | null }

const SYNC_API = '/api/organizer/integrations/eventbrite/sync'

/** Connect Eventbrite, keep live events in sync, or bring events over as drafts with their ticket types. */
export default function EventbriteSection() {
  const { t, i18n } = useTranslation('organizer')
  const when = useWhen()
  const [state, setState] = useState<EbState | null>(null)
  const [sync, setSync] = useState<Sync | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<Created[] | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/organizer/import/eventbrite')
      .then((r) => r.json())
      .then((d: EbState) => {
        setState(d)
        setPicked(new Set((d.events || []).map((e) => e.id)))
      })
      .catch(() => setState({ available: true, connected: false, events: [] }))
    fetch(SYNC_API)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSync)
      .catch(() => setSync(null))
  }, [])

  useEffect(() => {
    setStatus(new URLSearchParams(window.location.search).get('eventbrite'))
    load()
  }, [load])

  const noteFor = (r: SyncResult | null | undefined) =>
    !r ? '' : !r.ok ? t('import_page.eb_sync_failed') : r.rate_limited ? t('import_page.eb_sync_limited') : t('import_page.eb_sync_done', { count: (r.created || 0) + (r.updated || 0) })

  const syncNow = async () => {
    setSyncing(true)
    setNote('')
    const res = await fetch(SYNC_API, { method: 'POST' }).catch(() => null)
    const d = await res?.json().catch(() => null)
    setSyncing(false)
    if (!res?.ok) return setNote(res?.status === 429 ? t('import_page.errors.rate_limited') : t('import_page.eb_sync_failed'))
    setSync({ connected: d.connected, auto_sync: d.auto_sync, last_synced_at: d.last_synced_at, last_sync_result: d.last_sync_result })
    setNote(noteFor(d.result))
    load()
  }

  const toggleAuto = async () => {
    if (!sync) return
    const on = !sync.auto_sync
    setSync({ ...sync, auto_sync: on })
    const res = await fetch(SYNC_API, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_sync: on }) }).catch(() => null)
    if (!res?.ok) setSync((s) => (s ? { ...s, auto_sync: !on } : s))
  }

  const importNow = async () => {
    setBusy(true)
    setError('')
    const res = await fetch('/api/organizer/import/eventbrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...picked] }) }).catch(() => null)
    const d = await res?.json().catch(() => ({}))
    setBusy(false)
    if (!res?.ok) return setError(d?.code ? t(`import_page.errors.${d.code}`, { defaultValue: t('import_page.error_generic') }) : t('import_page.error_generic'))
    setDone(d.created || [])
  }

  const disconnect = async () => {
    await fetch('/api/organizer/import/eventbrite', { method: 'DELETE' }).catch(() => null)
    setState((s) => (s ? { ...s, connected: false, events: [] } : s))
    setSync(null)
    setDone(null)
  }

  const synced = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(intlLocaleFor(i18n.language), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
    } catch {
      return ''
    }
  }
  const tierLine = (e: Ev) =>
    e.tiers
      .map((tier) =>
        tier.price
          ? `${tier.name} ${tier.price} ${e.currency || ''}`.trim()
          : /^(free|gratuit|gratis)$/i.test(tier.name.trim())
            ? tier.name
            : `${tier.name} ${t('import_page.free_lower')}`,
      )
      .join(', ')

  if (state && !state.available) return null

  return (
    <section className="mt-12">
      <SectionHeader
        title={t('import_page.eb_title')}
        description={state?.connected ? t('import_page.eb_connected_body') : t('import_page.eb_connect_body')}
        actions={
          state?.connected ? (
            <button type="button" onClick={disconnect} className="text-sm font-semibold text-fg-muted hover:text-fg">
              {t('import_page.eb_disconnect')}
            </button>
          ) : undefined
        }
      />

      {status === 'connected' && state?.connected && <p className="mt-3 text-sm text-fg-muted">{t('import_page.eb_just_connected')}</p>}
      {status === 'error' && <p className="mt-3 text-sm text-danger">{t('import_page.eb_error')}</p>}
      {status === 'cancelled' && <p className="mt-3 text-sm text-fg-muted">{t('import_page.eb_cancelled')}</p>}
      {state?.expired && <p className="mt-3 text-sm text-fg-muted">{t('import_page.eb_expired')}</p>}

      {state && !state.connected && (
        <a href="/api/integrations/eventbrite/start" className={`${buttonPrimary} mt-4`}>
          {t('import_page.eb_connect')}
        </a>
      )}

      {state?.connected && sync?.connected && (
        <div className="mt-4 rounded bg-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">{t('import_page.eb_sync_title')}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{t('import_page.eb_sync_hint')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sync.auto_sync}
              aria-label={t('import_page.eb_sync_title')}
              onClick={toggleAuto}
              className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${sync.auto_sync ? 'bg-brand-700' : 'bg-surface-high'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-inverse transition-transform ${sync.auto_sync ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-fg-muted">
              {note || (sync.last_synced_at ? t('import_page.eb_last_synced', { when: synced(sync.last_synced_at) }) : t('import_page.eb_never_synced'))}
            </p>
            <button type="button" onClick={syncNow} disabled={syncing} className={`${buttonQuiet} flex-none`}>
              {syncing ? t('import_page.eb_syncing') : t('import_page.eb_sync_now')}
            </button>
          </div>
        </div>
      )}

      {state?.connected && (
        <div className="mt-6">
          {done ? (
            <DoneList items={done} />
          ) : state.events.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('import_page.eb_none')}</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-fg-muted">{t('import_page.eb_drafts_body')}</p>
              <PickList
                items={state.events.map((e) => ({
                  id: e.id,
                  title: e.title,
                  meta: [when(e.start), e.online ? t('import_page.online') : e.venue, tierLine(e)].filter(Boolean).join(' · '),
                }))}
                picked={picked}
                onToggle={(id) => {
                  const n = new Set(picked)
                  if (n.has(id)) n.delete(id)
                  else n.add(id)
                  setPicked(n)
                }}
                onAll={() => setPicked(picked.size === state.events.length ? new Set() : new Set(state.events.map((e) => e.id)))}
              />
              <button type="button" onClick={importNow} disabled={busy || picked.size === 0} className={`${buttonPrimary} mt-4 w-full`}>
                {busy ? t('import_page.importing') : t('import_page.import_drafts', { count: picked.size })}
              </button>
              {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
    </section>
  )
}
