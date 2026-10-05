'use client'

import { useTranslation } from 'react-i18next'

import { useState } from 'react'
import Link from 'next/link'
import { FEE_CONFIG, type EarningsSummary } from '@/types/earnings'
import { StatusChip, type ChipTone } from '@/components/ui/kit'
import { PayoutRequestModal } from '@/components/organizer/PayoutRequestModal'
import {
  DollarSign,
  TrendingUp,
  Wallet,
  ArrowDownCircle,
  ArrowRight,
  Clock,
  Receipt,
  ChevronDown,
} from 'lucide-react'

interface EarningsViewProps {
  summary: EarningsSummary
  organizerId: string
  /**
   * The withdrawable balance PER CURRENCY, from lib/payouts/availability.ts —
   * the same function /api/organizer/request-payout (and the per-event
   * withdraw routes) validate with. Required: there is no fallback to a second
   * engine, because that fallback is how the page once offered money the
   * request then refused.
   */
  withdrawable: {
    totals: Array<{ currency: string; availableNowMinor: number; pendingMinor: number; withdrawnMinor: number; nextAvailableAt?: string | null }>
  }
}

// The single minimum, shared with the server so the button and the route can
// never disagree about the threshold. It was previously duplicated here as a
// literal 5000 and compared with `>`, while the server used `>=` — so a balance
// of exactly the minimum was refused by the UI and accepted by the API.
const MIN_PAYOUT_CENTS = FEE_CONFIG.MINIMUM_PAYOUT_AMOUNT

type CurrencyTotals = {
  totalGrossSales: number
  totalNetAmount: number
  totalAvailableToWithdraw: number
  totalWithdrawn: number
  totalPlatformFees: number
  totalProcessingFees: number
}

/** Compact KPI card with a brand-tinted icon chip. Value is supplied as children
 * so callers control single- vs mixed-currency rendering. */
function StatCard({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-white/[0.03] p-5 shadow-soft">
      <div className="flex items-center gap-2 text-white/50">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-brand-300">{icon}</span>
        <span className="label-mono text-xs uppercase">{label}</span>
      </div>
      <div className="mt-3 text-white">{children}</div>
      {hint && <p className="mt-1 text-xs text-white/50">{hint}</p>}
    </div>
  )
}

export default function EarningsView({ summary, organizerId, withdrawable }: EarningsViewProps) {
  const { t: tx } = useTranslation('organizer')

  const [filter, setFilter] = useState<'all' | 'ready' | 'pending' | 'locked'>('all')
  const [payoutOpen, setPayoutOpen] = useState(false)

  const formatCurrency = (cents: number, currencyOverride?: 'HTG' | 'USD' | 'CAD' | 'EUR') => {
    const amount = cents / 100

    const currency =
      currencyOverride ||
      (summary.currency === 'HTG' || summary.currency === 'USD' || summary.currency === 'CAD' || summary.currency === 'EUR' ? summary.currency : 'USD')

    if (currency === 'HTG') {
      const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      return `HTG ${formatted}`
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const settlementTone: Record<string, ChipTone> = {
    ready: 'success',
    pending: 'warning',
    locked: 'neutral',
  }

  const usd = summary.totalsByCurrency?.USD
  const htg = summary.totalsByCurrency?.HTG
  const isMixed = summary.currency === 'mixed' && !!summary.totalsByCurrency

  // Joins a USD + HTG pair into a single "$X · HTG Y" string for compact contexts.
  const mixedInline = (pick: (t?: CurrencyTotals) => number) =>
    `${formatCurrency(pick(usd), 'USD')} · ${formatCurrency(pick(htg), 'HTG')}`

  // Renders a money value as a single bold figure, or a stacked USD/HTG pair for
  // mixed-currency organizers. Centralizes what was previously repeated inline.
  const renderMoney = (
    pick: (t?: CurrencyTotals) => number,
    single: number,
    valueClass = 'text-white',
  ) => {
    if (isMixed) {
      return (
        <span className="block space-y-1">
          {(['USD', 'HTG'] as const).map((code) => (
            <span key={code} className="flex items-baseline justify-between gap-3">
              <span className="label-mono text-[11px] uppercase text-white/40">{code}</span>
              <span className={`font-mono tabular-nums text-lg font-bold ${valueClass}`}>
                {formatCurrency(pick(code === 'USD' ? usd : htg), code)}
              </span>
            </span>
          ))}
        </span>
      )
    }
    return <span className={`font-mono tabular-nums text-2xl font-bold ${valueClass}`}>{formatCurrency(single)}</span>
  }

  /* ------------------------------------------------------------------------
   * The withdrawable balance, one figure per currency.
   *
   * Straight from the server's shared availability: what the payout request
   * will re-derive and judge. Never summed across currencies.
   * ---------------------------------------------------------------------- */
  const asCode = (c: string): 'HTG' | 'USD' | 'CAD' | 'EUR' | undefined =>
    c === 'HTG' || c === 'USD' || c === 'CAD' || c === 'EUR' ? c : undefined

  const balances = withdrawable.totals.length
    ? withdrawable.totals
    : [{ currency: summary.currency === 'mixed' ? 'HTG' : String(summary.currency || 'HTG'), availableNowMinor: 0, pendingMinor: 0, withdrawnMinor: 0 }]

  // `>=`, matching the server. The old `>` refused a balance of exactly the
  // minimum that the API would have accepted.
  const requestable = balances.filter((b) => b.availableNowMinor >= MIN_PAYOUT_CENTS)
  const [payoutCurrencyChoice, setPayoutCurrencyChoice] = useState<string | null>(null)
  const payoutRow = balances.find((b) => b.currency === payoutCurrencyChoice) || requestable[0] || balances[0]
  const canWithdraw = requestable.length > 0
  const anyAvailable = balances.some((b) => b.availableNowMinor > 0)

  const totalFeesLabel = isMixed
    ? mixedInline((t) => (t?.totalPlatformFees ?? 0) + (t?.totalProcessingFees ?? 0))
    : formatCurrency(summary.totalPlatformFees + summary.totalProcessingFees)

  const filteredEvents = filter === 'all' 
    ? summary.events 
    : summary.events.filter(e => e.settlementStatus === filter)

  return (
    <div className="space-y-6">
      {/* Payout hero.
          Was a full teal gradient panel, which fought the rest of the product:
          the canvas is black and teal is the sparing accent, so a big teal slab
          here read as another product's screen. Now the balance carries it, 
          one large figure on the canvas, the way the public pages let a number
          or a title do the work, and teal is left to the one accent that
          matters, the wallet mark. */}
      <section className="relative overflow-hidden rounded-2xl bg-white/[0.03] p-6 sm:p-8">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-white/50">
              <Wallet className="h-4 w-4 text-brand-400" />
              <span className="eyebrow">{tx('earnings.available_to_withdraw')}</span>
            </div>

            {/* One figure per currency, from the shared availability. HTG and
                USD are separate balances with separate payout paths. */}
            <div className="mt-3 space-y-2">
              {balances.map((b) => (
                <div
                  key={b.currency}
                  className={`font-mono tabular-nums leading-none ${balances.length > 1 ? 'text-[clamp(26px,4.5vw,40px)]' : 'text-[clamp(32px,6vw,52px)]'}`}
                >
                  {formatCurrency(b.availableNowMinor, asCode(b.currency))}
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/55">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Pending&nbsp;
                <span className="font-mono tabular-nums font-semibold text-white">
                  {balances.map((b) => formatCurrency(b.pendingMinor, asCode(b.currency))).join(' · ')}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ArrowDownCircle className="h-3.5 w-3.5" />
                Withdrawn&nbsp;
                <span className="font-mono tabular-nums font-semibold text-white">
                  {balances.map((b) => formatCurrency(b.withdrawnMinor, asCode(b.currency))).join(' · ')}
                </span>
              </span>
            </div>
          </div>

          <div className="shrink-0">
            {requestable.length > 1 && (
              <div className="mb-2 flex gap-2">
                {requestable.map((b) => (
                  <button
                    key={b.currency}
                    type="button"
                    onClick={() => setPayoutCurrencyChoice(b.currency)}
                    className={`rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium ${payoutRow.currency === b.currency ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70'}`}
                  >
                    {b.currency}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPayoutOpen(true)}
              disabled={!canWithdraw}
              // Enabled is white (this product's primary button); disabled is a
              // dim, obviously-inert fill.
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 font-bold text-gray-900 shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40 disabled:shadow-none lg:w-auto"
            >
              {tx('actions.request_payout')}
              <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-2 max-w-[14rem] text-xs text-white/55 lg:text-right">
              {canWithdraw
                ? 'Paid to your configured method, batched to the next Friday.'
                : anyAvailable
                  ? `You need at least ${formatCurrency(MIN_PAYOUT_CENTS, asCode(payoutRow.currency))} to request a payout.`
                  : 'Nothing to withdraw yet. Funds are released 24–72 hours after each event ends.'}
            </p>
          </div>
        </div>
      </section>

      {/* Secondary stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<DollarSign className="h-4 w-4" />} label={tx('earnings.gross_sales')} hint="All ticket revenue">
          {renderMoney((t) => t?.totalGrossSales ?? 0, summary.totalGrossSales)}
        </StatCard>
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label={tx('earnings.net_amount')} hint="After platform & processing fees">
          {renderMoney((t) => t?.totalNetAmount ?? 0, summary.totalNetAmount)}
        </StatCard>
        <StatCard icon={<Receipt className="h-4 w-4" />} label={tx('earnings.fees_paid')} hint="Platform + processing">
          {renderMoney(
            (t) => (t?.totalPlatformFees ?? 0) + (t?.totalProcessingFees ?? 0),
            summary.totalPlatformFees + summary.totalProcessingFees,
            'text-white/50',
          )}
        </StatCard>
      </div>

      {/* Fee structure — compact disclosure to keep the page focused */}
      <details className="group overflow-hidden rounded-2xl bg-white/[0.03] shadow-soft">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span className="flex items-center gap-2 text-sm font-medium text-white">
            <Receipt className="h-4 w-4 text-brand-300" />
            {tx('earnings.how_fees_calculated')}
          </span>
          <span className="flex items-center gap-3 text-sm text-white/50">
            <span className="hidden sm:inline">{tx('earnings.total_fees')}<span className="font-mono tabular-nums">{totalFeesLabel}</span></span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="space-y-2 border-t border-white/10 px-5 py-4 text-sm text-white/60">
          <div className="flex justify-between">
            <span>{tx('earnings.platform_fee')}</span>
            <span className="font-mono tabular-nums font-medium text-white">10% of ticket sales</span>
          </div>
          <div className="flex justify-between">
            <span>{tx('earnings.processing_fee')}</span>
            <span className="font-mono tabular-nums font-medium text-white">Included — Tikèm pays it</span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-2">
            <span>{tx('earnings.total_fees_paid')}</span>
            <span className="font-mono tabular-nums font-semibold text-white">{totalFeesLabel}</span>
          </div>
          {/* WHO PAYS decides whether these rates come out of the organizer's money at
              all. Stating the rates without this reads as "deducted from you" in every
              market, which is only true where the organizer bears the fee. */}
          <p className="border-t border-white/10 pt-2 text-xs text-white/45">
            Card and MonCash processing come out of Tikèm&rsquo;s 10%, never out of your money.
            When the fee is passed to buyers it is added to what they pay, so you receive
            your full ticket price; when you absorb it, the 10% is deducted from your
            proceeds and nothing else.{' '}
            <a
              href="/organizer/settings/payouts/fees"
              className="text-brand-300 underline underline-offset-2"
            >
              Fees &amp; rules
            </a>
          </p>
        </div>
      </details>

      <div className="overflow-hidden rounded-2xl bg-white/[0.03] shadow-soft">
        {/* Filter Tabs */}
        <div className="border-b border-white/10 px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="font-display text-[20px] lowercase italic leading-none text-white">events</div>
              <div className="text-xs text-white/50">{tx('earnings.filter_by_settlement')}</div>
            </div>

            <div className="flex gap-2 overflow-x-auto">
              {(['all', 'ready', 'pending', 'locked'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`relative inline-flex items-center whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium leading-[18px] transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] ${
                    filter === status
                      ? 'bg-white text-black'
                      : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile View - Cards */}
        <div className="sm:hidden divide-y divide-white/10">
          {filteredEvents.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <svg
                className="mx-auto h-12 w-12 text-white/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="mt-4 text-white/50">{tx('earnings.no_events_for_filter')}</p>
            </div>
          ) : (
            filteredEvents.map((event) => (
              <div key={event.eventId} className="p-4 hover:bg-white/[0.07]">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate font-semibold text-white">{event.eventTitle}</h3>
                    <p className="font-mono tabular-nums text-sm text-white/50 mt-1">
                      {new Date(event.eventDate).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusChip
                    tone={settlementTone[event.settlementStatus] ?? 'neutral'}
                    className="ml-2 whitespace-nowrap"
                  >
                    {event.settlementStatus}
                  </StatusChip>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                  <div>
                    <div className="label-mono uppercase text-white/50">{tx('earnings.gross_sales_title')}</div>
                    <div className="font-mono tabular-nums font-medium">
                      {formatCurrency(event.grossSales, event.currency || undefined)}
                    </div>
                  </div>
                  <div>
                    <div className="label-mono uppercase text-white/50">{tx('earnings.net_amount_title')}</div>
                    <div className="font-mono tabular-nums font-medium">
                      {formatCurrency(event.netAmount, event.currency || undefined)}
                    </div>
                  </div>
                  <div>
                    <div className="label-mono uppercase text-white/50">{tx('earnings.available')}</div>
                    <div className="font-mono tabular-nums font-semibold text-emerald-300">
                      {formatCurrency(event.availableToWithdraw, event.currency || undefined)}
                    </div>
                  </div>
                  <div className="flex items-end justify-end">
                    <Link
                      href={`/organizer/events/${event.eventId}/earnings`}
                      className="text-brand-300 hover:text-brand-300 font-medium"
                    >
                      View Details →
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop View - Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className="px-6 py-3 text-left text-xs label-mono text-white/50 uppercase">
                  {tx('actions.event')}
                </th>
                <th className="px-6 py-3 text-left text-xs label-mono text-white/50 uppercase">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs label-mono text-white/50 uppercase">
                  {tx('earnings.gross_sales_title')}
                </th>
                <th className="px-6 py-3 text-right text-xs label-mono text-white/50 uppercase">
                  {tx('earnings.net_amount_title')}
                </th>
                <th className="px-6 py-3 text-right text-xs label-mono text-white/50 uppercase">
                  {tx('earnings.available')}
                </th>
                <th className="px-6 py-3 text-center text-xs label-mono text-white/50 uppercase">
                  {tx('actions.status')}
                </th>
                <th className="px-6 py-3 text-center text-xs label-mono text-white/50 uppercase">
                  {tx('actions.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <svg
                      className="mx-auto h-12 w-12 text-white/40"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="mt-4 text-white/50">{tx('earnings.no_events_for_filter')}</p>
                  </td>
                </tr>
              ) : (
                filteredEvents.map((event) => (
                  <tr key={event.eventId} className="hover:bg-white/[0.07]">
                    <td className="px-6 py-4">
                      <div className="font-medium text-white">{event.eventTitle}</div>
                    </td>
                    <td className="px-6 py-4 font-mono tabular-nums text-sm text-white/50 whitespace-nowrap">
                      {new Date(event.eventDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                      {formatCurrency(event.grossSales, event.currency || undefined)}
                    </td>
                    <td className="px-6 py-4 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                      {formatCurrency(event.netAmount, event.currency || undefined)}
                    </td>
                    <td className="px-6 py-4 text-right font-mono tabular-nums font-semibold text-emerald-300 whitespace-nowrap">
                      {formatCurrency(event.availableToWithdraw, event.currency || undefined)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <StatusChip tone={settlementTone[event.settlementStatus] ?? 'neutral'}>
                        {event.settlementStatus}
                      </StatusChip>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Link
                        href={`/organizer/events/${event.eventId}/earnings`}
                        className="text-brand-300 hover:text-brand-300 text-sm font-medium"
                      >
                        {tx('earnings.view_details')}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* The confirmation must restate the SAME figure the request will be
          judged against, not the earnings-summary one. */}
      <PayoutRequestModal
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        currency={payoutRow.currency}
        availableLabel={formatCurrency(payoutRow.availableNowMinor, asCode(payoutRow.currency))}
      />
    </div>
  )
}
