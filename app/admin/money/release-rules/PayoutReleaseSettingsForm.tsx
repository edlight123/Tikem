'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Clock, Info, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { PayoutReleaseConfig } from '@/types/platform-settings'
import { ConsoleButton, ConsolePanel, ConsoleState } from '@/components/admin/console'

/**
 * Platform payout release thresholds — the admin face of
 * /api/admin/payout-release. Every knob here decides when other people's money
 * moves, so each field carries a one-line plain-language explanation, its
 * platform default (with a one-click reset), and the server's own min/max.
 *
 * Units: the API stores money in MINOR units of the account currency and
 * ratios as 0..1. This form speaks major units and percent to the admin and
 * converts on save.
 *
 * No reserve: Tikèm does not hold back a slice of an organizer's takings, so
 * there is nothing here to configure for one. Chargeback exposure is handled by
 * the post-event hold and by the review triggers below.
 */

type NumericField =
  | 'newHoldHours'
  | 'establishedHoldHours'
  | 'establishedAfterEvents'
  | 'establishedAfterGrossMinor'
  | 'preEventEligibleGrossMinor'
  | 'reviewAboveGrossMinor'
  | 'manualCheckInReviewRatio'
  | 'lowAttendanceReviewRatio'

/** How a stored value is shown to (and read back from) the admin. */
type FieldKind = 'hours' | 'events' | 'money' | 'percentRatio'

type Limit = { min: number; max: number }

interface FieldDef {
  key: NumericField
  label: string
  kind: FieldKind
  /** One sentence: what changing this does to real organizers. */
  help: string
}

interface GroupDef {
  title: string
  blurb: string
  fields: FieldDef[]
}

/**
 * Live FX status, computed on the server from the stored daily snapshot. Purely
 * informational — the editable numbers below are the manual fallback table.
 */
export type FxStatus = {
  /** A readable snapshot doc exists. */
  available: boolean
  provider: string | null
  fetchedAt: string | null
  ageHours: number | null
  maxAgeDays: number
  /** Currencies whose live rate came from the snapshot… */
  snapshotCurrencies: string[]
  /** …and the ones falling back to the hand-maintained numbers below. */
  manualCurrencies: string[]
  /** Provider currencies that were missing or refused by the sanity guard. */
  warnings: string[]
}

const GROUPS: GroupDef[] = [
  {
    title: 'Holds',
    blurb: 'How long after an event ends before ticket money is allowed to move to the organizer.',
    fields: [
      {
        key: 'newHoldHours',
        label: 'New organizer hold',
        kind: 'hours',
        help: 'A new organizer waits this many hours after their event ends before payout, raising it makes us safer and makes them slower.',
      },
      {
        key: 'establishedHoldHours',
        label: 'Established organizer hold',
        kind: 'hours',
        help: 'The same wait once an organizer has earned the established tier below.',
      },
    ],
  },
  {
    title: 'When an organizer becomes established',
    blurb: 'Either threshold is enough, an organizer graduates on whichever they reach first.',
    fields: [
      {
        key: 'establishedAfterEvents',
        label: 'Clean events needed',
        kind: 'events',
        help: 'Events completed without a dispute or a refund storm before an organizer counts as established.',
      },
      {
        key: 'establishedAfterGrossMinor',
        label: 'Lifetime revenue needed',
        kind: 'money',
        help: 'Lifetime gross ticket sales that also earn the established tier, for organizers who sell a lot across few events.',
      },
      {
        key: 'preEventEligibleGrossMinor',
        label: 'Lifetime revenue for pre-event eligibility',
        kind: 'money',
        help: 'Below this, an admin cannot grant pre-event payouts at all; reaching it grants nothing by itself, an admin still has to approve each organizer by hand.',
      },
    ],
  },
  {
    title: 'Review triggers',
    blurb: 'These never block an organizer, they route a payout to the admin queue for a human look instead of paying out automatically.',
    fields: [
      {
        key: 'reviewAboveGrossMinor',
        label: 'Review events above',
        kind: 'money',
        help: 'An event this big from an organizer who is still new goes to review rather than paying out on its own.',
      },
      {
        key: 'manualCheckInReviewRatio',
        label: 'Manual check-in share',
        kind: 'percentRatio',
        help: 'If this share or more of an event’s check-ins were typed in by hand instead of scanned, send the payout to review.',
      },
      {
        key: 'lowAttendanceReviewRatio',
        label: 'Low attendance below',
        kind: 'percentRatio',
        help: 'If fewer than this share of sold tickets were checked in, send the payout to review, it can mean the event never really happened.',
      },
    ],
  },
]

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields)

/** Mirrors the server's own guard on referenceRates. */
const MAX_REFERENCE_RATE = 10_000

const majorFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const minorFormatter = new Intl.NumberFormat('en-US')
const rateFormatter = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 })

function round(value: number, places: number) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Stored (API) value → what the admin types. */
function toDisplay(kind: FieldKind, value: number): string {
  if (!Number.isFinite(value)) return ''
  switch (kind) {
    case 'money':
      return (value / 100).toFixed(2)
    case 'percentRatio':
      return String(round(value * 100, 2))
    default:
      return String(value)
  }
}

/** What the admin typed → the stored (API) value. NaN when unparseable. */
function toApi(kind: FieldKind, display: string): number {
  const n = Number(display)
  if (display.trim() === '' || !Number.isFinite(n)) return NaN
  switch (kind) {
    case 'money':
      return Math.round(n * 100)
    case 'percentRatio':
      // via basis points so 80 → 0.8 exactly rather than 0.7999999
      return Math.round(n * 100) / 10000
    default:
      return n
  }
}

function unitSuffix(kind: FieldKind): string {
  switch (kind) {
    case 'hours':
      return 'hours'
    case 'events':
      return 'events'
    case 'percentRatio':
      return '%'
    case 'money':
      return ''
  }
}

function stepFor(kind: FieldKind): string {
  switch (kind) {
    case 'money':
      return '0.01'
    default:
      return '1'
  }
}

/** Pretty version of a display value, for the default chip and previews. */
function prettyDisplay(kind: FieldKind, display: string): string {
  const n = Number(display)
  if (!Number.isFinite(n)) return display
  if (kind === 'money') return majorFormatter.format(n)
  if (kind === 'percentRatio') return `${round(n, 2)}%`
  return `${n} ${unitSuffix(kind)}`.trim()
}

type Values = Record<NumericField, string>

function valuesFrom(config: PayoutReleaseConfig): Values {
  return ALL_FIELDS.reduce((acc, field) => {
    acc[field.key] = toDisplay(field.kind, config[field.key] as number)
    return acc
  }, {} as Values)
}

// ── FX rate table ───────────────────────────────────────────────────────────

/** One editable row of the manual reference-rate table. */
type RateRow = { id: string; code: string; value: string }

let rateRowSeq = 0
const nextRowId = () => `rate-${(rateRowSeq += 1)}`

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 3)
}

/**
 * The threshold currency is always 1 by definition and is force-pinned by the
 * API, so it is shown but never edited — only the other currencies are rows.
 */
function rowsFrom(config: PayoutReleaseConfig): RateRow[] {
  const threshold = normalizeCode(config.thresholdCurrency || 'USD')
  return Object.entries(config.referenceRates || {})
    .map(([code, value]) => [normalizeCode(code), value] as const)
    .filter(([code]) => code !== threshold)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, value]) => ({ id: nextRowId(), code, value: String(value) }))
}

/** Rows + the pinned threshold currency → exactly what the API stores. */
function ratesPayload(rows: RateRow[], thresholdCurrency: string): Record<string, number> {
  const threshold = normalizeCode(thresholdCurrency) || 'USD'
  const out: Record<string, number> = {}
  for (const row of rows) {
    const code = normalizeCode(row.code)
    if (!/^[A-Z]{3}$/.test(code) || code === threshold) continue
    const n = Number(row.value)
    if (!Number.isFinite(n) || n <= 0) continue
    out[code] = n
  }
  out[threshold] = 1
  return out
}

function formatAge(ageHours: number | null): string {
  if (ageHours === null || !Number.isFinite(ageHours)) return 'unknown age'
  if (ageHours < 1) return 'less than an hour ago'
  if (ageHours < 48) return `${Math.round(ageHours)} hours ago`
  return `${Math.round(ageHours / 24)} days ago`
}

export function PayoutReleaseSettingsForm({ fx = null }: { fx?: FxStatus | null }) {
  const [config, setConfig] = useState<PayoutReleaseConfig | null>(null)
  const [defaults, setDefaults] = useState<PayoutReleaseConfig | null>(null)
  const [limits, setLimits] = useState<Partial<Record<NumericField, Limit>>>({})

  const [values, setValues] = useState<Values | null>(null)
  const [thresholdCurrency, setThresholdCurrency] = useState('USD')
  const [rateRows, setRateRows] = useState<RateRow[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [serverDetails, setServerDetails] = useState<string[]>([])

  const applyConfig = (next: PayoutReleaseConfig) => {
    setValues(valuesFrom(next))
    setThresholdCurrency(normalizeCode(next.thresholdCurrency || 'USD'))
    setRateRows(rowsFrom(next))
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/admin/payout-release')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data?.config) {
          setMessage({ type: 'error', text: data?.error || 'Failed to load payout release settings' })
          return
        }
        setConfig(data.config)
        setDefaults(data.defaults)
        setLimits(data.limits || {})
        applyConfig(data.config)
      } catch (error) {
        console.error('Error loading payout release settings:', error)
        if (!cancelled) setMessage({ type: 'error', text: 'Failed to load payout release settings' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  /** Client-side mirror of the server guard rails. The server is the authority. */
  const fieldError = (field: FieldDef): string | null => {
    if (!values) return null
    const raw = values[field.key]
    if (raw.trim() === '') return 'Required'
    const apiValue = toApi(field.kind, raw)
    if (!Number.isFinite(apiValue)) return 'Must be a number'
    const limit = limits[field.key]
    if (limit && (apiValue < limit.min || apiValue > limit.max)) {
      return `Must be between ${toDisplay(field.kind, limit.min)} and ${toDisplay(field.kind, limit.max)}`
    }
    return null
  }

  const errors = values
    ? ALL_FIELDS.reduce<Partial<Record<NumericField, string>>>((acc, field) => {
        const err = fieldError(field)
        if (err) acc[field.key] = err
        return acc
      }, {})
    : {}

  const normalizedThreshold = normalizeCode(thresholdCurrency)
  const thresholdError = /^[A-Z]{3}$/.test(normalizedThreshold)
    ? null
    : 'Use a 3-letter currency code, e.g. USD'

  const seenCodes = new Map<string, number>()
  for (const row of rateRows) {
    const code = normalizeCode(row.code)
    seenCodes.set(code, (seenCodes.get(code) || 0) + 1)
  }

  const rowError = (row: RateRow): string | null => {
    const code = normalizeCode(row.code)
    if (code === '') return 'Currency code required'
    if (!/^[A-Z]{3}$/.test(code)) return 'Use a 3-letter currency code'
    if ((seenCodes.get(code) || 0) > 1) return 'This currency is listed twice'
    if (code === normalizedThreshold) return null // pinned to 1 by the API
    const n = Number(row.value)
    if (row.value.trim() === '' || !Number.isFinite(n)) return 'Must be a number'
    if (n <= 0 || n > MAX_REFERENCE_RATE) return `Must be greater than 0 and at most ${minorFormatter.format(MAX_REFERENCE_RATE)}`
    return null
  }

  const rateErrors = rateRows.reduce<Record<string, string>>((acc, row) => {
    const err = rowError(row)
    if (err) acc[row.id] = err
    return acc
  }, {})

  const hasErrors =
    Object.keys(errors).length > 0 || Object.keys(rateErrors).length > 0 || !!thresholdError

  const isDirtyField = (field: FieldDef) =>
    !!config && !!values && toApi(field.kind, values[field.key]) !== config[field.key]

  const ratesDirty =
    !!config &&
    JSON.stringify(ratesPayload(rateRows, normalizedThreshold)) !==
      JSON.stringify(ratesPayload(rowsFrom(config), normalizeCode(config.thresholdCurrency || 'USD')))

  const hasChanges =
    !!config &&
    !!values &&
    (ALL_FIELDS.some(isDirtyField) ||
      normalizedThreshold !== normalizeCode(config.thresholdCurrency || 'USD') ||
      ratesDirty)

  const isDefaultField = (field: FieldDef) =>
    !!defaults && !!values && toApi(field.kind, values[field.key]) === defaults[field.key]

  const setValue = (key: NumericField, next: string) => {
    setValues((prev) => (prev ? { ...prev, [key]: next } : prev))
  }

  const resetField = (field: FieldDef) => {
    if (!defaults) return
    setValue(field.key, toDisplay(field.kind, defaults[field.key] as number))
  }

  const resetAll = () => {
    if (!defaults) return
    applyConfig(defaults)
  }

  const discardChanges = () => {
    if (!config) return
    applyConfig(config)
    setMessage(null)
    setServerDetails([])
  }

  const setRow = (id: string, patch: Partial<RateRow>) => {
    setRateRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const addRow = () => setRateRows((prev) => [...prev, { id: nextRowId(), code: '', value: '' }])

  const removeRow = (id: string) => setRateRows((prev) => prev.filter((row) => row.id !== id))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!values || hasErrors || saving) return

    setSaving(true)
    setMessage(null)
    setServerDetails([])

    try {
      const payload: Record<string, unknown> = {
        thresholdCurrency: normalizedThreshold,
        referenceRates: ratesPayload(rateRows, normalizedThreshold),
      }
      for (const field of ALL_FIELDS) {
        payload[field.key] = toApi(field.kind, values[field.key])
      }

      const res = await fetch('/api/admin/payout-release', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Failed to save payout release settings' })
        if (Array.isArray(data?.details)) setServerDetails(data.details)
        return
      }

      setConfig(data.config)
      applyConfig(data.config)
      const changed: string[] = Array.isArray(data.changed) ? data.changed : []
      setMessage({
        type: 'success',
        text: changed.length
          ? `Saved, ${changed.length} setting${changed.length === 1 ? '' : 's'} updated.`
          : 'Nothing to save, these values already match what is live.',
      })
    } catch (error) {
      console.error('Error saving payout release settings:', error)
      setMessage({ type: 'error', text: 'Failed to save payout release settings' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg bg-console-panel p-4 sm:p-5">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-1/4 rounded bg-console-raise" />
              <div className="h-4 w-1/2 rounded bg-console-raise" />
              <div className="h-4 w-1/3 rounded bg-console-raise" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!config || !values || !defaults) {
    return (
      <div className="rounded-lg bg-console-panel p-4 text-sm text-console-red">
        {message?.text || 'Could not load payout release settings.'}
      </div>
    )
  }

  const snapshotStale =
    !!fx && (!fx.available || fx.ageHours === null || fx.ageHours > fx.maxAgeDays * 24)

  return (
    <div className="space-y-6">
      {/* Live summary figures */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
        <div>
          <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">New hold</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {config.newHoldHours}
            <span className="text-sm font-medium text-console-mut"> h</span>
          </p>
        </div>
        <div>
          <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Established hold</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {config.establishedHoldHours}
            <span className="text-sm font-medium text-console-mut"> h</span>
          </p>
        </div>
        <div>
          <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Established after</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {config.establishedAfterEvents}
            <span className="text-sm font-medium text-console-mut"> events</span>
          </p>
        </div>
        <div>
          <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Review above</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {majorFormatter.format(config.reviewAboveGrossMinor / 100)}
          </p>
        </div>
        <div>
          <p className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Thresholds in</p>
          <p className="mt-1 font-mono text-xl text-console-text">
            {normalizeCode(config.thresholdCurrency || 'USD')}
          </p>
        </div>
      </div>

      {/* Money units, stated honestly */}
      <ConsolePanel className="flex gap-3 p-4">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-console-faint" />
        <p className="text-sm text-console-mut">
          Money thresholds are stored and compared in <span className="text-console-text">minor units of the account
          currency</span> (cents for a USD account, centimes for HTG), there is one number for every currency, so it is
          not dollars. Inputs below are shown in major units for readability: typing{' '}
          <span className="font-mono text-console-text">1,000.00</span> saves{' '}
          <span className="font-mono text-console-text">100,000</span> minor units. Changes take effect on the next release
          decision and are audit-logged.
        </p>
      </ConsolePanel>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Messages */}
        {message && (
          <ConsolePanel
            className={`p-4 text-sm ${
              message.type === 'success' ? 'text-console-green' : 'text-console-red'
            }`}
          >
            <p>{message.text}</p>
            {serverDetails.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-console-red">
                {serverDetails.map((detail, i) => (
                  <li key={i} className="font-mono">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </ConsolePanel>
        )}

        {GROUPS.map((group) => (
          <section key={group.title} className="rounded-lg bg-console-panel p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">{group.title}</h2>
              <p className="mt-1 text-xs text-console-mut">{group.blurb}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.fields.map((field) => {
                const limit = limits[field.key]
                const error = errors[field.key]
                const defaultDisplay = toDisplay(field.kind, defaults[field.key] as number)
                const atDefault = isDefaultField(field)
                const suffix = unitSuffix(field.kind)
                const apiValue = toApi(field.kind, values[field.key])

                return (
                  <div key={field.key}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <label htmlFor={field.key} className="block text-sm font-medium text-console-mut">
                        {field.label}
                      </label>
                      {atDefault ? (
                        <span className="label-mono text-eyebrow uppercase tracking-wide text-console-faint">Default</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => resetField(field)}
                          className="inline-flex items-center gap-1 text-eyebrow font-semibold text-console-mut hover:text-console-text"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset to {prettyDisplay(field.kind, defaultDisplay)}
                        </button>
                      )}
                    </div>

                    <div className="relative">
                      <input
                        type="number"
                        id={field.key}
                        value={values[field.key]}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        step={stepFor(field.kind)}
                        min={limit ? toDisplay(field.kind, limit.min) : undefined}
                        max={limit ? toDisplay(field.kind, limit.max) : undefined}
                        aria-describedby={`${field.key}-help`}
                        className={`w-full rounded bg-console-ground px-3 py-2.5 text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut ${
                          error ? 'ring-1 ring-console-red' : ''
                        } ${suffix ? 'pr-16' : ''}`}
                      />
                      {suffix && (
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                          <span className="text-sm text-console-mut">{suffix}</span>
                        </div>
                      )}
                    </div>

                    <p id={`${field.key}-help`} className="mt-1.5 text-xs text-console-mut">
                      {field.help}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-eyebrow text-console-faint">
                      <span>
                        Default {prettyDisplay(field.kind, defaultDisplay)}
                      </span>
                      {limit && (
                        <span>
                          Allowed {prettyDisplay(field.kind, toDisplay(field.kind, limit.min))}, {' '}
                          {prettyDisplay(field.kind, toDisplay(field.kind, limit.max))}
                        </span>
                      )}
                      {field.kind === 'money' && Number.isFinite(apiValue) && (
                        <span className="font-mono">= {minorFormatter.format(apiValue)} minor units</span>
                      )}
                    </div>

                    {error && <p className="mt-1 text-xs text-console-red">{error}</p>}
                  </div>
                )
              })}

              {/* A trigger is only useful if someone answers it. */}
              {group.title === 'Review triggers' && (
                <p className="text-xs text-console-mut md:col-span-2">
                  Payouts these triggers have flagged are waiting in the{' '}
                  <Link
                    href="/admin/money"
                    className="text-console-text underline decoration-console-faint hover:decoration-console-text"
                  >
                    review queue
                  </Link>{' '}
, a flagged event stays unpaid until someone decides there.
                </p>
              )}
            </div>
          </section>
        ))}

        {/* ── Threshold currency + FX fallback table ─────────────────────── */}
        <section className="rounded-lg bg-console-panel p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">
              Currency conversion for thresholds
            </h2>
            <p className="mt-1 text-xs text-console-mut">
              The money thresholds above are single numbers, but organizers settle in different currencies. Before a
              threshold is compared, an amount is converted into the threshold currency with these rates, so one
              threshold means one economic amount whether the account is in USD, CAD, EUR or HTG. Rates are used{' '}
              <span className="text-console-text">only for those comparisons</span>: payouts are always made in the
              account&rsquo;s own currency and are never converted.
            </p>
          </div>

          {/* Where the live rates actually come from */}
          <div
            className={`mb-4 rounded-lg bg-console-ground p-4 text-xs ${
              snapshotStale ? 'ring-1 ring-console-amber' : ''
            }`}
          >
            <p className="text-sm font-medium text-console-text">
              A daily job overwrites these, hand-edits are the fallback
            </p>
            <p className="mt-1 text-console-mut">
              <span className="font-mono text-console-text">/api/cron/fx-snapshot</span> fetches mid-market rates once a day
              and stores them. A release run reads that snapshot and only falls back to the table below for currencies
              the provider did not return, or for every currency once the snapshot is more than{' '}
              {fx?.maxAgeDays ?? 7} days old. So typing a rate here does not pin it: it is the number used when the
              snapshot cannot answer.
            </p>

            {fx ? (
              <div className="mt-3 space-y-1.5 text-console-mut">
                {fx.available ? (
                  <p>
                    <ConsoleState tone={snapshotStale ? 'warn' : 'good'}>
                      Snapshot updated {formatAge(fx.ageHours)}
                    </ConsoleState>
                    {fx.fetchedAt ? <span className="font-mono text-console-faint"> ({fx.fetchedAt.slice(0, 16).replace('T', ' ')} UTC)</span> : null}
                    {fx.provider ? <span className="text-console-faint"> via {fx.provider}</span> : null}
                    {snapshotStale ? ', too old to trust, every currency is on the manual rate below.' : ''}
                  </p>
                ) : (
                  <p>
                    <ConsoleState tone="warn">No FX snapshot stored yet</ConsoleState>, every currency is using the
                    manual rate below.
                  </p>
                )}
                <p>
                  From the snapshot:{' '}
                  <span className="font-mono text-console-text">
                    {fx.snapshotCurrencies.length ? fx.snapshotCurrencies.join(', ') : 'none'}
                  </span>
                </p>
                <p>
                  From this table:{' '}
                  <span className="font-mono text-console-text">
                    {fx.manualCurrencies.length ? fx.manualCurrencies.join(', ') : 'none'}
                  </span>
                </p>
                {fx.warnings.map((warning, i) => (
                  <p key={i} className="text-console-amber">
                    {warning}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-console-faint">Snapshot status unavailable.</p>
            )}
          </div>

          {/* Threshold currency */}
          <div className="mb-4 max-w-xs">
            <label htmlFor="thresholdCurrency" className="mb-1.5 block text-sm font-medium text-console-mut">
              Threshold currency
            </label>
            <input
              id="thresholdCurrency"
              type="text"
              value={thresholdCurrency}
              onChange={(e) => setThresholdCurrency(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="thresholdCurrency-help"
              className={`w-full rounded bg-console-ground px-3 py-2.5 font-mono text-sm uppercase tracking-widest text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut ${
                thresholdError ? 'ring-1 ring-console-red' : ''
              }`}
            />
            <p id="thresholdCurrency-help" className="mt-1.5 text-xs text-console-mut">
              The currency every money threshold above is expressed in. Its own rate is always 1.
            </p>
            {thresholdError && <p className="mt-1 text-xs text-console-red">{thresholdError}</p>}
          </div>

          {/* Rate rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-console-mut">
                Fallback rates, {normalizedThreshold || 'USD'} per 1 unit
              </p>
              <span className="label-mono text-eyebrow uppercase tracking-wide text-console-faint">
                {rateRows.length} currenc{rateRows.length === 1 ? 'y' : 'ies'}
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-lg bg-console-ground px-3 py-2.5 text-xs text-console-faint">
              <span className="font-mono text-sm uppercase tracking-widest text-console-mut">
                {normalizedThreshold || 'USD'}
              </span>
              <span className="font-mono text-sm text-console-mut">1</span>
              <span>Pinned, the threshold currency is always 1 against itself.</span>
            </div>

            {rateRows.map((row) => {
              const error = rateErrors[row.id]
              const code = normalizeCode(row.code)
              const rate = Number(row.value)
              const pinned = code === normalizedThreshold && /^[A-Z]{3}$/.test(code)
              const showPreview =
                !pinned && !error && /^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0

              return (
                <div key={row.id}>
                  <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                    <input
                      type="text"
                      value={row.code}
                      onChange={(e) => setRow(row.id, { code: e.target.value.toUpperCase().slice(0, 3) })}
                      maxLength={3}
                      placeholder="HTG"
                      spellCheck={false}
                      aria-label="Currency code"
                      className={`w-24 flex-shrink-0 rounded bg-console-ground px-3 py-2.5 font-mono text-sm uppercase tracking-widest text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut ${
                        error ? 'ring-1 ring-console-red' : ''
                      }`}
                    />
                    <input
                      type="number"
                      value={pinned ? '1' : row.value}
                      onChange={(e) => setRow(row.id, { value: e.target.value })}
                      disabled={pinned}
                      step="any"
                      min="0"
                      max={MAX_REFERENCE_RATE}
                      placeholder="0.0076"
                      aria-label={`${code || 'Currency'} rate`}
                      className={`min-w-0 flex-1 rounded bg-console-ground px-3 py-2.5 font-mono text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut disabled:opacity-40 ${
                        error ? 'ring-1 ring-console-red' : ''
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Remove ${code || 'currency'}`}
                      className="flex-shrink-0 rounded bg-console-raise p-2.5 text-console-mut transition-colors hover:text-console-red"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {pinned && (
                    <p className="mt-1 text-eyebrow text-console-faint">
                      This is the threshold currency, saved as 1 whatever is typed.
                    </p>
                  )}
                  {showPreview && (
                    <p className="mt-1 text-eyebrow text-console-faint">
                      1 {code} counts as {rateFormatter.format(rate)} {normalizedThreshold} · 1{' '}
                      {normalizedThreshold} counts as {rateFormatter.format(1 / rate)} {code}
                    </p>
                  )}
                  {error && <p className="mt-1 text-xs text-console-red">{error}</p>}
                </div>
              )
            })}

            <ConsoleButton
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add currency
            </ConsoleButton>

            <p className="text-xs text-console-faint">
              A currency with no rate at all is compared unconverted, its raw minor-unit number is measured against the
              threshold, which is almost always wrong. Removing a row is only safe when no organizer settles in that
              currency. Rates must be above 0 and at most{' '}
              {minorFormatter.format(MAX_REFERENCE_RATE)}; the daily job also refuses any single-day move larger than
              35%, so a bad provider response keeps the previous value instead of moving the bar.
            </p>
          </div>
        </section>

        {/* Sticky save bar */}
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-console-panel/90 px-4 py-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-4 text-sm">
            {hasChanges ? (
              <ConsoleState tone="warn">Unsaved changes</ConsoleState>
            ) : (
              <span className="text-console-mut">All changes saved</span>
            )}
            {hasErrors && (
              <span className="inline-flex items-center gap-1.5 text-xs text-console-red">
                <AlertTriangle className="h-3.5 w-3.5" />
                Fix the highlighted fields
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <ConsoleButton type="button" onClick={resetAll} className="text-xs">
              Load platform defaults
            </ConsoleButton>
            <ConsoleButton type="button" onClick={discardChanges} disabled={!hasChanges} className="text-xs">
              Discard
            </ConsoleButton>
            <ConsoleButton type="submit" variant="primary" disabled={saving || !hasChanges || hasErrors}>
              {saving ? 'Saving...' : 'Save thresholds'}
            </ConsoleButton>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-console-faint">
          <Clock className="h-3.5 w-3.5" /> Per-organizer exceptions (pre-event payouts, high risk, custom holds) are
          set on each organizer’s detail page, not here.
        </p>
      </form>
    </div>
  )
}
