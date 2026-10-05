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
    for (const f of ['price_paid', 'status', 'fee_incidence', 'payment_id', 'payment_method', 'refund_status', 'currency', 'original_currency', 'end_datetime']) {
      expect(update).not.toContain(`'${f}'`)
    }
  })

  it('clients may not create or delete tickets', () => {
    expect(block).toMatch(/allow create: if false;/)
    expect(block).not.toMatch(/allow (delete|write)/)
  })

  it('every client ticket write in the mobile app fits the whitelist', () => {
    const files = ['mobile/screens/organizer/TicketScannerScreen.tsx', 'mobile/screens/organizer/EventAttendeesScreen.tsx']
    for (const f of files) {
      const src = read(f)
      const idx = src.indexOf("updateDoc(doc(db, 'tickets'")
      expect(idx).toBeGreaterThan(-1)
    }
    // Scanner payload keys.
    const scanner = read('mobile/screens/organizer/TicketScannerScreen.tsx')
    const payload = scanner.slice(scanner.indexOf('const payload: Record<string, any> = {'), scanner.indexOf("const writePromise = updateDoc(doc(db, 'tickets'"))
    const scannerKeys = new Set(
      Array.from(payload.matchAll(/^\s*([a-z_]+):/gm)).map((m) => m[1]).concat(Array.from(payload.matchAll(/payload\.([a-z_]+)\s*=/g)).map((m) => m[1]))
    )
    for (const k of Array.from(scannerKeys)) expect(CHECK_IN_FIELDS).toContain(k)
    // Manual check-in payload keys.
    const attendees = read('mobile/screens/organizer/EventAttendeesScreen.tsx')
    const call = attendees.slice(attendees.indexOf("await updateDoc(doc(db, 'tickets', attendee.id), {"))
    const body = call.slice(0, call.indexOf('});'))
    const keys = Array.from(body.matchAll(/^\s*([a-z_]+):/gm)).map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(CHECK_IN_FIELDS).toContain(k)
  })
})

describe('firestore.rules — events (S2)', () => {
  const rules = read('firestore.rules')
  const events = rules.slice(rules.indexOf('match /events/{eventId}'), rules.indexOf('match /members/{memberId}'))
  it('payout freeze and cancellation cannot be undone from a client', () => {
    expect(events).toContain("request.resource.data.get('payouts_frozen', false) == resource.data.get('payouts_frozen', false)")
    expect(events).toContain("(resource.data.get('status', '') != 'cancelled' || request.resource.data.get('status', '') == 'cancelled')")
  })
  it('currency and country are fixed once tickets have sold', () => {
    expect(events).toContain("resource.data.get('tickets_sold', 0) == 0 ||")
    expect(events).toContain("request.resource.data.get('currency', null) == resource.data.get('currency', null)")
  })
})

describe('Haitian rails stamp fee_incidence from the payment (F2)', () => {
  it.each([
    ['lib/tickets/fulfillment.ts', 2],
    ['app/api/moncash-button/return/route.ts', 2],
  ])('%s stamps organizer incidence on every ticket write', (file, n) => {
    const src = read(file as string)
    expect(src.match(/fee_incidence: 'organizer',/g)).toHaveLength(n as number)
  })
  it('the MonCash callback no longer copies the event setting', () => {
    const src = read('app/api/moncash/callback/route.ts')
    expect(src).not.toContain('incidenceForEvent')
    expect(src).toContain("const feeIncidence = 'organizer' as const")
  })
})
