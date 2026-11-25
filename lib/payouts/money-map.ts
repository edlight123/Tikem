/**
 * MONEY MAP — where Tikèm's money physically sits, per currency and rail.
 *
 * PURE: the loader (lib/payouts/money-map-server.ts) reads tickets, the
 * fund_transfers ledger, the Haiti availability rows and the live MonCash
 * prefunded pool; this module does the arithmetic, so it can be tested.
 *
 * Per account (a funds rail, or a place money is moved to: a bank, the MonCash
 * prefunded pool) and currency:
 *
 *   collected   what buyers paid on that rail — the CHARGED amount, in the
 *               currency the money actually arrived in (a Haiti card sale is
 *               USD on stripe_platform, not HTG);
 *   refunded    what went back to buyers (same currency);
 *   disputed    card chargebacks still standing (Stripe debited them);
 *   out / in    fund_transfers recorded by an admin (out includes the wire /
 *               transfer fee the sending account paid);
 *   balance     collected − refunded − disputed − out + in.
 *
 * Two kinds of fund_transfers:
 *   movement         money moved between Tikèm's own accounts (a Stripe payout
 *                    to the bank, a bank wire into Digicel prefunding);
 *   organizer_payout money paid OUT to a Haitian organizer by international
 *                    wire from Tikèm's bank (USD, with its HTG equivalent and
 *                    the wire fee). It leaves the sending account and is
 *                    matched to the organizer's bank withdrawal request, which
 *                    is what reduced their owed balance in the availability
 *                    engine. A payout with no withdrawal reduced nothing there:
 *                    it is flagged so nobody pays it twice.
 *
 * The balance is a LEDGER balance, not a bank statement: it is what should be
 * there if every movement was recorded. Stripe fees, FX spreads and organizer
 * payouts that are not recorded as transfers show up as the difference
 * between this figure and the real account.
 *
 * Haiti: what organizers are owed (the availability engine's balances, plus
 * MonCash withdrawals filed but not yet sent) against the MonCash prefunded
 * pool. The shortfall is how much must be moved from Stripe / PayPal / the
 * merchant account into Digicel prefunding before those payouts can go out.
 */

import { isLiveTicketStatus } from '@/lib/tickets/status'
import { resolveFundsRail, type FundsRail } from '@/lib/payouts/funds-rail'

/** Places money can sit that are not sale rails. */
export const TRANSFER_ONLY_ACCOUNTS = ['bank', 'moncash_prefunded'] as const
export type TransferOnlyAccount = (typeof TRANSFER_ONLY_ACCOUNTS)[number]

/** A rail or a transfer-only account. 'unknown' collects sales no rule could place. */
export type MoneyAccount = FundsRail | TransferOnlyAccount | 'unknown'

/**
 * Accounts an admin may record a movement from or to. 'free' holds nothing;
 * PayPal checkout was cancelled (2026-11-24), so it is not offered here even
 * though `paypal` stays a valid funds rail.
 */
export const TRANSFER_ACCOUNTS = [
  'stripe_platform',
  'bank',
  'moncash',
  'moncash_prefunded',
  'sogepay',
] as const
export type TransferAccount = (typeof TRANSFER_ACCOUNTS)[number]

/** The payee side of an organizer payout: money that has left Tikèm. */
export const ORGANIZER_PAYEE = 'organizer' as const

export const TRANSFER_KINDS = ['movement', 'organizer_payout'] as const
export type TransferKind = (typeof TRANSFER_KINDS)[number]

export const ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  moncash: 'MonCash merchant',
  moncash_prefunded: 'MonCash prefunded pool',
  sogepay: 'Sogepay',
  stripe_platform: 'Stripe (Tikèm balance)',
  stripe_connect: 'Stripe Connect (organizers)',
  paypal: 'PayPal',
  cash: 'Cash at the door (organizers)',
  free: 'Free',
  bank: 'Bank',
  unknown: 'Unknown rail',
}

/** Sale money Tikèm does NOT hold: shown for completeness, never counted as Tikèm's. */
export const NOT_TIKEM_HELD: ReadonlySet<MoneyAccount> = new Set<MoneyAccount>(['stripe_connect', 'cash', 'free'])

export type FundTransfer = {
  id: string
  kind: TransferKind
  fromAccount: TransferAccount
  /** Another account for a movement; 'organizer' for an organizer payout. */
  toAccount: TransferAccount | typeof ORGANIZER_PAYEE
  /** Minor units of `currency`, leaving `fromAccount`. */
  amountMinor: number
  currency: string
  /** Minor units of `toCurrency`, arriving in `toAccount`. Same as amountMinor when no FX. */
  toAmountMinor: number
  toCurrency: string
  /** toCurrency per 1 unit of currency; null when the currencies match. */
  fxRate: number | null
  /** Fee the sending account paid on top (wire fee), minor units of `currency`. */
  feeMinor: number
  /** organizer_payout: who was paid, and the bank withdrawal request it settles. */
  organizerId: string | null
  withdrawalId: string | null
  /** The withdrawal as it stood when the payout was recorded (amount = owed side). */
  withdrawal: { amountMinor: number; currency: string; status: string; eventId: string | null } | null
  reference: string | null
  /** ISO date the money moved (YYYY-MM-DD or full ISO). */
  date: string
  note: string | null
  createdAt: string | null
  createdBy: string | null
  createdByEmail: string | null
}

export type SaleFacts = {
  account: MoneyAccount
  currency: string
  grossMinor: number
  refundedMinor: number
  disputedMinor: number
}

function minor(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

function code(value: unknown, fallback = 'HTG'): string {
  const s = String(value ?? '').trim().toUpperCase()
  return s || fallback
}

/**
 * What one ticket put on its rail. Null when the ticket carried no money
 * (free, never paid, cancelled without a refund) or should not count.
 */
export function saleFactsFromTicket(ticket: Record<string, any> | null | undefined): SaleFacts | null {
  if (!ticket) return null
  const rail = resolveFundsRail(ticket)
  const status = String(ticket.status ?? '').toLowerCase().trim()
  const refundStatus = String(ticket.refund_status ?? '').toLowerCase().trim()
  const refunded = status === 'refunded' || refundStatus === 'approved'
  const disputed = !refunded && status === 'disputed'
  if (!refunded && !disputed && !isLiveTicketStatus(status)) return null

  // Pay at the door: the cash is the organizer's, counted once it was taken.
  if (rail === 'cash') {
    if (ticket.door_paid !== true) return null
    const gross = minor(ticket.door_amount ?? ticket.door_price)
    if (!gross) return null
    return {
      account: 'cash',
      currency: code(ticket.door_currency ?? ticket.currency),
      grossMinor: gross,
      refundedMinor: 0,
      disputedMinor: 0,
    }
  }
  if (rail === 'free') return null

  // The money as it ARRIVED: charged amount and currency, else the face value.
  const charged = minor(ticket.charged_amount)
  const grossMinor = charged || minor(ticket.price_paid ?? ticket.pricePaid ?? ticket.price)
  if (!grossMinor) return null
  const currency = charged
    ? code(ticket.charged_currency, code(ticket.original_currency ?? ticket.currency))
    : code(ticket.original_currency ?? ticket.currency)

  let refundedMinor = 0
  if (refunded) {
    const refundAmount = minor(ticket.refund_amount)
    const refundCurrency = code(ticket.refund_currency, currency)
    // A refund recorded in the arrival currency is taken as written (a refund
    // that kept the service fee returns less than was charged); anything else
    // is assumed to have returned the whole charge.
    refundedMinor = refundAmount && refundCurrency === currency ? Math.min(refundAmount, grossMinor) : grossMinor
  }
  return {
    account: rail ?? 'unknown',
    currency,
    grossMinor,
    refundedMinor,
    disputedMinor: disputed ? grossMinor : 0,
  }
}

export type AccountLine = {
  account: MoneyAccount
  label: string
  currency: string
  /** False for money that sits with organizers (Connect, door cash). */
  tikemHeld: boolean
  tickets: number
  grossMinor: number
  refundedMinor: number
  disputedMinor: number
  transferredOutMinor: number
  transferredInMinor: number
  balanceMinor: number
}

export type CurrencyBlock = {
  currency: string
  lines: AccountLine[]
  /** Sums over Tikèm-held accounts only. */
  tikemCollectedMinor: number
  tikemBalanceMinor: number
}

export type HaitiPosition = {
  /** Availability engine: Σ unpaid HTG balances of organizers paid over MonCash (or not chosen yet). */
  owedEventsMinor: number
  /** Same, for organizers whose payout method is a bank account (paid by wire). */
  owedEventsBankRailMinor: number
  /** Owed by international wire: bank-rail balances + unsent bank withdrawals (HTG). */
  owedByWireMinor: number
  /** MonCash withdrawals filed but not yet sent from the pool. */
  unsentWithdrawalsMinor: number
  /** Bank withdrawals filed (HTG) but not yet completed: owed by wire. */
  unsentBankWithdrawalsMinor: number
  /** What the MonCash pool must cover: events + unsent MonCash withdrawals. */
  owedMinor: number
  /** Live MonCash prefunded balance (HTG minor), null when the read failed. */
  poolBalanceMinor: number | null
  poolError: string | null
  /** owed − pool, never negative; null when the pool could not be read. */
  shortfallMinor: number | null
  /** USD per 1 HTG used to express the shortfall in USD; null when unknown. */
  usdPerHtg: number | null
  /** The shortfall in USD cents (what to move from Stripe / PayPal). */
  shortfallUsdMinor: number | null
  /** Ledger balance on stripe_platform + bank in USD: what is there to move. */
  movableUsdMinor: number
  /** Organizer balances on Haiti events priced in USD (minor), owed too. */
  owedUsdEventsMinor: number
}

export type PayoutCheck = {
  id: string
  date: string
  organizerId: string | null
  withdrawalId: string | null
  reference: string | null
  /** What left the bank, wire fee excluded, and the fee itself. */
  amountMinor: number
  currency: string
  feeMinor: number
  /** The HTG (or other) equivalent the organizer received. */
  toAmountMinor: number
  toCurrency: string
  /** The withdrawal it settles: the owed side. Null = not linked. */
  owedMinor: number | null
  owedCurrency: string | null
  /** toAmount − owed, when both are in the same currency (+ = organizer got more). */
  varianceMinor: number | null
  /** 'matched' | 'variance' | 'unlinked' | 'currency_mismatch' */
  state: 'matched' | 'variance' | 'unlinked' | 'currency_mismatch'
}

export type PayoutSummary = {
  currency: string
  count: number
  amountMinor: number
  feeMinor: number
  /** HTG equivalent paid, summed per receiving currency. */
  received: Array<{ currency: string; amountMinor: number }>
}

export type MoneyMap = {
  from: string | null
  to: string | null
  currencies: CurrencyBlock[]
  transfers: FundTransfer[]
  /** Organizer payouts by wire, per sending currency. */
  payouts: PayoutSummary[]
  /** One line per organizer payout, matched against its withdrawal. */
  payoutChecks: PayoutCheck[]
  haiti: HaitiPosition
  ticketsScanned: number
  /** True when the ticket scan hit its cap: totals are a lower bound. */
  truncated: boolean
}

export type MoneyMapInput = {
  from?: string | null
  to?: string | null
  tickets: Array<Record<string, any>>
  transfers: FundTransfer[]
  haiti: {
    owedEventsHtgMinor: number
    owedEventsUsdMinor: number
    unsentWithdrawalsHtgMinor: number
    unsentBankWithdrawalsHtgMinor?: number
    /** Balances of bank-rail organizers, excluded from owedEventsHtgMinor. */
    owedEventsBankRailHtgMinor?: number
    poolBalanceHtg: number | null
    poolError?: string | null
    /** HTG per 1 USD (the payout-side rate); null when unknown. */
    htgPerUsd: number | null
  }
  truncated?: boolean
}

/** Within this many minor units, a payout's HTG equivalent "matches" its withdrawal. */
export const PAYOUT_MATCH_TOLERANCE_MINOR = 100

/** A payout against the withdrawal it settles. */
export function checkPayout(t: FundTransfer): PayoutCheck {
  const w = t.withdrawal
  const toCurrency = code(t.toCurrency || t.currency)
  let state: PayoutCheck['state'] = 'unlinked'
  let variance: number | null = null
  if (t.withdrawalId && w) {
    if (code(w.currency) === toCurrency) {
      variance = Math.round(t.toAmountMinor) - Math.round(w.amountMinor)
      state = Math.abs(variance) <= PAYOUT_MATCH_TOLERANCE_MINOR ? 'matched' : 'variance'
    } else {
      state = 'currency_mismatch'
    }
  }
  return {
    id: t.id,
    date: t.date,
    organizerId: t.organizerId,
    withdrawalId: t.withdrawalId,
    reference: t.reference,
    amountMinor: Math.round(t.amountMinor),
    currency: code(t.currency),
    feeMinor: Math.max(0, Math.round(t.feeMinor || 0)),
    toAmountMinor: Math.round(t.toAmountMinor),
    toCurrency,
    owedMinor: w ? Math.round(w.amountMinor) : null,
    owedCurrency: w ? code(w.currency) : null,
    varianceMinor: variance,
    state,
  }
}

const ACCOUNT_ORDER: MoneyAccount[] = [
  'stripe_platform',
  'paypal',
  'moncash',
  'moncash_prefunded',
  'sogepay',
  'bank',
  'stripe_connect',
  'cash',
  'unknown',
]

/** Within [from, to] (inclusive dates). A transfer with no usable date is always in. */
export function transferInRange(t: Pick<FundTransfer, 'date'>, from?: string | null, to?: string | null): boolean {
  const day = String(t.date || '').slice(0, 10)
  if (!day) return true
  if (from && day < String(from).slice(0, 10)) return false
  if (to && day > String(to).slice(0, 10)) return false
  return true
}

export function computeMoneyMap(input: MoneyMapInput): MoneyMap {
  const lines = new Map<string, AccountLine>()
  const line = (account: MoneyAccount, currency: string): AccountLine => {
    const key = `${currency}|${account}`
    let l = lines.get(key)
    if (!l) {
      l = {
        account,
        label: ACCOUNT_LABELS[account],
        currency,
        tikemHeld: !NOT_TIKEM_HELD.has(account) && account !== 'unknown',
        tickets: 0,
        grossMinor: 0,
        refundedMinor: 0,
        disputedMinor: 0,
        transferredOutMinor: 0,
        transferredInMinor: 0,
        balanceMinor: 0,
      }
      lines.set(key, l)
    }
    return l
  }

  for (const ticket of input.tickets) {
    const f = saleFactsFromTicket(ticket)
    if (!f) continue
    const l = line(f.account, f.currency)
    l.tickets += 1
    l.grossMinor += f.grossMinor
    l.refundedMinor += f.refundedMinor
    l.disputedMinor += f.disputedMinor
  }

  const transfers = input.transfers.filter((t) => transferInRange(t, input.from, input.to))
  const payoutTotals = new Map<string, PayoutSummary>()
  for (const t of transfers) {
    const fee = Math.max(0, Math.round(t.feeMinor || 0))
    line(t.fromAccount, code(t.currency)).transferredOutMinor += Math.max(0, Math.round(t.amountMinor)) + fee
    if (t.toAccount === ORGANIZER_PAYEE) {
      // Paid out of Tikèm: no receiving account to credit.
      const cur = code(t.currency)
      const sum = payoutTotals.get(cur) || { currency: cur, count: 0, amountMinor: 0, feeMinor: 0, received: [] }
      sum.count += 1
      sum.amountMinor += Math.max(0, Math.round(t.amountMinor))
      sum.feeMinor += fee
      const toCur = code(t.toCurrency || t.currency)
      const rec = sum.received.find((r) => r.currency === toCur)
      if (rec) rec.amountMinor += Math.max(0, Math.round(t.toAmountMinor))
      else sum.received.push({ currency: toCur, amountMinor: Math.max(0, Math.round(t.toAmountMinor)) })
      payoutTotals.set(cur, sum)
      continue
    }
    line(t.toAccount, code(t.toCurrency || t.currency)).transferredInMinor += Math.max(0, Math.round(t.toAmountMinor))
  }

  const byCurrency = new Map<string, AccountLine[]>()
  for (const l of lines.values()) {
    l.balanceMinor = l.grossMinor - l.refundedMinor - l.disputedMinor - l.transferredOutMinor + l.transferredInMinor
    const list = byCurrency.get(l.currency) || []
    list.push(l)
    byCurrency.set(l.currency, list)
  }

  const currencyRank = (c: string) => (c === 'HTG' ? 0 : c === 'USD' ? 1 : 2)
  const currencies: CurrencyBlock[] = Array.from(byCurrency.entries())
    .sort(([a], [b]) => currencyRank(a) - currencyRank(b) || a.localeCompare(b))
    .map(([currency, list]) => {
      list.sort((a, b) => ACCOUNT_ORDER.indexOf(a.account) - ACCOUNT_ORDER.indexOf(b.account))
      const held = list.filter((l) => l.tikemHeld)
      return {
        currency,
        lines: list,
        tikemCollectedMinor: held.reduce((s, l) => s + l.grossMinor - l.refundedMinor - l.disputedMinor, 0),
        tikemBalanceMinor: held.reduce((s, l) => s + l.balanceMinor, 0),
      }
    })

  // ── Haiti position ──
  const h = input.haiti
  const owedEventsMinor = Math.max(0, Math.round(h.owedEventsHtgMinor))
  const unsentWithdrawalsMinor = Math.max(0, Math.round(h.unsentWithdrawalsHtgMinor))
  const owedMinor = owedEventsMinor + unsentWithdrawalsMinor
  const poolBalanceMinor =
    h.poolBalanceHtg === null || !Number.isFinite(Number(h.poolBalanceHtg)) ? null : Math.round(Number(h.poolBalanceHtg) * 100)
  const unsentBankWithdrawalsMinor = Math.max(0, Math.round(h.unsentBankWithdrawalsHtgMinor || 0))
  const shortfallMinor = poolBalanceMinor === null ? null : Math.max(0, owedMinor - poolBalanceMinor)
  const htgPerUsd = Number(h.htgPerUsd)
  const usdPerHtg = Number.isFinite(htgPerUsd) && htgPerUsd > 0 ? 1 / htgPerUsd : null
  const shortfallUsdMinor =
    shortfallMinor === null || usdPerHtg === null ? null : Math.ceil(shortfallMinor * usdPerHtg)
  const usdBlock = currencies.find((c) => c.currency === 'USD')
  const movableUsdMinor = Math.max(
    0,
    (usdBlock?.lines || [])
      .filter((l) => l.account === 'stripe_platform' || l.account === 'bank')
      .reduce((s, l) => s + l.balanceMinor, 0)
  )

  return {
    from: input.from || null,
    to: input.to || null,
    currencies,
    transfers: transfers.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
    payouts: Array.from(payoutTotals.values()),
    payoutChecks: transfers
      .filter((t) => t.toAccount === ORGANIZER_PAYEE)
      .map(checkPayout)
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    haiti: {
      owedEventsMinor,
      owedEventsBankRailMinor: Math.max(0, Math.round(h.owedEventsBankRailHtgMinor || 0)),
      owedByWireMinor: Math.max(0, Math.round(h.owedEventsBankRailHtgMinor || 0)) + unsentBankWithdrawalsMinor,
      unsentWithdrawalsMinor,
      unsentBankWithdrawalsMinor,
      owedMinor,
      poolBalanceMinor,
      poolError: h.poolError || null,
      shortfallMinor,
      usdPerHtg,
      shortfallUsdMinor,
      movableUsdMinor,
      owedUsdEventsMinor: Math.max(0, Math.round(h.owedEventsUsdMinor)),
    },
    ticketsScanned: input.tickets.length,
    truncated: Boolean(input.truncated),
  }
}
