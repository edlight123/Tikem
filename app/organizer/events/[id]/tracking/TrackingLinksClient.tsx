'use client'

// Per-event tracking links, saved on the server (tracking_links). Each link is
// a utm-tagged event URL plus a short `t=` id; the event page counts its clicks
// and fulfillment counts the orders and revenue it drove. Counters are
// server-written only — this page reads them, it never edits them.

import { useTranslation } from 'react-i18next'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link2, Copy, Check, Plus, Trash2 } from 'lucide-react'
import { FormField, OrgEmptyState } from '@/components/organizer/ui'
import { useToast } from '@/components/ui/Toast'
import { buildTrackingUrl, formatConversion } from '@/lib/attribution'

interface TrackingLink {
  id: string
  label: string
  source: string
  medium: string
  campaign: string
  url: string
  createdAt: string | null
  clicks: number
  salesCount: number
  ticketsCount: number
  revenueByCurrency: Record<string, number>
}

interface TrackingLinksClientProps {
  eventId: string
  eventTitle: string
}

function fmtMoney(cents: number, currency: string): string {
  return `${(Math.round(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

/** Each currency on its own — never summed across currencies. */
function fmtRevenue(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency || {}).filter(([, v]) => v > 0)
  if (entries.length === 0) return '—'
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cur, cents]) => fmtMoney(cents, cur))
    .join(' · ')
}

export default function TrackingLinksClient({ eventId }: TrackingLinksClientProps) {
  const { t } = useTranslation('organizer')
  const { showToast } = useToast()
  // Held in a ref so the loader's identity never depends on the toast context.
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast
  const toastError = (title: string) => showToastRef.current({ type: 'error', title })

  const [origin, setOrigin] = useState('')
  const [links, setLinks] = useState<TrackingLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [source, setSource] = useState('')
  const [medium, setMedium] = useState('link')
  const [campaign, setCampaign] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin.replace('://tikem.co', '://www.tikem.co'))
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/tracking-links`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'load failed')
      setLinks(Array.isArray(data.links) ? data.links : [])
    } catch {
      toastError(t('tracking_links.load_failed'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, t])

  useEffect(() => {
    load()
  }, [load])

  const baseUrl = origin ? `${origin}/events/${eventId}` : `/events/${eventId}`
  // The real `t=` id is minted on save; the preview shows the utm part.
  const previewUrl = buildTrackingUrl(baseUrl, { source, medium, campaign })

  const reset = () => {
    setLabel('')
    setSource('')
    setMedium('link')
    setCampaign('')
    setShowForm(false)
  }

  const handleCreate = async () => {
    if (!label.trim() || !source.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/tracking-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), source: source.trim(), medium: medium.trim(), campaign: campaign.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.link) throw new Error(data?.error || 'create failed')
      setLinks((prev) => [data.link, ...prev])
      reset()
    } catch (err: any) {
      toastError(err?.message || t('tracking_links.create_failed'))
    } finally {
      setSaving(false)
    }
  }

  const copyLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url).catch(() => undefined)
    setCopiedId(id)
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000)
  }

  const deleteLink = async (link: TrackingLink) => {
    if (!window.confirm(t('tracking_links.delete_confirm'))) return
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/tracking-links/${link.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      setLinks((prev) => prev.filter((l) => l.id !== link.id))
    } catch {
      toastError(t('tracking_links.delete_failed'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{t('tracking_links.tracking_links')}</h1>
          <p className="mt-0.5 text-sm text-white/70">
            {t('tracking_links.generate_utm')}
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Plus className="h-4 w-4" />
            {t('tracking_links.new_link')}
          </button>
        )}
      </div>

      {/* Builder form */}
      {showForm && (
        <div className="rounded-2xl border border-white/10 p-5">
          <h2 className="mb-4 font-semibold text-white">{t('tracking_links.build_tracking_link')}</h2>
          <div className="space-y-4">
            <FormField label={t('actions.label')} htmlFor="tl-label" required>
              <input
                id="tl-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Instagram story"
                maxLength={80}
                className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label={t('tracking_links.source')} htmlFor="tl-source" required>
                <input
                  id="tl-source"
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="instagram"
                  className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </FormField>
              <FormField label={t('tracking_links.medium')} htmlFor="tl-medium">
                <input
                  id="tl-medium"
                  type="text"
                  value={medium}
                  onChange={(e) => setMedium(e.target.value)}
                  placeholder="story"
                  className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </FormField>
              <FormField label={t('tracking_links.campaign')} htmlFor="tl-campaign">
                <input
                  id="tl-campaign"
                  type="text"
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  placeholder="launch"
                  className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </FormField>
            </div>
          </div>

          {/* Live preview */}
          <div className="mt-4 rounded-xl border border-white/10 px-4 py-3">
            <p className="label-mono uppercase mb-1 text-white/40">{t('tracking_links.preview')}</p>
            <p className="break-all font-mono text-xs text-white/70">{previewUrl}</p>
            <p className="mt-1 text-xs text-white/40">{t('tracking_links.preview_id_note')}</p>
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!label.trim() || !source.trim() || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Plus className="h-4 w-4" />
              {t('tracking_links.create_link')}
            </button>
          </div>
        </div>
      )}

      {/* Links list */}
      {loading ? (
        <div className="rounded-2xl border border-white/10 divide-y divide-white/5" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="px-5 py-4">
              <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-72 animate-pulse rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : links.length === 0 && !showForm ? (
        <OrgEmptyState
          icon={Link2}
          title={t('tracking_links.no_tracking_links')}
          description={t('tracking_links.create_utm_links')}
          action={
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Plus className="h-4 w-4" />
              {t('tracking_links.new_tracking_link')}
            </button>
          }
        />
      ) : links.length > 0 ? (
        <div className="rounded-2xl border border-white/10 divide-y divide-white/5">
          {links.map((link) => (
            <div key={link.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{link.label}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-white/70">{link.url}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {(
                      [
                        ['source', link.source],
                        link.medium ? ['medium', link.medium] : null,
                        link.campaign ? ['campaign', link.campaign] : null,
                      ] as (string[] | null)[]
                    )
                      .filter((x): x is string[] => x !== null)
                      .map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/70"
                        >
                          {k}={v}
                        </span>
                      ))}
                  </div>
                </div>

                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <p className="font-semibold text-white">{link.clicks}</p>
                    <p className="text-[11px] uppercase tracking-wider text-white/40">{t('tracking_links.clicks')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-white">{link.salesCount}</p>
                    <p className="text-[11px] uppercase tracking-wider text-white/40">{t('tracking_links.sales')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-white">{fmtRevenue(link.revenueByCurrency)}</p>
                    <p className="text-[11px] uppercase tracking-wider text-white/40">{t('tracking_links.revenue')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-white">{formatConversion(link.salesCount, link.clicks)}</p>
                    <p className="text-[11px] uppercase tracking-wider text-white/40">{t('tracking_links.conversion')}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyLink(link.id, link.url)}
                    aria-label={`Copy tracking link: ${link.label}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {copiedId === link.id ? (
                      <><Check className="h-3.5 w-3.5 text-emerald-400" />{t('tracking_links.copied')}</>
                    ) : (
                      <><Copy className="h-3.5 w-3.5" />{t('tracking_links.copy')}</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteLink(link)}
                    aria-label={`Delete tracking link: ${link.label}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {links.length > 0 && (
        <p className="text-xs text-white/40">{t('tracking_links.stats_note')}</p>
      )}
    </div>
  )
}
