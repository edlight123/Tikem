'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ConsoleButton,
  ConsoleInput,
  ConsolePanel,
  ConsoleSection,
  ConsoleState,
  type ConsoleTone,
} from '@/components/admin/console'
import {
  ACCOUNT_LABELS,
  TRANSFER_ACCOUNTS,
  type FundTransfer,
  type MoneyMap,
  type PayoutCheck,
  type TransferAccount,
} from '@/lib/payouts/money-map'

/**
 * Money map (admin). Reads GET /api/admin/money-map, records movements and
 * organizer wires through POST /api/admin/fund-transfers. Read-mostly: the
 * only write is the append-only ledger entry.
 */

const CURRENCIES = ['USD', 'HTG', 'CAD', 'EUR'] as const

function fmt(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—'
  const major = minor / 100
  const digits = currency === 'HTG' ? 0 : 2
  return `${major.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`
}

const accountLabel = (a: string) => (a === 'organizer' ? 'Organizer' : ACCOUNT_LABELS[a as keyof typeof ACCOUNT_LABELS] || a)

const PAYOUT_STATE: Record<PayoutCheck['state'], { tone: ConsoleTone; label: string }> = {
  matched: { tone: 'good', label: 'Matches withdrawal' },
  variance: { tone: 'warn', label: 'Differs from withdrawal' },
  currency_mismatch: { tone: 'warn', label: 'Different currency' },
  unlinked: { tone: 'bad', label: 'No withdrawal linked' },
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' }) {
  const color = tone === 'bad' ? 'text-console-red' : tone === 'good' ? 'text-console-green' : 'text-console-text'
  return (
    <div>
      <div className="label-mono text-eyebrow uppercase tracking-[0.14em] text-console-faint">{label}</div>
      <div className={`mt-1 text-body font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

type FormState = {
  kind: 'movement' | 'organizer_payout'
  fromAccount: TransferAccount
  toAccount: TransferAccount
  amount: string
  currency: string
  toAmount: string
  toCurrency: string
  fxRate: string
  fee: string
  reference: string
  date: string
  note: string
  organizerId: string
  withdrawalId: string
}

const EMPTY_FORM: FormState = {
  kind: 'movement',
  fromAccount: 'stripe_platform',
  toAccount: 'bank',
  amount: '',
  currency: 'USD',
  toAmount: '',
  toCurrency: 'USD',
  fxRate: '',
  fee: '',
  reference: '',
  date: '',
  note: '',
  organizerId: '',
  withdrawalId: '',
}

const selectClass =
  'mt-1 w-full rounded bg-console-ground px-3 py-2 text-meta text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut'

export function MoneyMapClient() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [map, setMap] = useState<MoneyMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await fetch(`/api/admin/money-map?${qs.toString()}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not load the money map')
      setMap(data.map as MoneyMap)
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the money map')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
    // Loaded once on mount; the date range reloads on "Apply".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setForm((f) => (f.date ? f : { ...f, date: todayIso() }))
  }, [])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const isPayout = form.kind === 'organizer_payout'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaved(null)
    const num = (s: string) => (s.trim() ? Number(s.replace(/,/g, '')) : null)
    const body = {
      kind: form.kind,
      fromAccount: form.fromAccount,
      toAccount: isPayout ? 'organizer' : form.toAccount,
      amount: num(form.amount),
      currency: form.currency,
      toAmount: num(form.toAmount),
      toCurrency: form.toCurrency,
      fxRate: num(form.fxRate),
      fee: num(form.fee),
      reference: form.reference || null,
      date: form.date,
      note: form.note || null,
      organizerId: isPayout ? form.organizerId || null : null,
      withdrawalId: isPayout ? form.withdrawalId || null : null,
    }
    try {
      const res = await fetch('/api/admin/fund-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not record it')
      setSaved(isPayout ? 'Organizer payout recorded.' : 'Movement recorded.')
      setForm({ ...EMPTY_FORM, kind: form.kind, fromAccount: form.fromAccount, date: todayIso() })
      await load()
    } catch (err: any) {
      setSaveError(err?.message || 'Could not record it')
    } finally {
      setSaving(false)
    }
  }

  const h = map?.haiti

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-caption text-console-mut">
          From
          <ConsoleInput type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block text-caption text-console-mut">
          To
          <ConsoleInput type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <ConsoleButton onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </ConsoleButton>
        <span className="text-caption text-console-faint">Empty dates = all time. Haiti figures are always as of now.</span>
      </div>

      {loadError && <p className="mt-4 text-meta text-console-red">{loadError}</p>}
      {map?.truncated && (
        <p className="mt-4 text-meta text-console-amber">
          Too many tickets to scan at once ({map.ticketsScanned.toLocaleString()}): totals are partial. Narrow the dates.
        </p>
      )}

      {h && (
        <>
          <ConsoleSection>Haiti · owed vs MonCash prefunding</ConsoleSection>
          <ConsolePanel className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Owed via MonCash" value={fmt(h.owedMinor, 'HTG')} />
            <Figure
              label="Prefunded pool"
              value={h.poolBalanceMinor === null ? 'Unavailable' : fmt(h.poolBalanceMinor, 'HTG')}
            />
            <Figure
              label="Shortfall"
              value={h.shortfallMinor === null ? '—' : fmt(h.shortfallMinor, 'HTG')}
              tone={h.shortfallMinor ? 'bad' : h.shortfallMinor === 0 ? 'good' : undefined}
            />
            <Figure label="Shortfall in USD" value={fmt(h.shortfallUsdMinor, 'USD')} />
            <Figure label="Owed by bank wire" value={fmt(h.owedByWireMinor, 'HTG')} />
            <Figure label="Stripe + bank (USD) to move" value={fmt(h.movableUsdMinor, 'USD')} />
            <Figure label="Unsent MonCash withdrawals" value={fmt(h.unsentWithdrawalsMinor, 'HTG')} />
            {h.owedUsdEventsMinor > 0 && <Figure label="Owed on USD-priced events" value={fmt(h.owedUsdEventsMinor, 'USD')} />}
          </ConsolePanel>
          {h.poolError && <p className="mt-2 text-caption text-console-amber">MonCash balance: {h.poolError}</p>}
          <p className="mt-2 text-caption text-console-faint">
            Owed = organizer balances from the payout engine (released or not yet) plus withdrawals filed but not sent.
            The shortfall is what must reach Digicel prefunding before those payouts can go out.
          </p>
        </>
      )}

      {map?.currencies.map((block) => (
        <div key={block.currency}>
          <ConsoleSection>
            {block.currency} · Tikèm holds {fmt(block.tikemBalanceMinor, block.currency)}
          </ConsoleSection>
          <ConsolePanel className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-meta">
              <thead className="label-mono border-b border-console-ground text-eyebrow uppercase tracking-[0.14em] text-console-faint">
                <tr>
                  <th className="px-4 py-3 font-normal">Where</th>
                  <th className="px-4 py-3 text-right font-normal">Tickets</th>
                  <th className="px-4 py-3 text-right font-normal">Collected</th>
                  <th className="px-4 py-3 text-right font-normal">Refunded</th>
                  <th className="px-4 py-3 text-right font-normal">Chargebacks</th>
                  <th className="px-4 py-3 text-right font-normal">Moved out</th>
                  <th className="px-4 py-3 text-right font-normal">Moved in</th>
                  <th className="px-4 py-3 text-right font-normal">Balance</th>
                </tr>
              </thead>
              <tbody>
                {block.lines.map((l) => (
                  <tr key={l.account} className="border-b border-console-ground last:border-0">
                    <td className="px-4 py-3 text-console-text">
                      {l.label}
                      {!l.tikemHeld && <span className="ml-2 text-caption text-console-faint">not Tikèm&apos;s</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-console-mut">{l.tickets || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-console-text">{fmt(l.grossMinor, l.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-console-mut">{fmt(l.refundedMinor, l.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-console-mut">{fmt(l.disputedMinor, l.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-console-mut">{fmt(l.transferredOutMinor, l.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-console-mut">{fmt(l.transferredInMinor, l.currency)}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        l.balanceMinor < 0 ? 'text-console-red' : 'text-console-text'
                      }`}
                    >
                      {fmt(l.balanceMinor, l.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ConsolePanel>
        </div>
      ))}
      {map && map.currencies.length === 0 && !loading && (
        <p className="mt-6 text-meta text-console-mut">No paid sales or movements in this range.</p>
      )}
      <p className="mt-2 text-caption text-console-faint">
        A ledger balance, not a bank statement: Stripe fees, FX spreads and anything not recorded below show up as the
        difference from the real account. A card sale on a Haiti event arrives in USD; Stripe converts it to CAD on
        payout unless a USD bank account is attached.
      </p>

      {map && map.payoutChecks.length > 0 && (
        <>
          <ConsoleSection>Organizer wires</ConsoleSection>
          <div className="space-y-2">
            {map.payoutChecks.map((p) => (
              <ConsolePanel key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-meta">
                <span className="label-mono text-console-faint">{p.date}</span>
                <span className="text-console-text">
                  {fmt(p.amountMinor, p.currency)} → {fmt(p.toAmountMinor, p.toCurrency)}
                </span>
                {p.feeMinor > 0 && <span className="text-console-mut">fee {fmt(p.feeMinor, p.currency)}</span>}
                {p.owedMinor !== null && (
                  <span className="text-console-mut">withdrawal {fmt(p.owedMinor, p.owedCurrency || 'HTG')}</span>
                )}
                {p.varianceMinor !== null && p.state === 'variance' && (
                  <span className="text-console-amber">
                    {p.varianceMinor > 0 ? '+' : ''}
                    {fmt(p.varianceMinor, p.toCurrency)}
                  </span>
                )}
                {p.reference && <span className="label-mono text-console-faint">{p.reference}</span>}
                <span className="ml-auto">
                  <ConsoleState tone={PAYOUT_STATE[p.state].tone}>{PAYOUT_STATE[p.state].label}</ConsoleState>
                </span>
              </ConsolePanel>
            ))}
          </div>
          <p className="mt-2 text-caption text-console-faint">
            A wire with no withdrawal linked did not reduce that organizer&apos;s balance in the payout engine: link it,
            or the same money can be withdrawn again.
          </p>
        </>
      )}

      <ConsoleSection>Record a movement</ConsoleSection>
      <ConsolePanel className="p-5">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
          <label className="block text-caption text-console-mut">
            Kind
            <select
              className={selectClass}
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as FormState['kind']
                setForm((f) => ({
                  ...f,
                  kind,
                  ...(kind === 'organizer_payout' ? { fromAccount: 'bank', currency: 'USD', toCurrency: 'HTG' } : {}),
                }))
              }}
            >
              <option value="movement">Between Tikèm accounts</option>
              <option value="organizer_payout">Wire to an organizer</option>
            </select>
          </label>
          <label className="block text-caption text-console-mut">
            From
            <select
              className={selectClass}
              value={form.fromAccount}
              onChange={(e) => set('fromAccount', e.target.value as TransferAccount)}
            >
              {TRANSFER_ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </label>
          {isPayout ? (
            <label className="block text-caption text-console-mut">
              Withdrawal id (bank)
              <ConsoleInput
                className="mt-1"
                value={form.withdrawalId}
                onChange={(e) => set('withdrawalId', e.target.value)}
                placeholder="from Money → Withdrawals"
              />
            </label>
          ) : (
            <label className="block text-caption text-console-mut">
              To
              <select
                className={selectClass}
                value={form.toAccount}
                onChange={(e) => set('toAccount', e.target.value as TransferAccount)}
              >
                {TRANSFER_ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-caption text-console-mut">
            Amount sent
            <ConsoleInput className="mt-1" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </label>
          <label className="block text-caption text-console-mut">
            Currency sent
            <select className={selectClass} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-console-mut">
            {isPayout ? 'Wire fee (currency sent)' : 'Fee (currency sent)'}
            <ConsoleInput className="mt-1" inputMode="decimal" value={form.fee} onChange={(e) => set('fee', e.target.value)} />
          </label>

          <label className="block text-caption text-console-mut">
            {isPayout ? 'Organizer received (HTG equivalent)' : 'Amount received'}
            <ConsoleInput
              className="mt-1"
              inputMode="decimal"
              value={form.toAmount}
              onChange={(e) => set('toAmount', e.target.value)}
              placeholder="blank = amount × rate"
            />
          </label>
          <label className="block text-caption text-console-mut">
            Currency received
            <select className={selectClass} value={form.toCurrency} onChange={(e) => set('toCurrency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-console-mut">
            Rate (received per 1 sent)
            <ConsoleInput className="mt-1" inputMode="decimal" value={form.fxRate} onChange={(e) => set('fxRate', e.target.value)} />
          </label>

          <label className="block text-caption text-console-mut">
            Date
            <ConsoleInput type="date" className="mt-1" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className="block text-caption text-console-mut">
            Bank / transfer reference
            <ConsoleInput className="mt-1" value={form.reference} onChange={(e) => set('reference', e.target.value)} />
          </label>
          {isPayout ? (
            <label className="block text-caption text-console-mut">
              Organizer id (if no withdrawal)
              <ConsoleInput className="mt-1" value={form.organizerId} onChange={(e) => set('organizerId', e.target.value)} />
            </label>
          ) : (
            <div />
          )}

          <label className="block text-caption text-console-mut md:col-span-3">
            Note
            <ConsoleInput className="mt-1" value={form.note} onChange={(e) => set('note', e.target.value)} />
          </label>

          <div className="flex flex-wrap items-center gap-3 md:col-span-3">
            <ConsoleButton type="submit" variant="primary" disabled={saving || !form.amount || !form.date}>
              {saving ? 'Recording…' : isPayout ? 'Record wire' : 'Record movement'}
            </ConsoleButton>
            {saveError && <span className="text-meta text-console-red">{saveError}</span>}
            {saved && <span className="text-meta text-console-green">{saved}</span>}
          </div>
        </form>
        <p className="mt-3 text-caption text-console-faint">
          Entries cannot be edited: record the reverse movement to correct one.
        </p>
      </ConsolePanel>

      {map && map.transfers.length > 0 && (
        <>
          <ConsoleSection>Ledger</ConsoleSection>
          <div className="space-y-2">
            {map.transfers.map((t: FundTransfer) => (
              <ConsolePanel key={t.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-meta">
                <span className="label-mono text-console-faint">{t.date}</span>
                <span className="text-console-text">
                  {accountLabel(t.fromAccount)} → {accountLabel(t.toAccount)}
                </span>
                <span className="tabular-nums text-console-text">
                  {fmt(t.amountMinor, t.currency)}
                  {t.toCurrency !== t.currency && ` → ${fmt(t.toAmountMinor, t.toCurrency)}`}
                </span>
                {t.feeMinor > 0 && <span className="text-console-mut">fee {fmt(t.feeMinor, t.currency)}</span>}
                {t.reference && <span className="label-mono text-console-faint">{t.reference}</span>}
                {t.note && <span className="text-console-mut">{t.note}</span>}
                {t.createdByEmail && <span className="ml-auto text-caption text-console-faint">{t.createdByEmail}</span>}
              </ConsolePanel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
