'use client'

import { useTranslation } from 'react-i18next'

import { useState } from 'react'
import {
  OrgEmptyState,
  OrgDataTable,
  Drawer,
  ConfirmationDialog,
  StatusChip,
  type ChipTone,
} from '@/components/organizer/ui'
import type { OrgColumn } from '@/components/organizer/ui'
import { Ticket, Plus, Trash2 } from 'lucide-react'
import { EMPTY_VALUE } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'

type Event = {
  id: string
  title: string
}

type PromoCode = {
  id: string
  code: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  max_uses: number | null
  uses_count: number
  event_id: string
  is_active: boolean
  expires_at: string | null
  event: {
    title: string
  } | null
}

export default function PromoCodeManager({
  events,
  promoCodes: initialPromoCodes,
  organizerId,
}: {
  events: Event[]
  promoCodes: PromoCode[]
  organizerId: string
}) {
  const { t } = useTranslation('organizer')
  const { showToast } = useToast()
  const [promoCodes, setPromoCodes] = useState(initialPromoCodes)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Form state
  const [code, setCode] = useState('')
  const [eventId, setEventId] = useState('')
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage')
  const [discountValue, setDiscountValue] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const payload = {
        eventId,
        code: code.toUpperCase(),
        discountType,
        discountValue: parseFloat(discountValue),
        maxUses: maxUses ? parseInt(maxUses) : null,
        validFrom: null,
        validUntil: expiresAt ? new Date(expiresAt).toISOString() : null,
      }

      const res = await fetch('/api/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to create promo code')

      const eventTitle = events.find((e) => e.id === eventId)?.title || ''
      const created: PromoCode = {
        id: String(json?.promoId || ''),
        code: payload.code,
        discount_type: discountType,
        discount_value: payload.discountValue,
        max_uses: payload.maxUses,
        uses_count: 0,
        event_id: eventId,
        is_active: true,
        expires_at: payload.validUntil,
        event: eventTitle ? { title: eventTitle } : null,
      }

      if (!created.id) throw new Error('Promo ID missing from response')

      setPromoCodes([created, ...promoCodes])
      
      // Reset form
      setCode('')
      setEventId('')
      setDiscountValue('')
      setMaxUses('')
      setExpiresAt('')
      setShowForm(false)
    } catch (error: unknown) {
      showToast({ type: 'error', title: 'Failed to create promo code', message: error instanceof Error ? error.message : undefined })
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(promoId: string, isActive: boolean) {
    try {
      const res = await fetch('/api/promo-codes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoId, isActive: !isActive }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to update promo code')

      setPromoCodes(promoCodes.map(p => 
        p.id === promoId ? { ...p, is_active: !isActive } : p
      ))
    } catch (error: unknown) {
      showToast({ type: 'error', title: 'Failed to update promo code', message: error instanceof Error ? error.message : undefined })
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/promo-codes?promoId=${encodeURIComponent(deleteTarget)}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to delete promo code')
      setPromoCodes(promoCodes.filter((p) => p.id !== deleteTarget))
    } catch (error: unknown) {
      showToast({ type: 'error', title: 'Failed to delete promo code', message: error instanceof Error ? error.message : undefined })
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }

  const getPromoStatus = (promo: PromoCode): { label: string; tone: ChipTone } => {
    if (!promo.is_active) return { label: 'Disabled', tone: 'neutral' }
    const expired = promo.expires_at ? new Date(promo.expires_at).getTime() < Date.now() : false
    if (expired) return { label: 'Expired', tone: 'danger' }
    return { label: 'Active', tone: 'success' }
  }

  const actionButtons = (promo: PromoCode) => (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => toggleActive(promo.id, promo.is_active)}
        className={`px-3 py-1.5 rounded-full font-medium text-xs md:text-sm transition ${
          promo.is_active
            ? 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12]'
            : 'bg-white/[0.07] text-white/70 hover:bg-white/[0.12]'
        }`}
      >
        {promo.is_active ? 'Deactivate' : 'Activate'}
      </button>
      <button
        onClick={() => setDeleteTarget(promo.id)}
        className="p-1.5 md:p-2 text-red-300 hover:bg-red-500/10 rounded-lg transition"
        aria-label={t('promo_codes.delete_promo_code')}
      >
        <Trash2 className="w-4 h-4 md:w-5 md:h-5" />
      </button>
    </div>
  )

  const columns: OrgColumn<PromoCode>[] = [
    {
      key: 'code',
      header: 'Code',
      sortable: true,
      sortAccessor: (p) => p.code,
      render: (p) => (
        <div className="min-w-0">
          <div className="font-mono font-bold tracking-tight text-white">{p.code}</div>
          <div className="text-xs text-white/50 truncate">{p.event?.title || 'Event not found'}</div>
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      render: (p) => (
        <span className="font-mono tabular-nums">
          {p.discount_type === 'percentage' ? `${p.discount_value}% off` : `$${p.discount_value} off`}
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'Usage',
      sortable: true,
      sortAccessor: (p) => p.uses_count,
      render: (p) => (
        <span className="font-mono tabular-nums text-white/70">
          {p.uses_count}
          {p.max_uses ? ` / ${p.max_uses}` : ''}
        </span>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      hideOnMobile: true,
      sortable: true,
      sortAccessor: (p) => (p.expires_at ? new Date(p.expires_at).getTime() : 0),
      render: (p) => (
        <span className="font-mono tabular-nums">
          {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : EMPTY_VALUE}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => {
        const s = getPromoStatus(p)
        return <StatusChip tone={s.tone}>{s.label}</StatusChip>
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => actionButtons(p),
    },
  ]

  const renderMobileCard = (p: PromoCode) => {
    const s = getPromoStatus(p)
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-lg font-bold tracking-tight text-white">{p.code}</span>
          <StatusChip tone={s.tone}>{s.label}</StatusChip>
        </div>
        <p className="text-sm text-white/60 truncate">{p.event?.title || 'Event not found'}</p>
        <p className="text-sm text-white/70">
          <span className="font-mono tabular-nums">
            {p.discount_type === 'percentage' ? `${p.discount_value}% off` : `$${p.discount_value} off`}
          </span>
          <span className="text-white/40"> · </span>
          {t('actions.used')}<span className="font-mono tabular-nums">{p.uses_count}{p.max_uses ? ` / ${p.max_uses}` : ''}</span>
        </p>
        {p.expires_at && (
          <p className="text-xs text-white/50">{t('promo_codes.expires')}<span className="font-mono tabular-nums">{new Date(p.expires_at).toLocaleDateString()}</span></p>
        )}
        <div className="pt-1">{actionButtons(p)}</div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-24 relative">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('promo_codes.your_promo_codes')}</h2>
        <button
          onClick={() => setShowForm(true)}
          className="hidden md:inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition"
        >
          <Plus className="w-4 h-4" />
          {t('promo_codes.create_promo_code')}
        </button>
      </div>

      {/* Sticky mobile create button */}
      <div className="fixed bottom-24 right-4 z-40 md:hidden">
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 active:scale-95 transition"
        >
          <Plus className="w-4 h-4" />
          {t('actions.create')}
        </button>
      </div>

      {/* Promo Codes Table */}
      <OrgDataTable<PromoCode>
        columns={columns}
        rows={promoCodes}
        rowKey={(p) => p.id}
        pageSize={10}
        renderMobileCard={renderMobileCard}
        empty={
          <OrgEmptyState
            icon={Ticket}
            title={t('promo_codes.no_promo_codes_yet')}
            description={t('promo_codes.create_discount_cta')}
          />
        }
      />

      {/* Create Drawer */}
      <Drawer open={showForm} onClose={() => setShowForm(false)} title={t('promo_codes.new_promo_code')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-mono block text-xs uppercase text-white/60 mb-1.5">
                Code
              </label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="bg-white/[0.06] w-full rounded-lg px-4 py-2.5 uppercase text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                placeholder="SUMMER2024"
              />
            </div>

            <div>
              <label className="label-mono block text-xs uppercase text-white/60 mb-1.5">
                {t('actions.event')}
              </label>
              <select
                required
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="bg-white/[0.06] w-full rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              >
                <option value="">{t('promo_codes.select_event')}</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>{event.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-mono block text-xs uppercase text-white/60 mb-1.5">
                {t('promo_codes.discount_type')}
              </label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')}
                className="bg-white/[0.06] w-full rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              >
                <option value="percentage">{t('promo_codes.percentage')}</option>
                <option value="fixed">{t('promo_codes.fixed_amount')}</option>
              </select>
            </div>

            <div>
              <label className="label-mono block text-xs uppercase text-white/60 mb-1.5">
                {t('promo_codes.discount_value')}
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="bg-white/[0.06] w-full rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                placeholder={discountType === 'percentage' ? '10' : '5.00'}
              />
            </div>

            <div>
              <label className="label-mono block text-xs uppercase text-white/60 mb-1.5">
                {t('promo_codes.max_discounted_tickets')}<span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                type="number"
                min="1"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="bg-white/[0.06] w-full rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                placeholder={t('promo_codes.unlimited')}
              />
              {/* The cap counts TICKETS, not orders: fulfillment increments
                  uses_count by the order quantity. Saying so here stops an
                  organizer reading "50" as "the first 50 customers". */}
              <p className="mt-1.5 text-xs text-white/40">
                {t('promo_codes.counts_tickets_note')}
              </p>
            </div>

            <div>
              <label className="label-mono block text-xs uppercase text-white/60 mb-1.5">
                {t('promo_codes.expires_at')}<span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="bg-white/[0.06] w-full rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full bg-white/[0.07] px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/[0.12] transition"
            >
              {t('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90 transition disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Code'}
            </button>
          </div>
        </form>
      </Drawer>

      {/* Delete confirmation */}
      <ConfirmationDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('promo_codes.delete_promo_code_q')}
        description={t('promo_codes.delete_warning')}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLoading}
      />
    </div>
  )
}
