/**
 * Static guards for the payout trust boundary.
 *
 * The rules emulator cannot run here (no Java runtime, and
 * @firebase/rules-unit-testing is not installed), so these read the source:
 *
 *  - S1: firestore.rules lets the event owner update a ticket ONLY through the
 *    same check-in whitelist as door staff. An unrestricted owner update let an
 *    organizer rewrite price_paid / status / fee_incidence / payment fields,
 *    which lib/payouts/availability.ts computes the withdrawable balance from.
 *    Every client ticket write in the apps must fit inside that whitelist.
 *  - S2: cancellation / payout freeze are client-immutable on the event, and
 *    currency/country are fixed once tickets have sold.
 *  - F2: the Haitian rails stamp fee_incidence 'organizer' from the payment,
 *    never from the client-editable event setting.
 *
 * The behavioural rules check is a manual step before deploy (see report):
 * `firebase emulators:exec` with a rules test, or the Rules Playground.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const CHECK_IN_FIELDS = [
  'checked_in',
  'checked_in_at',
  'checked_in_by',
  'entry_point',
  'check_in_method',
  'updated_at',
  'reentry_override',
]

function ticketsBlock(rules: string): string {
  const start = rules.indexOf('match /tickets/{ticketId}')
  const end = rules.indexOf('match /ticket_tiers/{tierId}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return rules.slice(start, end)
}

describe('firestore.rules — tickets (S1)', () => {
  const block = ticketsBlock(read('firestore.rules'))
  const update = block.slice(block.indexOf('allow update'))

  it('has exactly one update rule, and it is bounded by hasOnly for owner AND staff', () => {
    expect(block.match(/allow update/g)).toHaveLength(1)
    // The owner may not sit in an OR beside the whitelist.
    expect(update).toMatch(/\(isEventOwner\(ticketEventId\(\)\) \|\| canCheckin\(ticketEventId\(\)\)\) &&\s*request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(/)
  })

  it('whitelists exactly the check-in fields', () => {
    const list = update.slice(update.indexOf('hasOnly(['), update.indexOf('])'))
    const keys = Array.from(list.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort()
    expect(keys).toEqual([...CHECK_IN_FIELDS].sort())
  })

  it('no money field is writable by a client', () => {
    for (const f of ['price_paid', 'status', 'fee_incidence', 'buyer_fee_charged', 'refund_face_amount', 'payment_id', 'payment_method', 'refund_status', 'currency', 'original_currency', 'end_datetime']) {
      expect(update).not.toContain(`'${f}'`)
    }
  })

  it('a transferred ticket (qr_version >= 1) never checks in by a direct client write', () => {
    // Only the server can judge WHICH code was scanned (lib/tickets/qr.ts).
    expect(update).toMatch(/\]\) &&\s*(\/\/[^\n]*\n\s*)*resource\.data\.get\('qr_version', 0\) == 0;/)
  })

  it('clients may not create or delete tickets', () => {
    expect(block).toMatch(/allow create: if false;/)
    expect(block).not.toMatch(/allow (delete|write)/)
  })

  // Check-in now goes through the transactional server endpoint
  // (POST /api/staff/events/:id/check-in), so current mobile code writes no
  // ticket fields itself. The rule's check-in whitelist stays for builds
  // already in the field.
  it('the current mobile app makes no direct client ticket writes', () => {
    for (const f of ['mobile/screens/organizer/TicketScannerScreen.tsx', 'mobile/screens/organizer/EventAttendeesScreen.tsx']) {
      const src = read(f)
      expect(src).not.toMatch(/(updateDoc|setDoc|deleteDoc)\(doc\(db, 'tickets'/)
      expect(src).toContain('postCheckIn')
    }
  })
})

describe('firestore.rules — events (S2)', () => {
  const rules = read('firestore.rules')
  const events = rules.slice(rules.indexOf('match /events/{eventId}'), rules.indexOf('match /members/{memberId}'))
  it('payout freeze and cancellation cannot be undone from a client', () => {
    expect(events).toContain("request.resource.data.get('payouts_frozen', false) == resource.data.get('payouts_frozen', false)")
    expect(events).toContain("(resource.data.get('status', '') != 'cancelled' || request.resource.data.get('status', '') == 'cancelled')")
  })
  it('tickets_sold is the server counter: created at 0, never changed by a client', () => {
    const create = events.slice(events.indexOf('allow create'), events.indexOf('allow update'))
    expect(create).toContain("request.resource.data.get('tickets_sold', 0) == 0")
    expect(events).toContain("request.resource.data.get('tickets_sold', 0) == resource.data.get('tickets_sold', 0)")
  })
  it('an event that sold, was cancelled or frozen cannot be deleted (and re-created clean)', () => {
    const del = events.slice(events.indexOf('allow delete'))
    expect(del).toContain("resource.data.get('tickets_sold', 0) == 0")
    expect(del).toContain("resource.data.get('status', '') != 'cancelled'")
    expect(del).toContain("resource.data.get('payouts_frozen', false) != true")
  })
  it('currency and country are fixed once tickets have sold', () => {
    expect(events).toContain("resource.data.get('tickets_sold', 0) == 0 ||")
    expect(events).toContain("request.resource.data.get('currency', null) == resource.data.get('currency', null)")
  })
})

describe('Haitian rails stamp fee_incidence from the payment (F2)', () => {
  // Pass-on now reaches MonCash: initiate prices the buyer total and stamps the
  // incidence on the ORDER; fulfillment reads it from there. It must never come
  // from the event's client-editable setting.
  it('fulfillment stamps the ORDER-recorded incidence on every ticket write', () => {
    const src = read('lib/tickets/fulfillment.ts')
    expect(src.match(/fee_incidence: feeIncidence,/g)).toHaveLength(2)
    expect(src).toContain("pendingTx.fee_incidence === 'buyer'")
    expect(src).not.toContain('incidenceForEvent')
    expect(src).not.toMatch(/eventDetails\??\.fee_incidence/)
  })
  it('every ticket write also carries the server-only buyer_fee_charged proof the payout engine requires', () => {
    const src = read('lib/tickets/fulfillment.ts')
    expect(src.match(/buyer_fee_charged: buyerFeeChargedMinor,/g)).toHaveLength(2)
    // 'buyer' is stamped only when the proof is there.
    expect(src).toContain("const feeIncidence: 'buyer' | 'organizer' = buyerFeeChargedMinor > 0 ? 'buyer' : 'organizer'")
  })
  it('SogePay initiate prices pass-on and records it on the order like MonCash', () => {
    const src = read('app/api/sogepay/initiate/route.ts')
    expect(src).toContain('priceOrderCents(')
    expect(src).toContain('fee_incidence: feeIncidence,')
    expect(src).toContain('buyer_fee_original:')
    expect(src).toContain('amount: chargeAmount,')
  })
  it('the MonCash return issues tickets only through the shared pipeline', () => {
    const src = read('app/api/moncash-button/return/route.ts')
    expect(src).toContain('fulfillPaidOrder(')
    expect(src).not.toContain('fee_incidence')
  })
  it('the MonCash callback no longer issues tickets itself or reads the event setting', () => {
    const src = read('app/api/moncash/callback/route.ts')
    expect(src).not.toContain('incidenceForEvent')
    expect(src).toContain('fulfillPaidOrder(')
    expect(src).not.toContain("from('tickets').insert")
  })
})
