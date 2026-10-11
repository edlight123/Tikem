'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle, RefreshCw, ShieldQuestion, XCircle } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { ageTier, formatAge } from '@/lib/admin/age'
import {
  ConsoleButton,
  ConsolePanel,
  ConsoleState,
  consoleAgeClass,
  useConsoleNow,
} from '@/components/admin/console'

/**
 * The payout review queue.
 *
 * /api/cron/release-payouts flags an event when its rules want human eyes, and a
 * flagged row also blocks that event's automatic payout. Until this page existed
 * nothing read those rows, so a flagged organizer simply never got paid and
 * nobody was told. Everything here is written for someone deciding about a real
 * promoter's money: the machine's reason is spelled out in words, and both
 * actions say what happens to the money.
 */

type ReviewItem = {
  eventId: string
  organizerId: string
  amountMinor: number
  currency: string | null
  reason: string
  tier: string | null
  status: string
  createdAt: string | null
  updatedAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  resolvedByEmail: string | null
  note: string | null
  eventTitle: string | null
  organizerName: string | null
  organizerEmail: string | null
}

/** The machine's reason codes, in words an admin can act on. */
const REASON_LABELS: Record<string, string> = {
  mostly_manual_checkins: 'Most attendees were checked in by hand, not scanned',
  very_low_attendance: 'Hardly any of the tickets sold were ever checked in',
  large_event_from_new_organizer: 'A large payout from an organizer who is still new',
  organizer_flagged_high_risk: 'This organizer is flagged high risk, so every payout is reviewed',
  awaiting_admin_review: 'Held because this event was already sitting in this queue',
  eligible: 'Passed every automatic check',
}

/** What an admin should actually go and look at before deciding. */
const REASON_HINTS: Record<string, string> = {
  mostly_manual_checkins:
    'Hand-entered check-ins are indistinguishable from scans in the data, so they can hide tickets that were never really sold. Check the door staff and the guest list.',
  very_low_attendance:
    'Very few check-ins can mean the event did not happen, or that nobody scanned at the door. Confirm the event ran before releasing.',
  large_event_from_new_organizer:
    'First big payout for this promoter. Confirm who they are and that the event took place.',
  organizer_flagged_high_risk:
    'Someone set the high-risk flag on this organizer. Read the note on their detail page before releasing.',
}

const TIER_LABELS: Record<string, string> = {
  new: 'New organizer',
  established: 'Established organizer',
  pre_event: 'Pre-event payouts approved',
}

function describeReason(reason: string): string {
  const parts = String(reason || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return 'No reason recorded'
  return parts
    .map((part) => REASON_LABELS[part] || part.replace(/_/g, ' '))
    .join(' · ')
}

function reasonHint(reason: string): string | null {
  for (const part of String(reason || '').split('+')) {
    const hint = REASON_HINTS[part.trim()]
    if (hint) return hint
  }
  return null
}

/**
 * Amounts are stored in MINOR units of the account currency. Format with the
 * stored code rather than assuming dollars — a HTG queue row is not a USD one.
 */
function formatMinor(amountMinor: number, currency: string | null): string {
  const code = (currency || 'USD').toUpperCase()
  const major = (Number(amountMinor) || 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major)
  } catch {
    return `${major.toFixed(2)} ${code}`
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'unknown'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'unknown'
  const hours = (Date.now() - then.getTime()) / 3_600_000
  if (hours < 1) return 'less than an hour ago'
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

/**
 * Which timestamp says how long this payout has been waiting.
 *
 * Rows in this collection have been written by more than one job over the life
 * of the queue, so the field that carries the queue time is not guaranteed to be
 * `createdAt`. Take the first candidate that actually parses instead of trusting
 * a single name — an age that silently reads "—" would hide exactly the item an
 * admin most needs to see. `updatedAt` is last because a re-check moves it, so
 * it understates the wait; it is still better than showing nothing.
 */
const WAITING_SINCE_FIELDS = ['createdAt', 'submittedAt', 'created_at', 'updatedAt'] as const

function waitingSince(item: ReviewItem): string | null {
  const row = item as unknown as Record<string, unknown>
  for (const field of WAITING_SINCE_FIELDS) {
    const value = row[field]
    if (typeof value !== 'string' || !value.trim()) continue
    if (Number.isNaN(new Date(value).getTime())) continue
    return value
  }
  return null
}

/** The exact moment, for the hover title — the badge itself is deliberately terse. */
function waitingSinceTitle(iso: string | null): string {
  if (!iso) return 'No queue timestamp recorded on this item'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'No queue timestamp recorded on this item'
  return `Waiting since ${then.toLocaleString()}`
}

/** The ConsoleRow left-edge tier color, for these richer pending cards. */
function edgeClass(iso: string | null, now: Date | null): string {
  const tier = now && iso ? ageTier(iso, now) : 'none'
  if (tier === 'overdue') return 'border-console-red'
  if (tier === 'waiting') return 'border-console-amber'
  return 'border-console-faint'
}

export default function PayoutReviewQueue() {
  const confirmDialog = useConfirm()
  const now = useConsoleNow()

  const [pending, setPending] = useState<ReviewItem[]>([])
  const [resolved, setResolved] = useState<ReviewItem[]>([])
  const [pendingByCurrency, setPendingByCurrency] = useState<Record<string, number>>({})

  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      const res = await fetch('/api/admin/payouts/review')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Failed to load the review queue' })
        return
      }
      setPending(Array.isArray(data.pending) ? data.pending : [])
      setResolved(Array.isArray(data.resolved) ? data.resolved : [])
      setPendingByCurrency(data.pendingByCurrency || {})
    } catch (error) {
      console.error('Error loading payout review queue:', error)
      setMessage({ type: 'error', text: 'Failed to load the review queue' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const [refundReasons, setRefundReasons] = useState<Record<string, string>>({})

  const act = async (item: ReviewItem, action: 'release' | 'dismiss' | 'reopen' | 'refund_buyers') => {
    const amount = formatMinor(item.amountMinor, item.currency)
    const who = item.organizerName || item.organizerEmail || item.organizerId
    const note = action === 'refund_buyers' ? String(refundReasons[item.eventId] || '').trim() : ''
    if (action === 'refund_buyers' && !note) {
      setMessage({ type: 'error', text: 'Write the reason buyers will see before refunding them.' })
      return
    }

    const ok = await confirmDialog(
      action === 'reopen'
        ? {
            title: 'Reopen this review?',
            description: `“${item.eventTitle || item.eventId}” (${who}) goes back to pending so it can be decided again. Nothing is paid until someone approves it.`,
            confirmLabel: 'Reopen',
            variant: 'default',
          }
        : action === 'refund_buyers'
        ? {
            title: 'Cancel the event and refund its buyers?',
            description: `“${item.eventTitle || item.eventId}” is cancelled and every buyer is refunded from its earnings (Haiti refunds go to the refund review queue to execute). The organizer and buyers are told. This cannot be undone.`,
            confirmLabel: 'Cancel and refund buyers',
            variant: 'danger',
          }
        : action === 'release'
        ? {
            title: `Approve release of ${amount}?`,
            description: `This lifts the review hold on “${item.eventTitle || item.eventId}” for ${who}. The hourly release run pays it out on its next pass, nothing moves from this page.`,
            confirmLabel: 'Approve release',
            variant: 'default',
          }
        : {
            title: `Dismiss ${amount} without paying?`,
            description: `This closes the review for “${item.eventTitle || item.eventId}” (${who}) and pays nothing. The money stays in their Stripe balance and the event stops appearing here.`,
            confirmLabel: 'Dismiss without paying',
            variant: 'danger',
          }
    )
    if (!ok) return

    setBusyId(item.eventId)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/payouts/review/${encodeURIComponent(item.eventId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note ? { action, note } : { action }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        setMessage({
          type: 'error',
          text: [data?.error || 'Could not resolve this review item', data?.details].filter(Boolean).join(', '),
        })
        // A 409 means someone else already decided; re-read so the list is true.
        if (res.status === 409) await load(false)
        return
      }

      setMessage({
        type: 'success',
        text:
          action === 'release'
            ? `Release approved, ${amount} is queued for the next payout run.`
            : action === 'reopen'
            ? 'Reopened: the review is pending again.'
            : action === 'refund_buyers'
            ? `Event cancelled; ${data?.outcome?.refundsSucceeded ?? 0} refunded, ${data?.outcome?.refundsQueuedManual ?? 0} queued for manual payout, ${data?.outcome?.refundsSentToReview ?? 0} sent to refund review, ${data?.outcome?.refundsFailed ?? 0} failed.`
            : `Dismissed, ${amount} stays held and will not be paid.`,
      })
      await load(false)
    } catch (error) {
      console.error('Error resolving payout review item:', error)
      setMessage({ type: 'error', text: 'Could not resolve this review item' })
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg bg-console-panel p-4 sm:p-5">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-1/3 rounded bg-console-raise" />
              <div className="h-4 w-1/2 rounded bg-console-raise" />
              <div className="h-4 w-1/4 rounded bg-console-raise" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const currencyRows = Object.entries(pendingByCurrency).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-6">
      {/* Summary figures */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
        <div>
          <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">
            Waiting on a decision
          </p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{pending.length}</p>
        </div>
        <div>
          <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">
            Held from organizers
          </p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {currencyRows.length ? (
              currencyRows.map(([code, minor]) => (
                <span key={code} className="mr-3 whitespace-nowrap">
                  {formatMinor(minor, code)}
                </span>
              ))
            ) : (
              <span>, </span>
            )}
          </p>
        </div>
        <div>
          <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">
            Recently resolved
          </p>
          <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{resolved.length}</p>
        </div>
      </div>

      {/* What this queue is */}
      <ConsolePanel className="flex gap-3 p-4">
        <ShieldQuestion className="mt-0.5 h-5 w-5 flex-shrink-0 text-console-faint" />
        <p className="text-sm text-console-mut">
          The hourly release job sends an event here when something about it wants human eyes, and a queued event is{' '}
          <span className="text-console-text">not paid</span> while it sits here. Approving lifts that hold so the next
          run pays it; dismissing closes it and pays nothing. Neither button moves money by itself, the release job
          does, on its own schedule, with the balance and idempotency checks it already has. The thresholds that decide
          what lands here live in{' '}
          <Link
            href="/admin/money/release-rules"
            className="text-console-text underline decoration-console-faint hover:decoration-console-text"
          >
            release settings
          </Link>
          .
        </p>
      </ConsolePanel>

      {message && (
        <ConsolePanel
          className={`p-4 text-sm ${message.type === 'success' ? 'text-console-green' : 'text-console-red'}`}
        >
          {message.text}
        </ConsolePanel>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Pending review</h2>
        <ConsoleButton
          type="button"
          onClick={() => load(false)}
          className="inline-flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </ConsoleButton>
      </div>

      {pending.length === 0 ? (
        <ConsolePanel className="p-8 text-center">
          <CheckCircle className="mx-auto h-8 w-8 text-console-faint" />
          <p className="mt-3 text-sm font-medium text-console-text">Nothing is waiting on a decision</p>
          <p className="mt-1 text-xs text-console-mut">
            Every flagged payout has been actioned. New ones appear here within an hour of the release job flagging
            them.
          </p>
        </ConsolePanel>
      ) : (
        <div className="space-y-3">
          {pending.map((item) => {
            const hint = reasonHint(item.reason)
            const busy = busyId === item.eventId
            const since = waitingSince(item)

            return (
              <div
                key={item.eventId}
                className={`rounded-r-lg border-l-2 bg-console-panel p-4 sm:p-5 ${edgeClass(since, now)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/events/${item.eventId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-base font-semibold text-console-text hover:underline"
                    >
                      {item.eventTitle || 'Untitled event'}
                    </Link>
                    <p className="mt-1 text-xs text-console-mut">
                      {item.organizerId ? (
                        <Link
                          href={`/admin/people/organizers/${item.organizerId}`}
                          className="text-console-text underline decoration-console-faint hover:decoration-console-text"
                        >
                          {item.organizerName || item.organizerEmail || item.organizerId}
                        </Link>
                      ) : (
                        <span>Unknown organizer</span>
                      )}
                      {item.organizerName && item.organizerEmail ? (
                        <span className="text-console-faint"> · {item.organizerEmail}</span>
                      ) : null}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-console-faint">{item.eventId}</p>
                  </div>

                  <div className="text-right">
                    {/* How long this organizer has been unpaid — the reason this queue is urgent. */}
                    <p
                      className={`label-mono text-[13px] tabular-nums ${
                        now ? consoleAgeClass(since, now) : 'text-console-faint'
                      }`}
                      title={waitingSinceTitle(since)}
                    >
                      {now ? (since ? `${formatAge(since, now)} waiting` : 'age unknown') : '·'}
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">
                      {formatMinor(item.amountMinor, item.currency)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-console-faint">held from this organizer</p>
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-console-ground p-3">
                  <p className="text-sm text-console-text">
                    <span className="text-console-amber">●</span> {describeReason(item.reason)}
                  </p>
                  {hint && <p className="mt-1 text-xs text-console-mut">{hint}</p>}
                  <p className="mt-2 font-mono text-[11px] text-console-faint">{item.reason}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-console-faint">
                  <span>Queued {timeAgo(item.createdAt)}</span>
                  {item.tier && <span>{TIER_LABELS[item.tier] || item.tier}</span>}
                  {item.updatedAt && item.updatedAt !== item.createdAt && (
                    <span>Re-checked {timeAgo(item.updatedAt)}</span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-console-ground pt-4">
                  <ConsoleButton
                    type="button"
                    variant="danger"
                    onClick={() => act(item, 'dismiss')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Dismiss, do not pay
                  </ConsoleButton>
                  <ConsoleButton
                    type="button"
                    variant="primary"
                    onClick={() => act(item, 'release')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {busy ? 'Working…' : 'Approve release'}
                  </ConsoleButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recently resolved */}
      <section>
        <div className="mb-2">
          <h2 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Recently resolved</h2>
          <p className="mt-1 text-xs text-console-mut">
            The last decisions made here, so you can see what a colleague already actioned. Every one is also in the
            admin audit log.
          </p>
        </div>

        {resolved.length === 0 ? (
          <ConsolePanel className="p-4">
            <p className="text-xs text-console-faint">Nothing has been resolved yet.</p>
          </ConsolePanel>
        ) : (
          <ConsolePanel className="px-4 sm:px-5">
            <ul className="divide-y divide-console-ground">
              {resolved.map((item) => (
                <li key={item.eventId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-console-text">{item.eventTitle || item.eventId}</p>
                    <p className="text-[11px] text-console-faint">
                      {item.organizerName || item.organizerEmail || item.organizerId} · {describeReason(item.reason)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold tabular-nums text-console-text">
                      {formatMinor(item.amountMinor, item.currency)}
                    </p>
                    <p className="text-[11px] text-console-faint">
                      <ConsoleState tone={item.status === 'released' ? 'good' : 'neutral'}>
                        {item.status === 'released' ? 'Released' : 'Dismissed'}
                      </ConsoleState>{' '}
                      {timeAgo(item.resolvedAt || item.updatedAt)}
                      {item.resolvedByEmail ? ` by ${item.resolvedByEmail}` : ''}
                    </p>
                  </div>
                  {item.status === 'dismissed' && (
                    <div className="flex w-full flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={refundReasons[item.eventId] || ''}
                        onChange={(e) => setRefundReasons((r) => ({ ...r, [item.eventId]: e.target.value }))}
                        placeholder="Reason buyers will see (needed to refund)"
                        className="min-w-0 flex-1 rounded-md bg-console-raise px-3 py-2 text-base text-console-text placeholder:text-console-faint sm:text-sm"
                        maxLength={500}
                      />
                      <div className="flex gap-2">
                        <ConsoleButton
                          variant="quiet"
                          onClick={() => act(item, 'reopen')}
                          disabled={busyId === item.eventId}
                        >
                          Reopen
                        </ConsoleButton>
                        <ConsoleButton
                          variant="danger"
                          onClick={() => act(item, 'refund_buyers')}
                          disabled={busyId === item.eventId}
                        >
                          Refund buyers
                        </ConsoleButton>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </ConsolePanel>
        )}
      </section>

      <p className="flex items-start gap-1.5 text-xs text-console-faint">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        Approving does not itself send money: it clears the block, and the release job pays the event on its next run
        once its own rules allow. If an event keeps re-appearing here, the condition that flagged it is still true, 
        change the organizer&rsquo;s settings or the platform thresholds rather than re-approving.
      </p>
    </div>
  )
}
