/**
 * What an organizer can withdraw from ONE event, as the per-event earnings
 * endpoint (/api/organizer/events/{id}/earnings) reports it.
 *
 * Every mobile withdrawal goes through a per-event route
 * (/api/organizer/withdraw-moncash, /api/organizer/withdraw-bank), and those
 * routes validate the requested amount against exactly this row: settlement
 * ready, not held for review, and capped by the release ladder. So this is the
 * authoritative figure for the mobile rail, and the Earnings hub totals it per
 * currency rather than reading the event_earnings history aggregate.
 *
 * Shared by the per-event earnings screen and the Earnings hub so the two can
 * never disagree about the same event.
 */

export type ReleasePreview = {
  releasedNow: boolean
  releasableMinor: number
  availableAt: string | null
  holdHours: number
  reason: string
  tier: 'new' | 'established' | 'pre_event' | string
  reviewStatus: string | null
}

export type EventEarningsRow = {
  availableToWithdraw: number
  currency?: 'HTG' | 'USD' | 'CAD' | 'EUR'
  settlementStatus?: 'pending' | 'ready' | 'locked' | string
  settlementReadyDate?: string | null
  release?: ReleasePreview | null
  lastCalculatedAt?: string | null
  dataSource?: string
  grossSales?: number
  netAmount?: number
  ticketsSold?: number
  totalEarned?: number
  withdrawnAmount?: number
  /** Set when the server holds this balance for admin review: nothing is withdrawable. */
  withdrawalBlocked?: { code: string; storedCurrency?: string; eventCurrency?: string } | null
  /** The MonCash 1,000 HTG floor in this event's currency, computed server-side. */
  moncashMinimum?: { minimumHtgCents: number; minimumMinor: number | null; currency: string; usdToHtgRate: number | null } | null
}

/** Minor units withdrawable from this event right now (0 when anything blocks it). */
export function withdrawableMinor(earnings: EventEarningsRow | null | undefined): number {
  if (!earnings) return 0
  if (earnings.withdrawalBlocked) return 0
  if (earnings.settlementStatus !== 'ready') return 0
  /**
   * The release ladder has the final say, and it is stricter than settlement:
   * an event still inside its post-event hold, one with no end date, or one the
   * payouts team is reviewing has nothing withdrawable no matter what
   * settlement says.
   *
   * `release` absent means the server could not compute it: treat that as
   * unknown and fall back to the old behaviour rather than blocking a payout.
   */
  if (earnings.release && earnings.release.releasedNow === false) return 0
  if (earnings.release && typeof earnings.release.releasableMinor === 'number') {
    return Math.max(0, earnings.release.releasableMinor)
  }

  const net = typeof earnings.netAmount === 'number' && Number.isFinite(earnings.netAmount) ? earnings.netAmount : null
  const withdrawn =
    typeof earnings.withdrawnAmount === 'number' && Number.isFinite(earnings.withdrawnAmount) ? earnings.withdrawnAmount : 0

  if (net != null) return Math.max(0, net - withdrawn)

  // Backwards-compatible fallback if the API doesn't provide netAmount.
  return Math.max(0, Number(earnings.availableToWithdraw || 0))
}

/** The currency an earnings row is denominated in (HTG when unstated). */
export function earningsCurrency(earnings: EventEarningsRow | null | undefined): string {
  return String(earnings?.currency || 'HTG').toUpperCase()
}

/**
 * Sum withdrawable balances PER CURRENCY. Currencies are never added together:
 * an HTG balance and a USD balance are two separate figures with two separate
 * withdrawal paths.
 */
export function totalsByCurrency(
  rows: Array<{ currency: string; amountMinor: number }>
): Array<{ currency: string; amountMinor: number }> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!(r.amountMinor > 0)) continue
    map.set(r.currency, (map.get(r.currency) || 0) + r.amountMinor)
  }
  return Array.from(map.entries())
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => (a.currency === 'HTG' ? -1 : b.currency === 'HTG' ? 1 : a.currency.localeCompare(b.currency)))
}
