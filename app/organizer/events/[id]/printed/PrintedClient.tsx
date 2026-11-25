'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CreditCard, Printer, Smartphone, Wallet } from 'lucide-react'
import { Drawer, FormField, OrgEmptyState, SectionHeader, StatusChip, type ChipTone } from '@/components/organizer/ui'
import { quoteBatch, type PhysicalTicketsConfig } from '@/lib/physical/config'
import { formatSerial, showBalanceOption, type BatchCounts } from '@/lib/physical/rules'

interface BalanceInfo {
  canUse: boolean
  availableHtg: number
}

interface Tier {
  id: string
  name: string
  price: number
  remaining: number | null
}

interface BatchSummary {
  batch: {
    id: string
    tier_name: string
    quantity: number
    serial_prefix: string
    status: string
    total_htg: number
    unit_price_htg: number
    payment?: { method?: string; funds_rail?: string; refunded_to_balance_at?: string }
    payment_expires_at?: string
    assignments?: Array<{ uid: string; name: string; from: number; to: number }>
    voided_ranges?: Array<{ from: number; to: number; count: number }>
    released_count?: number
    created_at: string
  }
  counts: BatchCounts
  bySeller: Array<{ uid: string; name: string; counts: BatchCounts }>
}

interface Seller {
  uid: string
  name: string
  role: string
}

type Panel = { kind: 'order' } | { kind: 'assign' | 'void' | 'release'; batch: BatchSummary['batch'] } | null

const field =
  'w-full rounded bg-surface px-4 py-3 text-base text-fg placeholder-fg-faint focus:outline-none focus:ring-2 focus:ring-brand-500/60 sm:text-sm'
const btnPrimary =
  'inline-flex h-10 items-center justify-center gap-2 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'
const btnQuiet =
  'inline-flex h-10 items-center justify-center gap-2 rounded bg-surface-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'

const nf = (n: number) => new Intl.NumberFormat().format(n)

export function batchStatusTone(status: string): ChipTone {
  if (status === 'active' || status === 'ready') return 'success'
  if (status === 'awaiting_payment') return 'warning'
  if (status === 'cancelled') return 'neutral'
  return 'brand'
}

export default function PrintedClient({ eventId, currency, tiers }: { eventId: string; currency: string; tiers: Tier[] }) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const search = useSearchParams()
  const [config, setConfig] = useState<PhysicalTicketsConfig | null>(null)
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [sellers, setSellers] = useState<Seller[]>([])
  const [balance, setBalance] = useState<BalanceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error)
      setConfig(data.config)
      setBatches(data.batches || [])
      setSellers(data.sellers || [])
      setBalance(data.balance || null)
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  // Back from MonCash / Stripe: confirm the payment, then reload.
  useEffect(() => {
    const batchId = search.get('batch')
    const back = search.get('moncash') || search.get('card')
    if (!batchId || !back) return
    if (back === 'cancelled') {
      setNotice(t('physical.payment_cancelled'))
      return
    }
    void (async () => {
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches/${batchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_payment', sessionId: search.get('session_id') || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      setNotice(data?.paid ? t('physical.payment_received') : t('physical.payment_not_seen'))
      await load()
      router.replace(`/organizer/events/${eventId}/printed`)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const orderButton = (
    <button type="button" className={btnPrimary} onClick={() => setPanel({ kind: 'order' })} disabled={!config?.enabled}>
      <Printer className="h-4 w-4" strokeWidth={1.75} />
      {t('physical.order_batch')}
    </button>
  )

  return (
    <>
      <SectionHeader
        className="mb-6"
        title={t('physical.title')}
        description={config ? t('physical.subtitle', { min: nf(config.minBatch) }) : undefined}
        actions={batches.length > 0 ? <div className="hidden sm:block">{orderButton}</div> : undefined}
      />
      {batches.length > 0 && <div className="-mt-2 mb-6 sm:hidden">{orderButton}</div>}

      {notice && <p className="mb-6 rounded bg-surface px-4 py-3 text-sm text-fg-soft">{notice}</p>}
      {config && !config.enabled && <p className="mb-6 text-sm text-fg-muted">{t('physical.disabled')}</p>}

      {loading ? (
        <div className="h-40 animate-pulse rounded bg-surface-low" />
      ) : loadError ? (
        <p className="text-sm text-danger-soft">{t('physical.load_error')}</p>
      ) : batches.length === 0 ? (
        <OrgEmptyState variant="quiet" icon={Printer} title={t('physical.empty')} action={orderButton} />
      ) : (
        <div className="space-y-4">
          {batches.map((b) => (
            <BatchCard key={b.batch.id} eventId={eventId} summary={b} onPanel={setPanel} onChanged={load} />
          ))}
        </div>
      )}

      {panel?.kind === 'order' && config && (
        <OrderDrawer
          eventId={eventId}
          currency={currency}
          tiers={tiers}
          config={config}
          balance={balance}
          onClose={() => setPanel(null)}
          onPaid={async () => {
            setPanel(null)
            setNotice(t('physical.payment_received'))
            await load()
          }}
        />
      )}
      {panel && panel.kind !== 'order' && (
        <RangeDrawer
          eventId={eventId}
          kind={panel.kind}
          batch={panel.batch}
          sellers={sellers}
          onClose={() => setPanel(null)}
          onDone={async (msg) => {
            setPanel(null)
            setNotice(msg)
            await load()
          }}
        />
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[88px]">
      <p className="text-caption text-fg-subtle">{label}</p>
      <p className="font-mono text-lead tabular-nums text-fg">{nf(value)}</p>
    </div>
  )
}

function BatchCard({
  eventId,
  summary,
  onPanel,
  onChanged,
}: {
  eventId: string
  summary: BatchSummary
  onPanel: (p: Panel) => void
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const { batch, counts, bySeller } = summary
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unpaid = batch.status === 'awaiting_payment'
  const first = formatSerial(batch.serial_prefix, 1, batch.quantity)
  const last = formatSerial(batch.serial_prefix, batch.quantity, batch.quantity)

  const act = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches/${batch.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || t('physical.generic_error'))
      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl
        return
      }
      if (body.action === 'check_payment' && !data?.paid) setError(t('physical.payment_not_seen'))
      await onChanged()
    } catch (e: any) {
      setError(String(e?.message || t('physical.generic_error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="min-w-0 rounded bg-surface-low p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lead font-semibold text-fg">
            {t('physical.batch_heading', { count: nf(batch.quantity), tier: batch.tier_name })}
          </p>
          <p className="mt-0.5 font-mono text-meta text-fg-subtle">
            {first} – {last}
          </p>
        </div>
        <StatusChip className="!normal-case" tone={batchStatusTone(batch.status)}>
          {t(`physical.status.${batch.status}`)}
        </StatusChip>
      </div>

      {unpaid ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="text-sm text-fg-muted">{t('physical.awaiting_payment_line', { total: nf(batch.total_htg) })}</p>
            {batch.payment_expires_at && (
              <p className="mt-0.5 text-caption text-fg-subtle">
                {t('physical.pay_by', {
                  time: new Date(batch.payment_expires_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
                })}
              </p>
            )}
          </div>
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => act({ action: 'check_payment' })}>
            {t('physical.check_payment')}
          </button>
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => act({ action: 'cancel' })}>
            {t('physical.cancel_batch')}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() => act({ action: 'pay', method: batch.payment?.method === 'card' ? 'card' : batch.payment?.method === 'balance' ? 'balance' : 'moncash' })}
          >
            {t('physical.pay_now')}
          </button>
        </div>
      ) : batch.status === 'cancelled' ? (
        batch.payment?.refunded_to_balance_at ? (
          <p className="mt-3 text-sm text-fg-muted">{t('physical.credited_back')}</p>
        ) : null
      ) : (
        <>
          {batch.status === 'paid' && batch.payment?.funds_rail === 'balance_offset' && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="mr-auto text-sm text-fg-muted">{t('physical.paid_from_balance')}</p>
              <button type="button" className={btnQuiet} disabled={busy} onClick={() => act({ action: 'cancel' })}>
                {t('physical.cancel_credit_balance')}
              </button>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-4">
            <Stat label={t('physical.count_printed')} value={counts.printed} />
            <Stat label={t('physical.count_sold')} value={counts.activated} />
            <Stat label={t('physical.count_unsold')} value={counts.unsold} />
            <Stat label={t('physical.count_checked_in')} value={counts.checkedIn} />
            <Stat label={t('physical.count_voided')} value={counts.voided} />
            <Stat label={t('physical.count_released')} value={counts.released} />
          </div>

          {(batch.assignments?.length || 0) > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="text-caption text-fg-subtle">
                    <th className="py-2 pr-4 font-normal">{t('physical.col_seller')}</th>
                    <th className="py-2 pr-4 font-normal">{t('physical.col_range')}</th>
                    <th className="py-2 pr-4 text-right font-normal">{t('physical.count_sold')}</th>
                    <th className="py-2 pr-4 text-right font-normal">{t('physical.count_unsold')}</th>
                    <th className="py-2 text-right font-normal">{t('physical.count_checked_in')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.assignments!.map((a) => {
                    const c = bySeller.find((s) => s.uid === a.uid)?.counts
                    return (
                      <tr key={`${a.uid}-${a.from}`} className="odd:bg-surface-low">
                        <td className="py-2 pr-4 text-fg">{a.name || t('physical.seller_unnamed')}</td>
                        <td className="py-2 pr-4 font-mono text-meta text-fg-muted">
                          {formatSerial(batch.serial_prefix, a.from, batch.quantity)} – {formatSerial(batch.serial_prefix, a.to, batch.quantity)}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-fg">{nf(c?.activated || 0)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-fg-muted">{nf(c?.unsold || 0)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-fg-muted">{nf(c?.checkedIn || 0)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className={btnQuiet} onClick={() => onPanel({ kind: 'assign', batch })}>
              {t('physical.assign_range')}
            </button>
            <button type="button" className={btnQuiet} onClick={() => onPanel({ kind: 'void', batch })}>
              {t('physical.void_range')}
            </button>
            <button type="button" className={btnQuiet} disabled={counts.unsold + counts.voided === 0} onClick={() => onPanel({ kind: 'release', batch })}>
              {t('physical.release_unsold')}
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-danger-soft">{error}</p>}
    </section>
  )
}

function OrderDrawer({
  eventId,
  currency,
  tiers,
  config,
  balance,
  onClose,
  onPaid,
}: {
  eventId: string
  currency: string
  tiers: Tier[]
  config: PhysicalTicketsConfig
  balance: BalanceInfo | null
  onClose: () => void
  onPaid: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [tierId, setTierId] = useState(tiers[0]?.id || '')
  const [qty, setQty] = useState(String(config.minBatch))
  const [method, setMethod] = useState<'moncash' | 'card' | 'balance'>('moncash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const quantity = Math.round(Number(qty))
  const quote = useMemo(() => quoteBatch(config, quantity), [config, quantity])
  const tier = tiers.find((x) => x.id === tierId)
  const overCapacity = tier?.remaining != null && quantity > tier.remaining
  const balanceShown = quote.ok && showBalanceOption(balance, quote.totalHtg)
  const chosen = method === 'balance' && !balanceShown ? 'moncash' : method

  const submit = async () => {
    if (!quote.ok || overCapacity) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, quantity, method: chosen }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.paid) {
        await onPaid()
        return
      }
      if (!res.ok || !data?.redirectUrl) throw new Error(data?.error || t('physical.generic_error'))
      window.location.href = data.redirectUrl
    } catch (e: any) {
      setError(String(e?.message || t('physical.generic_error')))
      setBusy(false)
    }
  }

  const quoteError = !quote.ok
    ? quote.code === 'below_minimum'
      ? t('physical.min_batch', { min: nf(config.minBatch) })
      : quote.code === 'above_maximum'
        ? t('physical.max_batch', { max: nf(config.maxBatch) })
        : quote.code === 'disabled'
          ? t('physical.disabled')
          : t('physical.whole_number')
    : overCapacity
      ? t('physical.over_capacity', { remaining: nf(tier!.remaining!) })
      : null

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('physical.order_title')}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className={btnQuiet} onClick={onClose}>
            {t('physical.cancel')}
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !!quoteError || !tierId} onClick={submit}>
            {quote.ok
              ? chosen === 'balance'
                ? t('physical.pay_from_balance_total', { total: nf(quote.totalHtg) })
                : t('physical.pay_total', { total: nf(quote.totalHtg) })
              : t('physical.pay')}
          </button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <p className="text-sm text-fg-muted">{t('physical.order_intro')}</p>

        <FormField label={t('physical.ticket_type')} htmlFor="phys-tier">
          <select id="phys-tier" value={tierId} onChange={(e) => setTierId(e.target.value)} className={field}>
            {tiers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.remaining != null ? ` · ${t('physical.left', { count: x.remaining })}` : ''}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label={t('physical.quantity')} htmlFor="phys-qty" error={quoteError || undefined}>
          <input
            id="phys-qty"
            type="number"
            inputMode="numeric"
            min={config.minBatch}
            max={config.maxBatch}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={field}
          />
        </FormField>

        <div className="rounded bg-surface p-4">
          <p className="text-caption text-fg-subtle">{t('physical.price_list')}</p>
          <ul className="mt-2 space-y-1">
            {config.tiers.map((tierRow, i) => {
              const next = config.tiers[i + 1]
              const active = quote.ok && quote.tierIndex === i
              return (
                <li key={tierRow.minQty} className={`flex justify-between text-sm ${active ? 'text-fg' : 'text-fg-subtle'}`}>
                  <span>
                    {next
                      ? t('physical.tier_range', { from: nf(tierRow.minQty), to: nf(next.minQty - 1) })
                      : t('physical.tier_from', { from: nf(tierRow.minQty) })}
                  </span>
                  <span className="font-mono tabular-nums">{t('physical.per_ticket', { price: nf(tierRow.priceHtgPerTicket) })}</span>
                </li>
              )
            })}
          </ul>
          {quote.ok && (
            <div className="mt-4 flex items-baseline justify-between bg-surface-raised px-3 py-2">
              <span className="text-sm text-fg-muted">
                {nf(quote.quantity)} × {nf(quote.unitPriceHtg)} HTG
              </span>
              <span className="font-mono text-lead tabular-nums text-fg">{nf(quote.totalHtg)} HTG</span>
            </div>
          )}
          {quote.ok && Object.entries(quote.display).map(([cur, v]) => (
            <p key={cur} className="mt-1 text-right text-caption text-fg-subtle">
              ≈ {v.total.toFixed(2)} {cur}
            </p>
          ))}
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-soft">{t('physical.pay_with')}</legend>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { id: 'moncash', icon: Smartphone, label: t('physical.method_moncash') },
                { id: 'card', icon: CreditCard, label: t('physical.method_card') },
                ...(balanceShown ? [{ id: 'balance', icon: Wallet, label: t('physical.method_balance') }] : []),
              ] as Array<{ id: 'moncash' | 'card' | 'balance'; icon: typeof Wallet; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={chosen === m.id}
                onClick={() => setMethod(m.id)}
                className={`flex h-10 items-center gap-2 rounded px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  m.id === 'balance' ? 'col-span-2' : ''
                } ${chosen === m.id ? 'bg-surface-high text-fg' : 'bg-surface text-fg-muted hover:bg-surface-raised'}`}
              >
                <m.icon className="h-4 w-4" strokeWidth={1.75} />
                {m.label}
              </button>
            ))}
          </div>
          {chosen === 'card' && <p className="mt-2 text-caption text-fg-subtle">{t('physical.card_note')}</p>}
          {chosen === 'balance' && balance && (
            <p className="mt-2 text-caption text-fg-subtle">{t('physical.balance_note', { amount: nf(balance.availableHtg) })}</p>
          )}
          {currency !== 'HTG' && <p className="mt-2 text-caption text-fg-subtle">{t('physical.htg_note')}</p>}
        </fieldset>

        <p className="text-caption text-fg-subtle">{t('physical.no_fee_note')}</p>
        {error && <p className="text-sm text-danger-soft">{error}</p>}
      </div>
    </Drawer>
  )
}

function RangeDrawer({
  eventId,
  kind,
  batch,
  sellers,
  onClose,
  onDone,
}: {
  eventId: string
  kind: 'assign' | 'void' | 'release'
  batch: BatchSummary['batch']
  sellers: Seller[]
  onClose: () => void
  onDone: (message: string) => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(batch.quantity))
  const [sellerUid, setSellerUid] = useState(sellers[0]?.uid || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const action = kind === 'assign' ? 'assign_range' : kind === 'void' ? 'void_range' : 'release_unsold'
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/physical-batches/${batch.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, from: Number(from), to: Number(to), sellerUid, reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || t('physical.generic_error'))
      await onDone(
        kind === 'assign'
          ? t('physical.assigned_done', { count: data.assigned || 0 })
          : kind === 'void'
            ? t('physical.voided_done', { count: data.voided || 0 })
            : t('physical.released_done', { count: data.released || 0 })
      )
    } catch (e: any) {
      setError(String(e?.message || t('physical.generic_error')))
      setBusy(false)
    }
  }

  const titles = { assign: t('physical.assign_range'), void: t('physical.void_range'), release: t('physical.release_unsold') }
  const intros = { assign: t('physical.assign_intro'), void: t('physical.void_intro'), release: t('physical.release_intro') }

  return (
    <Drawer
      open
      onClose={onClose}
      title={titles[kind]}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className={btnQuiet} onClick={onClose}>
            {t('physical.cancel')}
          </button>
          <button type="button" className={btnPrimary} disabled={busy || (kind === 'assign' && !sellerUid)} onClick={submit}>
            {titles[kind]}
          </button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <p className="text-sm text-fg-muted">{intros[kind]}</p>
        {kind === 'assign' &&
          (sellers.length === 0 ? (
            <p className="rounded bg-surface px-4 py-3 text-sm text-fg-muted">{t('physical.no_sellers')}</p>
          ) : (
            <FormField label={t('physical.col_seller')} htmlFor="phys-seller">
              <select id="phys-seller" value={sellerUid} onChange={(e) => setSellerUid(e.target.value)} className={field}>
                {sellers.map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.name || s.uid} · {t(`physical.role_${s.role}`, { defaultValue: s.role })}
                  </option>
                ))}
              </select>
            </FormField>
          ))}
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('physical.from_no')} htmlFor="phys-from">
            <input id="phys-from" type="number" min={1} max={batch.quantity} value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          </FormField>
          <FormField label={t('physical.to_no')} htmlFor="phys-to">
            <input id="phys-to" type="number" min={1} max={batch.quantity} value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </FormField>
        </div>
        <p className="font-mono text-meta text-fg-subtle">
          {formatSerial(batch.serial_prefix, Math.max(1, Number(from) || 1), batch.quantity)} –{' '}
          {formatSerial(batch.serial_prefix, Math.max(1, Number(to) || 1), batch.quantity)}
        </p>
        {kind === 'void' && (
          <FormField label={t('physical.void_reason')} htmlFor="phys-reason">
            <input id="phys-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={field} placeholder={t('physical.void_reason_ph')} />
          </FormField>
        )}
        {error && <p className="text-sm text-danger-soft">{error}</p>}
      </div>
    </Drawer>
  )
}
