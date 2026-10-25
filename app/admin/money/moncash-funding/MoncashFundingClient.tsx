'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ConsoleButton,
  ConsoleInput,
  ConsolePanel,
  ConsoleSection,
  ConsoleState,
  consoleTone,
  type ConsoleTone,
} from '@/components/admin/console'
import {
  formatHtg,
  validateRequestAmount,
  type PlanBucket,
  type PrefundingPlan,
} from '@/lib/payouts/prefunding-plan'
import { HAITI_TZ } from '@/lib/payouts/haiti-business-time'
import {
  DIGICEL_BANK_ACCOUNTS,
  PREFUNDING_LETTER_KINDS,
  bankTransferDescription,
  isValidTransactionNumber,
  type PrefundingLetterKind,
} from '@/lib/payouts/prefunding-letter'
import type { PrefundingLetterSettings } from '@/lib/payouts/prefunding-config'
import { LetterSettingsForm } from './LetterSettingsForm'

/**
 * MonCash prefunding planner (admin). Reads GET /api/admin/moncash-funding/plan,
 * generates a Digicel request via POST …/requests (logged, never sent) as one of
 * two formal letters (merchant → prefunded, or bank transfer), downloads the
 * letter PDF from GET …/requests/:id/letter, opens the cover email in Gmail,
 * marks logged requests sent / completed / cancelled via PATCH …/requests/:id,
 * and edits the letterhead / Digicel settings via PUT …/settings.
 */

type BalanceReading = { balanceHtg: number | null; checkedAt: string; error: string | null }
type LoggedRequest = {
  id: string
  reference: string | null
  amountHtg: number
  choice: string | null
  letterType: PrefundingLetterKind
  bankName: string | null
  transactionNumber: string | null
  status: 'generated' | 'sent' | 'completed' | 'cancelled'
  createdAt: string | null
  createdByEmail: string | null
  sentAt: string | null
  completedAt: string | null
  balanceAtGenerationHtg: number | null
  balanceAtSentHtg: number | null
  balanceAtCompletionHtg: number | null
}
type PlanResponse = {
  plan: PrefundingPlan
  balance: BalanceReading
  contacts: { to: string[]; cc: string[]; from: string }
  letterSettings: PrefundingLetterSettings
  letterDefaults: PrefundingLetterSettings
  requests: LoggedRequest[]
}
type GeneratedEmail = {
  to: string[]
  cc: string[]
  from: string
  subject: string
  body: string
  attachments: string[]
  gmailUrl: string
  mailtoUrl: string
}
type GeneratedRequest = {
  id: string
  reference: string
  amountHtg: number
  letterType: PrefundingLetterKind
  bankName: string | null
  transactionNumber: string | null
  email: GeneratedEmail
  letter: { fileName: string; missing: string[]; url: string }
}

const BUCKET_LABEL: Record<PlanBucket, string> = {
  available_now: 'Withdrawable now',
  pre_event: 'Pre-event release',
  due_soon: 'Due within minimum window',
  due_week: 'Due this week',
  later: 'Later',
  held: 'Held (excluded)',
  bank_rail: 'Bank payout (excluded)',
  other_currency: 'Not HTG (excluded)',
}
const BUCKET_TONE: Record<PlanBucket, ConsoleTone> = {
  available_now: 'bad',
  pre_event: 'warn',
  due_soon: 'warn',
  due_week: 'neutral',
  later: 'neutral',
  held: 'neutral',
  bank_rail: 'neutral',
  other_currency: 'neutral',
}

function haitiDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HAITI_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

const htgMinor = (minor: number) => formatHtg(minor, 'minor')

export function MoncashFundingClient() {
  const [data, setData] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [letterType, setLetterType] = useState<PrefundingLetterKind>('merchant_transfer')
  const [bankId, setBankId] = useState<string>('')
  const [txn, setTxn] = useState('')
  const [choice, setChoice] = useState<'minimum' | 'recommended' | 'custom'>('recommended')
  const [custom, setCustom] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedRequest | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/moncash-funding/plan', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) throw new Error(json?.details || json?.error || `HTTP ${res.status}`)
      setData(json as PlanResponse)
    } catch (e: any) {
      setLoadError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const plan = data?.plan
  const blocking = plan?.warnings.find((w) => w.blocking) || null
  const minOverMax = !!plan && plan.minimum.amountHtg > plan.maximum.amountHtg

  const chosenAmount = useMemo(() => {
    if (!plan) return 0
    if (choice === 'minimum') return plan.minimum.amountHtg
    if (choice === 'recommended') return plan.recommended.amountHtg
    return Number(custom.replace(/[\s,]/g, ''))
  }, [plan, choice, custom])

  const isBank = letterType === 'bank_transfer'

  const amountError = useMemo(() => {
    if (!plan) return null
    if (choice === 'custom') {
      if (!custom.trim()) return null
      if (isBank) {
        return Number.isInteger(chosenAmount) && chosenAmount > 0 ? null : 'Enter the amount wired, in whole gourdes.'
      }
      const v = validateRequestAmount(chosenAmount, plan)
      return v.ok ? null : v.error
    }
    if (choice === 'minimum' && minOverMax && !isBank) return 'The minimum is more than can safely be moved now. Use a custom amount up to the maximum.'
    if (!(chosenAmount > 0)) return 'Nothing to request.'
    return null
  }, [plan, choice, custom, chosenAmount, minOverMax, isBank])

  const bankError = isBank ? (!bankId ? 'Choose the Digicel bank account you wired to.' : !isValidTransactionNumber(txn.trim()) ? 'Enter the transaction number from the bank receipt.' : null) : null

  const canGenerate = !!plan && !blocking && !generating && chosenAmount > 0 && !amountError && !bankError

  async function generate() {
    if (!plan || !canGenerate) return
    setGenerating(true)
    setGenerateError(null)
    setGenerated(null)
    try {
      const res = await fetch('/api/admin/moncash-funding/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choice,
          ...(choice === 'custom' ? { amountHtg: chosenAmount } : {}),
          letterType,
          ...(isBank ? { bankId, transactionNumber: txn.trim() } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setGenerated({
        id: json.request.id,
        reference: json.request.reference,
        amountHtg: json.request.amountHtg,
        letterType: json.request.letterType,
        bankName: json.request.bankName,
        transactionNumber: json.request.transactionNumber,
        email: json.email,
        letter: json.letter,
      })
      load()
    } catch (e: any) {
      setGenerateError(String(e?.message || e))
    } finally {
      setGenerating(false)
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  async function mark(id: string, status: 'sent' | 'completed' | 'cancelled') {
    setRowBusy(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/moncash-funding/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      await load()
    } catch (e: any) {
      setRowError(String(e?.message || e))
    } finally {
      setRowBusy(null)
    }
  }

  if (loading && !data) {
    return <ConsolePanel className="px-5 py-6 text-[13px] text-console-mut">Computing the plan…</ConsolePanel>
  }
  if (loadError && !data) {
    return (
      <ConsolePanel className="px-5 py-6">
        <ConsoleState tone="bad">Could not compute the plan</ConsoleState>
        <p className="mt-2 text-[13px] text-console-mut">{loadError}</p>
        <ConsoleButton className="mt-4" onClick={load}>Try again</ConsoleButton>
      </ConsolePanel>
    )
  }
  if (!data || !plan) return null

  const balance = data.balance
  const buffer = Math.round(plan.settings.recommendedBufferPercent * 100)
  const feePct = Math.round((plan.settings.poolFeeFactor - 1) * 100)

  return (
    <div>
      {/* ── Pool balance + cutoff ── */}
      <div className="grid gap-3 md:grid-cols-2">
        <ConsolePanel className="px-5 py-4">
          <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Prefunded pool (live)</div>
          {balance.balanceHtg === null ? (
            <>
              <div className="mt-2">
                <ConsoleState tone="bad">MonCash balance unavailable</ConsoleState>
              </div>
              <p className="mt-1 break-words text-[12px] text-console-mut">{balance.error}</p>
              <p className="mt-1 text-[12px] text-console-faint">
                Tried {haitiDateTime(balance.checkedAt)} (Haiti). Generating a request is disabled until it loads.
              </p>
            </>
          ) : (
            <>
              <div className="label-mono mt-1 text-[26px] font-bold tabular-nums text-console-text">
                {formatHtg(balance.balanceHtg)}
              </div>
              <p className="text-[12px] text-console-faint">Read from MonCash {haitiDateTime(balance.checkedAt)} (Haiti)</p>
            </>
          )}
          <ConsoleButton className="mt-3" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </ConsoleButton>
        </ConsolePanel>
        <ConsolePanel className="px-5 py-4">
          <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Next Digicel cutoff</div>
          <div className="label-mono mt-1 text-[26px] font-bold text-console-text">{plan.cutoff.label}</div>
          <p className="text-[12px] text-console-mut">
            {plan.cutoff.sameDay
              ? 'A request sent before then is processed today.'
              : `A request sent now is processed ${plan.cutoff.label.replace(/ \d+ (AM|PM)$/, '')}.`}{' '}
            Digicel processes requests received before {plan.settings.cutoffHourHaiti > 12 ? plan.settings.cutoffHourHaiti - 12 : plan.settings.cutoffHourHaiti} PM Haiti time the same business day.
          </p>
        </ConsolePanel>
      </div>

      {/* ── The three numbers ── */}
      <ConsoleSection>How much to move</ConsoleSection>
      {plan.nothingDue ? (
        <EmptyPanel
          title="Nothing due"
          line={`No organizer money is owed to MonCash in the next ${plan.settings.recommendedHorizonDays} days, no MonCash withdrawal is waiting to be sent, and nothing is movable. There is no request to make.`}
        />
      ) : (
      <div className="grid gap-3 md:grid-cols-3">
        <NumberPanel
          label="Minimum"
          value={plan.minimum.amountHtg}
          explain={`Covers what organizers can withdraw to MonCash by the end of the next ${plan.settings.minimumHorizonBusinessDays} Haiti business days (${haitiDateTime(plan.minimum.horizonEnd)}) plus MonCash withdrawals already requested, with Digicel's ${feePct}% transfer fee, minus what is already in the pool. Owed: ${htgMinor(plan.minimum.owedMinor)}; pool needs ${htgMinor(plan.minimum.poolNeedMinor)}.`}
        />
        <NumberPanel
          label="Recommended"
          value={plan.recommended.amountHtg}
          explain={`The same for the next ${plan.settings.recommendedHorizonDays} days, plus a ${buffer}% buffer, minus the pool. Owed: ${htgMinor(plan.recommended.owedMinor)}; pool needs ${htgMinor(plan.recommended.poolNeedMinor)}.${plan.recommended.cappedAtMaximum ? ` Capped at the maximum (was ${formatHtg(plan.recommended.uncappedAmountHtg)}).` : ''}`}
        />
        <NumberPanel
          label="Maximum safe"
          value={plan.maximum.amountHtg}
          explain={`Organizer money for events that have ended and passed their release hold, plus requested withdrawals, minus what is already in the pool (${htgMinor(plan.maximum.movableMinor)} owed, ${htgMinor(plan.maximum.poolEquivalentMinor)} with the transfer fee). Excludes Tikèm's fees, upcoming or ongoing events (kept for refunds), refunds under review and held events.`}
        />
      </div>
      )}

      {/* ── Warnings ── */}
      {plan.warnings.length > 0 && (
        <>
          <ConsoleSection>Warnings</ConsoleSection>
          <ConsolePanel className="divide-y divide-console-ground overflow-hidden">
            {plan.warnings.map((w) => (
              <div key={w.code} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="w-20 shrink-0">
                  <ConsoleState tone={w.severity === 'critical' ? 'bad' : w.severity === 'warning' ? 'warn' : 'neutral'}>
                    {w.severity === 'critical' ? 'Critical' : w.severity === 'warning' ? 'Warning' : 'Note'}
                  </ConsoleState>
                </span>
                <p className="text-[13px] leading-relaxed text-console-text">{w.message}</p>
              </div>
            ))}
          </ConsolePanel>
        </>
      )}

      {/* ── Request: shown even when nothing is due (a bank top-up is still possible) ── */}
        <>
      <ConsoleSection>Request a top-up from Digicel</ConsoleSection>
      <ConsolePanel className="px-5 py-4">
        {/* 1. Letter type */}
        <fieldset>
          <legend className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Letter</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(['merchant_transfer', 'bank_transfer'] as const).map((k) => (
              <label
                key={k}
                className={`flex cursor-pointer gap-3 rounded px-4 py-3 text-[13px] ${letterType === k ? 'bg-console-raise text-console-text' : 'bg-console-ground text-console-mut hover:text-console-text'}`}
              >
                <input
                  type="radio"
                  name="letter-type"
                  value={k}
                  checked={letterType === k}
                  onChange={() => setLetterType(k)}
                  className="mt-0.5 accent-white"
                />
                <span>
                  <span className="block font-semibold">{PREFUNDING_LETTER_KINDS[k].label}</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-console-faint">
                    {k === 'merchant_transfer'
                      ? `Digicel debits the MonCash merchant account and credits ${data.letterSettings.companyName} PREFUNDED No. ${data.letterSettings.prefundedAccountNumber}.`
                      : 'You already wired the money to a Digicel bank account; Digicel credits the prefunded account. The receipt goes with the letter.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {letterType === 'merchant_transfer' && !data.letterSettings.merchantAccountNumber && (
          <p className="mt-3 text-[12px] text-console-amber">
            The merchant account number is not set, so the letter prints a blank line where it goes. Fill it in by hand, or
            set it in Letter settings below before downloading.
          </p>
        )}

        {isBank && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block text-[12px] text-console-mut">
              Digicel account you wired to
              <select
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
                className="mt-1 w-full rounded bg-console-ground px-3 py-2 text-[13.5px] text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="">Choose a bank…</option>
                {DIGICEL_BANK_ACCOUNTS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bank} · {b.accountNumber} · {b.accountName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-console-mut">
              Transaction number (from the receipt)
              <ConsoleInput className="mt-1" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. FT26299ABC12" />
            </label>
            <div className="rounded bg-console-ground px-4 py-3 text-[12px] leading-relaxed text-console-mut md:col-span-2">
              <span className="font-semibold text-console-text">Before you send:</span> the wire&apos;s description must end with{' '}
              <span className="label-mono text-console-text">{bankTransferDescription(data.letterSettings.companyName)}</span>, and the
              bank receipt must be attached to the email with the letter. Otherwise Digicel reverses the deposit at your cost.
            </div>
          </div>
        )}

        {/* 2. Amount */}
        <fieldset className="mt-5 space-y-2">
          <legend className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
            {isBank ? 'Amount wired' : 'Amount'}
          </legend>
          {(['minimum', 'recommended', 'custom'] as const).map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-3 text-[13px] text-console-text">
              <input
                type="radio"
                name="amount-choice"
                value={c}
                checked={choice === c}
                onChange={() => setChoice(c)}
                className="accent-white"
              />
              <span className="w-28 capitalize">{c}</span>
              {c === 'custom' ? (
                <ConsoleInput
                  inputMode="numeric"
                  placeholder={
                    isBank
                      ? 'Amount on the receipt'
                      : `${Math.min(plan.minimum.amountHtg, plan.maximum.amountHtg).toLocaleString('en-US')} – ${plan.maximum.amountHtg.toLocaleString('en-US')}`
                  }
                  value={custom}
                  onFocus={() => setChoice('custom')}
                  onChange={(e) => setCustom(e.target.value)}
                  className="max-w-[220px] tabular-nums"
                  aria-label="Custom amount in HTG"
                />
              ) : (
                <span className="label-mono tabular-nums text-console-mut">
                  {formatHtg(c === 'minimum' ? plan.minimum.amountHtg : plan.recommended.amountHtg)}
                </span>
              )}
            </label>
          ))}
        </fieldset>
        {amountError && <p className="mt-2 text-[12px] text-console-amber">{amountError}</p>}
        {bankError && (bankId || txn) && <p className="mt-2 text-[12px] text-console-amber">{bankError}</p>}
        <p className="mt-3 text-[12px] text-console-faint">
          {isBank
            ? 'For a bank transfer, use the exact amount on the receipt, in whole gourdes.'
            : `Custom amounts must be a multiple of ${plan.settings.roundingStepHtg.toLocaleString('en-US')} HTG, at least the minimum and at most the maximum.`}{' '}
          Sent to {data.contacts.to.join(', ')}
          {data.contacts.cc.length ? `, cc ${data.contacts.cc.join(', ')}` : ''}, from {data.contacts.from}. Send before{' '}
          {plan.settings.cutoffHourHaiti > 12 ? plan.settings.cutoffHourHaiti - 12 : plan.settings.cutoffHourHaiti} PM Haiti time.
        </p>
        {/* Once generated, Download is the one loud action; Generate steps back. */}
        <ConsoleButton variant={generated ? 'quiet' : 'primary'} className="mt-4" onClick={generate} disabled={!canGenerate}>
          {generating ? 'Generating…' : `Generate letter${chosenAmount > 0 && !amountError ? ` for ${formatHtg(chosenAmount)}` : ''}`}
        </ConsoleButton>
        {blocking && <p className="mt-2 text-[12px] text-console-red">{blocking.message}</p>}
        {generateError && <p className="mt-2 text-[12px] text-console-red">{generateError}</p>}

        {generated && (
          <div className="mt-5 rounded bg-console-ground px-4 py-4">
            <span className="label-mono text-[12px] text-console-mut">
              {generated.reference} · {formatHtg(generated.amountHtg)} · {PREFUNDING_LETTER_KINDS[generated.letterType].short} · logged, not sent
            </span>

            <ol className="mt-3 space-y-3 text-[13px] text-console-text">
              <li className="flex flex-wrap items-center gap-3">
                <span className="label-mono w-5 text-console-faint">1</span>
                <a
                  href={generated.letter.url}
                  download={generated.letter.fileName}
                  className="rounded bg-console-text px-4 py-2 text-[13px] font-bold text-console-ground hover:opacity-90"
                >
                  Download letter (PDF)
                </a>
                <span className="text-[12px] text-console-faint">Print, sign, put the seal in its own box (never on the signature), scan.</span>
              </li>
              <li className="flex flex-wrap items-center gap-3">
                <span className="label-mono w-5 text-console-faint">2</span>
                <a
                  href={generated.email.gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-console-raise px-4 py-2 text-[13px] font-semibold text-console-text hover:opacity-90"
                >
                  Open in Gmail
                </a>
                <a href={generated.email.mailtoUrl} className="rounded bg-console-raise px-4 py-2 text-[13px] font-semibold text-console-mut hover:text-console-text">
                  Mail app
                </a>
                <span className="text-[12px] text-console-faint">Opens as {generated.email.from}; nothing is sent until you press Send.</span>
              </li>
              <li className="flex items-baseline gap-3">
                <span className="label-mono w-5 shrink-0 text-console-faint">3</span>
                <span className="min-w-0 break-words">
                  Attach {generated.email.attachments.length > 1 ? 'both' : 'the signed letter'}:{' '}
                  <span className="text-console-mut">{generated.email.attachments.join(' + ')}</span>
                </span>
              </li>
            </ol>

            {generated.letter.missing.includes('merchantAccountNumber') && (
              <p className="mt-3 text-[12px] text-console-amber">
                This letter has a blank line for the merchant account number. Write it in before signing, or set it in Letter
                settings and download again.
              </p>
            )}

            <dl className="mt-4 space-y-1 text-[12.5px]">
              <Row label="To" value={generated.email.to.join(', ')} />
              <Row label="Cc" value={generated.email.cc.join(', ') || '—'} />
              <Row label="From" value={generated.email.from} />
              <Row label="Subject" value={generated.email.subject} onCopy={() => copy('subject', generated.email.subject)} copied={copied === 'subject'} />
            </dl>
            <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded bg-console-panel px-4 py-3 font-sans text-[13px] leading-relaxed text-console-text">
              {generated.email.body}
            </pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <ConsoleButton onClick={() => copy('body', generated.email.body)}>{copied === 'body' ? 'Copied' : 'Copy body'}</ConsoleButton>
              <ConsoleButton onClick={() => mark(generated.id, 'sent')} disabled={rowBusy === generated.id}>
                I sent it: mark as sent
              </ConsoleButton>
            </div>
            <p className="mt-2 text-[12px] text-console-faint">
              Tikèm does not send this email. The letter is dated the day you download it; the request is confirmed completed
              when the pool balance rises.
            </p>
          </div>
        )}
      </ConsolePanel>
        </>

      {/* Deadlines and breakdown say nothing new when nothing is due. */}
      {!plan.nothingDue && (
        <>
      {/* ── Deadlines ── */}
      <ConsoleSection>Next payout deadlines</ConsoleSection>
      {plan.deadlines.length === 0 ? (
        <EmptyPanel title="No deadlines" line={`Nothing becomes withdrawable to MonCash in the next ${plan.settings.recommendedHorizonDays} days.`} />
      ) : (
        <ConsolePanel className="overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="label-mono border-b border-console-ground text-[10px] uppercase tracking-[0.14em] text-console-faint">
              <tr>
                <th className="px-4 py-3 font-normal">Withdrawable from</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="px-4 py-3 text-right font-normal">Pool needed (cumulative)</th>
                <th className="px-4 py-3 font-normal">Send request by</th>
                <th className="px-4 py-3 font-normal">Covered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-console-ground">
              {plan.deadlines.map((d) => (
                <tr key={d.day + d.dueAt} className="hover:bg-console-raise">
                  <td className="px-4 py-2 text-console-text">{d.sendBy ? haitiDateTime(d.dueAt) : 'Now'}</td>
                  <td className="label-mono px-4 py-2 text-right tabular-nums">{htgMinor(d.owedMinor)}</td>
                  <td className="label-mono px-4 py-2 text-right tabular-nums text-console-mut">{htgMinor(d.cumulativePoolNeedMinor)}</td>
                  <td className="px-4 py-2 text-console-mut">{d.sendBy ? haitiDateTime(d.sendBy) : 'Already due'}</td>
                  <td className="px-4 py-2">
                    <ConsoleState tone={d.covered ? 'good' : 'bad'}>{d.covered ? 'Covered' : 'Short'}</ConsoleState>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </ConsolePanel>
      )}

      {/* ── Breakdown ── */}
      <ConsoleSection>Breakdown by event</ConsoleSection>
      {plan.rows.length === 0 && plan.withdrawals.length === 0 ? (
        <EmptyPanel title="Nothing due" line="No Haiti event has organizer money waiting, and no MonCash withdrawal is waiting to be sent." />
      ) : (
        <ConsolePanel className="overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="label-mono border-b border-console-ground text-[10px] uppercase tracking-[0.14em] text-console-faint">
              <tr>
                <th className="px-4 py-3 font-normal">Event</th>
                <th className="px-4 py-3 font-normal">Organizer</th>
                <th className="px-4 py-3 font-normal">Release</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="px-4 py-3 font-normal">Bucket</th>
                <th className="px-4 py-3 font-normal">Counts in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-console-ground">
              {plan.rows.map((r) => (
                <tr key={r.eventId} className="hover:bg-console-raise">
                  <td className="px-4 py-2">
                    <Link href={`/events/${r.eventId}`} className="text-console-text hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-console-mut">{r.organizerName || r.organizerId}</td>
                  <td className="px-4 py-2 text-console-mut">{r.bucket === 'available_now' || r.bucket === 'pre_event' ? 'Now' : haitiDateTime(r.releaseAt)}</td>
                  <td className="label-mono px-4 py-2 text-right tabular-nums">{htgMinor(r.amountMinor)}</td>
                  <td className="px-4 py-2">
                    <ConsoleState tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</ConsoleState>
                    {r.bucket === 'held' && <span className="ml-2 text-[11px] text-console-faint">{r.reason}</span>}
                  </td>
                  <td className="label-mono px-4 py-2 text-[11px] text-console-mut">
                    {[r.countsIn.minimum && 'min', r.countsIn.recommended && 'rec', r.countsIn.maximum && 'max'].filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
              {plan.withdrawals.map((w) => (
                <tr key={w.id} className="hover:bg-console-raise">
                  <td className="px-4 py-2 text-console-text">
                    <Link href="/admin/money/withdrawals" className="hover:underline">
                      MonCash withdrawal {w.id.slice(0, 6)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-console-mut">
                    {w.organizerId}
                    {w.payeeType === 'promoter' ? ' (promoter)' : ''}
                  </td>
                  <td className="px-4 py-2 text-console-mut">Requested {haitiDateTime(w.createdAt)}</td>
                  <td className="label-mono px-4 py-2 text-right tabular-nums">{w.amountHtgMinor === null ? 'unknown' : htgMinor(w.amountHtgMinor)}</td>
                  <td className="px-4 py-2">
                    <ConsoleState tone="bad">{w.status === 'pending' ? 'Requested, not sent' : 'Approved, not sent'}</ConsoleState>
                  </td>
                  <td className="label-mono px-4 py-2 text-[11px] text-console-mut">min · rec · max</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </ConsolePanel>
      )}
        </>
      )}

      {/* ── Request log ── */}
      <ConsoleSection>Requests to Digicel</ConsoleSection>
      {rowError && <p className="mb-2 text-[12px] text-console-red">{rowError}</p>}
      {data.requests.length === 0 ? (
        <EmptyPanel title="No requests" line="No Digicel request has been generated yet." />
      ) : (
        <ConsolePanel className="overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="label-mono border-b border-console-ground text-[10px] uppercase tracking-[0.14em] text-console-faint">
              <tr>
                <th className="px-4 py-3 font-normal">Reference</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="px-4 py-3 font-normal">Letter</th>
                <th className="px-4 py-3 font-normal">Generated</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal" />
              </tr>
            </thead>
            <tbody className="divide-y divide-console-ground">
              {data.requests.map((r) => (
                <tr key={r.id} className="align-top hover:bg-console-raise">
                  <td className="label-mono px-4 py-2 text-[12px] text-console-text">{r.reference || r.id}</td>
                  <td className="label-mono px-4 py-2 text-right tabular-nums">{formatHtg(r.amountHtg)}</td>
                  <td className="px-4 py-2 text-console-text">
                    {PREFUNDING_LETTER_KINDS[r.letterType]?.short || PREFUNDING_LETTER_KINDS.merchant_transfer.short}
                    {r.letterType === 'bank_transfer' && (
                      <div className="label-mono text-[11px] text-console-faint">
                        {r.bankName || '—'} · txn {r.transactionNumber || '—'}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-console-mut">
                    {haitiDateTime(r.createdAt)}
                    <div className="text-[11px] text-console-faint">{r.createdByEmail || ''}</div>
                  </td>
                  <td className="px-4 py-2">
                    <ConsoleState tone={r.status === 'generated' ? 'neutral' : consoleTone(r.status === 'sent' ? 'pending' : r.status)}>
                      {r.status === 'generated' ? 'Generated' : r.status === 'sent' ? 'Sent, awaiting top-up' : r.status === 'completed' ? 'Completed' : 'Cancelled'}
                    </ConsoleState>
                    {r.status === 'completed' && r.balanceAtCompletionHtg !== null && (
                      <div className="text-[11px] text-console-faint">Pool rose to {formatHtg(r.balanceAtCompletionHtg)}</div>
                    )}
                    {r.status === 'sent' && r.sentAt && <div className="text-[11px] text-console-faint">Sent {haitiDateTime(r.sentAt)}</div>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {r.status !== 'cancelled' && (
                        <a
                          href={`/api/admin/moncash-funding/requests/${r.id}/letter`}
                          className="rounded bg-console-raise px-4 py-2 text-[13px] font-semibold text-console-mut hover:text-console-text"
                        >
                          PDF
                        </a>
                      )}
                      {r.status === 'generated' && (
                        <ConsoleButton onClick={() => mark(r.id, 'sent')} disabled={rowBusy === r.id}>
                          Mark sent
                        </ConsoleButton>
                      )}
                      {(r.status === 'generated' || r.status === 'sent') && (
                        <>
                          <ConsoleButton onClick={() => mark(r.id, 'completed')} disabled={rowBusy === r.id}>
                            Check pool &amp; complete
                          </ConsoleButton>
                          <ConsoleButton variant="danger" onClick={() => mark(r.id, 'cancelled')} disabled={rowBusy === r.id}>
                            Cancel
                          </ConsoleButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </ConsolePanel>
      )}

      {/* ── Letter settings ── */}
      <ConsoleSection>Letter settings</ConsoleSection>
      <LetterSettingsForm initial={data.letterSettings} defaults={data.letterDefaults} onSaved={load} />
    </div>
  )
}

/** The console's empty state: mono caps title over one faint line (as in Withdrawals). */
function EmptyPanel({ title, line }: { title: string; line: string }) {
  return (
    <ConsolePanel className="px-5 py-10 text-center sm:p-12">
      <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">{title}</p>
      <p className="mt-1 text-[13px] text-console-faint">{line}</p>
    </ConsolePanel>
  )
}

function NumberPanel({ label, value, explain }: { label: string; value: number; explain: string }) {
  return (
    <ConsolePanel className="px-5 py-4">
      <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{label}</div>
      <div className="label-mono mt-1 text-[26px] font-bold tabular-nums text-console-text">{formatHtg(value)}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-console-mut">{explain}</p>
    </ConsolePanel>
  )
}

function Row({ label, value, onCopy, copied }: { label: string; value: string; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="label-mono w-16 shrink-0 text-[11px] uppercase text-console-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-console-text">{value}</dd>
      {onCopy && (
        <button type="button" onClick={onCopy} className="text-[12px] text-console-mut hover:text-console-text">
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  )
}
