/**
 * Shared sell/issue gates (lib/tickets/purchasable.ts) and the MonCash reconcile
 * candidate rules (lib/moncash-reconcile.ts).
 *
 * @jest-environment node
 */
import {
  MAX_TICKETS_PER_ORDER,
  checkEventPurchasable,
  checkTierForEvent,
  normalizeTierLines,
  parseTicketQuantity,
  pickTierWhenUnspecified,
  validateStoredOrderLines,
} from '@/lib/tickets/purchasable'
import { selectReconcileCandidates } from '@/lib/moncash-reconcile'

const NOW = new Date('2026-10-05T12:00:00.000Z')

describe('parseTicketQuantity', () => {
  it.each([1, 2, 10, MAX_TICKETS_PER_ORDER])('accepts whole number %p', (q) => {
    expect(parseTicketQuantity(q)).toBe(q)
  })

  it.each([0.01, 1.01, 1.5, 0, -1, -0.5, NaN, Infinity, MAX_TICKETS_PER_ORDER + 1, null, undefined, {}, [], true])(
    'refuses %p (fractional, out of range, or not a number)',
    (q) => {
      expect(parseTicketQuantity(q as any)).toBeNull()
    }
  )

  it('accepts a plain digit string but not a decimal or exponent string', () => {
    expect(parseTicketQuantity('3')).toBe(3)
    expect(parseTicketQuantity('1.5')).toBeNull()
    expect(parseTicketQuantity('1e1')).toBeNull()
    expect(parseTicketQuantity('0x2')).toBeNull()
    expect(parseTicketQuantity('')).toBeNull()
  })

  it('honours a custom max', () => {
    expect(parseTicketQuantity(10, 10)).toBe(10)
    expect(parseTicketQuantity(11, 10)).toBeNull()
  })
})

describe('normalizeTierLines', () => {
  it('drops zero lines and merges duplicate tiers', () => {
    const r = normalizeTierLines([
      { tierId: 'a', quantity: 2 },
      { tierId: 'b', quantity: 0 },
      { tierId: 'a', quantity: 3 },
    ])
    expect(r).toEqual({ ok: true, lines: [{ tierId: 'a', quantity: 5 }] })
  })

  it.each([0.01, 1.01, -1, 'x', NaN])('refuses the WHOLE order when any line has quantity %p', (q) => {
    const r = normalizeTierLines([
      { tierId: 'a', quantity: 1 },
      { tierId: 'b', quantity: q },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_quantity')
  })

  it('refuses a line with a quantity but no tier id', () => {
    const r = normalizeTierLines([{ quantity: 1 }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('tier_not_found')
  })

  it('caps the order total, not just each line', () => {
    const r = normalizeTierLines([
      { tierId: 'a', quantity: MAX_TICKETS_PER_ORDER },
      { tierId: 'b', quantity: 1 },
    ])
    expect(r.ok).toBe(false)
  })

  it('treats a non-array as an empty cart', () => {
    expect(normalizeTierLines(undefined)).toEqual({ ok: true, lines: [] })
  })
})

describe('checkTierForEvent', () => {
  it('accepts an active tier of this event', () => {
    expect(checkTierForEvent({ id: 't', event_id: 'evt1', price: 10 }, 'evt1')).toEqual({ ok: true })
  })

  it('refuses a tier from ANOTHER event exactly like a missing tier', () => {
    const other = checkTierForEvent({ id: 't', event_id: 'evt2', price: 1 }, 'evt1')
    const missing = checkTierForEvent(null, 'evt1')
    expect(other).toEqual(missing)
    expect(other.ok).toBe(false)
    if (!other.ok) {
      expect(other.code).toBe('tier_not_found')
      expect(other.status).toBe(404)
    }
  })

  it('refuses a tier with no event id at all', () => {
    expect(checkTierForEvent({ id: 't', price: 1 }, 'evt1').ok).toBe(false)
  })

  it('refuses an inactive tier', () => {
    const r = checkTierForEvent({ id: 't', event_id: 'evt1', is_active: false }, 'evt1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('tier_inactive')
  })
})

describe('pickTierWhenUnspecified', () => {
  it('legacy event with no tiers prices from the event', () => {
    expect(pickTierWhenUnspecified([], 'evt1')).toEqual({ ok: true, tier: null })
  })

  it('one active tier is used, so its inventory is counted', () => {
    const tier = { id: 'only', event_id: 'evt1' }
    expect(pickTierWhenUnspecified([tier, { id: 'off', event_id: 'evt1', is_active: false }], 'evt1')).toEqual({
      ok: true,
      tier,
    })
  })

  it('several active tiers require the buyer to choose (no lowest-price fallback)', () => {
    const r = pickTierWhenUnspecified(
      [
        { id: 'ga', event_id: 'evt1', price: 10 },
        { id: 'vip', event_id: 'evt1', price: 100 },
      ],
      'evt1'
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('tier_required')
  })

  it('tiers that all are inactive refuse', () => {
    const r = pickTierWhenUnspecified([{ id: 'x', event_id: 'evt1', is_active: false }], 'evt1')
    expect(r.ok).toBe(false)
  })

  it('ignores tiers of other events', () => {
    expect(pickTierWhenUnspecified([{ id: 'x', event_id: 'evt2' }], 'evt1')).toEqual({ ok: true, tier: null })
  })
})

describe('checkEventPurchasable', () => {
  const live = {
    is_published: true,
    rejected: false,
    status: 'published',
    start_datetime: '2026-10-10T20:00:00.000Z',
    end_datetime: '2026-10-11T02:00:00.000Z',
  }

  it('a published, upcoming event is purchasable', () => {
    expect(checkEventPurchasable(live, NOW)).toEqual({ ok: true })
  })

  it('status "published" alone does NOT count: is_published is the only publish signal', () => {
    // Moderation and bans flip is_published off and leave status 'published'.
    const r = checkEventPurchasable({ ...live, is_published: undefined }, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('event_unavailable')
    expect(checkEventPurchasable({ ...live, is_published: false, status: 'published' }, NOW).ok).toBe(false)
  })

  it('refuses an event whose payouts are frozen', () => {
    const r = checkEventPurchasable({ ...live, payouts_frozen: true }, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('event_unavailable')
  })

  it('refuses a cancelled event', () => {
    const r = checkEventPurchasable({ ...live, status: 'cancelled' }, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('event_cancelled')
  })

  it('refuses an unpublished draft', () => {
    const r = checkEventPurchasable({ ...live, is_published: false, status: 'draft' }, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('event_unavailable')
  })

  it('refuses a rejected event even if a stale status says published', () => {
    const r = checkEventPurchasable({ ...live, is_published: false, rejected: true }, NOW)
    expect(r.ok).toBe(false)
  })

  it('refuses an event that has ended', () => {
    const r = checkEventPurchasable(
      { ...live, start_datetime: '2026-09-01T20:00:00Z', end_datetime: '2026-09-02T02:00:00Z' },
      NOW
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('event_ended')
  })

  it('still sells on the night (after start, before end)', () => {
    expect(
      checkEventPurchasable({ ...live, start_datetime: '2026-10-05T10:00:00Z', end_datetime: '2026-10-05T23:00:00Z' }, NOW)
    ).toEqual({ ok: true })
  })

  it('with no end time, allows a day of grace after start, then stops', () => {
    expect(
      checkEventPurchasable({ ...live, end_datetime: null, start_datetime: '2026-10-05T01:00:00Z' }, NOW)
    ).toEqual({ ok: true })
    expect(
      checkEventPurchasable({ ...live, end_datetime: null, start_datetime: '2026-10-03T01:00:00Z' }, NOW).ok
    ).toBe(false)
  })

  it('reads Firestore Timestamp-like dates', () => {
    const past = { toDate: () => new Date('2026-01-01T00:00:00Z') }
    expect(checkEventPurchasable({ ...live, end_datetime: past }, NOW).ok).toBe(false)
    expect(checkEventPurchasable({ ...live, end_datetime: { _seconds: 1893456000 } }, NOW).ok).toBe(true)
  })

  it('refuses a missing event', () => {
    expect(checkEventPurchasable(null, NOW).ok).toBe(false)
  })
})

describe('validateStoredOrderLines (fulfillment re-check)', () => {
  it('accepts whole lines that add up to the order', () => {
    expect(validateStoredOrderLines([{ quantity: 2 }, { quantity: 1 }], 3)).toEqual({ ok: true, total: 3 })
  })

  it('refuses a fractional order quantity (the 0.01-ticket order)', () => {
    expect(validateStoredOrderLines([{ quantity: 0.01 }], 0.01).ok).toBe(false)
  })

  it('refuses 1.01 (which used to issue two tickets)', () => {
    expect(validateStoredOrderLines([{ quantity: 1.01 }], 1.01).ok).toBe(false)
  })

  it('refuses lines that do not add up to the order quantity', () => {
    expect(validateStoredOrderLines([{ quantity: 2 }], 1).ok).toBe(false)
  })

  it('accepts a legacy order with no lines when its quantity is whole', () => {
    expect(validateStoredOrderLines(undefined, 2)).toEqual({ ok: true, total: 2 })
  })
})

describe('selectReconcileCandidates (MonCash stuck orders)', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()
  const MIN = 60 * 1000
  const HOUR = 60 * MIN
  const base = { payment_method: 'moncash', mobile_money_provider: 'moncash' }

  it('picks stale pending orders, not fresh ones', () => {
    const rows = [
      { ...base, order_id: 'fresh', status: 'pending', created_at: ago(2 * MIN) },
      { ...base, order_id: 'stale', status: 'pending', created_at: ago(30 * MIN) },
    ]
    expect(selectReconcileCandidates(rows, now).map((c) => c.tx.order_id)).toEqual(['stale'])
  })

  it('re-checks a recent gateway "not paid" failure (buyer returned before paying)', () => {
    const rows = [
      { ...base, order_id: 'f1', status: 'failed', failure_source: 'gateway_not_paid', created_at: ago(1 * HOUR) },
      // legacy failure without a source, carrying Digicel's words
      { ...base, order_id: 'f2', status: 'failed', failure_reason: 'Transaction Not Found', created_at: ago(1 * HOUR) },
    ]
    expect(selectReconcileCandidates(rows, now).map((c) => [c.tx.order_id, c.kind])).toEqual([
      ['f1', 'failed'],
      ['f2', 'failed'],
    ])
  })

  it('never re-checks our own refund verdicts, refund-flagged, old or exhausted failures', () => {
    const rows = [
      { ...base, order_id: 'mm', status: 'failed', failure_reason: 'amount_mismatch', created_at: ago(HOUR) },
      { ...base, order_id: 'cap', status: 'failed', failure_reason: 'capacity_exceeded', created_at: ago(HOUR) },
      { ...base, order_id: 'nr', status: 'failed', needs_refund: true, created_at: ago(HOUR) },
      { ...base, order_id: 'old', status: 'failed', failure_source: 'gateway_not_paid', created_at: ago(72 * HOUR) },
      {
        ...base,
        order_id: 'tired',
        status: 'failed',
        failure_source: 'gateway_not_paid',
        reconcile_attempts: 6,
        created_at: ago(HOUR),
      },
    ]
    expect(selectReconcileCandidates(rows, now)).toEqual([])
  })

  it('recovers a long-abandoned processing claim, not a live one', () => {
    const rows = [
      { ...base, order_id: 'live', status: 'processing', fulfillment_started_at: ago(30 * 1000), created_at: ago(HOUR) },
      { ...base, order_id: 'dead', status: 'processing', fulfillment_started_at: ago(20 * MIN), created_at: ago(HOUR) },
    ]
    expect(selectReconcileCandidates(rows, now).map((c) => [c.tx.order_id, c.kind])).toEqual([
      ['dead', 'processing'],
    ])
  })

  it('ignores NatCash and other rails', () => {
    const rows = [
      { order_id: 'n', status: 'pending', mobile_money_provider: 'natcash', payment_method: 'natcash', created_at: ago(HOUR) },
      { order_id: 's', status: 'pending', payment_method: 'sogepay', created_at: ago(HOUR) },
    ]
    expect(selectReconcileCandidates(rows, now)).toEqual([])
  })
})
