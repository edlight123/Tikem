'use client'

import { useTranslation } from 'react-i18next'

// Per-event promoter manager: create street-team / anbasadè links, watch what each
// one sells, and see the commission owed. Counters come from the server-only
// promoter_sales ledger; nothing here edits money.

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Plus, Users } from 'lucide-react'
import { OrgEmptyState } from '@/components/organizer/ui'
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
    'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="rounded-2xl border border-white/10">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="font-semibold text-white">{t('promoters.promoters')}</h2>
            <p className="text-sm text-white/50 mt-0.5">
              Personal links for your street team. Each sale through a link counts for
              its promoter, and Tikèm tallies the commission you owe them.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('promoters.add_promoter')}
          </button>
        </div>

        {showForm && (
          <div className="border-b border-white/10 px-5 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-mono text-[11px] uppercase text-white/50">Name</label>
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
                <label className="label-mono text-[11px] uppercase text-white/50">{t('promoters.contact_optional')}</label>
                <input
                  className={`mt-1.5 ${inputClass}`}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder={t('promoters.contact_hint')}
                />
              </div>
              <div>
                <label className="label-mono text-[11px] uppercase text-white/50">{t('promoters.link_code')}</label>
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
                <label className="label-mono text-[11px] uppercase text-white/50">{t('promoters.commission')}</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    className={`${inputClass} flex-1`}
                    type="number"
                    min="0"
                    value={commissionValue}
                    onChange={(e) => setCommissionValue(e.target.value)}
                  />
                  <select
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&>option]:bg-white/[0.03]"
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
                className="rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {saving ? 'Adding…' : 'Add promoter'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-white/50">Loading promoters…</div>
        ) : promoters.length === 0 && !showForm ? (
          <div className="p-8">
            <OrgEmptyState
              icon={Users}
              title={t('promoters.no_promoters_yet')}
              description={`Give each person selling "${eventTitle}" their own link, and see exactly who drives which sales.`}
              action={
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Plus className="h-4 w-4" />
                  {t('promoters.add_first_promoter')}
                </button>
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {promoters.map((p) => (
              <div key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-white">{p.name}</span>
                      <span className="font-mono text-xs text-white/50">{p.code}</span>
                      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/50">
                        <span className={`h-1.5 w-1.5 rounded-full ${p.isActive ? 'bg-emerald-400' : 'bg-white/30'}`} />
                        {p.isActive ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-white/50">
                      {commissionLabel(p)}
                      {p.contact ? ` · ${p.contact}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="text-white font-semibold">{p.clicks || 0}</p>
                      <p className="text-[11px] uppercase tracking-wider text-white/40">{t('promoters.clicks')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-semibold">{formatConversion(p.ordersCount, p.clicks || 0)}</p>
                      <p className="text-[11px] uppercase tracking-wider text-white/40">{t('promoters.conversion')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-semibold">{p.ticketsSold}</p>
                      <p className="text-[11px] uppercase tracking-wider text-white/40">{t('promoters.tickets')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-semibold">{fmtMoney(p.grossCents, p.currency)}</p>
                      <p className="text-[11px] uppercase tracking-wider text-white/40">{t('actions.sales')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-semibold">{fmtMoney(p.commissionCents, p.currency)}</p>
                      <p className="text-[11px] uppercase tracking-wider text-white/40">Owed</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copy(`share-${p.id}`, p.shareUrl)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    {copiedKey === `share-${p.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Sales link
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(`stats-${p.id}`, p.statsUrl)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('promoters.send_via_whatsapp')}
                  </a>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => handleToggle(p)}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/50 transition-colors hover:text-white"
                  >
                    {p.isActive ? 'Pause' : 'Resume'}
                  </button>
                  {p.ordersCount === 0 && (
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400/70 transition-colors hover:text-red-300"
                    >
                      {t('actions.remove')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-white/40 leading-relaxed">
        Commission on confirmed sales is withheld from your earnings automatically and
        paid to each promoter through their Tikèm wallet once this event&apos;s funds
        release, you never handle it. Free RSVPs count toward their tickets but earn
        no commission. Amounts tallied before wallets launched are still settled by
        you directly.
      </p>
    </div>
  )
}
