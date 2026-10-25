/**
 * MonCash prefunding planner (lib/payouts/prefunding-plan.ts) and the Haiti
 * business-time helpers it stands on. Pure: no Firestore, no MonCash.
 *
 * @jest-environment node
 */

import {
  bucketEvent,
  computePrefundingPlan,
  poolBelowMinimumNeed,
  roundDownHtg,
  roundUpHtg,
  validateRequestAmount,
  type PlanEventInput,
  type PlanWithdrawalInput,
} from '@/lib/payouts/prefunding-plan'
import {
  endOfNthBusinessDayAfter,
  haitiDay,
  haitiParts,
  haitiWallTime,
  nextDigicelCutoff,
  sendByFor,
} from '@/lib/payouts/haiti-business-time'
import { DEFAULT_PREFUNDING_PLAN_CONFIG, resolvePrefundingPlanConfig } from '@/lib/payouts/prefunding-config'
import { computeEventAvailability } from '@/lib/payouts/availability'
import { DEFAULT_PAYOUT_RELEASE_CONFIG } from '@/types/platform-settings'

const H = 3_600_000
const D = 24 * H

// Wednesday 2026-10-21, 10:00 in Port-au-Prince (EDT, UTC-4) = 14:00 UTC.
const WED_10AM = new Date('2026-10-21T14:00:00Z')

const cfg = {
  ...DEFAULT_PREFUNDING_PLAN_CONFIG,
  digicel: { ...DEFAULT_PREFUNDING_PLAN_CONFIG.digicel, merchantAccountNumber: 'M-1', prefundedAccountNumber: 'P-1' },
}

function ev(over: Partial<PlanEventInput> & { eventId: string }): PlanEventInput {
  return {
    title: over.eventId,
    organizerId: 'org1',
    organizerName: 'Org One',
    currency: 'HTG',
    payoutRail: 'moncash',
    balanceMinor: 0,
    availableNowMinor: 0,
    releasedNow: false,
    reason: 'hold_72h',
    availableAt: null,
    effectiveEndsAt: null,
    ...over,
  }
}

/** Ended 5 days ago, released now. */
const released = (id: string, htg: number) =>
  ev({
    eventId: id,
    balanceMinor: htg * 100,
    availableNowMinor: htg * 100,
    releasedNow: true,
    reason: 'eligible',
    effectiveEndsAt: new Date(WED_10AM.getTime() - 5 * D).toISOString(),
    availableAt: new Date(WED_10AM.getTime() - 4 * D).toISOString(),
  })

/** In its hold, releases `inHours` from now. */
const releasing = (id: string, htg: number, inHours: number) =>
  ev({
    eventId: id,
    balanceMinor: htg * 100,
    reason: 'hold_72h',
    effectiveEndsAt: new Date(WED_10AM.getTime() + (inHours - 72) * H).toISOString(),
    availableAt: new Date(WED_10AM.getTime() + inHours * H).toISOString(),
  })

// ── Haiti time ──────────────────────────────────────────────────────────────

describe('Haiti business time', () => {
  it('honours DST: 8 AM Haiti is 12:00 UTC in October and 13:00 UTC in December', () => {
    expect(haitiWallTime('2026-10-26', 8).toISOString()).toBe('2026-10-26T12:00:00.000Z')
    expect(haitiWallTime('2026-12-07', 8).toISOString()).toBe('2026-12-07T13:00:00.000Z')
    expect(haitiParts(new Date('2026-12-07T13:00:00Z')).hour).toBe(8)
  })

  it('a weekday request before 4 PM lands today', () => {
    const c = nextDigicelCutoff(WED_10AM)
    expect(c.sameDay).toBe(true)
    expect(c.processingDay).toBe('2026-10-21')
    expect(c.label).toBe('today 4 PM')
    expect(c.cutoffAt).toBe('2026-10-21T20:00:00.000Z')
  })

  it('a weekday request at or after 4 PM lands the next business day', () => {
    const wed4pm = haitiWallTime('2026-10-21', 16)
    expect(nextDigicelCutoff(wed4pm).processingDay).toBe('2026-10-22')
    expect(nextDigicelCutoff(wed4pm).label).toBe('tomorrow 4 PM')
    const fri5pm = haitiWallTime('2026-10-23', 17)
    const c = nextDigicelCutoff(fri5pm)
    expect(c.processingDay).toBe('2026-10-26')
    expect(c.label).toBe('Monday 4 PM')
  })

  it('a weekend request lands Monday, even before 4 PM', () => {
    const sat10 = haitiWallTime('2026-10-24', 10)
    expect(nextDigicelCutoff(sat10).processingDay).toBe('2026-10-26')
    const sun15 = haitiWallTime('2026-10-25', 15)
    expect(nextDigicelCutoff(sun15).label).toBe('tomorrow 4 PM')
  })

  it('skips configured holidays', () => {
    const fri5pm = haitiWallTime('2026-10-23', 17)
    expect(nextDigicelCutoff(fri5pm, 16, ['2026-10-26']).processingDay).toBe('2026-10-27')
  })

  it('the minimum horizon is the end of the 2nd business day after today', () => {
    // Friday → Monday, Tuesday.
    const fri = haitiWallTime('2026-10-23', 11)
    const end = endOfNthBusinessDayAfter(fri, 2)
    expect(haitiDay(end)).toBe('2026-10-27')
    expect(haitiParts(end).hour).toBe(23)
    // Saturday → also Tuesday.
    expect(haitiDay(endOfNthBusinessDayAfter(haitiWallTime('2026-10-24', 9), 2))).toBe('2026-10-27')
    // Wednesday → Friday.
    expect(haitiDay(endOfNthBusinessDayAfter(WED_10AM, 2))).toBe('2026-10-23')
  })

  it('send-by is the cutoff of the last business day before the release day', () => {
    // Releases Monday 9 AM → send by Friday 4 PM.
    expect(sendByFor(haitiWallTime('2026-10-26', 9)).toISOString()).toBe(haitiWallTime('2026-10-23', 16).toISOString())
    // Releases Thursday 20:00 → send by Wednesday 4 PM.
    expect(sendByFor(haitiWallTime('2026-10-22', 20)).toISOString()).toBe(haitiWallTime('2026-10-21', 16).toISOString())
  })
})

// ── Rounding ────────────────────────────────────────────────────────────────

describe('rounding', () => {
  it('rounds up and down to whole 1,000 HTG', () => {
    expect(roundUpHtg(1, 1000)).toBe(1000)
    expect(roundUpHtg(100_000_00, 1000)).toBe(100_000)
    expect(roundUpHtg(100_000_01, 1000)).toBe(101_000)
    expect(roundDownHtg(100_999_99, 1000)).toBe(100_000)
    expect(roundUpHtg(0, 1000)).toBe(0)
    expect(roundDownHtg(-5, 1000)).toBe(0)
  })
})

// ── Buckets ─────────────────────────────────────────────────────────────────

describe('bucketing', () => {
  const minEnd = endOfNthBusinessDayAfter(WED_10AM, 2) // end of Friday
  const recEnd = new Date(WED_10AM.getTime() + 7 * D)

  it('places events by when their money becomes withdrawable', () => {
    expect(bucketEvent(released('a', 1000), WED_10AM, minEnd, recEnd).bucket).toBe('available_now')
    expect(bucketEvent(releasing('b', 1000, 30), WED_10AM, minEnd, recEnd).bucket).toBe('due_soon')
    expect(bucketEvent(releasing('c', 1000, 24 * 5), WED_10AM, minEnd, recEnd).bucket).toBe('due_week')
    expect(bucketEvent(releasing('d', 1000, 24 * 10), WED_10AM, minEnd, recEnd).bucket).toBe('later')
  })

  it('a pre-event release (event not ended) is not available_now', () => {
    const pre = ev({
      eventId: 'p',
      balanceMinor: 5000_00,
      availableNowMinor: 5000_00,
      releasedNow: true,
      reason: 'eligible',
      effectiveEndsAt: new Date(WED_10AM.getTime() + 2 * D).toISOString(),
    })
    expect(bucketEvent(pre, WED_10AM, minEnd, recEnd).bucket).toBe('pre_event')
  })

  it('held, bank-rail and non-HTG events are excluded', () => {
    expect(bucketEvent(ev({ eventId: 'h', balanceMinor: 1, reason: 'payout_under_review' }), WED_10AM, minEnd, recEnd).bucket).toBe('held')
    expect(bucketEvent(ev({ eventId: 'f', balanceMinor: 1, reason: 'payouts_frozen' }), WED_10AM, minEnd, recEnd).bucket).toBe('held')
    expect(bucketEvent({ ...released('b', 1000), payoutRail: 'bank' }, WED_10AM, minEnd, recEnd).bucket).toBe('bank_rail')
    expect(bucketEvent({ ...released('u', 1000), currency: 'USD' }, WED_10AM, minEnd, recEnd).bucket).toBe('other_currency')
  })
})

// ── The plan ────────────────────────────────────────────────────────────────

describe('computePrefundingPlan', () => {
  it('empty: nothing due, all zeros, no critical warnings', () => {
    const plan = computePrefundingPlan({ now: WED_10AM, events: [], unsentWithdrawals: [], poolBalanceHtg: 0, config: cfg })
    expect(plan.nothingDue).toBe(true)
    expect(plan.minimum.amountHtg).toBe(0)
    expect(plan.recommended.amountHtg).toBe(0)
    expect(plan.maximum.amountHtg).toBe(0)
    expect(plan.warnings.filter((w) => w.severity === 'critical')).toEqual([])
    expect(plan.deadlines).toEqual([])
  })

  it('minimum = 2-business-day owed x 1.03 − pool, rounded up', () => {
    const plan = computePrefundingPlan({
      now: WED_10AM,
      events: [released('a', 40_000), releasing('b', 10_000, 30), releasing('c', 20_000, 24 * 5)],
      unsentWithdrawals: [],
      poolBalanceHtg: 5_000,
      config: cfg,
    })
    // owed soon = 50,000 → 51,500 − 5,000 = 46,500 → 47,000
    expect(plan.minimum.owedMinor).toBe(50_000_00)
    expect(plan.minimum.poolNeedMinor).toBe(51_500_00)
    expect(plan.minimum.amountHtg).toBe(47_000)
    // 7 days: 70,000 x 1.03 x 1.15 = 82,915 − 5,000 = 77,915 → 78,000, capped at max
    expect(plan.recommended.uncappedAmountHtg).toBe(78_000)
    // max: only the released 40,000 → 41,200 − 5,000 = 36,200 → 36,000
    expect(plan.maximum.amountHtg).toBe(36_000)
    expect(plan.recommended.amountHtg).toBe(36_000)
    expect(plan.recommended.cappedAtMaximum).toBe(true)
    expect(plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['recommended_capped', 'minimum_exceeds_maximum']))
    const mx = plan.warnings.find((w) => w.code === 'minimum_exceeds_maximum')!
    expect(mx.severity).toBe('critical')
  })

  it('upcoming and ongoing events never count toward the maximum', () => {
    const plan = computePrefundingPlan({
      now: WED_10AM,
      events: [releasing('upcoming', 100_000, 24 * 6)],
      unsentWithdrawals: [],
      poolBalanceHtg: 0,
      config: cfg,
    })
    expect(plan.maximum.amountHtg).toBe(0)
    expect(plan.recommended.amountHtg).toBe(0) // capped at max 0
    expect(plan.recommended.uncappedAmountHtg).toBeGreaterThan(0)
    expect(plan.nothingDue).toBe(false)
  })

  it('pre-event releases count toward the minimum but not the maximum, with a warning', () => {
    const pre = ev({
      eventId: 'p',
      balanceMinor: 10_000_00,
      availableNowMinor: 10_000_00,
      releasedNow: true,
      reason: 'eligible',
      effectiveEndsAt: new Date(WED_10AM.getTime() + D).toISOString(),
    })
    const plan = computePrefundingPlan({ now: WED_10AM, events: [pre], unsentWithdrawals: [], poolBalanceHtg: 0, config: cfg })
    expect(plan.minimum.amountHtg).toBe(11_000) // 10,300 → 11,000
    expect(plan.maximum.amountHtg).toBe(0)
    expect(plan.warnings.map((w) => w.code)).toContain('pre_event_not_movable')
  })

  it('unsent MonCash withdrawals count in all three numbers', () => {
    const w: PlanWithdrawalInput = { id: 'w1', organizerId: 'o', amountHtgMinor: 20_000_00, status: 'pending' }
    const plan = computePrefundingPlan({ now: WED_10AM, events: [], unsentWithdrawals: [w], poolBalanceHtg: 0, config: cfg })
    expect(plan.unsentWithdrawalsMinor).toBe(20_000_00)
    expect(plan.minimum.amountHtg).toBe(21_000) // 20,600 → 21,000
    expect(plan.maximum.amountHtg).toBe(20_000) // 20,600 → 20,000 (round down)
    // Only rounding separates them → informational, not critical.
    const mx = plan.warnings.find((x) => x.code === 'minimum_exceeds_maximum')!
    expect(mx.severity).toBe('info')
  })

  it('a withdrawal with no HTG amount is warned about and counted as 0', () => {
    const plan = computePrefundingPlan({
      now: WED_10AM,
      events: [],
      unsentWithdrawals: [{ id: 'w', organizerId: 'o', amountHtgMinor: null, status: 'pending' }],
      poolBalanceHtg: 0,
      config: cfg,
    })
    expect(plan.warnings.map((x) => x.code)).toContain('withdrawal_amount_unknown')
    expect(plan.minimum.amountHtg).toBe(0)
  })

  it('subtracts the pool and floors at 0', () => {
    const plan = computePrefundingPlan({
      now: WED_10AM,
      events: [released('a', 10_000)],
      unsentWithdrawals: [],
      poolBalanceHtg: 50_000,
      config: cfg,
    })
    expect(plan.minimum.amountHtg).toBe(0)
    expect(plan.recommended.amountHtg).toBe(0)
    expect(plan.maximum.amountHtg).toBe(0)
    expect(plan.deadlines[0].covered).toBe(true)
    expect(poolBelowMinimumNeed(plan)).toBe(false)
  })

  it('flags a pool below the 2-day need, and money already withdrawable but uncovered', () => {
    const plan = computePrefundingPlan({ now: WED_10AM, events: [released('a', 10_000)], unsentWithdrawals: [], poolBalanceHtg: 1_000, config: cfg })
    expect(poolBelowMinimumNeed(plan)).toBe(true)
    expect(plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['pool_below_minimum_need', 'owed_now_uncovered']))
  })

  it('an unreadable pool balance is a blocking warning', () => {
    const plan = computePrefundingPlan({ now: WED_10AM, events: [released('a', 10_000)], unsentWithdrawals: [], poolBalanceHtg: null, config: cfg })
    const w = plan.warnings.find((x) => x.code === 'pool_balance_unknown')!
    expect(w.blocking).toBe(true)
    expect(plan.poolBalanceHtg).toBeNull()
    expect(poolBelowMinimumNeed(plan)).toBe(false)
  })

  it('warns when a release deadline has already passed (a weekend release seen Saturday)', () => {
    // Saturday 10 AM; money releases Sunday 10 AM. Last cutoff was Friday 4 PM.
    const sat = haitiWallTime('2026-10-24', 10)
    const e = ev({
      eventId: 'sun',
      balanceMinor: 5_000_00,
      reason: 'hold_24h',
      effectiveEndsAt: new Date(sat.getTime() - H).toISOString(),
      availableAt: new Date(sat.getTime() + D).toISOString(),
    })
    const plan = computePrefundingPlan({ now: sat, events: [e], unsentWithdrawals: [], poolBalanceHtg: 0, config: cfg })
    expect(plan.deadlines[0].sendBy).toBe(haitiWallTime('2026-10-23', 16).toISOString())
    expect(plan.warnings.map((w) => w.code)).toContain('deadline_passed')
    expect(plan.cutoff.label).toBe('Monday 4 PM')
  })

  it('held / under-review events are excluded with notes; missing account numbers are warned', () => {
    const plan = computePrefundingPlan({
      now: WED_10AM,
      events: [
        ev({ eventId: 'r', balanceMinor: 7_000_00, reason: 'payout_under_review' }),
        ev({ eventId: 'f', balanceMinor: 3_000_00, reason: 'payouts_frozen' }),
      ],
      unsentWithdrawals: [],
      poolBalanceHtg: 0,
      config: DEFAULT_PREFUNDING_PLAN_CONFIG,
    })
    expect(plan.minimum.amountHtg).toBe(0)
    expect(plan.maximum.amountHtg).toBe(0)
    expect(plan.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['under_review_excluded', 'held_excluded', 'account_numbers_missing'])
    )
  })

  it('settings come from the stored config with defaults for anything missing or invalid', () => {
    const c = resolvePrefundingPlanConfig({ recommendedBufferPercent: 0.3, roundingStepHtg: 'x', digicel: { to: ['bad'], cc: [] } })
    expect(c.recommendedBufferPercent).toBe(0.3)
    expect(c.roundingStepHtg).toBe(1000)
    expect(c.minimumHorizonBusinessDays).toBe(2)
    expect(c.digicel.to).toEqual(['Hai_MFS_Request@digicelgroup.com'])
    expect(c.digicel.cc).toEqual([])
    expect(c.digicel.prefundedAccountName).toBe('PANTHEON SERVICES PREFUNDED')
    expect(c.digicel.signatories[0].name).toBe('Stéphane Lainé')
  })
})

// ── With the real balance engine ────────────────────────────────────────────

describe('fed by computeEventAvailability', () => {
  function ticket(i: number, over: Record<string, any> = {}) {
    return {
      id: `t${i}`,
      event_id: 'e1',
      price_paid: 1000,
      currency: 'HTG',
      status: i % 2 ? 'valid' : 'confirmed',
      payment_id: `pay${i}`,
      purchased_at: new Date(WED_10AM.getTime() - 10 * D).toISOString(),
      fee_incidence: 'organizer',
      checked_in: true,
      check_in_method: 'scan',
      ...over,
    }
  }
  const availability = (withdrawnMinor: number, tickets = Array.from({ length: 10 }, (_, i) => ticket(i))) =>
    computeEventAvailability({
      event: { id: 'e1', currency: 'HTG', country: 'HT', organizer_id: 'org1', end_datetime: new Date(WED_10AM.getTime() - 5 * D).toISOString() },
      tickets,
      fee: { platformFeePercentage: 0.1, legacyCapMinorPerTicket: null },
      ledger: { withdrawnMinor },
      release: {
        history: { completedEvents: 5, lifetimeGrossMinor: 0, currency: 'HTG' },
        config: DEFAULT_PAYOUT_RELEASE_CONFIG,
        reviewStatus: null,
      },
      now: WED_10AM,
    })

  const toInput = (a: ReturnType<typeof availability>): PlanEventInput =>
    ev({
      eventId: a.eventId,
      balanceMinor: a.balanceMinor,
      availableNowMinor: a.availableNowMinor,
      releasedNow: a.releasedNow,
      reason: a.reason,
      availableAt: a.availableAt,
      effectiveEndsAt: a.effectiveEndsAt,
    })

  it("excludes Tikèm's platform fee and subtracts what was already withdrawn", () => {
    const fresh = availability(0)
    expect(fresh.releasedNow).toBe(true)
    expect(fresh.grossMinor).toBe(10_000_00)
    // The organizer's net is below gross: the fee stays with Tikèm.
    expect(fresh.netMinor).toBeLessThan(fresh.grossMinor)
    const paid = availability(3_000_00)
    expect(paid.balanceMinor).toBe(fresh.balanceMinor - 3_000_00)

    const plan = computePrefundingPlan({ now: WED_10AM, events: [toInput(paid)], unsentWithdrawals: [], poolBalanceHtg: 0, config: cfg })
    expect(plan.maximum.movableMinor).toBe(paid.balanceMinor)
    expect(plan.maximum.movableMinor).toBeLessThan(fresh.grossMinor - 3_000_00)
    expect(plan.maximum.amountHtg).toBe(roundDownHtg(Math.floor(paid.balanceMinor * 1.03), 1000))
  })

  it('excludes money under refund review', () => {
    const tickets = Array.from({ length: 10 }, (_, i) => ticket(i, i < 3 ? { refund_status: 'admin_review' } : {}))
    const a = availability(0, tickets)
    const all = availability(0)
    expect(a.balanceMinor).toBeLessThan(all.balanceMinor)
    const plan = computePrefundingPlan({ now: WED_10AM, events: [toInput(a)], unsentWithdrawals: [], poolBalanceHtg: 0, config: cfg })
    expect(plan.maximum.movableMinor).toBe(a.balanceMinor)
  })
})

// ── Custom amount validation ────────────────────────────────────────────────

describe('validateRequestAmount', () => {
  const plan = {
    minimum: { amountHtg: 10_000 } as any,
    maximum: { amountHtg: 50_000 } as any,
    settings: { roundingStepHtg: 1000 } as any,
  }
  it('accepts whole steps between min and max', () => {
    expect(validateRequestAmount(10_000, plan).ok).toBe(true)
    expect(validateRequestAmount(50_000, plan).ok).toBe(true)
  })
  it('refuses below min, above max, off-step, and non-positive', () => {
    expect(validateRequestAmount(9_000, plan).ok).toBe(false)
    expect(validateRequestAmount(51_000, plan).ok).toBe(false)
    expect(validateRequestAmount(10_500, plan).ok).toBe(false)
    expect(validateRequestAmount(0, plan).ok).toBe(false)
    expect(validateRequestAmount(NaN, plan).ok).toBe(false)
  })
  it('when the minimum exceeds the maximum, only the maximum is safe', () => {
    const p = { ...plan, minimum: { amountHtg: 60_000 } as any }
    expect(validateRequestAmount(50_000, p).ok).toBe(true)
    expect(validateRequestAmount(60_000, p).ok).toBe(false)
  })
})
