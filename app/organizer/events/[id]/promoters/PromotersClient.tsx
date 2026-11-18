'use client'

import { useTranslation } from 'react-i18next'

// Per-event promoter manager: create street-team / anbasadè links, watch what each
// one sells, and see the commission owed. Counters come from the server-only
// promoter_sales ledger; nothing here edits money.

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Plus, Users } from 'lucide-react'
import { OrgEmptyState, SectionHeader } from '@/components/organizer/ui'
import { useToast } from '@/components/ui/Toast'
import { formatConversion } from '@/lib/attribution'

interface Promoter {
  id: string
  code: string
  name: string
  contact: string | null
  commissionType: 'percentage' | 'flat_per_ticket'
  commissionValue: number
  isActive: boolean
  claimed: boolean
  ticketsSold: number
  ordersCount: number
  clicks: number
  grossCents: number
  commissionCents: number
  currency: string
  shareUrl: string
  statsUrl: string
}

function fmtMoney(cents: number, currency: string): string {
  return `${(Math.round(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

function commissionLabel(p: Promoter): string {
  return p.commissionType === 'flat_per_ticket'
    ? `${fmtMoney(p.commissionValue, p.currency)} / ticket`
    : `${p.commissionValue}% of sales`
}

function suggestCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
    .slice(0, 12)
}

export default function PromotersClient({
  eventId,
  eventTitle,
  eventCurrency,
}: {
  eventId: string
  eventTitle: string
  eventCurrency: string
}) {
  const { t } = useTranslation('organizer')

  const { showToast } = useToast()
  const [promoters, setPromoters] = useState<Promoter[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Create form
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [commissionType, setCommissionType] = useState<'percentage' | 'flat_per_ticket'>('percentage')
  const [commissionValue, setCommissionValue] = useState('10')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/promoters`)
      const data = await res.json()
      if (res.ok) setPromoters(data.promoters || [])
    } catch {
      // Leave the list as-is; the empty state copy covers first load failures.
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    load()
  }, [load])

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      showToast({ type: 'error', title: 'Couldn’t copy', message: 'Copy it manually.' })
    }
  }

  const handleCreate = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/promoters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          contact,
          code: code || suggestCode(name),
          commissionType,
          commissionValue: Number(commissionValue),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast({ type: 'error', title: 'Couldn’t add promoter', message: data?.error || 'Try again.' })
        return
      }
      setPromoters((prev) => [data.promoter, ...prev])
      setShowForm(false)
      setName('')
      setContact('')
      setCode('')
      setCodeTouched(false)
      setCommissionType('percentage')
      setCommissionValue('10')
      showToast({
        type: 'success',
        title: 'Promoter added',
        message: 'Send them their stats link, it is their whole toolkit.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (p: Promoter) => {
    const res = await fetch(`/api/organizer/events/${eventId}/promoters/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !p.isActive }),
    })
    if (res.ok) {
      setPromoters((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: !p.isActive } : x)))
    } else {
      const data = await res.json().catch(() => ({}))
      showToast({ type: 'error', title: 'Couldn’t update', message: data?.error || 'Try again.' })
    }
  }

  const handleDelete = async (p: Promoter) => {
    const res = await fetch(`/api/organizer/events/${eventId}/promoters/${p.id}`, { method: 'DELETE' })
    if (res.ok) {
      setPromoters((prev) => prev.filter((x) => x.id !== p.id))
    } else {
      const data = await res.json().catch(() => ({}))
      showToast({ type: 'error', title: 'Couldn’t remove', message: data?.error || 'Try again.' })
    }
  }

  const inputClass =
    'w-full rounded-xl bg-surface px-4 py-3 text-sm text-fg placeholder-fg-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* No intro paragraph (owner, 2026-11-18: "avoid too many
          explanations"). Empty, the empty state carries the one button. */}
      <SectionHeader
        title={t('promoters.promoters')}
        actions={
          !showForm && promoters.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded bg-inverse px-4 py-2.5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Plus className="h-4 w-4" />
              {t('promoters.add_promoter')}
            </button>
          ) : undefined
        }
      />

        {showForm && (
          <div className="rounded-2xl bg-surface px-5 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-mono text-eyebrow uppercase text-fg-subtle">Name</label>
                <input
                  className={`mt-1.5 ${inputClass}`}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!codeTouched) setCode(suggestCode(e.target.value))
                  }}
                  placeholder="Steeve L."
                />
              </div>
              <div>
                <label className="label-mono text-eyebrow uppercase text-fg-subtle">{t('promoters.contact_optional')}</label>
                <input
                  className={`mt-1.5 ${inputClass}`}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder={t('promoters.contact_hint')}
                />
              </div>
              <div>
                <label className="label-mono text-eyebrow uppercase text-fg-subtle">{t('promoters.link_code')}</label>
                <input
                  className={`mt-1.5 ${inputClass} font-mono`}
                  value={code}
                  onChange={(e) => {
                    setCodeTouched(true)
                    setCode(e.target.value.toUpperCase())
                  }}
                  placeholder="STEEVE"
                />
              </div>
              <div>
                <label className="label-mono text-eyebrow uppercase text-fg-subtle">{t('promoters.commission')}</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    className={`${inputClass} flex-1`}
                    type="number"
                    min="0"
                    value={commissionValue}
                    onChange={(e) => setCommissionValue(e.target.value)}
                  />
                  <select
                    className="rounded-xl bg-surface px-3 py-3 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&>option]:bg-surface-low"
                    value={commissionType}
                    onChange={(e) => setCommissionType(e.target.value as any)}
                  >
                    <option value="percentage">% of sales</option>
                    <option value="flat_per_ticket">{eventCurrency} per ticket</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="rounded bg-inverse px-4 py-2.5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {saving ? 'Adding…' : 'Add promoter'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded px-4 py-2.5 text-sm font-semibold text-fg-muted transition-colors hover:bg-surface-high bg-surface-raised"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-fg-subtle">Loading promoters…</div>
        ) : promoters.length === 0 ? (
          showForm ? null : (
            <OrgEmptyState
              variant="quiet"
              icon={Users}
              title={t('promoters.no_promoters_yet')}
              action={
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 rounded bg-inverse px-4 py-2.5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Plus className="h-4 w-4" />
                  {t('promoters.add_first_promoter')}
                </button>
              }
            />
          )
        ) : (
          <div className="divide-y divide-line-soft rounded-2xl bg-surface">
            {promoters.map((p) => (
              <div key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-fg">{p.name}</span>
                      <span className="font-mono text-xs text-fg-subtle">{p.code}</span>
                      <span className="inline-flex items-center gap-1.5 text-eyebrow uppercase tracking-wider text-fg-subtle">
                        <span className={`h-1.5 w-1.5 rounded-full ${p.isActive ? 'bg-success' : 'bg-fg/30'}`} />
                        {p.isActive ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-fg-subtle">
                      {commissionLabel(p)}
                      {p.contact ? ` · ${p.contact}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="text-fg font-semibold">{p.clicks || 0}</p>
                      <p className="text-eyebrow uppercase tracking-wider text-fg-subtle">{t('promoters.clicks')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-fg font-semibold">{formatConversion(p.ordersCount, p.clicks || 0)}</p>
                      <p className="text-eyebrow uppercase tracking-wider text-fg-subtle">{t('promoters.conversion')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-fg font-semibold">{p.ticketsSold}</p>
                      <p className="text-eyebrow uppercase tracking-wider text-fg-subtle">{t('promoters.tickets')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-fg font-semibold">{fmtMoney(p.grossCents, p.currency)}</p>
                      <p className="text-eyebrow uppercase tracking-wider text-fg-subtle">{t('actions.sales')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-fg font-semibold">{fmtMoney(p.commissionCents, p.currency)}</p>
                      <p className="text-eyebrow uppercase tracking-wider text-fg-subtle">Owed</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copy(`share-${p.id}`, p.shareUrl)}
                    className="inline-flex items-center gap-1.5 rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-high hover:text-fg"
                  >
                    {copiedKey === `share-${p.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Sales link
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(`stats-${p.id}`, p.statsUrl)}
                    className="inline-flex items-center gap-1.5 rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-high hover:text-fg"
                  >
                    {copiedKey === `stats-${p.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Their stats page
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `You're a promoter for ${eventTitle}! Your personal sales link: ${p.shareUrl}, track your sales and commission here: ${p.statsUrl}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-high hover:text-fg"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('promoters.send_via_whatsapp')}
                  </a>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => handleToggle(p)}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-fg-subtle transition-colors hover:text-fg"
                  >
                    {p.isActive ? 'Pause' : 'Resume'}
                  </button>
                  {p.ordersCount === 0 && (
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-danger/70 transition-colors hover:text-danger-soft"
                    >
                      {t('actions.remove')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      {/* One short line where it matters: money leaves their earnings. */}
      {promoters.length > 0 && (
        <p className="text-xs text-fg-subtle">{t('promoters.commission_note')}</p>
      )}
    </div>
  )
}
