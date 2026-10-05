/**
 * Organizer MonCash withdrawal: the 1,000 HTG minimum, and the currency-mismatch
 * guard on stored event_earnings rows.
 *
 * Same harness as moncash-instant-withdrawal-e2e.test.ts (copied, since jest
 * mocks are per-file): REAL route handlers over the REAL lib/earnings and
 * lib/moncash, with an in-memory serializing Firestore and a fake Digicel.
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Fake Firestore
// ---------------------------------------------------------------------------
const db: Record<string, Record<string, any>> = {}
let autoId = 0

function isPlainObject(v: any) {
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
}
function stripUndefined(v: any): any {
  if (!isPlainObject(v)) return v
  const out: any = {}
  for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = stripUndefined(val)
  return out
}
function deepMerge(base: any, patch: any): any {
  const out: any = { ...(base || {}) }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out
}
function coll(name: string) {
  return (db[name] = db[name] || {})
}
function snapOf(name: string, id: string) {
  const data = coll(name)[id]
  return { id, exists: data !== undefined, ref: docRef(name, id), data: () => (data === undefined ? undefined : structuredClone(data)) }
}
function writeDoc(name: string, id: string, data: any, opts?: { merge?: boolean }) {
  const clean = stripUndefined(data)
  coll(name)[id] = opts?.merge ? deepMerge(coll(name)[id], clean) : clean
}
function updateDoc(name: string, id: string, patch: any) {
  if (coll(name)[id] === undefined) throw new Error(`NOT_FOUND ${name}/${id}`)
  coll(name)[id] = { ...coll(name)[id], ...stripUndefined(patch) }
}
function docRef(name: string, id?: string): any {
  const docId = id ?? `auto_${++autoId}`
  if (!docId) throw new Error('documentPath must be a non-empty string')
  return {
    __kind: 'doc',
    id: docId,
    path: `${name}/${docId}`,
    _c: name,
    get: async () => snapOf(name, docId),
    set: async (data: any, opts?: any) => writeDoc(name, docId, data, opts),
    update: async (patch: any) => updateDoc(name, docId, patch),
    create: async (data: any) => {
      if (coll(name)[docId] !== undefined) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      writeDoc(name, docId, data)
    },
    // Subcollections (organizers/{id}/payouts) are flat collections named by path.
    collection: (sub: string) => ({
      doc: (subId?: string) => docRef(`${name}/${docId}/${sub}`, subId),
      get: () => query(`${name}/${docId}/${sub}`).get(),
      where: (f: string, op: string, v: any) => query(`${name}/${docId}/${sub}`).where(f, op, v),
    }),
  }
}
function query(name: string, filters: Array<[string, any]> = [], lim = Infinity): any {
  return {
    __kind: 'query',
    where: (f: string, _op: string, v: any) => query(name, [...filters, [f, v]], lim),
    limit: (n: number) => query(name, filters, n),
    orderBy: () => query(name, filters, lim),
    get: async () => {
      const docs = Object.keys(coll(name))
        .filter((id) => filters.every(([f, v]) => coll(name)[id]?.[f] === v))
        .slice(0, lim)
        .map((id) => snapOf(name, id))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  }
}

// Transactions run one at a time — Firestore's optimistic retries give the
// same serializable outcome for contention on one document.
let txChain: Promise<any> = Promise.resolve()
async function runTransaction(fn: (tx: any) => Promise<any>) {
  const run = async () => {
    const writes: Array<() => void> = []
    const tx = {
      get: async (target: any) => target.get(),
      set: (ref: any, data: any, opts?: any) => void writes.push(() => writeDoc(ref._c, ref.id, data, opts)),
      update: (ref: any, patch: any) => void writes.push(() => updateDoc(ref._c, ref.id, patch)),
    }
    const result = await fn(tx)
    for (const w of writes) w()
    return result
  }
  const p = txChain.then(run, run)
  txChain = p.catch(() => undefined)
  return p
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(name, id),
      where: (f: string, op: string, v: any) => query(name).where(f, op, v),
      limit: (n: number) => query(name).limit(n),
      get: () => query(name).get(),
    }),
    runTransaction: (fn: any) => runTransaction(fn),
  },
}))

// ---------------------------------------------------------------------------
// Session, profile, gate, step-up, FX, platform settings
// ---------------------------------------------------------------------------
const session: { uid: string | null } = { uid: 'org1' }
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () =>
    session.uid ? { user: { id: session.uid, role: 'organizer' }, error: null } : { user: null, error: 'Not authenticated' }
  ),
}))

const profiles: Record<string, any> = {}
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: jest.fn(async (uid: string) => profiles[uid] ?? null),
  getRequiredPayoutProfileIdForEventCountry: (country: any) =>
    ['US', 'CA'].includes(String(country || '').toUpperCase()) ? 'stripe_connect' : 'haiti',
}))

jest.mock('@/lib/firestore/payout', () => ({
  requireRecentPayoutDetailsChangeVerification: jest.fn(async () => {
    throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  }),
  consumePayoutDetailsChangeVerification: jest.fn(async () => {}),
}))

const gateMock = jest.fn(async (_input: any): Promise<any> => ({ allowed: true, reviewStatus: null }))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({
  gateHaitiWithdrawal: (i: any) => gateMock(i),
  previewRelease: jest.fn(async () => null),
  // The shared availability (lib/payouts/availability-server.ts) asks for the
  // organizer's release context; an established organizer, so the ladder
  // releases an event that ended weeks ago.
  loadOrganizerReleaseContext: jest.fn(async (organizerId: string) => ({
    organizerId,
    platformConfig: {},
    override: { forceEstablished: true },
    endedEventIds: new Set<string>(),
    lifetimeGrossMinorByCurrency: {},
    fxWarnings: [],
  })),
}))

const USD_TO_HTG = 130
jest.mock('@/lib/currency', () => ({ fetchUsdToHtgRate: jest.fn(async () => 130) }))

jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: jest.fn(async () => ({
    haiti: { platformFeePercentage: 0.05, settlementHoldDays: 0 },
    usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 0 },
  })),
}))
jest.mock('@/lib/promoters', () => ({ getFundedCommissionForEvent: jest.fn(async () => 0) }))

// ---------------------------------------------------------------------------
// Fake Digicel (fetch boundary)
// ---------------------------------------------------------------------------
type TransferMode = 'ok' | 'reject400' | 'error500' | 'network' | 'garbled'
const digicel = {
  balanceHtg: 10_000, // major units
  transferMode: 'ok' as TransferMode,
  statusAnswer: null as null | string, // transStatus returned for a reference
  transfers: [] as any[],
  statusCalls: [] as string[],
  balanceCalls: 0,
  /** Hook to observe Firestore state at the instant Transfert is called. */
  onTransfer: null as null | ((body: any) => void),
}

function jsonResponse(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const realFetch = global.fetch
beforeAll(() => {
  process.env.MONCASH_CLIENT_ID = 'test-client'
  process.env.MONCASH_SECRET_KEY = 'test-secret'
  process.env.MONCASH_MODE = 'sandbox'
  delete process.env.MONCASH_PREFUNDED_CLIENT_ID
  delete process.env.MONCASH_PREFUNDED_SECRET_KEY
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (!url.startsWith('https://sandbox.moncashbutton.digicelgroup.com/')) {
      throw new Error(`Unexpected outbound call in test: ${url}`)
    }
    if (url.endsWith('/Api/oauth/token')) return jsonResponse(200, { access_token: 'tok', expires_in: 3600 })
    if (url.endsWith('/Api/v1/PrefundedBalance')) {
      digicel.balanceCalls++
      return jsonResponse(200, { path: '/Api/v1/PrefundedBalance', balance: { balance: digicel.balanceHtg, message: 'successful' }, status: 200 })
    }
    if (url.endsWith('/Api/v1/Transfert')) {
      const body = JSON.parse(String(init?.body || '{}'))
      digicel.onTransfer?.(body)
      digicel.transfers.push(body)
      switch (digicel.transferMode) {
        case 'ok':
          digicel.balanceHtg -= body.amount * 1.03
          return jsonResponse(200, {
            path: '/Api/v1/Transfert',
            transfer: { transaction_id: `TX${digicel.transfers.length}`, amount: body.amount, receiver: body.receiver, message: 'successful', desc: body.desc },
            status: 200,
          })
        case 'reject400':
          return jsonResponse(400, { error: 'Bad Request', message: 'Insufficient prefunded balance' })
        case 'error500':
          // The worst case: Digicel paid, then answered with an error.
          digicel.balanceHtg -= body.amount * 1.03
          return jsonResponse(500, { error: 'Internal Server Error' })
        case 'network':
          throw new TypeError('fetch failed')
        case 'garbled':
          return new Response('<html>ok</html>', { status: 200 })
      }
    }
    if (url.endsWith('/Api/v1/PrefundedTransactionStatus')) {
      const body = JSON.parse(String(init?.body || '{}'))
      digicel.statusCalls.push(body.reference)
      if (digicel.statusAnswer === null) return jsonResponse(404, { message: 'Transaction Not Found' })
      return jsonResponse(200, { path: '/Api/v1/PrefundedTransactionStatus', transStatus: digicel.statusAnswer, status: 200 })
    }
    throw new Error(`Unhandled fake Digicel URL: ${url}`)
  }) as any
})
afterAll(() => {
  global.fetch = realFetch
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
import { POST as withdraw } from '@/app/api/organizer/withdraw-moncash/route'
import { GET as quote } from '@/app/api/organizer/withdraw-moncash/quote/route'
import { GET as eventEarningsApi } from '@/app/api/organizer/events/[id]/earnings/route'
import { getEventEarnings, withdrawFromEarnings } from '@/lib/earnings'
import {
  MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
  meetsMoncashWithdrawalMinimum,
  moncashWithdrawalMinimumMinor,
} from '@/lib/payouts/moncash-withdrawal-minimum'

const MIN = MONCASH_MIN_WITHDRAWAL_HTG_CENTS // 1,000.00 HTG
const USD_MIN = Math.ceil(MIN / USD_TO_HTG) // 770 cents = $7.70 → 1,001 HTG

/**
 * The tickets behind a stored net. Withdrawals are now judged against the
 * ticket-derived figure (lib/payouts/availability.ts), so each fixture's ledger
 * row is backed by a sale that nets exactly that amount: buyer incidence (the
 * fee was paid on top, so net = face), checked in by scan.
 */
/** The seeded event's currency — backing tickets are sold in it. */
let currentCurrency = 'HTG'
function backingTicket(netMinor: number, over: Record<string, any> = {}) {
  return {
    event_id: 'evt1',
    currency: (over as any).currency ?? currentCurrency,
    status: 'valid',
    price_paid: netMinor / 100,
    fee_incidence: 'buyer',
    // Buyer incidence exists only on the Stripe rails (the Haitian rails charge
    // face value), so the backing sale is a card sale in the event currency.
    payment_method: 'stripe',
    payment_id: 'pay_backing',
    checked_in: true,
    check_in_method: 'scan',
    ...over,
  }
}

function seed(
  opts: {
    currency?: 'HTG' | 'USD'
    storedCurrency?: 'HTG' | 'USD' | null
    net?: number
    withdrawn?: number
    instant?: boolean
    earningsDoc?: Record<string, any>
    tickets?: Array<Record<string, any>>
  } = {}
) {
  for (const k of Object.keys(db)) delete db[k]
  currentCurrency = opts.currency || 'HTG'
  const ended = '2026-09-01T23:00:00.000Z'
  const currency = opts.currency || 'HTG'
  coll('events').evt1 = { organizer_id: 'org1', title: 'Konpa Night', currency, country: 'HT', end_datetime: ended, status: 'published' }
  const stored: any = {
    eventId: 'evt1',
    organizerId: 'org1',
    grossSales: (opts.net ?? MIN) + 20_000,
    netAmount: opts.net ?? MIN,
    availableToWithdraw: 0,
    withdrawnAmount: opts.withdrawn ?? 0,
    settlementStatus: 'pending',
    settlementReadyDate: ended,
    ...(opts.earningsDoc || {}),
  }
  const storedCurrency = opts.storedCurrency === undefined ? currency : opts.storedCurrency
  if (storedCurrency) stored.currency = storedCurrency
  coll('event_earnings').earn1 = stored
  const tickets = opts.tickets ?? [backingTicket(opts.net ?? MIN)]
  for (const [i, t] of tickets.entries()) coll('tickets')[`t${i}`] = { event_id: 'evt1', status: 'valid', ...t }
  const instant = opts.instant ?? true
  coll('config').payouts = { prefunding: { enabled: instant, available: instant } }
  profiles.org1 = {
    status: 'active',
    method: 'mobile_money',
    allowInstantMoncash: instant,
    mobileMoneyDetails: { provider: 'moncash', phoneNumber: '****7294', phoneNumberLast4: '7294' },
  }
  session.uid = 'org1'
  digicel.balanceHtg = 100_000
  digicel.transferMode = 'ok'
  digicel.statusAnswer = null
  digicel.transfers = []
  digicel.statusCalls = []
  digicel.balanceCalls = 0
  digicel.onTransfer = null
  gateMock.mockClear()
}

function post(body: any) {
  return { json: async () => body, headers: { get: () => null } } as any
}
function get(url: string) {
  return { url, headers: { get: () => null } } as any
}
const earnings = () => coll('event_earnings').earn1
const withdrawals = () => Object.entries(coll('withdrawal_requests')).map(([id, d]) => ({ id, ...(d as any) }))
const body = (amount: number, over: any = {}) => ({ eventId: 'evt1', amount, moncashNumber: '+509 3700 7294', ...over })
const moneyFields = (e: any) => ({
  netAmount: e.netAmount,
  withdrawnAmount: e.withdrawnAmount,
  grossSales: e.grossSales,
  currency: e.currency,
})

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// The shared constant
// ---------------------------------------------------------------------------
describe('moncash-withdrawal-minimum helpers', () => {
  it('is 1,000 HTG, measured in HTG', () => {
    expect(MIN).toBe(100_000)
    expect(meetsMoncashWithdrawalMinimum(99_999, 'HTG')).toBe(false)
    expect(meetsMoncashWithdrawalMinimum(100_000, 'HTG')).toBe(true)
  })

  it('USD converts at the given rate, and the displayed minimum is the smallest passing amount', () => {
    expect(moncashWithdrawalMinimumMinor('USD', 130)).toBe(770)
    expect(meetsMoncashWithdrawalMinimum(769, 'USD', 130)).toBe(false)
    expect(meetsMoncashWithdrawalMinimum(770, 'USD', 130)).toBe(true)
    // An exact division has no off-by-one.
    expect(moncashWithdrawalMinimumMinor('USD', 125)).toBe(800)
    expect(meetsMoncashWithdrawalMinimum(800, 'USD', 125)).toBe(true)
    // No usable rate fails closed.
    expect(meetsMoncashWithdrawalMinimum(1_000_000, 'USD', null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Minimum enforcement
// ---------------------------------------------------------------------------
describe('1,000 HTG minimum — HTG event', () => {
  it.each([[true], [false]])('below the minimum is refused with a code, nothing written (instant=%s)', async (instant) => {
    seed({ net: 500_000, instant })
    const before = moneyFields(earnings())
    const res = await withdraw(post(body(MIN - 1)))
    const out = await res.json()
    expect(res.status).toBe(400)
    expect(out.code).toBe('moncash_below_minimum')
    expect(out.error).toMatch(/1,000 HTG/)
    expect(out.minimum).toMatchObject({ minimumHtgCents: MIN, minimumMinor: MIN, currency: 'HTG' })
    expect(withdrawals()).toEqual([])
    expect(digicel.transfers).toEqual([])
    expect(moneyFields(earnings())).toEqual(before)
  })

  it('the old 50 HTG floor no longer applies: 50 HTG is refused', async () => {
    seed({ net: 500_000 })
    expect((await withdraw(post(body(5_000)))).status).toBe(400)
  })

  it('exactly the minimum is allowed — instant', async () => {
    seed({ net: MIN })
    const res = await withdraw(post(body(MIN)))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ success: true, instant: true })
    expect(digicel.transfers).toHaveLength(1)
    expect(earnings()).toMatchObject({ withdrawnAmount: MIN, availableToWithdraw: 0 })
  })

  it('exactly the minimum is allowed — manual', async () => {
    seed({ net: MIN, instant: false })
    const res = await withdraw(post(body(MIN)))
    expect(res.status).toBe(200)
    expect(withdrawals()[0]).toMatchObject({ status: 'pending', amount: MIN })
    expect(earnings().withdrawnAmount).toBe(MIN)
  })

  it('the quote reports the minimum and refuses a sub-minimum balance', async () => {
    seed({ net: MIN - 1 })
    const q = await (await quote(get('http://x/q?eventId=evt1'))).json()
    expect(q.quote).toMatchObject({
      amountCents: MIN - 1,
      canWithdraw: false,
      code: 'moncash_below_minimum',
      minimum: { minimumHtgCents: MIN, minimumMinor: MIN },
    })

    seed({ net: MIN })
    const ok = await (await quote(get('http://x/q?eventId=evt1'))).json()
    expect(ok.quote).toMatchObject({ amountCents: MIN, canWithdraw: true, code: null })
  })

  it('the earnings API hands mobile the minimum', async () => {
    seed({ net: MIN })
    const res = await eventEarningsApi({} as any, { params: Promise.resolve({ id: 'evt1' }) })
    const out = await res.json()
    expect(out.earnings.moncashMinimum).toMatchObject({ minimumHtgCents: MIN, minimumMinor: MIN, currency: 'HTG' })
    expect(out.earnings.withdrawalBlocked).toBeNull()
  })
})

describe('1,000 HTG minimum — USD event (converted at the quote/withdrawal rate)', () => {
  it.each([[true], [false]])('one cent under the converted minimum is refused (instant=%s)', async (instant) => {
    seed({ currency: 'USD', net: 10_000, instant })
    const res = await withdraw(post(body(USD_MIN - 1)))
    const out = await res.json()
    expect(res.status).toBe(400)
    expect(out.code).toBe('moncash_below_minimum')
    expect(out.minimum).toMatchObject({ minimumHtgCents: MIN, minimumMinor: USD_MIN, currency: 'USD', usdToHtgRate: 130 })
    expect(out.error).toMatch(/7\.70 USD/)
    expect(withdrawals()).toEqual([])
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('exactly the converted minimum is allowed', async () => {
    seed({ currency: 'USD', net: USD_MIN })
    const res = await withdraw(post(body(USD_MIN)))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.instant).toBe(true)
    expect(earnings().withdrawnAmount).toBe(USD_MIN)
  })

  it('the quote converts the floor the same way', async () => {
    seed({ currency: 'USD', net: USD_MIN - 1 })
    const q = await (await quote(get('http://x/q?eventId=evt1'))).json()
    expect(q.quote).toMatchObject({ canWithdraw: false, code: 'moncash_below_minimum', minimum: { minimumMinor: USD_MIN } })
  })
})

describe('no double debit at the minimum', () => {
  it('two concurrent instant requests of the minimum against 1.5x the minimum: one debit', async () => {
    seed({ net: 150_000 })
    const [a, b] = await Promise.all([withdraw(post(body(MIN))), withdraw(post(body(MIN)))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(digicel.transfers).toHaveLength(1)
    expect(earnings().withdrawnAmount).toBe(MIN)
  })

  it('two concurrent manual requests: one pending, loser failed, one debit', async () => {
    seed({ net: 150_000, instant: false })
    const [a, b] = await Promise.all([withdraw(post(body(MIN))), withdraw(post(body(MIN)))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(earnings().withdrawnAmount).toBe(MIN)
    const rows = withdrawals()
    expect(rows.filter((w) => w.status === 'pending')).toHaveLength(1)
    expect(rows.filter((w) => w.status === 'failed')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Currency mismatch between the stored row and the event
// ---------------------------------------------------------------------------
describe('stored earnings row in a different currency than the event', () => {
  // HTG event, but the stored row is labelled USD (e.g. Stripe's charged
  // currency). Tickets say 2,000 HTG gross.
  const mismatched = (over: any = {}) =>
    seed({
      currency: 'HTG',
      storedCurrency: 'USD',
      net: 300_000,
      withdrawn: 0,
      tickets: [{ price_paid: 2_000, payment_method: 'moncash', payment_id: 'p1' }],
      ...over,
    })

  it('the read path shows derived figures but ZERO withdrawable, with a review flag', async () => {
    mismatched({ withdrawn: 5_000 })
    const e = await getEventEarnings('evt1')
    expect(e).toMatchObject({
      currency: 'HTG',
      dataSource: 'tickets_derived',
      grossSales: 200_000,
      availableToWithdraw: 0,
      withdrawalBlocked: { code: 'earnings_currency_review', storedCurrency: 'USD', eventCurrency: 'HTG' },
    })
  })

  it('the page, quote and earnings API all agree with the route: nothing available', async () => {
    mismatched()
    const q = await (await quote(get('http://x/q?eventId=evt1'))).json()
    expect(q.quote).toMatchObject({ amountCents: 0, canWithdraw: false, code: 'earnings_currency_review' })

    const api = await (await eventEarningsApi({} as any, { params: Promise.resolve({ id: 'evt1' }) })).json()
    expect(api.earnings.withdrawalBlocked).toMatchObject({ code: 'earnings_currency_review' })
    expect(api.earnings.availableToWithdraw).toBe(0)
  })

  it.each([[true], [false]])('the withdrawal is refused for admin review; no money moves (instant=%s)', async (instant) => {
    mismatched({ instant })
    const before = moneyFields(earnings())
    const res = await withdraw(post(body(MIN)))
    const out = await res.json()
    expect(res.status).toBe(409)
    expect(out).toMatchObject({ code: 'earnings_currency_review', needsAdminReview: true })
    expect(withdrawals()).toEqual([])
    expect(digicel.transfers).toEqual([])
    expect(moneyFields(earnings())).toEqual(before)
    // Flagged for an admin, money fields untouched.
    expect(earnings().currencyReview).toMatchObject({ status: 'needs_admin_review', storedCurrency: 'USD', eventCurrency: 'HTG' })
  })

  it('also refused when there are no tickets to derive from', async () => {
    mismatched({ tickets: [] })
    const e = await getEventEarnings('evt1')
    expect(e).toMatchObject({ currency: 'HTG', availableToWithdraw: 0, withdrawalBlocked: { code: 'earnings_currency_review' } })
    expect((await withdraw(post(body(MIN)))).status).toBe(409)
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('concurrent submits on a mismatched row: both refused, zero debits', async () => {
    mismatched()
    const [a, b] = await Promise.all([withdraw(post(body(MIN))), withdraw(post(body(MIN)))])
    expect([a.status, b.status]).toEqual([409, 409])
    expect(earnings().withdrawnAmount).toBe(0)
    expect(withdrawals()).toEqual([])
  })

  it('withdrawFromEarnings itself refuses a mismatched row (backstop for other callers, e.g. bank)', async () => {
    mismatched()
    const r = await withdrawFromEarnings('evt1', MIN, 'payout_x', { ceilingMinor: 300_000 })
    expect(r).toMatchObject({ success: false, code: 'earnings_currency_review' })
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('the reservation transaction re-checks the snapshot it debits', async () => {
    // Validation read a consistent row; the row is relabelled before the debit.
    seed({ net: 300_000 })
    digicel.onTransfer = () => {
      throw new Error('must not transfer')
    }
    gateMock.mockImplementationOnce(async () => {
      earnings().currency = 'USD'
      return { allowed: true, reviewStatus: null }
    })
    const res = await withdraw(post(body(MIN)))
    const out = await res.json()
    expect(res.status).toBe(409)
    expect(out.code).toBe('earnings_currency_review')
    expect(earnings().withdrawnAmount).toBe(0)
    expect(digicel.transfers).toEqual([])
  })

  it('a row with no stored currency is legacy event-currency data, not a mismatch', async () => {
    seed({ storedCurrency: null, net: MIN })
    const res = await withdraw(post(body(MIN)))
    expect(res.status).toBe(200)
    expect(earnings().withdrawnAmount).toBe(MIN)
  })
})

describe('validation and debit read the same row', () => {
  it('a legacy row keyed by event_id is debited in place, not shadowed by a new empty row', async () => {
    seed({ net: MIN, instant: false })
    const legacy = { ...earnings() }
    delete legacy.eventId
    legacy.event_id = 'evt1'
    coll('event_earnings').earn1 = legacy

    const res = await withdraw(post(body(MIN)))
    expect(res.status).toBe(200)
    expect(Object.keys(coll('event_earnings'))).toEqual(['earn1'])
    expect(earnings().withdrawnAmount).toBe(MIN)

    // And the balance is now spent: a second request is refused.
    expect((await withdraw(post(body(MIN)))).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// One figure: what the screens show is what the withdrawal accepts
// ---------------------------------------------------------------------------
describe('display and validation agree (lib/payouts/availability.ts)', () => {
  // A 10,000 HTG ticket absorbed by the organizer (fee capped at 750 HTG →
  // nets 9,250 HTG), a refunded 2,000 HTG ticket, and a 1,000 HTG ticket that
  // an APPROVED legacy batch payout already covers. The stored ledger row says
  // something else entirely (an uncapped 10%, refunds never removed) — it must
  // not matter.
  const EXPECTED = 925_000
  // The shipped fee settings (10%, 750 HTG cap) rather than this file's 5% stub.
  const { getPlatformSettings } = jest.requireMock('@/lib/admin/platform-settings')
  let stub: any
  beforeEach(() => {
    stub = getPlatformSettings.getMockImplementation()
    getPlatformSettings.mockImplementation(async () => jest.requireActual('@/types/platform-settings').DEFAULT_PLATFORM_SETTINGS)
  })
  afterEach(() => getPlatformSettings.mockImplementation(stub))

  const seedMixed = (instant: boolean) => {
    seed({
      net: 1_080_000, // the stale event_earnings figure
      instant,
      tickets: [
        backingTicket(0, { price_paid: 10_000, fee_incidence: 'organizer', payment_id: 'p1' }),
        backingTicket(0, { price_paid: 2_000, payment_id: 'p2', status: 'refunded', refund_status: 'approved', refund_amount: 2_000 }),
        backingTicket(0, { price_paid: 1_000, fee_incidence: 'organizer', payment_id: 'p3' }),
      ],
    })
    coll('organizers/org1/payouts').po1 = { status: 'approved', ticketIds: ['t2'], amount: 90_000, currency: 'HTG' }
  }

  it.each([[true], [false]])('earnings API, mobile, quote and route all agree on one number (instant=%s)', async (instant) => {
    seedMixed(instant)
    const api = await (await eventEarningsApi({} as any, { params: Promise.resolve({ id: 'evt1' }) })).json()
    expect(api.earnings).toMatchObject({
      availableToWithdraw: EXPECTED,
      netAmount: 1_015_000,
      withdrawnAmount: 90_000,
      platformFee: 85_000,
      refundedAmount: 200_000,
      settlementStatus: 'ready',
      dataSource: 'availability',
      release: { releasedNow: true, releasableMinor: EXPECTED },
    })
    // The mobile hub/per-event screen read exactly this field chain.
    const { withdrawableMinor } = jest.requireActual('../mobile/lib/eventEarnings')
    expect(withdrawableMinor(api.earnings)).toBe(EXPECTED)

    const q = await (await quote(get('http://x/q?eventId=evt1'))).json()
    expect(q.quote.amountCents).toBe(EXPECTED)

    // One cent more is refused, nothing written.
    const over = await withdraw(post(body(EXPECTED + 1)))
    expect(over.status).toBe(400)
    expect((await over.json()).error).toMatch(/Available: 9250\.00 HTG/)
    expect(withdrawals()).toEqual([])

    // Exactly the displayed figure is accepted, and debited once.
    const ok = await withdraw(post(body(EXPECTED)))
    expect(ok.status).toBe(200)
    expect(earnings().withdrawnAmount).toBe(EXPECTED)

    // Afterwards every surface agrees there is nothing left.
    const after = await (await eventEarningsApi({} as any, { params: Promise.resolve({ id: 'evt1' }) })).json()
    expect(after.earnings.availableToWithdraw).toBe(0)
    expect((await withdraw(post(body(MIN)))).status).toBe(400)
  })

  it('the gate is fed the same gross / refund / balance figures the screen used', async () => {
    seedMixed(false)
    await withdraw(post(body(EXPECTED)))
    expect(gateMock).toHaveBeenCalledWith(
      expect.objectContaining({ grossMinor: 1_300_000, refundedMinor: 200_000, availableMinor: EXPECTED, requestedAmountMinor: EXPECTED })
    )
  })
})

// ---------------------------------------------------------------------------
// F1: the first withdrawal on an event with NO ledger row creates exactly one
// ---------------------------------------------------------------------------
describe('concurrent first withdrawals (no event_earnings row yet)', () => {
  it.each([[true], [false]])('one row is created, one withdrawal succeeds, one debit (instant=%s)', async (instant) => {
    seed({ net: 150_000, instant })
    delete coll('event_earnings').earn1 // legacy event: sales only in tickets
    const [a, b] = await Promise.all([withdraw(post(body(MIN))), withdraw(post(body(MIN)))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const rows = Object.entries(coll('event_earnings'))
    expect(rows).toHaveLength(1)
    expect(rows[0][0]).toBe('evt1') // deterministic id
    expect((rows[0][1] as any).withdrawnAmount).toBe(MIN)
    // Seeded from the tickets, so history is kept and the cap is armed.
    expect(rows[0][1]).toMatchObject({ grossSales: 150_000, seededFromTickets: true, grossSalesComplete: true })
  })
})

// ---------------------------------------------------------------------------
// S2: money inputs come from server-written records, not the editable event
// ---------------------------------------------------------------------------
describe('route refuses integrity-flagged events', () => {
  it.each([[true], [false]])('event re-labelled to another currency than its tickets: 409, nothing moves (instant=%s)', async (instant) => {
    seed({ net: 300_000, instant })
    coll('tickets').t0.currency = 'USD' // sold in USD, event says HTG
    const before = moneyFields(earnings())
    const res = await withdraw(post(body(MIN)))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ticket_currency_review')
    expect(withdrawals()).toEqual([])
    expect(digicel.transfers).toEqual([])
    expect(moneyFields(earnings())).toEqual(before)
    const api = await (await eventEarningsApi({} as any, { params: Promise.resolve({ id: 'evt1' }) })).json()
    expect(api.earnings).toMatchObject({ availableToWithdraw: 0, withdrawalBlocked: { code: 'ticket_currency_review' } })
  })

  it('ticket gross above a complete ledger gross: 409, nothing moves', async () => {
    seed({ net: 300_000, earningsDoc: { grossSales: 200_000, grossSalesComplete: true } })
    const res = await withdraw(post(body(MIN)))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ledger_gross_exceeded')
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('the gate judges the server-stamped end, not an end_datetime moved earlier', async () => {
    seed({ net: 300_000, instant: false })
    coll('tickets').t0.end_datetime = '2026-09-30T23:00:00.000Z' // sold for this end
    coll('events').evt1.end_datetime = '2026-01-01T00:00:00.000Z' // edited afterwards
    await withdraw(post(body(MIN)))
    expect(gateMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventData: expect.objectContaining({ end_datetime: '2026-09-30T23:00:00.000Z' }) })
    )
  })
})
