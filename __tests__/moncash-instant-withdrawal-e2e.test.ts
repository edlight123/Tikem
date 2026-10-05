/**
 * End-to-end: organizer MonCash withdrawal, instant (prefunded) and manual.
 *
 * Runs the REAL route handlers — GET /api/organizer/withdraw-moncash/quote and
 * POST /api/organizer/withdraw-moncash — over the REAL lib/earnings, the REAL
 * lib/moncash (token + REST wrappers, error text and all) and the real outcome
 * logic in lib/payouts/moncash-prefunded. Only two boundaries are faked:
 *
 *  - Firestore: an in-memory store with merge semantics, equality queries and
 *    transactions that SERIALIZE (reads see pre-transaction state, writes land
 *    on commit) — the property the double-submit guard relies on. The Firestore
 *    emulator is not usable here (no Java runtime on this machine).
 *  - The network: global fetch is routed to a fake Digicel that serves the
 *    token, PrefundedBalance, Transfert and PrefundedTransactionStatus.
 *
 * Also stubbed, as out of scope: the session (requireAuth), the payout profile
 * loader, the release-ladder gate (its own tests cover it), the OTP step-up
 * store, and the FX rate.
 *
 * No real MonCash endpoint is ever called.
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
// Session, profile, gate, step-up, FX
// ---------------------------------------------------------------------------
const session: { uid: string | null } = { uid: 'org1' }
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => (session.uid ? { user: { id: session.uid }, error: null } : { user: null, error: 'Not authenticated' })),
}))

const profiles: Record<string, any> = {}
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: jest.fn(async (uid: string) => profiles[uid] ?? null),
  getRequiredPayoutProfileIdForEventCountry: (country: any) =>
    ['US', 'CA'].includes(String(country || '').toUpperCase()) ? 'stripe_connect' : 'haiti',
}))

const stepUp = { verified: false, consumed: 0 }
jest.mock('@/lib/firestore/payout', () => ({
  requireRecentPayoutDetailsChangeVerification: jest.fn(async () => {
    if (!stepUp.verified) throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  }),
  consumePayoutDetailsChangeVerification: jest.fn(async () => {
    stepUp.verified = false
    stepUp.consumed++
  }),
}))

const gateMock = jest.fn(async (_input: any): Promise<any> => ({ allowed: true, reviewStatus: null }))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({
  gateHaitiWithdrawal: (i: any) => gateMock(i),
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

jest.mock('@/lib/currency', () => ({ fetchUsdToHtgRate: jest.fn(async () => 130) }))

// lib/earnings imports these; nothing on the withdrawal path calls them.
jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: jest.fn(async () => jest.requireActual('@/types/platform-settings').DEFAULT_PLATFORM_SETTINGS),
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

const NET = 100_000 // 1,000.00 HTG available

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

function seed(opts: { currency?: 'HTG' | 'USD'; net?: number; storedStatus?: string; enabled?: boolean; available?: boolean; optedIn?: boolean } = {}) {
  for (const k of Object.keys(db)) delete db[k]
  currentCurrency = opts.currency || 'HTG'
  const ended = '2026-09-01T23:00:00.000Z'
  coll('events').evt1 = { organizer_id: 'org1', title: 'Konpa Night', currency: opts.currency || 'HTG', country: 'HT', end_datetime: ended, status: 'published' }
  coll('event_earnings').earn1 = {
    eventId: 'evt1',
    organizerId: 'org1',
    currency: opts.currency || 'HTG',
    grossSales: 120_000,
    netAmount: opts.net ?? NET,
    // Deliberately stale, as real rows are: the read path normalizes readiness
    // without persisting it.
    availableToWithdraw: 0,
    withdrawnAmount: 0,
    settlementStatus: opts.storedStatus ?? 'pending',
    settlementReadyDate: ended,
  }
  coll('tickets').t0 = backingTicket(opts.net ?? NET)
  coll('config').payouts = { prefunding: { enabled: opts.enabled ?? true, available: opts.available ?? true } }
  profiles.org1 = {
    status: 'active',
    method: 'mobile_money',
    allowInstantMoncash: opts.optedIn ?? true,
    mobileMoneyDetails: { provider: 'moncash', phoneNumber: '****7294', phoneNumberLast4: '7294' },
  }
  session.uid = 'org1'
  stepUp.verified = false
  stepUp.consumed = 0
  digicel.balanceHtg = 10_000
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

const body = (over: any = {}) => ({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294', ...over })

// Silence the routes' own diagnostic logging.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('instant MonCash withdrawal — happy path', () => {
  it('quote and withdrawal agree; earnings debited once; request completed; ledger split', async () => {
    seed()

    const q = await (await quote(get('http://x/api/organizer/withdraw-moncash/quote?eventId=evt1'))).json()
    expect(q.quote).toMatchObject({
      amountCents: NET,
      currency: 'HTG',
      instantAvailable: true,
      prefundingFeePercent: 0.03,
      feeCents: 3_000,
      payoutAmountCents: 97_000,
      payoutAmountHtgCents: 97_000,
    })

    // Earnings must already be reserved when Transfert goes out.
    let withdrawnAtTransfer: number | null = null
    digicel.onTransfer = () => {
      withdrawnAtTransfer = earnings().withdrawnAmount
    }

    const res = await withdraw(post(body()))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ success: true, instant: true, feeCents: 3_000, payoutAmountHtgCents: 97_000 })

    // Exactly one transfer, of the NET, to the normalized receiver.
    expect(digicel.transfers).toEqual([
      { amount: 970, receiver: '50937007294', desc: 'Tikèm instant withdrawal (evt1)', reference: out.withdrawalId },
    ])
    expect(withdrawnAtTransfer).toBe(NET)

    expect(earnings()).toMatchObject({ withdrawnAmount: NET, availableToWithdraw: 0, settlementStatus: 'locked' })

    const [w] = withdrawals()
    expect(w).toMatchObject({
      id: out.withdrawalId,
      status: 'completed',
      prefundingUsed: true,
      amount: NET,
      feeCents: 3_000,
      payoutAmountHtgCents: 97_000,
      moncashNumber: '50937007294',
      moncashTransactionId: 'TX1',
      confirmedVia: 'transfer',
      // Digicel's 3% of the 970 HTG sent — Tikèm's cost, not its revenue.
      prefundingProviderFeeHtgCents: 2_910,
      prefundingPoolDebitHtgCents: 99_910,
      prefundingPlatformNetHtgCents: 90,
    })
    expect(w.needsReconciliation).toBeUndefined()
  })

  it('USD earnings: fee in USD, transfer converted to HTG', async () => {
    seed({ currency: 'USD', net: 10_000 }) // $100.00
    digicel.balanceHtg = 50_000
    const out = await (await withdraw(post(body({ amount: 10_000 })))).json()
    expect(out).toMatchObject({ instant: true, feeCents: 300, payoutAmountCents: 9_700, payoutAmountHtgCents: 1_261_000 })
    expect(digicel.transfers[0].amount).toBe(12_610)
  })
})

describe('instant MonCash withdrawal — failure handling', () => {
  it('a definitive MonCash rejection releases the reservation', async () => {
    seed()
    digicel.transferMode = 'reject400'
    const res = await withdraw(post(body()))
    expect(res.status).toBe(502)
    expect(digicel.statusCalls).toEqual([])
    expect(earnings()).toMatchObject({ withdrawnAmount: 0, availableToWithdraw: NET, settlementStatus: 'ready' })
    const [w] = withdrawals()
    expect(w.status).toBe('failed')
    expect(w.reservationRolledBackAt).toBeDefined()
  })

  it.each<[TransferMode]>([['error500'], ['network'], ['garbled']])(
    'ambiguous outcome (%s) with no confirmation: reservation KEPT, row held for reconciliation',
    async (mode) => {
      seed()
      digicel.transferMode = mode
      const res = await withdraw(post(body()))
      const out = await res.json()
      expect(res.status).toBe(202)
      expect(out).toMatchObject({ success: true, instant: false, confirming: true })
      expect(digicel.statusCalls).toEqual([out.withdrawalId])
      // No blind refund: the organizer cannot withdraw this money again.
      expect(earnings()).toMatchObject({ withdrawnAmount: NET, availableToWithdraw: 0 })
      const [w] = withdrawals()
      expect(w).toMatchObject({ status: 'processing', needsReconciliation: true })

      // A retry is refused — this is the double payout the old blind rollback allowed.
      digicel.transferMode = 'ok'
      const retry = await withdraw(post(body()))
      expect(retry.status).toBe(400)
      expect(digicel.transfers).toHaveLength(1)
    }
  )

  it('ambiguous outcome that PrefundedTransactionStatus confirms is completed', async () => {
    seed()
    digicel.transferMode = 'error500'
    digicel.statusAnswer = 'successful'
    const res = await withdraw(post(body()))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.instant).toBe(true)
    const [w] = withdrawals()
    expect(w).toMatchObject({ status: 'completed', confirmedVia: 'status_check' })
    expect(earnings().withdrawnAmount).toBe(NET)
  })
})

describe('prefunded pool too small', () => {
  it('falls back to a fee-free manual request without calling Transfert', async () => {
    seed()
    digicel.balanceHtg = 999 // needs 999.10 HTG (970 + Digicel 3%)
    const res = await withdraw(post(body()))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ instant: false, instantFallbackReason: 'insufficient_prefunded_balance' })
    expect(digicel.transfers).toEqual([])
    const [w] = withdrawals()
    expect(w).toMatchObject({ status: 'pending', amount: NET, payoutAmountHtgCents: NET })
    expect(w.feeCents).toBeUndefined()
    expect(earnings().withdrawnAmount).toBe(NET)
  })

  it('an empty pool (balance 0) is never instant', async () => {
    seed()
    digicel.balanceHtg = 0
    const out = await (await withdraw(post(body()))).json()
    expect(out.instant).toBe(false)
    expect(digicel.transfers).toEqual([])
  })
})

describe('double submit', () => {
  it('two concurrent instant requests: one transfer, one debit, the other refused', async () => {
    seed()
    const [a, b] = await Promise.all([withdraw(post(body())), withdraw(post(body()))])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])
    expect(digicel.transfers).toHaveLength(1)
    expect(earnings().withdrawnAmount).toBe(NET)
    expect(withdrawals().filter((w) => w.status === 'completed')).toHaveLength(1)
  })

  it('two concurrent manual requests: one pending, the loser marked failed (not left pending)', async () => {
    seed({ enabled: false, available: false })
    const [a, b] = await Promise.all([withdraw(post(body())), withdraw(post(body()))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(earnings().withdrawnAmount).toBe(NET)
    const rows = withdrawals()
    expect(rows.filter((w) => w.status === 'pending')).toHaveLength(1)
    expect(rows.filter((w) => w.status === 'failed')).toHaveLength(1)
  })
})

describe('eligibility', () => {
  it('prefunding disabled -> pending manual request, no MonCash calls', async () => {
    seed({ enabled: false, available: false })
    const out = await (await withdraw(post(body()))).json()
    expect(out).toMatchObject({ success: true, instant: false })
    expect(digicel.transfers).toEqual([])
    expect(digicel.balanceCalls).toBe(0)
    expect(withdrawals()[0]).toMatchObject({ status: 'pending', moncashNumber: '50937007294' })
    expect(earnings().withdrawnAmount).toBe(NET)
  })

  it('organizer not opted in -> manual, and the quote says so', async () => {
    seed({ optedIn: false })
    const q = await (await quote(get('http://x/q?eventId=evt1'))).json()
    expect(q.quote).toMatchObject({ instantAvailable: false, feeCents: 0, payoutAmountCents: NET })
    const out = await (await withdraw(post(body()))).json()
    expect(out.instant).toBe(false)
    expect(digicel.transfers).toEqual([])
  })

  it('wrong owner is refused before anything is written', async () => {
    seed()
    profiles.intruder = { ...profiles.org1 }
    session.uid = 'intruder'
    const res = await withdraw(post(body()))
    expect(res.status).toBe(403)
    expect(withdrawals()).toEqual([])
    expect(digicel.transfers).toEqual([])
    const q = await quote(get('http://x/q?eventId=evt1'))
    expect(q.status).toBe(403)
  })

  it('unauthenticated is refused', async () => {
    seed()
    session.uid = null
    expect((await withdraw(post(body()))).status).toBe(401)
  })

  it('a release-gate refusal moves no money', async () => {
    seed()
    gateMock.mockResolvedValueOnce({ allowed: false, status: 403, body: { error: 'held', code: 'payout_on_hold' } })
    const res = await withdraw(post(body()))
    expect(res.status).toBe(403)
    expect(withdrawals()).toEqual([])
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('more than available is refused', async () => {
    seed()
    const res = await withdraw(post(body({ amount: NET + 1 })))
    expect(res.status).toBe(400)
    expect(digicel.transfers).toEqual([])
  })
})

describe('destination number', () => {
  it('rejects a non-Haitian / malformed number', async () => {
    seed()
    const res = await withdraw(post(body({ moncashNumber: '+1 305 555 0100' })))
    expect(res.status).toBe(400)
    expect(withdrawals()).toEqual([])
  })

  it('an instant payout to a number other than the profile\'s needs the OTP step-up', async () => {
    seed()
    const res = await withdraw(post(body({ moncashNumber: '3811 2233' })))
    const out = await res.json()
    expect(res.status).toBe(403)
    expect(out).toMatchObject({ requiresVerification: true, code: 'PAYOUT_CHANGE_VERIFICATION_REQUIRED' })
    expect(digicel.transfers).toEqual([])
    expect(earnings().withdrawnAmount).toBe(0)

    stepUp.verified = true
    const ok = await withdraw(post(body({ moncashNumber: '3811 2233' })))
    expect(ok.status).toBe(200)
    expect(digicel.transfers[0].receiver).toBe('50938112233')
    expect(stepUp.consumed).toBe(1)
  })
})
