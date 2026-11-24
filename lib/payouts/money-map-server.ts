/**
 * Firestore + MonCash loader for the Money map (lib/payouts/money-map.ts).
 * READ-ONLY: reads tickets, fund_transfers, the Haiti availability rows (the
 * one balance engine, via the prefunding planner's loader), unsent
 * withdrawals and the live prefunded pool. Writes nothing.
 */

import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { computeMoneyMap, type MoneyMap } from '@/lib/payouts/money-map'
import { FUND_TRANSFERS_COLLECTION, fundTransferFromDoc } from '@/lib/payouts/fund-transfers'
import {
  loadPlanEvents,
  loadUnsentMoncashWithdrawals,
  readPoolBalance,
} from '@/lib/payouts/prefunding-plan-server'
import { fetchUsdToHtgRate } from '@/lib/currency'

/** The fields the money map reads off a ticket (keeps the scan light). */
const TICKET_FIELDS = [
  'status',
  'refund_status',
  'payment_method',
  'funds_rail',
  'source',
  'price_paid',
  'currency',
  'original_currency',
  'charged_amount',
  'charged_currency',
  'refund_amount',
  'refund_currency',
  'door_paid',
  'door_amount',
  'door_price',
  'door_currency',
  'payment_intent_id',
  'payment_id',
  'stripe_connect_account_id',
] as const

/** Upper bound on tickets scanned per request; beyond it the map says it is partial. */
export const MONEY_MAP_TICKET_CAP = 50_000

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}
function dayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999Z`)
}

/**
 * Tickets bought in [from, to]. `purchased_at` is an ISO string on paid
 * tickets and a Firestore Timestamp on free claims (see the timestamp-drift
 * note in lib/payouts/availability.ts), and a range query only matches one
 * type — so both are asked, and merged by id.
 */
async function loadTickets(from: string | null, to: string | null): Promise<{ tickets: any[]; truncated: boolean }> {
  const col = adminDb.collection('tickets')
  if (!from && !to) {
    const snap = await col.select(...TICKET_FIELDS).limit(MONEY_MAP_TICKET_CAP + 1).get()
    const docs = snap.docs.map((d: any) => d.data() || {})
    return { tickets: docs.slice(0, MONEY_MAP_TICKET_CAP), truncated: docs.length > MONEY_MAP_TICKET_CAP }
  }
  const lo = from ? dayStart(from) : new Date('2000-01-01T00:00:00Z')
  const hi = to ? dayEnd(to) : new Date('2100-01-01T00:00:00Z')
  const [asString, asTimestamp] = await Promise.all([
    col
      .where('purchased_at', '>=', lo.toISOString())
      .where('purchased_at', '<=', hi.toISOString())
      .select(...TICKET_FIELDS)
      .limit(MONEY_MAP_TICKET_CAP + 1)
      .get(),
    col
      .where('purchased_at', '>=', Timestamp.fromDate(lo))
      .where('purchased_at', '<=', Timestamp.fromDate(hi))
      .select(...TICKET_FIELDS)
      .limit(MONEY_MAP_TICKET_CAP + 1)
      .get(),
  ])
  const byId = new Map<string, any>()
  for (const d of [...asString.docs, ...asTimestamp.docs]) byId.set(d.id, d.data() || {})
  const tickets = Array.from(byId.values())
  return {
    tickets: tickets.slice(0, MONEY_MAP_TICKET_CAP),
    truncated: tickets.length > MONEY_MAP_TICKET_CAP || asString.size > MONEY_MAP_TICKET_CAP || asTimestamp.size > MONEY_MAP_TICKET_CAP,
  }
}

export async function loadFundTransfers(limit = 500) {
  const snap = await adminDb.collection(FUND_TRANSFERS_COLLECTION).orderBy('date', 'desc').limit(limit).get()
  return snap.docs.map((d: any) => fundTransferFromDoc(d.id, d.data() || {}))
}

/** Bank withdrawals filed but not completed: owed, to be paid by wire. */
async function loadUnsentBankWithdrawalsHtgMinor(): Promise<number> {
  const snap = await adminDb
    .collection('withdrawal_requests')
    .where('method', '==', 'bank')
    .where('status', 'in', ['pending', 'approved', 'processing'])
    .get()
  let total = 0
  for (const doc of snap.docs) {
    const r = (doc.data() as any) || {}
    if (String(r.currency || 'HTG').toUpperCase() !== 'HTG') continue
    const amount = Number(r.amount)
    if (Number.isFinite(amount) && amount > 0) total += Math.round(amount)
  }
  return total
}

export async function loadMoneyMap(opts: { from?: string | null; to?: string | null; now?: Date } = {}): Promise<MoneyMap> {
  const now = opts.now || new Date()
  const from = opts.from || null
  const to = opts.to || null
  const [{ tickets, truncated }, transfers, planEvents, unsentMoncash, unsentBank, pool, htgPerUsd] = await Promise.all([
    loadTickets(from, to),
    loadFundTransfers(),
    loadPlanEvents(now),
    loadUnsentMoncashWithdrawals(),
    loadUnsentBankWithdrawalsHtgMinor(),
    readPoolBalance(now),
    fetchUsdToHtgRate().catch(() => null),
  ])

  let owedPool = 0
  let owedBankRail = 0
  let owedUsd = 0
  for (const e of planEvents) {
    if (e.currency === 'HTG') {
      if (e.payoutRail === 'bank') owedBankRail += e.balanceMinor
      else owedPool += e.balanceMinor
    } else if (e.currency === 'USD') {
      owedUsd += e.balanceMinor
    }
  }
  const unsentMoncashMinor = unsentMoncash.reduce((s, w) => s + (Number(w.amountHtgMinor) || 0), 0)

  return computeMoneyMap({
    from,
    to,
    tickets,
    transfers,
    truncated,
    haiti: {
      owedEventsHtgMinor: owedPool,
      owedEventsBankRailHtgMinor: owedBankRail,
      owedEventsUsdMinor: owedUsd,
      unsentWithdrawalsHtgMinor: unsentMoncashMinor,
      unsentBankWithdrawalsHtgMinor: unsentBank,
      poolBalanceHtg: pool.balanceHtg,
      poolError: pool.error,
      htgPerUsd: typeof htgPerUsd === 'number' ? htgPerUsd : null,
    },
  })
}
