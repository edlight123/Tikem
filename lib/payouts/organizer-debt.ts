/**
 * ORGANIZER-LEVEL DEBT: refunds and chargebacks that landed after an event's
 * money was already withdrawn.
 *
 * computeEventAvailability floors every event's balance at 0, so an event that
 * was paid out and THEN refunded simply reads "0 available" and the loss lands
 * on Tikèm. Its `deficitMinor` is that loss. This module carries it across
 * events: the organizer's next withdrawal (any event, SAME currency) first
 * repays the debt, inside the withdrawal's own debit transaction.
 *
 * One doc per organizer: organizers/{id}/ledger/debt
 *
 *   byCurrency.{HTG|USD|…}.eventDeficits.{eventId}  current deficit of that event
 *   byCurrency.{C}.entries.{refId}                  explicit debts (e.g. a chargeback
 *                                                   recorded by the Stripe webhook)
 *   byCurrency.{C}.repaidMinor                      what withdrawals have netted off
 *   byCurrency.{C}.repayments.{withdrawalId}        audit of each netting
 *
 *   outstanding(C) = Σ eventDeficits + Σ entries − repaidMinor   (floored at 0)
 *
 * Currencies are NEVER mixed: HTG debt is repaid only from HTG withdrawals.
 *
 * Event deficits are idempotent (each write REPLACES that event's figure, it is
 * recomputed from the tickets), so syncing twice never doubles a debt.
 *
 * How a repayment is booked: the withdrawn event's ledger row gets
 * withdrawnAmount += applied (and debtAppliedMinor += applied), so its balance
 * drops by what Tikèm kept. A later failed/rejected withdrawal credits back only
 * its own reservedCents, never the repayment.
 */
import { adminDb } from '@/lib/firebase/admin'

export const ORGANIZER_DEBT_CODE = 'organizer_debt_outstanding'

export type CurrencyDebt = {
  eventDeficits?: Record<string, number>
  entries?: Record<string, number>
  repaidMinor?: number
  repayments?: Record<string, { eventId: string; amountMinor: number; at: string }>
}

export type OrganizerDebtDoc = {
  byCurrency?: Record<string, CurrencyDebt>
  updatedAt?: string
}

const minor = (v: unknown) => {
  const n = Math.round(Number(v) || 0)
  return n > 0 ? n : 0
}

const cur = (c: unknown) => String(c || '').toUpperCase().trim()

export function organizerDebtRef(organizerId: string) {
  return adminDb.collection('organizers').doc(String(organizerId)).collection('ledger').doc('debt')
}

/** Pure: outstanding debt in ONE currency. */
export function outstandingDebtMinor(doc: OrganizerDebtDoc | null | undefined, currency: string): number {
  const c = doc?.byCurrency?.[cur(currency)]
  if (!c) return 0
  let owed = 0
  for (const v of Object.values(c.eventDeficits || {})) owed += minor(v)
  for (const v of Object.values(c.entries || {})) owed += minor(v)
  return Math.max(0, owed - minor(c.repaidMinor))
}

/** Pure: outstanding debt for every currency that has any. */
export function outstandingDebtByCurrency(doc: OrganizerDebtDoc | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of Object.keys(doc?.byCurrency || {})) {
    const owed = outstandingDebtMinor(doc, c)
    if (owed > 0) out[c] = owed
  }
  return out
}

export type DebtNetting =
  | { ok: true; appliedMinor: number; outstandingMinor: number }
  | { ok: false; code: typeof ORGANIZER_DEBT_CODE; error: string; outstandingMinor: number; withdrawableMinor: number }

/**
 * Pure: may `amountMinor` be withdrawn from an event with `availableMinor`
 * left, once the organizer's outstanding debt in that currency is repaid first?
 */
export function netDebtAgainstWithdrawal(args: {
  debt: OrganizerDebtDoc | null | undefined
  currency: string
  availableMinor: number
  amountMinor: number
}): DebtNetting {
  const outstanding = outstandingDebtMinor(args.debt, args.currency)
  const available = minor(args.availableMinor)
  const amount = minor(args.amountMinor)
  if (outstanding <= 0) return { ok: true, appliedMinor: 0, outstandingMinor: 0 }
  const applied = Math.min(outstanding, available)
  const withdrawable = Math.max(0, available - applied)
  if (amount > withdrawable) {
    const c = cur(args.currency)
    return {
      ok: false,
      code: ORGANIZER_DEBT_CODE,
      outstandingMinor: outstanding,
      withdrawableMinor: withdrawable,
      error:
        `${(outstanding / 100).toFixed(2)} ${c} is owed for refunds on an event you were already paid for. ` +
        `It is taken from this balance first, so you can withdraw up to ${(withdrawable / 100).toFixed(2)} ${c} now.`,
    }
  }
  return { ok: true, appliedMinor: applied, outstandingMinor: outstanding }
}

/**
 * Inside a withdrawal's debit transaction (after its reads): read the debt doc.
 * Call BEFORE any tx write (Firestore requires every read first).
 */
export async function readDebtInTransaction(tx: any, organizerId: string): Promise<{ ref: any; data: OrganizerDebtDoc }> {
  const ref = organizerDebtRef(organizerId)
  const snap = await tx.get(ref)
  return { ref, data: (snap?.exists ? snap.data() : null) || {} }
}

/** Inside the same transaction, after the netting allowed it: book the repayment. */
export function bookDebtRepaymentInTransaction(
  tx: any,
  debt: { ref: any; data: OrganizerDebtDoc },
  args: { currency: string; appliedMinor: number; withdrawalId: string; eventId: string; now?: Date }
): void {
  const applied = minor(args.appliedMinor)
  if (applied <= 0) return
  const c = cur(args.currency)
  const at = (args.now || new Date()).toISOString()
  const prior = minor(debt.data?.byCurrency?.[c]?.repaidMinor)
  tx.set(
    debt.ref,
    {
      byCurrency: {
        [c]: {
          repaidMinor: prior + applied,
          repayments: { [args.withdrawalId]: { eventId: String(args.eventId), amountMinor: applied, at } },
        },
      },
      updatedAt: at,
    },
    { merge: true }
  )
}

/**
 * Record (replace) one event's current deficit. A no-op when unchanged, so it
 * is cheap to call after every refund and before every withdrawal.
 */
export async function recordEventDeficit(
  organizerId: string,
  eventId: string,
  currency: string,
  deficitMinor: number
): Promise<boolean> {
  const c = cur(currency)
  if (!organizerId || !eventId || !c) return false
  const next = minor(deficitMinor)
  const ref = organizerDebtRef(organizerId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const data: OrganizerDebtDoc = (snap?.exists ? snap.data() : null) || {}
    const current = minor(data?.byCurrency?.[c]?.eventDeficits?.[eventId])
    if (current === next) return false
    if (next === 0 && !snap?.exists) return false
    const at = new Date().toISOString()
    tx.set(ref, { byCurrency: { [c]: { eventDeficits: { [eventId]: next } } }, updatedAt: at }, { merge: true })
    console.warn('[organizer-debt] event deficit changed', { organizerId, eventId, currency: c, from: current, to: next })
    return true
  })
}

/**
 * Record an explicit debt not visible on the tickets — e.g. a chargeback on
 * Tikèm-held money. Idempotent per refId. For the Stripe webhook owner.
 */
export async function addOrganizerDebtEntry(
  organizerId: string,
  entry: { currency: string; amountMinor: number; refId: string }
): Promise<void> {
  const c = cur(entry.currency)
  if (!c || !entry.refId) throw new Error('currency and refId are required')
  await organizerDebtRef(organizerId).set(
    { byCurrency: { [c]: { entries: { [String(entry.refId)]: minor(entry.amountMinor) } } }, updatedAt: new Date().toISOString() },
    { merge: true }
  )
}

/**
 * Recompute and record the deficit of every event this organizer has withdrawn
 * from (only those can be in deficit). Called by the withdraw routes before the
 * debit, so a refund that landed since the last sync is already debt. Never
 * throws; returns the events it could not judge.
 */
export async function syncOrganizerDebt(organizerId: string): Promise<{ failed: string[] }> {
  const failed: string[] = []
  try {
    // Lazy import: availability-server pulls the whole fee/settings graph.
    const { loadEventAvailability } = await import('@/lib/payouts/availability-server')
    const snap = await adminDb.collection('event_earnings').where('organizerId', '==', String(organizerId)).get()
    const eventIds = new Set<string>()
    for (const d of snap?.docs || []) {
      const data = (d.data() || {}) as any
      if (minor(data.withdrawnAmount) > 0) eventIds.add(String(data.eventId || d.id))
    }
    for (const eventId of Array.from(eventIds)) {
      try {
        const a = await loadEventAvailability({ eventId })
        if (!a) continue
        await recordEventDeficit(organizerId, eventId, a.currency, a.deficitMinor)
      } catch (err: any) {
        failed.push(eventId)
        console.error('[organizer-debt] could not judge event', { organizerId, eventId, message: err?.message })
      }
    }
  } catch (err: any) {
    console.error('[organizer-debt] sync failed', { organizerId, message: err?.message })
    failed.push('*')
  }
  return { failed }
}

/**
 * After a refund LANDS on one event: if that event had been withdrawn from,
 * recompute its deficit and record it as organizer debt. One cheap ledger read
 * when nothing was withdrawn. Best-effort, never throws: the withdraw routes
 * re-sync before every debit anyway (syncOrganizerDebt), so a miss here only
 * delays when the debt becomes visible, never whether it is netted.
 */
export async function syncEventDeficitAfterRefund(eventId: string, organizerId?: string | null): Promise<void> {
  try {
    const { findEventEarningsDoc } = await import('@/lib/earnings')
    const doc = await findEventEarningsDoc(String(eventId))
    const data = doc ? ((doc.data() || {}) as any) : null
    if (!data || minor(data.withdrawnAmount) <= 0) return
    const owner = String(organizerId || data.organizerId || '')
    if (!owner) return
    const { loadEventAvailability } = await import('@/lib/payouts/availability-server')
    const a = await loadEventAvailability({ eventId: String(eventId) })
    if (a) await recordEventDeficit(owner, String(eventId), a.currency, a.deficitMinor)
  } catch (err: any) {
    console.error('[organizer-debt] post-refund sync failed', { eventId, message: err?.message })
  }
}
