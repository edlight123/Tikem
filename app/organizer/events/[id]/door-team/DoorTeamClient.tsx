'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CreditCard, ScanLine, Smartphone, Wallet } from 'lucide-react'
import { ConfirmationDialog, Drawer, FormField, OrgEmptyState, SectionHeader, StatusChip, type ChipTone } from '@/components/organizer/ui'
import { quoteDoorTeam, type DoorTeamConfig } from '@/lib/doorTeam/config'
import { showBalanceFor } from '@/lib/doorTeam/rules'

/**
 * The organizer's door team page. Everything priced here is only a preview:
 * the server quotes from config/door_team and Tikèm confirms the final price
 * before anything is charged.
 */

type PublicConfig = Omit<DoorTeamConfig, 'updated_at' | 'updated_by' | 'updated_by_email'>

export interface DoorTeamRequestView {
  id: string
  status: string
  staff_count: number
  arrival_at: string | null
  hours: number
  notes: string
  contact_name: string
  contact_phone: string
  standard_quote: { totalHtg?: number } | null
  price_htg: number | null
  price_kind: 'standard' | 'negotiated' | null
  quote_note: string
  quote_expires_at: string | null
  decline_reason: string
  payment: { method?: string | null; funds_rail?: string | null; status?: string | null; refunded_to_balance_at?: string | null } | null
  crew: Array<{ first_name: string }>
  refund: { due: boolean; status: string | null; rail: string | null } | null
  cancel_reason: string | null
  created_at: string | null
}

interface LoadData {
  config: PublicConfig
  requests: DoorTeamRequestView[]
  event: { start: string | null; end: string | null }
  balance: { canUse: boolean; availableHtg: number }
}

const field =
  'w-full rounded bg-surface px-4 py-3 text-base text-fg placeholder-fg-faint focus:outline-none focus:ring-2 focus:ring-brand-500/60 sm:text-sm'
const btnPrimary =
  'inline-flex h-10 items-center justify-center gap-2 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'
const btnQuiet =
  'inline-flex h-10 items-center justify-center gap-2 rounded bg-surface-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'

const nf = (n: number) => new Intl.NumberFormat().format(n)
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
const OPEN = ['requested', 'quoted', 'paid', 'confirmed']

export function doorTeamTone(status: string): ChipTone {
  if (status === 'confirmed' || status === 'done') return 'success'
  if (status === 'quoted') return 'warning'
  if (status === 'paid' || status === 'requested') return 'brand'
  if (status === 'declined') return 'danger'
  return 'neutral'
}

export default function DoorTeamClient({ eventId }: { eventId: string }) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const search = useSearchParams()
  const [data, setData] = useState<LoadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/door-team`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error)
      setData(json)
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
    const requestId = search.get('request')
    const back = search.get('moncash') || search.get('card')
    if (!requestId || !back) return
    if (back === 'cancelled') {
      setNotice(t('door_team.payment_cancelled'))
      return
    }
    void (async () => {
      const res = await fetch(`/api/organizer/events/${eventId}/door-team/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_payment', sessionId: search.get('session_id') || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      setNotice(json?.paid ? t('door_team.payment_received') : t('door_team.payment_not_seen'))
      await load()
      router.replace(`/organizer/events/${eventId}/door-team`)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const config = data?.config
  const requests = data?.requests || []
  const hasOpen = requests.some((r) => OPEN.includes(r.status))
  const start = data?.event.start ? Date.parse(data.event.start) : null
  const tooLate = !!config && (start === null || start - Date.now() < config.minLeadHours * 3600_000)
  const canRequest = !!config?.enabled && !hasOpen && !tooLate

  const requestButton = (
    <button type="button" className={btnPrimary} onClick={() => setFormOpen(true)} disabled={!canRequest}>
      <ScanLine className="h-4 w-4" strokeWidth={1.75} />
      {requests.length > 0 ? t('door_team.new_request') : t('door_team.request_cta')}
    </button>
  )

  return (
    <>
      <SectionHeader
        className="mb-6"
        title={t('door_team.title')}
        description={t('door_team.subtitle')}
        actions={requests.length > 0 && !hasOpen ? <div className="hidden sm:block">{requestButton}</div> : undefined}
      />
      {requests.length > 0 && !hasOpen && <div className="-mt-2 mb-6 sm:hidden [&>button]:w-full">{requestButton}</div>}

      {notice && <p className="mb-6 rounded bg-surface px-4 py-3 text-sm text-fg-soft">{notice}</p>}

      {loading ? (
        <div className="h-40 animate-pulse rounded bg-surface-low" />
      ) : loadError || !config ? (
        <p className="text-sm text-danger-soft">{t('door_team.load_error')}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 space-y-4">
            {!config.enabled && <p className="text-sm text-fg-muted">{t('door_team.disabled')}</p>}
            {config.enabled && tooLate && !hasOpen && (
              <p className="text-sm text-fg-muted">{t('door_team.too_late_note', { hours: config.minLeadHours })}</p>
            )}
            {requests.length === 0 ? (
              <OrgEmptyState variant="quiet" icon={ScanLine} title={t('door_team.empty')} action={canRequest ? requestButton : undefined} />
            ) : (
              requests.map((r) => (
                <RequestCard
                  key={r.id}
                  eventId={eventId}
                  request={r}
                  config={config}
                  balance={data!.balance}
                  eventStart={data!.event.start}
                  onChanged={async (msg) => {
                    if (msg) setNotice(msg)
                    await load()
                  }}
                />
              ))
            )}
          </div>
          <PriceList config={config} />
        </div>
      )}

      {formOpen && config && (
        <RequestDrawer
          eventId={eventId}
          config={config}
          eventStart={data?.event.start || null}
          onClose={() => setFormOpen(false)}
          onSent={async () => {
            setFormOpen(false)
            setNotice(t('door_team.request_sent'))
            await load()
          }}
        />
      )}
    </>
  )
}

function PriceList({ config }: { config: PublicConfig }) {
  const { t } = useTranslation('common')
  return (
    <aside className="rounded bg-surface-low p-4 sm:p-5">
      <p className="text-caption text-fg-subtle">{t('door_team.price_list')}</p>
      <ul className="mt-3 space-y-2 text-sm text-fg-soft">
        <li>{t('door_team.rate_line', { rate: nf(config.ratePerStaffHtg), hours: config.includedHours })}</li>
        <li>{t('door_team.volume_line', { rate: nf(config.volumeRatePerStaffHtg), count: config.volumeMinStaff })}</li>
        <li>{t('door_team.extra_line', { rate: nf(config.extraHourPerStaffHtg) })}</li>
      </ul>
      <p className="mt-3 text-caption text-fg-subtle">{t('door_team.rules_line', { min: config.minStaff, hours: config.minLeadHours })}</p>
    </aside>
  )
}

function RequestCard({
  eventId,
  request: r,
  config,
  balance,
  eventStart,
  onChanged,
}: {
  eventId: string
  request: DoorTeamRequestView
  config: PublicConfig
  balance: { canUse: boolean; availableHtg: number }
  eventStart: string | null
  onChanged: (message?: string) => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const price = Number(r.price_htg) || 0
  const balanceShown = r.status === 'quoted' && showBalanceFor(balance, price)
  const lastMethod = r.payment?.method === 'card' ? 'card' : r.payment?.method === 'balance' ? 'balance' : 'moncash'
  const [method, setMethod] = useState<'moncash' | 'card' | 'balance'>(lastMethod)
  const chosen = method === 'balance' && !balanceShown ? 'moncash' : method
  const standardTotal = Number(r.standard_quote?.totalHtg) || 0
  const paid = r.status === 'paid' || r.status === 'confirmed'
  const refundable = eventStart ? Date.parse(eventStart) - Date.now() >= config.refundCutoffHours * 3600_000 : false

  const act = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/door-team/${r.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('door_team.generic_error'))
      if (json?.redirectUrl) {
        window.location.href = json.redirectUrl
        return
      }
      if (body.action === 'check_payment' && !json?.paid) {
        setError(t('door_team.payment_not_seen'))
        return
      }
      await onChanged(
        body.action === 'cancel' ? t('door_team.cancelled_done') : json?.paid ? t('door_team.payment_received') : undefined
      )
    } catch (e: any) {
      setError(String(e?.message || t('door_team.generic_error')))
    } finally {
      setBusy(false)
    }
  }

  const cancelText = !paid
    ? t('door_team.confirm_cancel_unpaid')
    : refundable
      ? t('door_team.confirm_cancel_refund', { hours: config.refundCutoffHours })
      : t('door_team.confirm_cancel_late', { hours: config.refundCutoffHours })

  const cancelButton = OPEN.includes(r.status) && (
    <button type="button" className={`${btnQuiet} w-full sm:w-auto`} disabled={busy} onClick={() => setConfirming(true)}>
      {t('door_team.cancel_request')}
    </button>
  )

  return (
    <section className="min-w-0 rounded bg-surface-low p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lead font-semibold text-fg">{t('door_team.heading', { staff: r.staff_count, hours: r.hours })}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{t('door_team.arrive_at', { time: when(r.arrival_at) })}</p>
          <p className="mt-0.5 break-words text-sm text-fg-muted">
            {t('door_team.contact_line', { name: r.contact_name, phone: r.contact_phone })}
          </p>
        </div>
        <StatusChip className="!normal-case" tone={doorTeamTone(r.status)}>
          {t(`door_team.status.${r.status}`, { defaultValue: r.status })}
        </StatusChip>
      </div>
      {r.notes && <p className="mt-3 whitespace-pre-line break-words text-sm text-fg-soft">{r.notes}</p>}

      {r.status === 'requested' && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 sm:mr-auto">
            <p className="text-sm text-fg-muted">{t('door_team.waiting_quote')}</p>
            {standardTotal > 0 && (
              <p className="mt-0.5 text-caption text-fg-subtle">{t('door_team.standard_was', { total: nf(standardTotal) })}</p>
            )}
          </div>
          {cancelButton}
        </div>
      )}

      {r.status === 'quoted' && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-surface px-3 py-2.5">
            <span className="text-sm text-fg-muted">{r.price_kind === 'negotiated' ? t('door_team.price_agreed') : t('door_team.price_standard')}</span>
            <span className="font-mono text-lead tabular-nums text-fg">{nf(price)} HTG</span>
          </div>
          {r.price_kind === 'negotiated' && standardTotal > 0 && (
            <p className="text-caption text-fg-subtle">{t('door_team.standard_was', { total: nf(standardTotal) })}</p>
          )}
          {r.quote_note && <p className="break-words text-sm text-fg-soft">{t('door_team.note_from_tikem', { note: r.quote_note })}</p>}
          {r.quote_expires_at && <p className="text-caption text-fg-subtle">{t('door_team.pay_by', { time: when(r.quote_expires_at) })}</p>}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg-soft">{t('door_team.pay_with')}</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(
                [
                  { id: 'moncash', icon: Smartphone, label: t('door_team.method_moncash') },
                  { id: 'card', icon: CreditCard, label: t('door_team.method_card') },
                  ...(balanceShown ? [{ id: 'balance', icon: Wallet, label: t('door_team.method_balance') }] : []),
                ] as Array<{ id: 'moncash' | 'card' | 'balance'; icon: typeof Wallet; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={chosen === m.id}
                  onClick={() => setMethod(m.id)}
                  className={`flex h-10 items-center gap-2 rounded px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    m.id === 'balance' ? 'col-span-2 sm:col-span-1' : ''
                  } ${chosen === m.id ? 'bg-surface-high text-fg' : 'bg-surface text-fg-muted hover:bg-surface-raised'}`}
                >
                  <m.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{m.label}</span>
                </button>
              ))}
            </div>
            {chosen === 'card' && <p className="mt-2 text-caption text-fg-subtle">{t('door_team.card_note')}</p>}
            {chosen === 'balance' && <p className="mt-2 text-caption text-fg-subtle">{t('door_team.balance_note', { amount: nf(balance.availableHtg) })}</p>}
          </fieldset>

          {/* Phones: the main action first and full width; wider: one row, main action last. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
            <button type="button" className={`${btnPrimary} w-full sm:order-last sm:w-auto`} disabled={busy} onClick={() => act({ action: 'pay', method: chosen })}>
              {chosen === 'balance' ? t('door_team.pay_from_balance_total', { total: nf(price) }) : t('door_team.pay_total', { total: nf(price) })}
            </button>
            {r.payment?.status === 'pending' && (
              <button type="button" className={`${btnQuiet} w-full sm:w-auto`} disabled={busy} onClick={() => act({ action: 'check_payment' })}>
                {t('door_team.check_payment')}
              </button>
            )}
            {cancelButton}
          </div>
        </div>
      )}

      {(paid || r.status === 'done') && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-surface px-3 py-2.5">
            <span className="text-sm text-fg-muted">{r.price_kind === 'negotiated' ? t('door_team.price_agreed') : t('door_team.price_standard')}</span>
            <span className="font-mono text-lead tabular-nums text-fg">{nf(price)} HTG</span>
          </div>
          <div>
            <p className="text-caption text-fg-subtle">{t('door_team.crew')}</p>
            {r.crew.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {r.crew.map((c, i) => (
                  <li key={`${c.first_name}-${i}`} className="rounded bg-surface px-3 py-1.5 text-sm text-fg">
                    {c.first_name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-fg-muted">{t('door_team.crew_pending')}</p>
            )}
          </div>
          {paid && <div className="flex flex-col sm:flex-row sm:justify-end">{cancelButton}</div>}
        </div>
      )}

      {r.status === 'declined' && r.decline_reason && (
        <p className="mt-3 break-words text-sm text-fg-muted">{t('door_team.declined_reason', { reason: r.decline_reason })}</p>
      )}
      {r.status === 'expired' && <p className="mt-3 text-sm text-fg-muted">{t('door_team.expired_note')}</p>}
      {r.status === 'cancelled' && r.refund && (
        <p className="mt-3 text-sm text-fg-muted">
          {r.refund.status === 'credited'
            ? t('door_team.credited_back')
            : r.refund.status === 'refunded'
              ? t('door_team.refund_done')
              : r.refund.due
                ? t('door_team.refund_pending')
                : r.cancel_reason === 'organizer_cancelled_late'
                  ? t('door_team.no_refund', { hours: config.refundCutoffHours })
                  : null}
        </p>
      )}

      {error && <p className="mt-3 text-sm text-danger-soft">{error}</p>}

      <ConfirmationDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void act({ action: 'cancel' })
        }}
        title={t('door_team.cancel_request')}
        description={cancelText}
        confirmLabel={t('door_team.cancel_request')}
        cancelLabel={t('door_team.close')}
        variant="danger"
        loading={busy}
      />
    </section>
  )
}

/** A datetime-local value (local time) for an ISO instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function RequestDrawer({
  eventId,
  config,
  eventStart,
  onClose,
  onSent,
}: {
  eventId: string
  config: PublicConfig
  eventStart: string | null
  onClose: () => void
  onSent: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [staff, setStaff] = useState(String(config.minStaff))
  const [hours, setHours] = useState(String(config.includedHours))
  // Default arrival: an hour before doors.
  const [arrival, setArrival] = useState(() => toLocalInput(eventStart ? new Date(Date.parse(eventStart) - 3600_000).toISOString() : null))
  const [notes, setNotes] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const quote = useMemo(
    () => quoteDoorTeam({ ...config }, { staff: Math.round(Number(staff)), hours: Math.round(Number(hours)) }),
    [config, staff, hours]
  )

  const quoteError = !quote.ok
    ? quote.code === 'below_min_staff'
      ? t('door_team.errors.below_min_staff', { min: config.minStaff })
      : quote.code === 'above_max_staff'
        ? t('door_team.errors.above_max_staff', { max: config.maxStaff })
        : quote.code === 'above_max_hours'
          ? t('door_team.errors.above_max_hours', { hours: config.maxHours })
          : quote.code === 'invalid_hours'
            ? t('door_team.errors.invalid_hours')
            : quote.code === 'disabled'
              ? t('door_team.disabled')
              : t('door_team.errors.invalid_staff')
    : null
  const staffError = quote.ok ? null : ['below_min_staff', 'above_max_staff', 'invalid_staff'].includes(quote.code) ? quoteError : null
  const hoursError = quote.ok ? null : ['invalid_hours', 'above_max_hours'].includes(quote.code) ? quoteError : null

  const submit = async () => {
    if (!quote.ok) return
    if (!arrival) return setError(t('door_team.errors.arrival_required'))
    if (contactName.trim().length < 2 || contactPhone.replace(/\D/g, '').length < 7) return setError(t('door_team.errors.contact_required'))
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizer/events/${eventId}/door-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffCount: quote.staff,
          hours: quote.hours,
          arrivalAt: new Date(arrival).toISOString(),
          notes,
          contactName,
          contactPhone,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('door_team.generic_error'))
      await onSent()
    } catch (e: any) {
      setError(String(e?.message || t('door_team.generic_error')))
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('door_team.form_title')}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button type="button" className={`${btnQuiet} w-full sm:w-auto`} onClick={onClose}>
            {t('door_team.close')}
          </button>
          <button type="button" className={`${btnPrimary} w-full sm:w-auto`} disabled={busy || !quote.ok} onClick={submit}>
            {t('door_team.send')}
          </button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <p className="text-sm text-fg-muted">{t('door_team.form_intro')}</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('door_team.staff')} htmlFor="dt-staff" error={staffError || undefined}>
            <input id="dt-staff" type="number" inputMode="numeric" min={config.minStaff} max={config.maxStaff} step={1} value={staff} onChange={(e) => setStaff(e.target.value)} className={field} />
          </FormField>
          <FormField label={t('door_team.hours')} htmlFor="dt-hours" error={hoursError || undefined}>
            <input id="dt-hours" type="number" inputMode="numeric" min={1} max={config.maxHours} step={1} value={hours} onChange={(e) => setHours(e.target.value)} className={field} />
          </FormField>
        </div>
        <FormField label={t('door_team.arrival')} htmlFor="dt-arrival">
          <input id="dt-arrival" type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} className={field} />
        </FormField>

        <div className="rounded bg-surface p-4">
          <p className="text-caption text-fg-subtle">{t('door_team.quote_total')}</p>
          {quote.ok ? (
            <>
              <div className="mt-2 flex justify-between text-sm text-fg-muted">
                <span>{t('door_team.quote_base', { staff: quote.staff, unit: nf(quote.unitHtg) })}</span>
                <span className="font-mono tabular-nums">{nf(quote.baseHtg)} HTG</span>
              </div>
              {quote.extraHours > 0 && (
                <div className="mt-1 flex justify-between gap-3 text-sm text-fg-muted">
                  <span>{t('door_team.quote_extra', { staff: quote.staff, hours: quote.extraHours, rate: nf(config.extraHourPerStaffHtg) })}</span>
                  <span className="font-mono tabular-nums">{nf(quote.extraHoursHtg)} HTG</span>
                </div>
              )}
              <div className="mt-3 flex items-baseline justify-between bg-surface-raised px-3 py-2">
                <span className="text-sm text-fg-muted">{t('door_team.quote_total')}</span>
                <span className="font-mono text-lead tabular-nums text-fg">{nf(quote.totalHtg)} HTG</span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">{quoteError}</p>
          )}
          <p className="mt-3 text-caption text-fg-subtle">{t('door_team.quote_note')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('door_team.contact_name')} htmlFor="dt-cname">
            <input id="dt-cname" type="text" autoComplete="name" value={contactName} onChange={(e) => setContactName(e.target.value)} className={field} />
          </FormField>
          <FormField label={t('door_team.contact_phone')} htmlFor="dt-cphone">
            <input id="dt-cphone" type="tel" autoComplete="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={field} />
          </FormField>
        </div>
        <FormField label={t('door_team.notes')} htmlFor="dt-notes">
          <textarea id="dt-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('door_team.notes_ph')} className={field} />
        </FormField>
        {error && <p className="text-sm text-danger-soft">{error}</p>}
      </div>
    </Drawer>
  )
}
