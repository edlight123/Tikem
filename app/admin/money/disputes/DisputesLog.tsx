'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import {
  ConsolePanel,
  ConsoleState,
  consoleAgeClass,
  useConsoleNow,
  type ConsoleTone,
} from '@/components/admin/console'
import { formatAge } from '@/lib/admin/age'
import { EMPTY_VALUE } from '@/lib/format'

/**
 * The chargeback log.
 *
 * Read-only on purpose. Nothing on this page moves money: a dispute is answered
 * with evidence in Stripe, and what a lost dispute should cost an organizer is
 * decided by the payout pipeline. What an admin needs from this screen is (a) which
 * disputes still have a live deadline, (b) which ones nobody could match to a
 * ticket and therefore need finding by hand, and (c) whether the organizer was
 * actually reached — a chargeback we never told anyone about is a chargeback we
 * lose by default.
 */

type DisputeItem = {
  disputeId: string
  status: string
  outcome: string
  isOpen: boolean
  reason: string | null
  reasonLabel: string
  amountMinor: number
  currency: string
  chargeId: string | null
  paymentIntentId: string | null
  evidenceDueBy: string | null
  evidenceSubmitted: boolean
  evidencePastDue: boolean
  fundsWithdrawnAt: string | null
  fundsReinstatedAt: string | null
  attributed: boolean
  unattributedReason: string | null
  lookupFailed: boolean
  ticketId: string | null
  eventId: string | null
  eventTitle: string | null
  organizerId: string | null
  organizerName: string | null
  organizerEmail: string | null
  attendeeName: string | null
  organizerNotifiedAt: string | null
  notifyError: string | null
  stripeCreatedAt: string | null
  firstSeenAt: string | null
  updatedAt: string | null
  closedAt: string | null
  lostAt: string | null
}

/** Why a dispute could not be pinned to a ticket, in words. */
const UNATTRIBUTED_LABELS: Record<string, string> = {
  no_ticket_matched_charge_or_payment_intent:
    'No ticket in Firestore carries this payment reference. Look the charge up in Stripe and find the order by buyer email.',
  dispute_had_no_charge_or_payment_intent:
    'Stripe sent this dispute with neither a charge nor a PaymentIntent, so there was nothing to match on.',
  ticket_lookup_failed:
    'The ticket lookup ERRORED, this is not a confirmed non-match. Refresh; if it persists, check Firestore.',
  attribution_threw:
    'Attribution crashed while this dispute was recorded. The dispute is stored; the match needs redoing by hand.',
  matched_ticket_has_no_event_id:
    'A ticket matched the payment but carries no event id, so it points at no show.',
}

function formatMinor(amountMinor: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase()
  const major = (Number(amountMinor) || 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major)
  } catch {
    return `${major.toFixed(2)} ${code}`
  }
}

function formatMoneyMap(map: Record<string, number>): string {
  const entries = Object.entries(map || {})
  if (!entries.length) return EMPTY_VALUE
  return entries.map(([currency, minor]) => formatMinor(minor, currency)).join(' · ')
}

function shortDate(iso: string | null): string {
  if (!iso) return EMPTY_VALUE
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Which field the waiting clock runs from.
 *
 * A dispute's age is time since it was OPENED, not since we last touched the
 * record — `updatedAt` moves every time Stripe sends a webhook, so leaning on it
 * would keep resetting a dispute that has actually been sitting for a week.
 * Writers have used a few different names for the opening moment, so probe the
 * candidates in order and take the first one that is really a parseable date.
 */
const AGE_FIELDS = [
  'createdAt',
  'stripeCreatedAt',
  'firstSeenAt',
  'updatedAt',
  'created_at',
  'updated_at',
] as const

function ageSource(item: DisputeItem): string | null {
  const record = item as unknown as Record<string, unknown>
  for (const field of AGE_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string' || !value) continue
    if (Number.isNaN(new Date(value).getTime())) continue
    return value
  }
  return null
}

/** The hover title behind a compact age: the moment itself, to the minute. */
function fullTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Deadlines are the whole point of this screen, so they read in hours/days. */
function deadlineLabel(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return null
  const hours = (due.getTime() - Date.now()) / 3_600_000
  if (hours <= 0) return { text: `Deadline passed ${shortDate(iso)}`, urgent: true }
  if (hours < 48) return { text: `Evidence due in ${Math.max(1, Math.round(hours))} hours`, urgent: true }
  return { text: `Evidence due ${shortDate(iso)} (${Math.round(hours / 24)} days)`, urgent: false }
}

function outcomeTone(outcome: string): ConsoleTone {
  if (outcome === 'won' || outcome === 'inquiry_closed') return 'good'
  if (outcome === 'lost') return 'bad'
  if (outcome === 'open') return 'warn'
  return 'neutral'
}

/** Plain unboxed figure — the console never boxes a KPI. */
function Figure({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div>
      <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{label}</div>
      <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-console-mut">{sub}</div>}
    </div>
  )
}

function DisputeRow({ item, now }: { item: DisputeItem; now: Date | null }) {
  const deadline = item.isOpen ? deadlineLabel(item.evidenceDueBy) : null
  // A closed dispute's age is history, not a queue signal, so only open ones age.
  const waitingSince = item.isOpen ? ageSource(item) : null

  return (
    <div className="border-t border-console-raise px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-base font-bold tabular-nums text-console-text">
              {formatMinor(item.amountMinor, item.currency)}
            </span>
            <ConsoleState tone={outcomeTone(item.outcome)}>{item.status.replace(/_/g, ' ')}</ConsoleState>
            {!item.attributed && <ConsoleState tone="warn">Unattributed</ConsoleState>}
            {item.fundsWithdrawnAt && !item.fundsReinstatedAt && (
              <ConsoleState tone="bad">Funds debited</ConsoleState>
            )}
            {item.fundsReinstatedAt && <ConsoleState tone="good">Funds returned</ConsoleState>}
          </div>

          <p className="mt-1.5 text-sm text-console-mut">
            {item.attributed ? (
              <>
                {item.eventId ? (
                  // No admin event-detail route exists; the public page is the
                  // fastest way to see what the buyer actually bought.
                  <Link
                    href={`/events/${item.eventId}`}
                    className="font-medium text-console-text underline decoration-console-faint hover:decoration-console-text"
                  >
                    {item.eventTitle || item.eventId}
                  </Link>
                ) : (
                  <span className="font-medium text-console-text">{item.eventTitle || 'Unknown event'}</span>
                )}
                {item.organizerId && (
                  <>
                    {' · '}
                    <Link
                      href={`/admin/people/organizers/${item.organizerId}`}
                      className="underline decoration-console-faint hover:decoration-console-text"
                    >
                      {item.organizerName || item.organizerEmail || item.organizerId}
                    </Link>
                  </>
                )}
              </>
            ) : (
              <span className="text-console-amber">Not matched to any ticket</span>
            )}
          </p>

          <p className="mt-1 text-sm text-console-faint">
            Buyer’s stated reason: {item.reasonLabel}
            {item.attendeeName ? ` · Buyer on file: ${item.attendeeName}` : ''}
          </p>
        </div>

        <div className="text-right text-xs text-console-faint">
          {waitingSince && now && (
            <div className="flex items-baseline justify-end gap-1.5">
              <span
                className={`label-mono text-[13px] tabular-nums ${consoleAgeClass(waitingSince, now)}`}
                title={`Open since ${fullTimestamp(waitingSince)}`}
              >
                {formatAge(waitingSince, now)}
              </span>
              <span className="text-[11px] text-console-faint">waiting</span>
            </div>
          )}
          <div>Opened {shortDate(item.stripeCreatedAt || item.firstSeenAt)}</div>
          {item.lostAt && <div className="text-console-red">Lost {shortDate(item.lostAt)}</div>}
          {item.closedAt && !item.lostAt && <div>Closed {shortDate(item.closedAt)}</div>}
        </div>
      </div>

      {deadline && (
        <div
          className={`mt-3 rounded bg-console-ground px-3 py-2 text-sm ${
            deadline.urgent ? 'text-console-red' : 'text-console-amber'
          }`}
        >
          ⏰ {deadline.text}
          {item.evidenceSubmitted ? ' · evidence already submitted' : ' · no evidence submitted yet'}
          {item.evidencePastDue ? ' · Stripe marks it past due' : ''}
        </div>
      )}

      {!item.attributed && item.unattributedReason && (
        <div className="mt-3 rounded bg-console-ground px-3 py-2 text-sm text-console-mut">
          {UNATTRIBUTED_LABELS[item.unattributedReason] || item.unattributedReason.replace(/_/g, ' ')}
        </div>
      )}

      {item.isOpen && item.attributed && !item.organizerNotifiedAt && (
        <div className="mt-3 rounded bg-console-ground px-3 py-2 text-sm text-console-red">
          The organizer has NOT been reached about this dispute
          {item.notifyError ? ` (${item.notifyError})` : ''}. They hold the evidence, contact them
          directly.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-console-faint">
        <span>dispute {item.disputeId}</span>
        {item.paymentIntentId && <span>pi {item.paymentIntentId}</span>}
        {item.ticketId && <span>ticket {item.ticketId}</span>}
      </div>
    </div>
  )
}

export default function DisputesLog() {
  const [open, setOpen] = useState<DisputeItem[]>([])
  const [closed, setClosed] = useState<DisputeItem[]>([])
  const [counts, setCounts] = useState<Record<string, any>>({})
  const [openByCurrency, setOpenByCurrency] = useState<Record<string, number>>({})
  const [lostByCurrency, setLostByCurrency] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const now = useConsoleNow()

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      const res = await fetch('/api/admin/disputes')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Failed to load chargebacks')
        return
      }
      setError(null)
      setOpen(Array.isArray(data.open) ? data.open : [])
      setClosed(Array.isArray(data.closed) ? data.closed : [])
      setCounts(data.counts || {})
      setOpenByCurrency(data.openByCurrency || {})
      setLostByCurrency(data.lostByCurrency || {})
    } catch (err) {
      console.error('Error loading chargebacks:', err)
      setError('Failed to load chargebacks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-8">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 w-24 animate-pulse rounded bg-console-panel" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-console-panel" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded bg-console-panel px-4 py-3 text-sm text-console-red">{error}</div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-8">
          <Figure label="Open" value={counts.open ?? 0} sub={formatMoneyMap(openByCurrency)} />
          <Figure label="Lost" value={counts.lost ?? 0} sub={formatMoneyMap(lostByCurrency)} />
          <Figure label="Won" value={counts.won ?? 0} sub="Money reinstated" />
          <Figure label="Unattributed" value={counts.unattributed ?? 0} sub="Need matching by hand" />
        </div>
        <button
          onClick={() => load(false)}
          className="inline-flex items-center gap-2 rounded bg-console-raise px-3 py-1.5 text-xs font-semibold text-console-mut transition-colors hover:text-console-text focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <section>
        <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
          Still open
        </h2>
        {open.length === 0 ? (
          <ConsolePanel className="px-4 py-12 text-center">
            <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-console-faint" />
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">
              No open chargebacks
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-console-faint">
              Nothing is currently being disputed. New disputes land here the moment Stripe tells us,
              and the organizer is emailed at the same time.
            </p>
          </ConsolePanel>
        ) : (
          <ConsolePanel>
            {open.map((item) => (
              <DisputeRow key={item.disputeId} item={item} now={now} />
            ))}
          </ConsolePanel>
        )}
      </section>

      <section>
        <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
          Resolved
        </h2>
        {closed.length === 0 ? (
          <ConsolePanel className="px-4 py-12 text-center">
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">
              Nothing resolved yet
            </p>
            <p className="mt-1 text-[13px] text-console-faint">
              Closed disputes stay here as an organizer’s risk history.
            </p>
          </ConsolePanel>
        ) : (
          <ConsolePanel>
            {closed.map((item) => (
              <DisputeRow key={item.disputeId} item={item} now={now} />
            ))}
          </ConsolePanel>
        )}
      </section>

      {counts.truncated && (
        <p className="text-xs text-console-faint">
          Showing the 200 most recently updated disputes. Older ones exist in Firestore and in Stripe.
        </p>
      )}
    </div>
  )
}
