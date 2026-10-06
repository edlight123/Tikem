import { adminDb } from '@/lib/firebase/admin'
import { getAdminEmails } from '@/lib/admin'
import { sendEmail } from '@/lib/email'
import { refundFaceAmount } from '@/lib/tickets/refundPlan'

/**
 * Refunds a HUMAN has to pay out, and the admin screen that works them
 * (app/admin/money/refunds).
 *
 * Two sources, both of which used to be written and never read:
 *
 *  1. `manual_refund_queue/ticket_{ticketId}` — written by
 *     lib/tickets/refundExecution.ts when a mobile-money ticket (MonCash,
 *     NatCash, SogePay) is refunded: those rails have no refund API, so the
 *     ticket is voided and the payout is queued. Also card sales a cancellation
 *     could not refund automatically (`needsReview`).
 *  2. `pending_transactions` with `needs_refund: true` — a MonCash/SogePay order
 *     that was PAID but could not be honored (sold out after payment, amount
 *     mismatch). No ticket exists; the buyer is simply owed their money.
 *
 * An admin pays the buyer by hand, then marks the item paid (or failed, when the
 * payout could not be made — e.g. a wrong wallet number — so it stays visible).
 */

export const MANUAL_REFUND_QUEUE = 'manual_refund_queue'

export type RefundQueueKind = 'ticket' | 'order'
export type RefundQueueStatus = 'pending' | 'paid' | 'failed'

export type RefundQueueItem = {
  kind: RefundQueueKind
  /** Doc id in manual_refund_queue (ticket) or pending_transactions (order). */
  id: string
  status: RefundQueueStatus
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
  /**
   * The number to PAY: the wallet that paid (payer_phone / order payer). Only
   * when no payer was recorded does it fall back to the buyer's profile phone,
   * which the buyer can edit (payerPhoneUnknown says so).
   */
  buyerPhone: string | null
  /** The buyer's profile/guest phone, when it differs from the paying wallet. */
  profilePhone: string | null
  /** Paying wallet and profile phone are different numbers: check before paying. */
  payerPhoneMismatch: boolean
  /** No paying wallet recorded; buyerPhone is the editable profile phone. */
  payerPhoneUnknown: boolean
  createdAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  note: string | null
}

const phoneDigits = (v: string | null) => String(v || '').replace(/\D/g, '').replace(/^509(?=\d{8}$)/, '')

/**
 * Pay the wallet the money came from, never the profile phone: a profile phone
 * is editable by the buyer (or anyone holding their session), so paying it
 * would let a refund be redirected. A difference between the two is surfaced.
 */
function refundPhones(payer: string | null, profile: string | null) {
  if (payer) {
    const mismatch = Boolean(profile) && phoneDigits(profile) !== phoneDigits(payer)
    return { buyerPhone: payer, profilePhone: mismatch ? profile : null, payerPhoneMismatch: mismatch, payerPhoneUnknown: false }
  }
  return { buyerPhone: profile, profilePhone: null, payerPhoneMismatch: false, payerPhoneUnknown: Boolean(profile) }
}

const RESOLVED_LIMIT = 50

function toIso(value: any): string | null {
  if (!value) return null
  try {
    if (typeof value?.toDate === 'function') return value.toDate().toISOString()
    if (typeof value === 'object' && typeof value._seconds === 'number') return new Date(value._seconds * 1000).toISOString()
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  } catch {
    return null
  }
}

function str(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return s || null
}

function normalizeStatus(raw: unknown): RefundQueueStatus {
  const s = String(raw ?? '').toLowerCase().trim()
  return s === 'paid' || s === 'failed' ? s : 'pending'
}

// ── Notify ──────────────────────────────────────────────────────────────────

export type QueuedRefundNotice = {
  ticketId: string
  eventTitle: string | null
  amount: number
  currency: string
  method: string
  reason: string
  needsReview?: boolean
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

function money(amount: number, currency: string) {
  return `${(Number(amount) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

/**
 * Email every ADMIN_EMAILS address that refunds were queued for a manual payout.
 * Best-effort and never throws: the queue doc is the record, the email is the nudge.
 * One email per call, so a cancellation that queues 300 tickets sends one summary.
 */
export async function notifyAdminsOfQueuedRefunds(items: QueuedRefundNotice[]): Promise<boolean> {
  if (!items.length) return false
  try {
    const recipients = getAdminEmails()
    if (recipients.length === 0) {
      console.warn('[manual-refunds] ADMIN_EMAILS is not configured — no admin was emailed', {
        queued: items.length,
      })
      return false
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
    const totals = new Map<string, number>()
    for (const i of items) totals.set(i.currency, (totals.get(i.currency) || 0) + (Number(i.amount) || 0))
    const totalText = Array.from(totals.entries())
      .map(([c, a]) => money(a, c))
      .join(' + ')
    const events = Array.from(new Set(items.map((i) => i.eventTitle || 'an event')))
    const subject =
      items.length === 1
        ? `[Tikèm] Manual refund queued: ${money(items[0].amount, items[0].currency)} (${items[0].method})`
        : `[Tikèm] ${items.length} manual refunds queued: ${totalText}`
    const rows = items
      .slice(0, 50)
      .map(
        (i) =>
          `<tr><td style="padding:4px 8px">${escapeHtml(money(i.amount, i.currency))}</td><td style="padding:4px 8px">${escapeHtml(
            i.method
          )}</td><td style="padding:4px 8px">${escapeHtml(i.eventTitle || '')}</td><td style="padding:4px 8px;font-family:monospace">${escapeHtml(
            i.ticketId
          )}</td><td style="padding:4px 8px">${i.needsReview ? 'check amount in Stripe first' : ''}</td></tr>`
      )
      .join('')
    const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px">
<p>${items.length === 1 ? 'A refund was' : `${items.length} refunds were`} queued for a manual payout (${escapeHtml(
      events.join(', ')
    )}). Mobile-money rails have no refund API, so the buyer is waiting on a person.</p>
<table style="border-collapse:collapse;font-size:13px">${rows}</table>
${items.length > 50 ? `<p>…and ${items.length - 50} more.</p>` : ''}
<p><a href="${appUrl}/admin/money/refunds">Open the refund queue</a></p>
</body></html>`

    const results = await Promise.all(
      recipients.map((to) =>
        sendEmail({ to, subject, html }).catch((err: any) => {
          console.error('[manual-refunds] admin email failed', { to, message: err?.message })
          return { success: false } as { success: boolean }
        })
      )
    )
    return results.some((r: any) => r?.success)
  } catch (err: any) {
    console.error('[manual-refunds] admin notification failed', { message: err?.message })
    return false
  }
}

// ── Refunds awaiting admin review ───────────────────────────────────────────

/**
 * `refund_reviews/{ticketId}`: a refund the organizer's remaining balance could
 * not cover (lib/tickets/refundCoverage.ts). Written by refundExecution in the
 * same transaction that puts the ticket on `refund_status: 'admin_review'`;
 * worked by lib/tickets/refundReview.ts from /admin/money/refunds.
 */
export const REFUND_REVIEWS = 'refund_reviews'

export type RefundReviewNotice = {
  ticketId: string
  eventTitle: string | null
  /** What the buyer gets back, charged currency. */
  amount: number
  currency: string
  method: string
  reason: string
  /** The gate's figures, EVENT currency minor units (null when it could not compute). */
  eventCurrency: string | null
  shortfallMinor: number | null
  coverageMinor: number | null
}

/**
 * Email every ADMIN_EMAILS address that a refund is waiting for a decision.
 * Best-effort and never throws, like notifyAdminsOfQueuedRefunds: the
 * refund_reviews doc is the record.
 */
export async function notifyAdminsOfRefundReview(item: RefundReviewNotice): Promise<boolean> {
  try {
    const recipients = getAdminEmails()
    if (recipients.length === 0) {
      console.warn('[refund-review] ADMIN_EMAILS is not configured, no admin was emailed', { ticketId: item.ticketId })
      return false
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
    const shortfall =
      item.shortfallMinor != null && item.eventCurrency
        ? money(item.shortfallMinor / 100, item.eventCurrency)
        : null
    const subject = `[Tikèm] Refund needs review: ${money(item.amount, item.currency)}${shortfall ? ` (short ${shortfall})` : ''}`
    const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px">
<p>A ${escapeHtml(money(item.amount, item.currency))} ${escapeHtml(item.method)} refund for ${escapeHtml(
      item.eventTitle || 'an event'
    )} was NOT sent. ${
      shortfall
        ? `The organizer's remaining unwithdrawn balance covers ${escapeHtml(
            money((item.coverageMinor || 0) / 100, item.eventCurrency || '')
          )}; Tikèm would fund ${escapeHtml(shortfall)}.`
        : "The organizer's balance could not be computed, so it was held for a person to check."
    }</p>
<p>Approve it (Tikèm funds the gap) or deny it. Until then the ticket is held: it cannot be used and its money cannot be withdrawn.</p>
<p style="font-family:monospace;font-size:12px">ticket ${escapeHtml(item.ticketId)} · ${escapeHtml(item.reason)}</p>
<p><a href="${appUrl}/admin/money/refunds">Open the refund queue</a></p>
</body></html>`
    const results = await Promise.all(
      recipients.map((to) =>
        sendEmail({ to, subject, html }).catch((err: any) => {
          console.error('[refund-review] admin email failed', { to, message: err?.message })
          return { success: false } as { success: boolean }
        })
      )
    )
    return results.some((r: any) => r?.success)
  } catch (err: any) {
    console.error('[refund-review] admin notification failed', { message: err?.message })
    return false
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function loadEventTitles(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection('events').doc(id))
    if (!refs.length) continue
    const docs = await adminDb.getAll(...refs)
    for (const d of docs as any[]) if (d.exists) out.set(d.id, String(d.data()?.title || ''))
  }
  return out
}

export async function loadUsers(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>()
  const unique = Array.from(new Set(ids.filter((id) => id && !id.startsWith('guest_'))))
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection('users').doc(id))
    if (!refs.length) continue
    const docs = await adminDb.getAll(...refs)
    for (const d of docs as any[]) if (d.exists) out.set(d.id, d.data() || {})
  }
  return out
}

export async function loadTickets(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection('tickets').doc(id))
    if (!refs.length) continue
    const docs = await adminDb.getAll(...refs)
    for (const d of docs as any[]) if (d.exists) out.set(d.id, d.data() || {})
  }
  return out
}

/** Every open item, plus the most recent resolved ones for history. */
export async function listRefundQueue(): Promise<{
  open: RefundQueueItem[]
  failed: RefundQueueItem[]
  resolved: RefundQueueItem[]
}> {
  const [queueOpen, queueFailed, queuePaid, orders] = await Promise.all([
    adminDb.collection(MANUAL_REFUND_QUEUE).where('status', '==', 'pending').get(),
    adminDb.collection(MANUAL_REFUND_QUEUE).where('status', '==', 'failed').get(),
    adminDb.collection(MANUAL_REFUND_QUEUE).where('status', '==', 'paid').limit(RESOLVED_LIMIT).get(),
    adminDb.collection('pending_transactions').where('needs_refund', '==', true).get(),
  ])

  const queueDocs = [...queueOpen.docs, ...queueFailed.docs, ...queuePaid.docs]
  const ticketIds = queueDocs.map((d: any) => String(d.data()?.ticketId || ''))
  const tickets = await loadTickets(ticketIds)
  const userIds = [
    ...queueDocs.map((d: any) => String(d.data()?.userId || '')),
    ...orders.docs.map((d: any) => String(d.data()?.user_id || '')),
  ]
  const eventIds = [
    ...queueDocs.map((d: any) => String(d.data()?.eventId || '')),
    ...orders.docs.map((d: any) => String(d.data()?.event_id || '')),
  ]
  const [users, titles] = await Promise.all([loadUsers(userIds), loadEventTitles(eventIds)])

  const items: RefundQueueItem[] = []

  for (const d of queueDocs as any[]) {
    const q = d.data() || {}
    const t = tickets.get(String(q.ticketId || '')) || {}
    const u = users.get(String(q.userId || '')) || {}
    items.push({
      kind: 'ticket',
      id: d.id,
      status: normalizeStatus(q.status),
      amount: Number(q.amount) || 0,
      currency: String(q.currency || 'HTG').toUpperCase(),
      method: String(q.method || t.payment_method || 'moncash').toLowerCase(),
      reason: String(q.reason || ''),
      needsReview: Boolean(q.needsReview),
      ticketId: str(q.ticketId),
      orderId: str(t.order_id),
      transactionId: str(q.transactionId),
      eventId: str(q.eventId),
      eventTitle: str(q.eventTitle) || titles.get(String(q.eventId || '')) || null,
      buyerName: str(t.attendee_name) || str(u.full_name) || str(t.guest_name),
      buyerEmail: str(u.email) || str(t.guest_email) || str(t.recipient_email),
      ...refundPhones(str(t.payer_phone), str(u.phone_number) || str(u.phone) || str(t.guest_phone)),
      createdAt: toIso(q.createdAt),
      resolvedAt: toIso(q.resolvedAt),
      resolvedBy: str(q.resolvedBy),
      note: str(q.resolutionNote),
    })
  }

  for (const d of orders.docs as any[]) {
    const o = d.data() || {}
    const u = users.get(String(o.user_id || '')) || {}
    items.push({
      kind: 'order',
      id: d.id,
      status: normalizeStatus(o.refund_queue_status),
      amount: Number(o.amount) || 0,
      currency: String(o.currency || 'HTG').toUpperCase(),
      method: String(o.payment_method || o.mobile_money_provider || 'moncash').toLowerCase(),
      reason: String(o.failure_reason || 'needs_refund'),
      needsReview: false,
      ticketId: null,
      orderId: str(o.order_id),
      transactionId: str(o.transaction_id),
      eventId: str(o.event_id),
      eventTitle: titles.get(String(o.event_id || '')) || null,
      buyerName: str(u.full_name) || str(o.guest_name),
      buyerEmail: str(u.email) || str(o.guest_email),
      ...refundPhones(
        str(o.payer_phone) || (typeof o.payer === 'string' ? str(o.payer) : null),
        str(u.phone_number) || str(u.phone) || str(o.guest_phone)
      ),
      createdAt: toIso(o.created_at) || toIso(o.createdAt) || toIso(o.updated_at),
      resolvedAt: toIso(o.refund_resolved_at),
      resolvedBy: str(o.refund_resolved_by),
      note: str(o.refund_resolution_note),
    })
  }

  const oldestFirst = (a: RefundQueueItem, b: RefundQueueItem) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  const newestResolvedFirst = (a: RefundQueueItem, b: RefundQueueItem) =>
    String(b.resolvedAt || '').localeCompare(String(a.resolvedAt || ''))

  return {
    open: items.filter((i) => i.status === 'pending').sort(oldestFirst),
    failed: items.filter((i) => i.status === 'failed').sort(oldestFirst),
    resolved: items
      .filter((i) => i.status === 'paid')
      .sort(newestResolvedFirst)
      .slice(0, RESOLVED_LIMIT),
  }
}

// ── Resolve ─────────────────────────────────────────────────────────────────

export class RefundQueueError extends Error {
  /** Machine-readable reason for the client (e.g. 'checked_in'), when there is one. */
  constructor(message: string, public status: number, public code?: string) {
    super(message)
  }
}

/**
 * Mark one item paid or failed. Transactional: the item is re-read, so two
 * admins cannot both act on it, and a paid item can never be reopened.
 *
 *   pending → paid | failed
 *   failed  → paid            (the retry by hand worked)
 *
 * Marking a TICKET item paid also finishes the ticket: status 'refunded',
 * refund_status 'approved' — the same end state as a card refund — so the
 * ticket stops reading as "refund pending" everywhere.
 */
export async function resolveRefundQueueItem(input: {
  kind: RefundQueueKind
  id: string
  action: 'paid' | 'failed'
  actorId: string
  note?: string | null
}): Promise<{ status: RefundQueueStatus }> {
  const { kind, id, action, actorId } = input
  const note = String(input.note ?? '').trim().slice(0, 500) || null
  if (!id || id.includes('/')) throw new RefundQueueError('Invalid item id', 400)
  if (action !== 'paid' && action !== 'failed') throw new RefundQueueError('Invalid action', 400)
  const nowIso = new Date().toISOString()

  const ref =
    kind === 'ticket'
      ? adminDb.collection(MANUAL_REFUND_QUEUE).doc(id)
      : kind === 'order'
        ? adminDb.collection('pending_transactions').doc(id)
        : null
  if (!ref) throw new RefundQueueError('Invalid item kind', 400)

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new RefundQueueError('Item not found', 404)
    const data = (snap.data() as any) || {}

    if (kind === 'order' && data.needs_refund !== true) {
      throw new RefundQueueError('This order is not owed a refund', 409)
    }
    const current = normalizeStatus(kind === 'ticket' ? data.status : data.refund_queue_status)
    if (current === 'paid') throw new RefundQueueError('Already marked paid', 409)
    if (current === 'failed' && action === 'failed') throw new RefundQueueError('Already marked failed', 409)

    let ticketRef: any = null
    let ticketData: Record<string, any> = {}
    if (kind === 'ticket' && action === 'paid' && data.ticketId) {
      ticketRef = adminDb.collection('tickets').doc(String(data.ticketId))
      // Read before any write: Firestore transactions require all reads first.
      const ticketSnap = await tx.get(ticketRef)
      ticketData = ticketSnap?.exists ? ticketSnap.data() || {} : {}
    }

    if (kind === 'ticket') {
      tx.set(
        ref,
        { status: action, resolvedAt: nowIso, resolvedBy: actorId, resolutionNote: note, updatedAt: nowIso },
        { merge: true }
      )
      if (ticketRef) {
        tx.set(
          ticketRef,
          {
            status: 'refunded',
            refund_status: 'approved',
            refund_processed_at: nowIso,
            refund_paid_manually_by: actorId,
            refund_manual_reference: note,
            // Queued refunds stamped it already; a ticket queued before that gets
            // it here, at face value in the event currency (payouts subtract it).
            ...(ticketData.refund_face_amount == null ? { refund_face_amount: refundFaceAmount(ticketData) } : {}),
            updated_at: nowIso,
          },
          { merge: true }
        )
      }
    } else {
      tx.set(
        ref,
        {
          refund_queue_status: action,
          refund_resolved_at: nowIso,
          refund_resolved_by: actorId,
          refund_resolution_note: note,
        },
        { merge: true }
      )
    }
    return { status: action }
  })
}

// ── Reconciliation ──────────────────────────────────────────────────────────

export const REFUND_RECONCILIATION = 'refund_reconciliation'

/**
 * A card refund Stripe ACCEPTED whose result could not be written to the ticket
 * (lib/tickets/refundExecution.ts recordSettledRefund). The ticket is stuck on
 * its `processing` claim — refused at the door, never re-refunded — until an
 * admin confirms the refund in Stripe and resolves it here.
 */
export type ReconciliationItem = {
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

export async function listReconciliation(): Promise<ReconciliationItem[]> {
  const snap = await adminDb.collection(REFUND_RECONCILIATION).where('resolved', '==', false).get()
  const docs = snap.docs as any[]
  const [tickets, titles] = await Promise.all([
    loadTickets(docs.map((d) => String(d.data()?.ticketId || d.id))),
    loadEventTitles(docs.map((d) => String(d.data()?.eventId || ''))),
  ])
  return docs
    .map((d) => {
      const r = d.data() || {}
      const ticketId = String(r.ticketId || d.id)
      const t = tickets.get(ticketId) || null
      return {
        ticketId,
        eventId: str(r.eventId),
        eventTitle: titles.get(String(r.eventId || '')) || null,
        amount: Number(r.amount) || 0,
        currency: String(r.currency || 'USD').toUpperCase(),
        refundId: str(r.refundId),
        reason: str(r.reason),
        error: str(r.error),
        ticketStatus: t ? str(t.status) : null,
        ticketRefundStatus: t ? str(t.refund_status) : null,
        createdAt: toIso(r.createdAt),
      }
    })
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

/**
 * Close a reconciliation record. If the ticket is still on its `processing`
 * claim, the write the refund could not make is applied now (the `intended`
 * fields: status 'refunded', refund_status 'approved', refund id…), so the
 * ticket ends exactly where a clean refund would have left it. A ticket that
 * has already moved on is left alone; only the flag is cleared.
 */
export async function resolveReconciliation(input: {
  ticketId: string
  actorId: string
  note?: string | null
}): Promise<{ appliedToTicket: boolean }> {
  const ticketId = String(input.ticketId || '').trim()
  const note = String(input.note ?? '').trim().slice(0, 500) || null
  if (!ticketId || ticketId.includes('/')) throw new RefundQueueError('Invalid ticket id', 400)
  const recRef = adminDb.collection(REFUND_RECONCILIATION).doc(ticketId)
  const ticketRef = adminDb.collection('tickets').doc(ticketId)
  const nowIso = new Date().toISOString()

  return adminDb.runTransaction(async (tx: any) => {
    const [recSnap, ticketSnap] = [await tx.get(recRef), await tx.get(ticketRef)]
    if (!recSnap.exists) throw new RefundQueueError('Record not found', 404)
    const rec = (recSnap.data() as any) || {}
    if (rec.resolved === true) throw new RefundQueueError('Already resolved', 409)

    const ticket = ticketSnap.exists ? ((ticketSnap.data() as any) ?? {}) : null
    const stillClaimed = Boolean(ticket) && String(ticket.refund_status || '').toLowerCase() === 'processing'
    const intended = rec.intended && typeof rec.intended === 'object' ? rec.intended : null

    if (ticket) {
      tx.set(
        ticketRef,
        {
          ...(stillClaimed && intended ? intended : {}),
          refund_needs_reconciliation: false,
          refund_reconciled_at: nowIso,
          refund_reconciled_by: input.actorId,
          updated_at: nowIso,
        },
        { merge: true }
      )
    }
    tx.set(
      recRef,
      { resolved: true, resolvedAt: nowIso, resolvedBy: input.actorId, resolutionNote: note },
      { merge: true }
    )
    return { appliedToTicket: Boolean(ticket && stillClaimed && intended) }
  })
}

// ── Stripe order ledger flags ───────────────────────────────────────────────

export const STRIPE_ORDERS = 'stripe_orders'

/**
 * A `stripe_orders/{paymentId}` ledger doc (lib/tickets/stripe-fulfillment.ts)
 * that needs a person:
 *  - needs_refund      sold out after payment and the automatic refund FAILED;
 *                      the buyer was charged and holds no ticket
 *  - needs_reconcile   a money step (promo / promoter / earnings) started but
 *                      never confirmed (`reconcile_<step>` says which), or a
 *                      partial Stripe refund did not map to whole tickets
 *  - refund_unallocated_cents > 0   those refunded cents, for the latter
 */
export type StripeOrderFlagItem = {
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

function isOpenStripeFlag(o: Record<string, any>): boolean {
  const unallocated = Number(o.refund_unallocated_cents) || 0
  const settled = Number(o.refund_unallocated_resolved_cents) || 0
  return o.needs_refund === true || o.needs_reconcile === true || unallocated > settled
}

export async function listStripeOrderFlags(): Promise<StripeOrderFlagItem[]> {
  const col = adminDb.collection(STRIPE_ORDERS)
  const [a, b, c] = await Promise.all([
    col.where('needs_refund', '==', true).get(),
    col.where('needs_reconcile', '==', true).get(),
    col.where('refund_unallocated_cents', '>', 0).get(),
  ])
  const byId = new Map<string, any>()
  for (const snap of [a, b, c]) for (const d of snap.docs as any[]) byId.set(d.id, d)
  const docs = Array.from(byId.values()).filter((d) => isOpenStripeFlag(d.data() || {}))
  const titles = await loadEventTitles(docs.map((d) => String(d.data()?.event_id || d.data()?.metadata?.eventId || '')))
  return docs
    .map((d) => {
      const o = d.data() || {}
      const eventId = str(o.event_id) || str(o.metadata?.eventId)
      return {
        paymentId: d.id,
        status: str(o.status),
        eventId,
        eventTitle: eventId ? titles.get(eventId) || null : null,
        paymentIntentId: str(o.payment_intent_id) || (String(d.id).startsWith('pi_') ? d.id : null),
        needsRefund: o.needs_refund === true,
        needsReconcile: o.needs_reconcile === true,
        reconcileSteps: Object.keys(o)
          .filter((k) => k.startsWith('reconcile_') && o[k] === true)
          .map((k) => k.slice('reconcile_'.length)),
        refundError: str(o.refund_error),
        unallocatedCents: Math.max(0, (Number(o.refund_unallocated_cents) || 0) - (Number(o.refund_unallocated_resolved_cents) || 0)),
        updatedAt: toIso(o.updated_at) || toIso(o.created_at),
      }
    })
    .sort((x, y) => String(x.updatedAt || '').localeCompare(String(y.updatedAt || '')))
}

/**
 * Record that an admin handled a flagged order (refunded it in Stripe, fixed the
 * ledger by hand…). Clears needs_refund / needs_reconcile and marks the current
 * unallocated cents as settled. The order's `status` is deliberately NOT
 * touched: fulfilment routes on it, and a sold-out order must never fall
 * through to ticket issuance. A later Stripe redelivery can therefore still
 * re-attempt a failed auto-refund (same idempotency key); if that fails again
 * the order re-flags and reappears here.
 */
export async function resolveStripeOrderFlag(input: {
  paymentId: string
  actorId: string
  note?: string | null
}): Promise<void> {
  const paymentId = String(input.paymentId || '').trim()
  const note = String(input.note ?? '').trim().slice(0, 500) || null
  if (!paymentId || paymentId.includes('/')) throw new RefundQueueError('Invalid payment id', 400)
  const ref = adminDb.collection(STRIPE_ORDERS).doc(paymentId)
  const nowIso = new Date().toISOString()
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new RefundQueueError('Order not found', 404)
    const o = (snap.data() as any) || {}
    if (!isOpenStripeFlag(o)) throw new RefundQueueError('Nothing open on this order', 409)
    const cleared: Record<string, any> = {}
    for (const k of Object.keys(o)) if (k.startsWith('reconcile_') && o[k] === true) cleared[k] = false
    tx.set(
      ref,
      {
        ...cleared,
        needs_refund: false,
        needs_reconcile: false,
        refund_unallocated_resolved_cents: Number(o.refund_unallocated_cents) || 0,
        admin_resolution: {
          resolved_at: nowIso,
          resolved_by: input.actorId,
          note,
          was: {
            needs_refund: o.needs_refund === true,
            needs_reconcile: o.needs_reconcile === true,
            refund_unallocated_cents: Number(o.refund_unallocated_cents) || 0,
          },
        },
        updated_at: nowIso,
      },
      { merge: true }
    )
  })
}
