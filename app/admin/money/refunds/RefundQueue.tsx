'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, Undo2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import {
  ConsoleAge,
  ConsoleButton,
  ConsoleInput,
  ConsolePanel,
  ConsoleRow,
  ConsoleState,
  useConsoleNow,
  type ConsoleTone,
} from '@/components/admin/console'

/**
 * The manual refund queue (GET/POST /api/admin/refund-queue).
 *
 * Nothing on this page moves money. The admin pays the buyer in the MonCash
 * merchant app (or by transfer) and records it here; "Mark paid" also finishes
 * the ticket as refunded. "Mark failed" keeps an item visible when the payout
 * could not be made, so it is not mistaken for done.
 *
 * A third section lists refund_reconciliation records: card refunds Stripe
 * accepted whose result never reached the ticket. "Mark resolved" (after
 * checking the refund in Stripe) finishes the ticket as refunded if it is still
 * stuck on its claim, and closes the record.
 *
 * A fourth lists stripe_orders the card pipeline flagged: a sold-out auto-refund
 * that failed, a money step that never confirmed, or a partial Stripe refund
 * that did not map to whole tickets. Read-only plus "Mark resolved".
 *
 * The first, "Refunds awaiting review", lists refund_reviews: refunds of money
 * Tikèm holds that the organizer's remaining unwithdrawn balance could not
 * cover, so no money was sent. "Approve" is the ONE action here that moves
 * money: Tikèm funds the gap, the refund runs through the normal path (Stripe
 * refund, or a manual mobile-money item that then appears under "Owed to
 * buyers"), and the shortfall is recorded against the organizer. "Deny" puts
 * the ticket back to live.
 */

type Item = {
  kind: 'ticket' | 'order'
  id: string
  status: 'pending' | 'paid' | 'failed'
  amount: number
  currency: string
  method: string
  reason: string
  needsReview: boolean
  ticketId: string | null
  orderId: string | null
  transactionId: string | null
  eventId: string | null
  eventTitle: string | null
  buyerName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  createdAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  note: string | null
}

type ReconItem = {
  ticketId: string
  eventId: string | null
  eventTitle: string | null
  amount: number
  currency: string
  refundId: string | null
  reason: string | null
  error: string | null
  ticketStatus: string | null
  ticketRefundStatus: string | null
  createdAt: string | null
}

type StripeOrderItem = {
  paymentId: string
  status: string | null
  eventId: string | null
  eventTitle: string | null
  paymentIntentId: string | null
  needsRefund: boolean
  needsReconcile: boolean
  reconcileSteps: string[]
  refundError: string | null
  unallocatedCents: number
  updatedAt: string | null
}

type ReviewItem = {
  ticketId: string
  status: 'pending' | 'approving'
  eventId: string | null
  eventTitle: string | null
  organizerId: string | null
  organizerName: string | null
  amount: number
  currency: string
  eventCurrency: string | null
  faceMinor: number | null
  coverageMinor: number | null
  shortfallMinor: number | null
  coverageError: string | null
  rail: string | null
  method: string | null
  reason: string | null
  buyerReason: string | null
  requestedBy: string | null
  buyerName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  ticketRefundStatus: string | null
  lastError: string | null
  createdAt: string | null
}

const RECONCILE_STEP_LABELS: Record<string, string> = {
  promo: 'promo redemption',
  promoter: 'promoter commission',
  earnings: 'organizer earnings',
}

const REASON_LABELS: Record<string, string> = {
  organizer_refund: 'Refunded by the organizer',
  event_cancelled: 'Event cancelled',
  capacity_exceeded: 'Paid after the event sold out, no ticket issued',
  amount_mismatch: 'Paid amount did not match the order, no ticket issued',
  needs_refund: 'Paid order could not be honored',
}

function formatMoney(amount: number, currency: string): string {
  const code = (currency || 'HTG').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount) || 0)
  } catch {
    return `${(Number(amount) || 0).toFixed(2)} ${code}`
  }
}

function totals(items: Item[]): string {
  const map = new Map<string, number>()
  for (const i of items) map.set(i.currency, (map.get(i.currency) || 0) + (Number(i.amount) || 0))
  if (map.size === 0) return ', '
  return Array.from(map.entries())
    .map(([c, a]) => formatMoney(a, c))
    .join(' · ')
}

function shortDate(iso: string | null): string {
  if (!iso) return ', '
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ', '
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_TONE: Record<Item['status'], ConsoleTone> = { pending: 'warn', failed: 'bad', paid: 'good' }
const STATUS_LABEL: Record<Item['status'], string> = { pending: 'Owed', failed: 'Payout failed', paid: 'Paid' }

/** Plain unboxed figure, as on the other money screens. */
function Figure({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div>
      <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{label}</div>
      <div className="mt-0.5 font-mono text-xl tabular-nums text-console-text">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-console-mut">{sub}</div>}
    </div>
  )
}

function ItemBody({ item }: { item: Item }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-base font-bold tabular-nums text-console-text">
          {formatMoney(item.amount, item.currency)}
        </span>
        <span className="label-mono text-[11px] uppercase tracking-[0.14em] text-console-mut">{item.method}</span>
        <ConsoleState tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</ConsoleState>
        {item.needsReview && <ConsoleState tone="warn">Check amount in Stripe first</ConsoleState>}
      </div>
      <p className="mt-1.5 text-sm text-console-mut">
        {item.eventId ? (
          <Link
            href={`/events/${item.eventId}`}
            className="font-medium text-console-text underline decoration-console-faint hover:decoration-console-text"
          >
            {item.eventTitle || item.eventId}
          </Link>
        ) : (
          <span className="font-medium text-console-text">{item.eventTitle || 'Unknown event'}</span>
        )}
        {' · '}
        {REASON_LABELS[item.reason] || item.reason.replace(/_/g, ' ')}
      </p>
      <p className="mt-1 text-sm text-console-faint">
        Pay to: {item.buyerName || 'Unknown buyer'}
        {item.buyerPhone ? ` · ${item.buyerPhone}` : ''}
        {item.buyerEmail ? ` · ${item.buyerEmail}` : ''}
      </p>
      {item.note && <p className="mt-1 text-sm text-console-mut">Note: {item.note}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-console-faint">
        {item.ticketId && <span>ticket {item.ticketId}</span>}
        {item.orderId && <span>order {item.orderId}</span>}
        {item.transactionId && <span>tx {item.transactionId}</span>}
        <span>queued {shortDate(item.createdAt)}</span>
        {item.resolvedAt && <span>resolved {shortDate(item.resolvedAt)}</span>}
      </div>
    </div>
  )
}

export default function RefundQueue() {
  const confirmDialog = useConfirm()
  const now = useConsoleNow()
  const [open, setOpen] = useState<Item[]>([])
  const [failed, setFailed] = useState<Item[]>([])
  const [resolved, setResolved] = useState<Item[]>([])
  const [recon, setRecon] = useState<ReconItem[]>([])
  const [stripeOrders, setStripeOrders] = useState<StripeOrderItem[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      const res = await fetch('/api/admin/refund-queue')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Failed to load the refund queue' })
        return
      }
      setOpen(Array.isArray(data.open) ? data.open : [])
      setFailed(Array.isArray(data.failed) ? data.failed : [])
      setResolved(Array.isArray(data.resolved) ? data.resolved : [])
      setRecon(Array.isArray(data.reconciliation) ? data.reconciliation : [])
      setStripeOrders(Array.isArray(data.stripeOrders) ? data.stripeOrders : [])
      setReviews(Array.isArray(data.reviews) ? data.reviews : [])
    } catch (err) {
      console.error('Error loading refund queue:', err)
      setMessage({ type: 'error', text: 'Failed to load the refund queue' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const keyOf = (item: Item) => `${item.kind}:${item.id}`

  const act = async (item: Item, action: 'paid' | 'failed') => {
    const amount = formatMoney(item.amount, item.currency)
    const who = item.buyerName || item.buyerPhone || item.buyerEmail || 'the buyer'
    const ok = await confirmDialog(
      action === 'paid'
        ? {
            title: `Mark ${amount} as paid?`,
            description: `Only do this once ${who} has actually received ${amount} by ${item.method}. ${
              item.kind === 'ticket' ? 'The ticket is finished as refunded. ' : ''
            }This cannot be undone here.`,
            confirmLabel: 'Mark paid',
            variant: 'default',
          }
        : {
            title: `Mark the ${amount} payout as failed?`,
            description: `Use this when the payout to ${who} could not be made (wrong number, rejected transfer). The item stays on this page under "Payout failed" until it is paid.`,
            confirmLabel: 'Mark failed',
            variant: 'danger',
          }
    )
    if (!ok) return

    const key = keyOf(item)
    setBusyKey(key)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/refund-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, id: item.id, action, note: notes[key] || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Could not update this refund' })
        if (res.status === 409) await load(false)
        return
      }
      setMessage({
        type: 'success',
        text: action === 'paid' ? `Recorded: ${amount} paid to ${who}.` : `Recorded: the ${amount} payout failed.`,
      })
      await load(false)
    } catch (err) {
      console.error('Error updating refund:', err)
      setMessage({ type: 'error', text: 'Could not update this refund' })
    } finally {
      setBusyKey(null)
    }
  }

  const resolveRecon = async (item: ReconItem) => {
    const amount = formatMoney(item.amount, item.currency)
    const ok = await confirmDialog({
      title: `Mark the ${amount} refund reconciled?`,
      description: `Check ${item.refundId || 'the refund'} in Stripe first. If the ticket is still stuck mid-refund it is finished as refunded; either way this record closes.`,
      confirmLabel: 'Mark resolved',
      variant: 'default',
    })
    if (!ok) return
    const key = `reconciliation:${item.ticketId}`
    setBusyKey(key)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/refund-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'reconciliation', id: item.ticketId, action: 'resolved', note: notes[key] || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Could not resolve this record' })
        if (res.status === 409) await load(false)
        return
      }
      setMessage({
        type: 'success',
        text: data.appliedToTicket
          ? `Resolved: ticket ${item.ticketId} is now recorded as refunded.`
          : `Resolved: record closed, ticket ${item.ticketId} was already settled.`,
      })
      await load(false)
    } catch (err) {
      console.error('Error resolving reconciliation:', err)
      setMessage({ type: 'error', text: 'Could not resolve this record' })
    } finally {
      setBusyKey(null)
    }
  }

  const resolveStripeOrder = async (item: StripeOrderItem) => {
    const ok = await confirmDialog({
      title: 'Mark this Stripe order resolved?',
      description: item.needsRefund
        ? 'Only once the buyer has been refunded in Stripe. The order stays on its refund path, so it never issues tickets; a later Stripe retry may still re-attempt the refund.'
        : 'Only once the ledger has been checked and corrected by hand. This clears the flag.',
      confirmLabel: 'Mark resolved',
      variant: 'default',
    })
    if (!ok) return
    const key = `stripe_order:${item.paymentId}`
    setBusyKey(key)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/refund-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'stripe_order', id: item.paymentId, action: 'resolved', note: notes[key] || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Could not resolve this order' })
        if (res.status === 409) await load(false)
        return
      }
      setMessage({ type: 'success', text: `Resolved: order ${item.paymentId}.` })
      await load(false)
    } catch (err) {
      console.error('Error resolving Stripe order:', err)
      setMessage({ type: 'error', text: 'Could not resolve this order' })
    } finally {
      setBusyKey(null)
    }
  }

  const decideReview = async (item: ReviewItem, action: 'approve' | 'deny') => {
    const amount = formatMoney(item.amount, item.currency)
    const gap =
      item.shortfallMinor != null && item.eventCurrency ? formatMoney(item.shortfallMinor / 100, item.eventCurrency) : null
    const ok = await confirmDialog(
      action === 'approve'
        ? {
            title: `Approve the ${amount} refund?`,
            description: `Tikèm funds ${gap ? `the ${gap} the organizer's balance doesn't cover` : 'whatever the organizer can no longer cover'}. ${
              item.rail === 'manual'
                ? 'The ticket is voided and the payout moves to "Owed to buyers" for you to send.'
                : 'The card is refunded in Stripe right away.'
            } The shortfall is recorded against the organizer. This cannot be undone here.`,
            confirmLabel: 'Approve refund',
            variant: 'default',
          }
        : {
            title: `Deny the ${amount} refund?`,
            description:
              'No money moves. The ticket is valid again and the buyer and organizer are told it was not approved.',
            confirmLabel: 'Deny refund',
            variant: 'danger',
          }
    )
    if (!ok) return
    const key = `review:${item.ticketId}`
    setBusyKey(key)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/refund-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'review', id: item.ticketId, action, note: notes[key] || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Could not update this review' })
        if (res.status === 409 || res.status === 502) await load(false)
        return
      }
      const funded =
        action === 'approve' && Number(data.shortfallMinor) > 0 && data.eventCurrency
          ? ` Tikèm advanced ${formatMoney(Number(data.shortfallMinor) / 100, data.eventCurrency)}.`
          : ''
      setMessage({
        type: 'success',
        text:
          action === 'approve'
            ? data.outcome === 'queued'
              ? `Approved: ${amount} is now owed to the buyer below.${funded}`
              : `Approved: ${amount} refunded to the buyer's card.${funded}`
            : `Denied: the ticket is valid again.`,
      })
      await load(false)
    } catch (err) {
      console.error('Error deciding refund review:', err)
      setMessage({ type: 'error', text: 'Could not update this review' })
    } finally {
      setBusyKey(null)
    }
  }

  const actionable = (item: Item) => {
    const key = keyOf(item)
    const busy = busyKey === key
    return (
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <ConsoleInput
          value={notes[key] || ''}
          onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder="Payout reference or note (optional)"
          maxLength={500}
          className="sm:max-w-sm"
          aria-label="Payout reference or note"
        />
        <div className="flex gap-2">
          <ConsoleButton variant="primary" disabled={busy} onClick={() => act(item, 'paid')}>
            Mark paid
          </ConsoleButton>
          {item.status === 'pending' && (
            <ConsoleButton variant="danger" disabled={busy} onClick={() => act(item, 'failed')}>
              Mark failed
            </ConsoleButton>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 w-24 animate-pulse rounded bg-console-panel" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-console-panel" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`rounded bg-console-panel px-4 py-3 text-sm ${
            message.type === 'error' ? 'text-console-red' : 'text-console-green'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-8">
          <Figure label="Awaiting review" value={reviews.length} />
          <Figure label="Owed" value={open.length} sub={totals(open)} />
          <Figure label="Payout failed" value={failed.length} sub={totals(failed)} />
          <Figure label="Recently paid" value={resolved.length} />
          <Figure label="To reconcile" value={recon.length} sub={recon.length ? 'Stripe refunded, ticket not updated' : undefined} />
          <Figure label="Flagged card orders" value={stripeOrders.length} />
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
          Refunds awaiting review
        </h2>
        {reviews.length === 0 ? (
          <ConsolePanel className="px-4 py-8 text-center">
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">Nothing to decide</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-console-faint">
              A refund lands here when the organizer&apos;s remaining balance with Tikèm can&apos;t cover it. No money
              is sent until you approve it.
            </p>
          </ConsolePanel>
        ) : (
          <div className="space-y-2">
            {reviews.map((item) => {
              const key = `review:${item.ticketId}`
              const busy = busyKey === key
              const ec = item.eventCurrency || item.currency
              return (
                <ConsoleRow key={key} ageAt={item.createdAt} now={now}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-base font-bold tabular-nums text-console-text">
                        {formatMoney(item.amount, item.currency)}
                      </span>
                      <span className="label-mono text-[11px] uppercase tracking-[0.14em] text-console-mut">
                        {item.method || item.rail || 'unknown'}
                      </span>
                      {item.status === 'approving' ? (
                        <ConsoleState tone="warn">Approval in progress</ConsoleState>
                      ) : item.shortfallMinor != null ? (
                        <ConsoleState tone="bad">Short {formatMoney(item.shortfallMinor / 100, ec)}</ConsoleState>
                      ) : (
                        <ConsoleState tone="warn">Balance could not be checked</ConsoleState>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-console-mut">
                      {item.eventId ? (
                        <Link
                          href={`/events/${item.eventId}`}
                          className="font-medium text-console-text underline decoration-console-faint hover:decoration-console-text"
                        >
                          {item.eventTitle || item.eventId}
                        </Link>
                      ) : (
                        <span className="font-medium text-console-text">{item.eventTitle || 'Unknown event'}</span>
                      )}
                      {item.reason ? ` · ${REASON_LABELS[item.reason] || item.reason.replace(/_/g, ' ')}` : ''}
                      {item.organizerName ? ` · organizer ${item.organizerName}` : ''}
                    </p>
                    {item.shortfallMinor != null && (
                      <p className="mt-1 text-sm text-console-faint">
                        Face {item.faceMinor != null ? formatMoney(item.faceMinor / 100, ec) : 'unknown'} · organizer still
                        holds {item.coverageMinor != null ? formatMoney(item.coverageMinor / 100, ec) : 'unknown'} · Tikèm
                        would fund {formatMoney(item.shortfallMinor / 100, ec)}
                      </p>
                    )}
                    {item.coverageError && (
                      <p className="mt-1 text-sm text-console-faint">Balance check failed: {item.coverageError}</p>
                    )}
                    <p className="mt-1 text-sm text-console-faint">
                      Buyer: {item.buyerName || 'Unknown buyer'}
                      {item.buyerPhone ? ` · ${item.buyerPhone}` : ''}
                      {item.buyerEmail ? ` · ${item.buyerEmail}` : ''}
                    </p>
                    {item.buyerReason && <p className="mt-1 text-sm text-console-mut">Buyer said: {item.buyerReason}</p>}
                    {item.lastError && (
                      <p className="mt-1 text-sm text-console-red">Last approval failed: {item.lastError}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-console-faint">
                      <span>ticket {item.ticketId}</span>
                      {item.ticketRefundStatus && <span>ticket now {item.ticketRefundStatus}</span>}
                      <span>held {shortDate(item.createdAt)}</span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <ConsoleInput
                        value={notes[key] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="Note (optional, sent to the organizer on deny)"
                        maxLength={500}
                        className="sm:max-w-sm"
                        aria-label="Review note"
                      />
                      <div className="flex gap-2">
                        <ConsoleButton variant="primary" disabled={busy} onClick={() => decideReview(item, 'approve')}>
                          Approve
                        </ConsoleButton>
                        <ConsoleButton variant="danger" disabled={busy} onClick={() => decideReview(item, 'deny')}>
                          Deny
                        </ConsoleButton>
                      </div>
                    </div>
                  </div>
                  <ConsoleAge ageAt={item.createdAt} now={now} />
                </ConsoleRow>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Owed to buyers</h2>
        {open.length === 0 ? (
          <ConsolePanel className="px-4 py-12 text-center">
            <Undo2 className="mx-auto mb-2 h-6 w-6 text-console-faint" />
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">Nobody is waiting</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-console-faint">
              Mobile-money refunds land here the moment they are queued, and the admins are emailed.
            </p>
          </ConsolePanel>
        ) : (
          <div className="space-y-2">
            {open.map((item) => (
              <ConsoleRow key={keyOf(item)} ageAt={item.createdAt} now={now}>
                <div className="min-w-0 flex-1">
                  <ItemBody item={item} />
                  {actionable(item)}
                </div>
                <ConsoleAge ageAt={item.createdAt} now={now} />
              </ConsoleRow>
            ))}
          </div>
        )}
      </section>

      {failed.length > 0 && (
        <section>
          <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Payout failed</h2>
          <div className="space-y-2">
            {failed.map((item) => (
              <ConsoleRow key={keyOf(item)} ageAt={item.createdAt} now={now}>
                <div className="min-w-0 flex-1">
                  <ItemBody item={item} />
                  {actionable(item)}
                </div>
                <ConsoleAge ageAt={item.createdAt} now={now} />
              </ConsoleRow>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
          Card refunds to reconcile
        </h2>
        {recon.length === 0 ? (
          <ConsolePanel className="px-4 py-8 text-center">
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">Nothing to reconcile</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-console-faint">
              A card refund lands here only when Stripe accepted it but the ticket could not be updated.
            </p>
          </ConsolePanel>
        ) : (
          <div className="space-y-2">
            {recon.map((item) => {
              const key = `reconciliation:${item.ticketId}`
              return (
                <ConsoleRow key={key} ageAt={item.createdAt} now={now}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-base font-bold tabular-nums text-console-text">
                        {formatMoney(item.amount, item.currency)}
                      </span>
                      <ConsoleState tone="bad">Ticket not updated</ConsoleState>
                    </div>
                    <p className="mt-1.5 text-sm text-console-mut">
                      {item.eventId ? (
                        <Link
                          href={`/events/${item.eventId}`}
                          className="font-medium text-console-text underline decoration-console-faint hover:decoration-console-text"
                        >
                          {item.eventTitle || item.eventId}
                        </Link>
                      ) : (
                        <span className="font-medium text-console-text">{item.eventTitle || 'Unknown event'}</span>
                      )}
                      {item.reason ? ` · ${REASON_LABELS[item.reason] || item.reason.replace(/_/g, ' ')}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-console-faint">
                      Ticket now: {item.ticketStatus || 'missing'}
                      {item.ticketRefundStatus ? ` / ${item.ticketRefundStatus}` : ''}
                      {item.error ? ` · write failed: ${item.error}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-console-faint">
                      <span>ticket {item.ticketId}</span>
                      {item.refundId && <span>refund {item.refundId}</span>}
                      <span>flagged {shortDate(item.createdAt)}</span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <ConsoleInput
                        value={notes[key] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="Note (optional)"
                        maxLength={500}
                        className="sm:max-w-sm"
                        aria-label="Reconciliation note"
                      />
                      <ConsoleButton variant="primary" disabled={busyKey === key} onClick={() => resolveRecon(item)}>
                        Mark resolved
                      </ConsoleButton>
                    </div>
                  </div>
                  <ConsoleAge ageAt={item.createdAt} now={now} />
                </ConsoleRow>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
          Flagged card orders
        </h2>
        {stripeOrders.length === 0 ? (
          <ConsolePanel className="px-4 py-8 text-center">
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">No flagged orders</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-console-faint">
              Card orders land here when an automatic refund failed, a money step never confirmed, or a
              partial Stripe refund did not match whole tickets.
            </p>
          </ConsolePanel>
        ) : (
          <div className="space-y-2">
            {stripeOrders.map((item) => {
              const key = `stripe_order:${item.paymentId}`
              return (
                <ConsoleRow key={key} ageAt={item.updatedAt} now={now}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      {item.needsRefund && <ConsoleState tone="bad">Buyer charged, refund failed</ConsoleState>}
                      {item.needsReconcile && item.reconcileSteps.length > 0 && (
                        <ConsoleState tone="warn">
                          Unconfirmed: {item.reconcileSteps.map((st) => RECONCILE_STEP_LABELS[st] || st.replace(/_/g, ' ')).join(', ')}
                        </ConsoleState>
                      )}
                      {item.unallocatedCents > 0 && (
                        <ConsoleState tone="warn">
                          {(item.unallocatedCents / 100).toFixed(2)} refunded outside whole tickets
                        </ConsoleState>
                      )}
                      {item.needsReconcile && item.reconcileSteps.length === 0 && item.unallocatedCents === 0 && (
                        <ConsoleState tone="warn">Needs reconciling</ConsoleState>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-console-mut">
                      {item.eventId ? (
                        <Link
                          href={`/events/${item.eventId}`}
                          className="font-medium text-console-text underline decoration-console-faint hover:decoration-console-text"
                        >
                          {item.eventTitle || item.eventId}
                        </Link>
                      ) : (
                        <span className="font-medium text-console-text">Event not recorded on the order</span>
                      )}
                      {item.status ? ` · order ${item.status.replace(/_/g, ' ')}` : ''}
                    </p>
                    {item.refundError && (
                      <p className="mt-1 text-sm text-console-faint">Stripe said: {item.refundError}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-console-faint">
                      <span>order {item.paymentId}</span>
                      {item.paymentIntentId && item.paymentIntentId !== item.paymentId && <span>pi {item.paymentIntentId}</span>}
                      <span>updated {shortDate(item.updatedAt)}</span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <ConsoleInput
                        value={notes[key] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="What was done (optional)"
                        maxLength={500}
                        className="sm:max-w-sm"
                        aria-label="Resolution note"
                      />
                      <ConsoleButton variant="primary" disabled={busyKey === key} onClick={() => resolveStripeOrder(item)}>
                        Mark resolved
                      </ConsoleButton>
                    </div>
                  </div>
                  <ConsoleAge ageAt={item.updatedAt} now={now} />
                </ConsoleRow>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Recently paid</h2>
        {resolved.length === 0 ? (
          <ConsolePanel className="px-4 py-12 text-center">
            <p className="label-mono text-[12px] uppercase tracking-[0.14em] text-console-mut">Nothing paid yet</p>
          </ConsolePanel>
        ) : (
          <ConsolePanel>
            {resolved.map((item) => (
              <div key={keyOf(item)} className="border-t border-console-raise px-4 py-4 first:border-t-0 sm:px-5">
                <ItemBody item={item} />
              </div>
            ))}
          </ConsolePanel>
        )}
      </section>
    </div>
  )
}
