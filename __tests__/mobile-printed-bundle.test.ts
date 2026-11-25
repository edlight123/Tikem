import {
  batchHeld,
  batchState,
  bundleBreakdown,
  hasSellableBatch,
  heldSeatsFromTickets,
  isAttendeeTicket,
  isUnsoldPrintedTicket,
  printedManageUrl,
  printedSerialOf,
  visibleBatches,
  type PrintedBatchSummary,
} from '../mobile/lib/printedBundle'
import { batchHeldSeats, tallyPhysical } from '@/lib/physical/rules'
import { eventStatLines } from '../mobile/lib/eventStatLines'
import en from '../mobile/locales/en'

const printed = (n: number, extra: Record<string, any> = {}) => ({
  kind: 'physical',
  source: 'physical',
  physical_batch_id: 'b1',
  physical_serial: `FETE-VIP-B1-${String(n).padStart(4, '0')}`,
  tier_id: 'vip',
  tier_name: 'VIP',
  price_paid: 0,
  status: 'printed_unsold',
  ...extra,
})
const online = (extra: Record<string, any> = {}) => ({ tier_name: 'VIP', price_paid: 2000, status: 'valid', ...extra })

describe('which printed tickets are attendees', () => {
  it('lists sold printed tickets, never unsold, voided or released ones', () => {
    expect(isAttendeeTicket(printed(1, { status: 'valid', attendee_name: 'Jean' }))).toBe(true)
    expect(isAttendeeTicket(printed(2))).toBe(false)
    expect(isAttendeeTicket(printed(3, { status: 'voided' }))).toBe(false)
    expect(isAttendeeTicket(printed(4, { status: 'released' }))).toBe(false)
    expect(isAttendeeTicket(online())).toBe(true)
    // An online ticket that was voided/refunded stays listed (struck through), as before.
    expect(isAttendeeTicket(online({ status: 'refunded' }))).toBe(true)
    // A slimmed cached row with no kind is still recognised by its status.
    expect(isUnsoldPrintedTicket({ status: 'printed_unsold' })).toBe(true)
  })

  it('gives the serial for the marker on printed tickets only', () => {
    expect(printedSerialOf(printed(12, { status: 'valid' }))).toBe('FETE-VIP-B1-0012')
    expect(printedSerialOf(online())).toBe('')
  })
})

describe('bundleBreakdown', () => {
  const tiers = [
    { id: 'vip', name: 'VIP', total_quantity: 300 },
    { id: 'ga', name: 'GA', total_quantity: 500 },
  ]
  // 3 online VIP (one refunded), 2 printed VIP sold (one in), 3 unsold, 1 voided
  // (seat held), 1 voided whose seat came back, 1 online GA checked in.
  const tickets = [
    online(),
    online({ checked_in: true, checked_in_at: '2026-11-24T21:00:00Z' }),
    online({ status: 'refunded' }),
    printed(1, { status: 'valid', checked_in: true, checked_in_at: '2026-11-24T21:05:00Z' }),
    printed(2, { status: 'valid' }),
    printed(3),
    printed(4),
    printed(5),
    printed(6, { status: 'voided' }),
    printed(7, { status: 'voided', seat_returned_at: '2026-11-24T00:00:00Z' }),
    { tier_name: 'GA', status: 'confirmed', checked_in: true },
  ]
  // The rollup counts every reserved seat: 2 VIP online + 1 GA + 2 printed sold + 4 held = 9.
  const ticketsSold = 9

  it('without batch data: printed sold count as sold, held seats come out of tickets_sold', () => {
    const b = bundleBreakdown({ ticketsSold, capacity: 800, tickets, tiers })
    expect(b.ticketsSold).toBe(5)
    expect(b.ticketsCheckedIn).toBe(3)
    expect(b.printed).toEqual({ sold: 2, checkedIn: 1, unsold: 4 })
    const vip = b.ticketTypes.find((t) => t.name === 'VIP')!
    expect(vip).toEqual({ name: 'VIP', sold: 4, online: 2, printedSold: 2, printedUnsold: 4, capacity: 300 })
    expect(b.ticketTypes.find((t) => t.name === 'GA')).toEqual({ name: 'GA', sold: 1, online: 1, printedSold: 0, printedUnsold: 0, capacity: 500 })
  })

  it('with batch data: a batch awaiting payment holds its seats too', () => {
    const batches: PrintedBatchSummary[] = [
      {
        batch: { id: 'b1', tier_id: 'vip', tier_name: 'VIP', quantity: 7, status: 'active' },
        counts: { printed: 7, unsold: 3, activated: 2, checkedIn: 1, voided: 2, released: 0, held: 4 },
        heldSeats: 4,
      },
      {
        batch: { id: 'b2', tier_id: 'ga', tier_name: 'GA', quantity: 100, status: 'awaiting_payment' },
        counts: { printed: 0, unsold: 0, activated: 0, checkedIn: 0, voided: 0, released: 0, held: 0 },
        heldSeats: 100,
      },
      {
        batch: { id: 'b3', tier_id: 'ga', tier_name: 'GA', quantity: 100, status: 'cancelled' },
        counts: { printed: 0, unsold: 0, activated: 0, checkedIn: 0, voided: 0, released: 0, held: 0 },
        heldSeats: 0,
      },
    ]
    const b = bundleBreakdown({ ticketsSold: ticketsSold + 100, capacity: 800, tickets, tiers, batches })
    expect(b.ticketsSold).toBe(5)
    expect(b.printed.unsold).toBe(104)
    expect(b.ticketTypes.find((t) => t.name === 'GA')!.printedUnsold).toBe(100)
    expect(b.ticketTypes.find((t) => t.name === 'VIP')!.printedUnsold).toBe(4)
  })

  it('never goes below zero and keeps a ticket whose tier is gone', () => {
    const b = bundleBreakdown({ ticketsSold: 0, capacity: 0, tickets: [printed(1), online({ tier_name: 'Old' })], tiers: [] })
    expect(b.ticketsSold).toBe(0)
    expect(b.ticketTypes.find((t) => t.name === 'Old')).toMatchObject({ sold: 1, capacity: 0 })
  })

  it('agrees with the server on the seats a batch holds', () => {
    const docs = [printed(1), printed(2, { status: 'valid' }), printed(3, { status: 'voided' }), printed(4, { status: 'released', seat_returned_at: 'x' })]
    const { total } = tallyPhysical(docs)
    const batch = { status: 'active', quantity: 4 }
    expect(heldSeatsFromTickets(docs)).toBe(2)
    expect(batchHeldSeats(batch, total)).toBe(2)
    // An older server without heldSeats: the app derives the same from the counts.
    expect(batchHeld({ batch: { id: 'b', ...batch }, counts: total })).toBe(2)
  })
})

describe('batch list helpers', () => {
  const summary = (status: string): PrintedBatchSummary => ({
    batch: { id: status, status, quantity: 100 },
    counts: { printed: 100, unsold: 100, activated: 0, checkedIn: 0, voided: 0, released: 0 },
  })

  it('maps batch status to a dot tone and a label key', () => {
    expect(batchState('active')).toEqual({ key: 'selling', tone: 'live' })
    expect(batchState('ready')).toEqual({ key: 'ready', tone: 'live' })
    expect(batchState('awaiting_payment')).toEqual({ key: 'awaitingPayment', tone: 'pending' })
    expect(batchState('printing').tone).toBe('pending')
    for (const s of ['awaiting_payment', 'paid', 'printing', 'ready', 'active', 'cancelled']) {
      expect((en as any).printedBundle.batchStatus[batchState(s).key]).toEqual(expect.any(String))
    }
  })

  it('hides cancelled batches and offers selling only once a batch can sell', () => {
    expect(visibleBatches([summary('cancelled'), summary('active')]).map((b) => b.batch.id)).toEqual(['active'])
    expect(hasSellableBatch([summary('awaiting_payment'), summary('paid')])).toBe(false)
    expect(hasSellableBatch([summary('ready')])).toBe(true)
    expect(hasSellableBatch(null)).toBe(false)
  })

  it('deep-links to the web page', () => {
    expect(printedManageUrl('ev 1')).toBe('https://www.tikem.co/organizer/events/ev%201/printed')
  })
})

describe('event stat line with printed tickets', () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    let v: any = en
    for (const part of key.split('.')) v = v?.[part]
    let s = String(v ?? key)
    for (const [k, val] of Object.entries(params || {})) s = s.replace(`{${k}}`, String(val))
    return s
  }
  const text = (lines: { value: string; label: string }[][]) =>
    lines.map((l) => l.map((s) => (s.value ? `${s.value} ${s.label}` : s.label)).join(' · '))

  it('says how many of the sold are printed', () => {
    expect(text(eventStatLines(t, 'en', { sold: 220, capacity: 300, checkedIn: 40, sellThrough: null, views: null, printedSold: 88 }))).toEqual([
      '220/300 sold · 88 printed · 40 checked in',
    ])
    expect(text(eventStatLines(t, 'en', { sold: 5, capacity: 0, checkedIn: 0, sellThrough: null, views: null }))).toEqual(['5 sold · 0 checked in'])
  })
})
