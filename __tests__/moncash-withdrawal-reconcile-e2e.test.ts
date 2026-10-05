/**
 * End-to-end: the MonCash withdrawal reconciliation cron and withdrawal-outcome
 * notifications.
 *
 * Same harness as __tests__/moncash-instant-withdrawal-e2e.test.ts — the REAL
 * withdraw route, lib/earnings, lib/moncash, lib/payouts/*, the REAL
 * notification modules (helpers -> in-app, notification-triggers -> push,
 * lib/email -> Resend) over a serializing in-memory Firestore and a fake
 * Digicel + fake Resend at the fetch boundary. Only the Expo push sender is
 * replaced by a recorder, which is how "push was actually attempted" is proven:
 * the wrong (in-app-only) module would never reach it.
 *
 * No real MonCash, Resend or Expo endpoint is ever called.
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Fake Firestore (with subcollections + add, which createNotification needs)
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
  return {
    __kind: 'doc',
    id: docId,
    path: `${name}/${docId}`,
    _c: name,
    get: async () => snapOf(name, docId),
    set: async (data: any, opts?: any) => writeDoc(name, docId, data, opts),
    update: async (patch: any) => updateDoc(name, docId, patch),
    collection: (sub: string) => collectionApi(`${name}/${docId}/${sub}`),
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
function collectionApi(name: string): any {
  return {
    doc: (id?: string) => docRef(name, id),
    where: (f: string, op: string, v: any) => query(name).where(f, op, v),
    limit: (n: number) => query(name).limit(n),
    get: () => query(name).get(),
    add: async (data: any) => {
      const ref = docRef(name)
      writeDoc(name, ref.id, data)
      return ref
    },
  }
}

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
    collection: (name: string) => collectionApi(name),
    runTransaction: (fn: any) => runTransaction(fn),
  },
}))

// ---------------------------------------------------------------------------
// Session, profile, gate, step-up, FX, admin audit
// ---------------------------------------------------------------------------
const session: { uid: string | null; admin: boolean } = { uid: 'org1', admin: false }
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => (session.uid ? { user: { id: session.uid }, error: null } : { user: null, error: 'Not authenticated' })),
  requireAdmin: jest.fn(async () =>
    session.admin ? { user: { id: 'admin1', email: 'a@tikem.co' }, error: null } : { user: null, error: 'no' }
  ),
}))

const profiles: Record<string, any> = {}
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: jest.fn(async (uid: string) => profiles[uid] ?? null),
  getRequiredPayoutProfileIdForEventCountry: () => 'haiti',
}))
jest.mock('@/lib/firestore/payout', () => ({
  requireRecentPayoutDetailsChangeVerification: jest.fn(async () => {}),
  consumePayoutDetailsChangeVerification: jest.fn(async () => {}),
}))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({
  gateHaitiWithdrawal: jest.fn(async () => ({ allowed: true, reviewStatus: null })),
  previewRelease: jest.fn(),
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
jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: jest.fn(async () => jest.requireActual('@/types/platform-settings').DEFAULT_PLATFORM_SETTINGS),
}))
jest.mock('@/lib/promoters', () => ({ getFundedCommissionForEvent: jest.fn(async () => 0) }))
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: jest.fn(async () => {}) }))

// The Expo sender is the bottom of the PUSH path (lib/notification-triggers).
const pushes: Array<{ userId: string; title: string; body: string; url?: string; data?: any }> = []
jest.mock('@/lib/push/expo', () => ({
  sendExpoPushNotificationToUser: jest.fn(async (userId: string, title: string, body: string, url?: string, data?: any) => {
    pushes.push({ userId, title, body, url, data })
  }),
}))

// ---------------------------------------------------------------------------
// Fake Digicel + fake Resend (fetch boundary)
// ---------------------------------------------------------------------------
type TransferMode = 'ok' | 'network'
const digicel = {
  balanceHtg: 10_000,
  transferMode: 'ok' as TransferMode,
  /** transStatus for a reference; null = 404 Not Found; 'ERROR500' = the status call itself fails. */
  statusAnswer: null as null | string,
  transfers: [] as any[],
  statusCalls: [] as string[],
}
const emails: Array<{ to: string; subject: string; html: string }> = []

function jsonResponse(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const realFetch = global.fetch
beforeAll(() => {
  process.env.MONCASH_CLIENT_ID = 'test-client'
  process.env.MONCASH_SECRET_KEY = 'test-secret'
  process.env.MONCASH_MODE = 'sandbox'
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.CRON_SECRET = 'cron-secret'
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  delete process.env.MONCASH_PREFUNDED_CLIENT_ID
  delete process.env.MONCASH_PREFUNDED_SECRET_KEY
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url === 'https://api.resend.com/emails') {
      emails.push(JSON.parse(String(init?.body || '{}')))
      return jsonResponse(200, { id: `em_${emails.length}` })
    }
    if (!url.startsWith('https://sandbox.moncashbutton.digicelgroup.com/')) {
      throw new Error(`Unexpected outbound call in test: ${url}`)
    }
    if (url.endsWith('/Api/oauth/token')) return jsonResponse(200, { access_token: 'tok', expires_in: 3600 })
    if (url.endsWith('/Api/v1/PrefundedBalance')) {
      return jsonResponse(200, { balance: { balance: digicel.balanceHtg, message: 'successful' }, status: 200 })
    }
    if (url.endsWith('/Api/v1/Transfert')) {
      const body = JSON.parse(String(init?.body || '{}'))
      digicel.transfers.push(body)
      if (digicel.transferMode === 'network') throw new TypeError('fetch failed')
      return jsonResponse(200, { transfer: { transaction_id: `TX${digicel.transfers.length}`, message: 'successful' }, status: 200 })
    }
    if (url.endsWith('/Api/v1/PrefundedTransactionStatus')) {
      const body = JSON.parse(String(init?.body || '{}'))
      digicel.statusCalls.push(body.reference)
      if (digicel.statusAnswer === null) return jsonResponse(404, { message: 'Transaction Not Found' })
      if (digicel.statusAnswer === 'ERROR500') return jsonResponse(500, { error: 'Internal Server Error' })
      return jsonResponse(200, { transStatus: digicel.statusAnswer, transaction_id: 'TXR1', status: 200 })
    }
    throw new Error(`Unhandled fake URL: ${url}`)
  }) as any
})
afterAll(() => {
  global.fetch = realFetch
})
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
import { POST as withdraw } from '@/app/api/organizer/withdraw-moncash/route'
import { GET as cronGET } from '@/app/api/cron/moncash-withdrawal-reconcile/route'
import { POST as adminPOST } from '@/app/api/admin/withdrawals/[id]/route'
import {
  runWithdrawalReconciliation,
  classifyStatusCheck,
  RECONCILE_RELEASE_GRACE_MS,
} from '@/lib/payouts/withdrawal-reconcile'
import {
  notifyWithdrawalOutcome,
  formatWithdrawalAmount,
  withdrawalNoticesAreTransactional,
} from '@/lib/notifications/withdrawal-outcome'

const NET = 100_000
const MIN = 60 * 1000

/**
 * The tickets behind a stored net. Withdrawals are now judged against the
 * ticket-derived figure (lib/payouts/availability.ts), so each fixture's ledger
 * row is backed by a sale that nets exactly that amount: buyer incidence (the
 * fee was paid on top, so net = face), checked in by scan.
 */
function backingTicket(netMinor: number, over: Record<string, any> = {}) {
  return {
    event_id: 'evt1',
    status: 'valid',
    price_paid: netMinor / 100,
    fee_incidence: 'buyer',
    payment_method: 'moncash',
    payment_id: 'pay_backing',
    checked_in: true,
    check_in_method: 'scan',
    ...over,
  }
}

function seed(opts: { language?: string; autoReleaseNotFound?: boolean } = {}) {
  for (const k of Object.keys(db)) delete db[k]
  const ended = '2026-09-01T23:00:00.000Z'
  coll('events').evt1 = { organizer_id: 'org1', title: 'Konpa Night', currency: 'HTG', country: 'HT', end_datetime: ended, status: 'published' }
  coll('event_earnings').earn1 = {
    eventId: 'evt1',
    organizerId: 'org1',
    currency: 'HTG',
    grossSales: 120_000,
    netAmount: NET,
    availableToWithdraw: 0,
    withdrawnAmount: 0,
    settlementStatus: 'pending',
    settlementReadyDate: ended,
  }
  coll('tickets').t0 = backingTicket(NET)
  coll('config').payouts = {
    prefunding: { enabled: true, available: true },
    ...(opts.autoReleaseNotFound ? { reconcile: { autoReleaseNotFound: true } } : {}),
  }
  coll('users').org1 = { email: 'org@example.com', language: opts.language ?? 'en', role: 'organizer' }
  coll('users').admin1 = { email: 'admin@tikem.co', role: 'admin' }
  coll('users').promo1 = { email: 'promo@example.com', language: 'fr', role: 'attendee' }
  profiles.org1 = {
    status: 'active',
    method: 'mobile_money',
    allowInstantMoncash: true,
    mobileMoneyDetails: { provider: 'moncash', phoneNumberLast4: '7294' },
  }
  session.uid = 'org1'
  session.admin = false
  digicel.balanceHtg = 10_000
  digicel.transferMode = 'ok'
  digicel.statusAnswer = null
  digicel.transfers = []
  digicel.statusCalls = []
  pushes.length = 0
  emails.length = 0
}

function post(body: any) {
  return { json: async () => body, headers: { get: () => null } } as any
}
const earnings = () => coll('event_earnings').earn1
const row = (id: string) => coll('withdrawal_requests')[id]
const inApp = (uid: string) => Object.values(coll(`users/${uid}/notifications`)) as any[]
const pushesFor = (uid: string, outcome?: string) =>
  pushes.filter((p) => p.userId === uid && (!outcome || p.data?.outcome === outcome))

/** An instant withdrawal whose Transfert timed out: flagged, reservation kept. */
async function unconfirmedWithdrawal(): Promise<string> {
  digicel.transferMode = 'network'
  digicel.statusAnswer = null
  const res = await withdraw(post({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294' }))
  const out = await res.json()
  expect(res.status).toBe(202)
  expect(row(out.withdrawalId)).toMatchObject({ status: 'processing', needsReconciliation: true })
  expect(earnings().withdrawnAmount).toBe(NET)
  return out.withdrawalId
}

function reservedAtMs(id: string): number {
  return new Date(row(id).reservedAt).getTime()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('reconcile cron — confirmation', () => {
  it('completes a row MonCash confirms, exactly once, without touching the ledger', async () => {
    seed()
    const id = await unconfirmedWithdrawal()
    // The organizer was told "confirming" by the route — in-app, push and email.
    expect(pushesFor('org1', 'confirming')).toHaveLength(1)
    expect(inApp('org1').filter((n) => n.metadata?.outcome === 'confirming')).toHaveLength(1)
    expect(emails.filter((e) => e.to === 'org@example.com')).toHaveLength(1)

    digicel.statusAnswer = 'successful'
    const now = new Date(reservedAtMs(id) + 12 * MIN)
    const first = await runWithdrawalReconciliation({ now })
    const second = await runWithdrawalReconciliation({ now: new Date(now.getTime() + 10 * MIN) })

    expect(first.results).toEqual([{ withdrawalId: id, action: 'completed' }])
    expect(second.results).toEqual([]) // no longer a candidate
    expect(row(id)).toMatchObject({
      status: 'completed',
      needsReconciliation: false,
      confirmedVia: 'reconcile_cron',
      moncashTransactionId: 'TXR1',
      reconciliationStatusRaw: { transStatus: 'successful', transaction_id: 'TXR1', status: 200 },
    })
    // Debited once at reservation; completing neither re-debits nor refunds.
    expect(earnings()).toMatchObject({ withdrawnAmount: NET, availableToWithdraw: 0 })
    expect(pushesFor('org1', 'completed')).toHaveLength(1)
    expect(pushesFor('org1', 'completed')[0].body).toContain('970 HTG')
  })
})

describe('reconcile cron — definitive failure', () => {
  it('never releases on "not found" while the auto-release switch is off (the default)', async () => {
    seed()
    const id = await unconfirmedWithdrawal()
    const r = await runWithdrawalReconciliation({ now: new Date(reservedAtMs(id) + RECONCILE_RELEASE_GRACE_MS + MIN) })
    expect(r.results[0]).toMatchObject({ withdrawalId: id, detail: 'not_found_auto_release_off' })
    expect(row(id)).toMatchObject({ status: 'processing', needsReconciliation: true })
    expect(earnings().withdrawnAmount).toBe(NET)
  })

  it('waits out the grace period before trusting "not found"', async () => {
    seed()
    const id = await unconfirmedWithdrawal()
    const early = await runWithdrawalReconciliation({ now: new Date(reservedAtMs(id) + 5 * MIN) })
    expect(early.results[0]).toMatchObject({ withdrawalId: id, action: 'waiting_grace' })
    expect(row(id)).toMatchObject({ status: 'processing', needsReconciliation: true, reconciliationAttempts: 1 })
    expect(earnings().withdrawnAmount).toBe(NET)
  })

  it('two overlapping runs release the reservation only once', async () => {
    seed({ autoReleaseNotFound: true })
    const id = await unconfirmedWithdrawal()
    const now = new Date(reservedAtMs(id) + RECONCILE_RELEASE_GRACE_MS + MIN)

    const [a, b] = await Promise.all([
      runWithdrawalReconciliation({ now }),
      runWithdrawalReconciliation({ now }),
    ])
    const actions = [...a.results, ...b.results].map((r) => r.action).sort()
    expect(actions).toEqual(['released', 'skipped'])

    // Credited back exactly once.
    expect(earnings()).toMatchObject({ withdrawnAmount: 0, availableToWithdraw: NET, settlementStatus: 'ready' })
    expect(row(id)).toMatchObject({
      status: 'failed',
      needsReconciliation: false,
      reservationReleasedBy: 'reconcile_cron',
    })
    expect(pushesFor('org1', 'failed')).toHaveLength(1)
    expect(pushesFor('org1', 'failed')[0].body).toContain('1,000 HTG')

    // A third run (or an admin 'fail') cannot credit again.
    await runWithdrawalReconciliation({ now: new Date(now.getTime() + 10 * MIN) })
    session.admin = true
    await adminPOST(post({ withdrawalId: id, action: 'fail' }))
    expect(earnings()).toMatchObject({ withdrawnAmount: 0, availableToWithdraw: NET })
  })

  it('an explicit "failed" status also releases (after grace)', async () => {
    seed()
    const id = await unconfirmedWithdrawal()
    digicel.statusAnswer = 'failed'
    const r = await runWithdrawalReconciliation({ now: new Date(reservedAtMs(id) + 40 * MIN) })
    expect(r.results[0]).toMatchObject({ action: 'released', detail: 'failed' })
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('releases a promoter wallet reservation exactly once', async () => {
    seed({ autoReleaseNotFound: true })
    const t0 = new Date('2026-09-29T10:00:00.000Z')
    coll('promoter_wallets').promo1 = { withdrawn_by_currency: { HTG: 50_000 } }
    coll('withdrawal_requests').pw1 = {
      payee_type: 'promoter',
      promoter_uid: 'promo1',
      organizerId: 'promo1',
      eventId: null,
      amount: 50_000,
      currency: 'HTG',
      method: 'moncash',
      status: 'processing',
      prefundingUsed: true,
      needsReconciliation: true,
      moncashNumber: '50937001111',
      payoutAmountHtgCents: 48_500,
      walletDebits: { HTG: 50_000 },
      createdAt: t0,
      updatedAt: t0,
    }
    const now = new Date(t0.getTime() + 45 * MIN)
    await Promise.all([runWithdrawalReconciliation({ now }), runWithdrawalReconciliation({ now })])
    expect(coll('promoter_wallets').promo1.withdrawn_by_currency.HTG).toBe(0)
    expect(row('pw1').status).toBe('failed')
    // Promoter is told, in their language (fr), with the amount returned.
    const [p] = pushesFor('promo1', 'failed')
    expect(pushesFor('promo1', 'failed')).toHaveLength(1)
    expect(p.title).toBe("Le retrait n'a pas abouti")
    expect(p.url).toBe('/promoter')
  })
})

describe('reconcile cron — ambiguous answers', () => {
  it('leaves the row alone, counts attempts, then escalates to admins once', async () => {
    seed()
    const id = await unconfirmedWithdrawal()
    digicel.statusAnswer = 'pending'
    const t = reservedAtMs(id)

    const r1 = await runWithdrawalReconciliation({ now: new Date(t + 60 * MIN) })
    expect(r1.results[0]).toMatchObject({ action: 'ambiguous' })
    expect(row(id)).toMatchObject({ status: 'processing', needsReconciliation: true, reconciliationAttempts: 1 })
    expect(row(id).reconciliationLastCheckedAt).toBeDefined()
    expect(row(id).reconciliationEscalated).toBeUndefined()

    // A failing status call is just as inconclusive.
    digicel.statusAnswer = 'ERROR500'
    await runWithdrawalReconciliation({ now: new Date(t + 70 * MIN) })
    expect(row(id).reconciliationAttempts).toBe(2)

    digicel.statusAnswer = 'pending'
    const r3 = await runWithdrawalReconciliation({ now: new Date(t + 25 * 60 * MIN) })
    expect(r3.results[0]).toMatchObject({ action: 'escalated' })
    expect(row(id)).toMatchObject({ status: 'processing', needsReconciliation: true, reconciliationEscalated: true })
    await runWithdrawalReconciliation({ now: new Date(t + 26 * 60 * MIN) })

    // Reservation never touched; admins told exactly once.
    expect(earnings().withdrawnAmount).toBe(NET)
    expect(pushesFor('admin1')).toHaveLength(1)
    expect(inApp('admin1')).toHaveLength(1)
    expect(inApp('admin1')[0]).toMatchObject({ type: 'withdrawal_escalated' })
  })
})

describe('reconcile cron — stuck processing', () => {
  function stuckRow(id: string, ageMin: number, over: any = {}) {
    const at = new Date(Date.parse('2026-09-29T12:00:00.000Z') - ageMin * MIN)
    coll('withdrawal_requests')[id] = {
      organizerId: 'org1',
      eventId: 'evt1',
      amount: NET,
      currency: 'HTG',
      method: 'moncash',
      status: 'processing',
      prefundingUsed: true,
      moncashNumber: '50937007294',
      payoutAmountHtgCents: 97_000,
      reservedAt: at,
      reservedCents: NET,
      createdAt: at,
      updatedAt: at,
      ...over,
    }
  }
  const NOW = new Date('2026-09-29T12:00:00.000Z')

  it('flags an abandoned instant row, tells the organizer, and settles it', async () => {
    seed()
    Object.assign(earnings(), { withdrawnAmount: NET, availableToWithdraw: 0 })
    stuckRow('stuck1', 15)
    stuckRow('fresh1', 5) // may still be in flight
    stuckRow('manual1', 60, { prefundingUsed: undefined }) // admin-approved manual row: not ours

    digicel.statusAnswer = 'successful'
    const r = await runWithdrawalReconciliation({ now: NOW })

    expect(r.stuckFlagged).toBe(1)
    expect(r.results).toEqual([{ withdrawalId: 'stuck1', action: 'completed' }])
    expect(row('stuck1')).toMatchObject({ status: 'completed', needsReconciliation: false })
    expect(row('stuck1').reconciliationReason).toMatch(/stuck_processing/)
    expect(row('fresh1').needsReconciliation).toBeUndefined()
    expect(row('manual1')).toMatchObject({ status: 'processing' })
    expect(row('manual1').needsReconciliation).toBeUndefined()
    expect(digicel.statusCalls).toEqual(['stuck1'])
    expect(pushesFor('org1', 'confirming')).toHaveLength(1)
    expect(pushesFor('org1', 'completed')).toHaveLength(1)
    expect(earnings().withdrawnAmount).toBe(NET)
  })

  it('an abandoned row MonCash never saw is released after the grace period', async () => {
    seed({ autoReleaseNotFound: true })
    Object.assign(earnings(), { withdrawnAmount: NET, availableToWithdraw: 0 })
    stuckRow('stuck2', 45)
    digicel.statusAnswer = null
    const r = await runWithdrawalReconciliation({ now: NOW })
    expect(r.results[0]).toMatchObject({ withdrawalId: 'stuck2', action: 'released' })
    expect(earnings()).toMatchObject({ withdrawnAmount: 0, availableToWithdraw: NET })
  })
})

describe('cron route auth', () => {
  it('requires the CRON_SECRET bearer', async () => {
    seed()
    const bad = await cronGET(new Request('http://x/api/cron/moncash-withdrawal-reconcile'))
    expect(bad.status).toBe(401)
    const ok = await cronGET(
      new Request('http://x/api/cron/moncash-withdrawal-reconcile', { headers: { authorization: 'Bearer cron-secret' } })
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ success: true, processed: 0 })
  })
})

describe('withdrawal-outcome notifications', () => {
  it('is transactional (never suppressed by marketing prefs)', async () => {
    expect(withdrawalNoticesAreTransactional()).toBe(true)
    seed()
    coll('users').org1.notify_ticket_purchase = false
    coll('users').org1.notify_organizer_nudges = false
    await notifyWithdrawalOutcome('w_x', 'completed', { row: { organizerId: 'org1', payoutAmountHtgCents: 97_000 } })
    expect(pushesFor('org1', 'completed')).toHaveLength(1)
  })

  it('dedupes per (withdrawal, outcome) and pushes through the push module', async () => {
    seed()
    const r = { organizerId: 'org1', amount: NET, currency: 'HTG', payoutAmountHtgCents: 97_000, moncashNumber: '50937007294' }
    const a = await notifyWithdrawalOutcome('w1', 'completed', { row: r })
    const b = await notifyWithdrawalOutcome('w1', 'completed', { row: r })
    const c = await notifyWithdrawalOutcome('w1', 'failed', { row: r })
    expect(a).toEqual({ sent: true })
    expect(b).toEqual({ sent: false, reason: 'duplicate' })
    expect(c).toEqual({ sent: true })

    // One push per outcome — via lib/notification-triggers -> Expo.
    expect(pushesFor('org1', 'completed')).toHaveLength(1)
    expect(pushesFor('org1', 'failed')).toHaveLength(1)
    expect(pushesFor('org1', 'completed')[0]).toMatchObject({
      title: 'Withdrawal sent',
      url: '/organizer/payouts',
      data: { type: 'withdrawal_update', withdrawalId: 'w1' },
    })
    expect(pushesFor('org1', 'completed')[0].body).toContain('•••• 7294')
    // One in-app entry per outcome, one email per outcome.
    expect(inApp('org1')).toHaveLength(2)
    expect(inApp('org1')[0]).toMatchObject({ type: 'withdrawal_update', title: 'Withdrawal sent' })
    expect(emails).toHaveLength(2)
    expect(emails[0]).toMatchObject({ to: 'org@example.com', subject: 'Withdrawal sent' })
  })

  it('localizes to the saved language (ht) with HTG amounts', async () => {
    seed({ language: 'ht' })
    await notifyWithdrawalOutcome('w2', 'confirming', { row: { organizerId: 'org1', payoutAmountHtgCents: 123_450 } })
    const [p] = pushesFor('org1', 'confirming')
    expect(p.title).toBe('N ap konfime retrè w la')
    expect(p.body).toMatch(/1\s234,50 HTG/)
  })

  it('formats HTG minor units', () => {
    expect(formatWithdrawalAmount(97_000, 'HTG', 'en')).toBe('970 HTG')
    expect(formatWithdrawalAmount(123_450, 'HTG', 'en')).toBe('1,234.50 HTG')
    expect(formatWithdrawalAmount(123_450, 'htg', 'fr')).toMatch(/^1\s234,50 HTG$/)
  })
})

describe('sync route + admin endpoint notifications', () => {
  it('instant success notifies "completed"; manual request notifies "submitted"', async () => {
    seed()
    const res = await withdraw(post({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294' }))
    expect(res.status).toBe(200)
    expect(pushesFor('org1', 'completed')).toHaveLength(1)

    seed()
    coll('config').payouts = { prefunding: { enabled: false, available: false } }
    const res2 = await withdraw(post({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294' }))
    expect(res2.status).toBe(200)
    expect(pushesFor('org1', 'submitted')).toHaveLength(1)
    expect(pushesFor('org1', 'submitted')[0].body).toContain('1,000 HTG')
  })

  it('admin approve / complete / reject each notify once', async () => {
    seed()
    coll('config').payouts = { prefunding: { enabled: false, available: false } }
    const out = await (await withdraw(post({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294' }))).json()
    const id = out.withdrawalId
    session.admin = true

    await adminPOST(post({ withdrawalId: id, action: 'approve' }))
    await adminPOST(post({ withdrawalId: id, action: 'approve' })) // idempotent: no second notice
    await adminPOST(post({ withdrawalId: id, action: 'complete' }))
    expect(pushesFor('org1', 'approved')).toHaveLength(1)
    expect(pushesFor('org1', 'admin_completed')).toHaveLength(1)
    expect(row(id).status).toBe('completed')

    // A second, rejected request.
    Object.assign(earnings(), { withdrawnAmount: 0, availableToWithdraw: NET, settlementStatus: 'ready' })
    session.admin = false
    const out2 = await (await withdraw(post({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294' }))).json()
    session.admin = true
    // A legacy `note` is INTERNAL: stored for admins, never sent to the payee.
    await adminPOST(
      post({ withdrawalId: out2.withdrawalId, action: 'reject', note: 'looks like fraud, checking ID', payeeReasonCode: 'details_mismatch' })
    )
    const [rej] = pushesFor('org1', 'admin_rejected')
    expect(pushesFor('org1', 'admin_rejected')).toHaveLength(1)
    expect(rej.body).toContain("Reason: The payout details don't match your verified identity.")
    expect(rej.body).not.toContain('fraud')
    expect(row(out2.withdrawalId)).toMatchObject({
      adminNote: 'looks like fraud, checking ID',
      payeeReasonCode: 'details_mismatch',
      failureReason: "The payout details don't match your verified identity.",
    })
    expect(earnings().withdrawnAmount).toBe(0)
  })

  it('localizes preset reasons, keeps internal notes out, and requires text for "other"', async () => {
    seed({ language: 'fr' })
    coll('config').payouts = { prefunding: { enabled: false, available: false } }
    const out = await (await withdraw(post({ eventId: 'evt1', amount: NET, moncashNumber: '+509 3700 7294' }))).json()
    session.admin = true

    const bad = await adminPOST(post({ withdrawalId: out.withdrawalId, action: 'reject', payeeReasonCode: 'other' }))
    expect(bad.status).toBe(400)
    expect(row(out.withdrawalId).status).toBe('pending')

    await adminPOST(
      post({
        withdrawalId: out.withdrawalId,
        action: 'reject',
        payeeReasonCode: 'verification_required',
        internalNote: 'ID photo blurry',
      })
    )
    const [rej] = pushesFor('org1', 'admin_rejected')
    expect(rej.body).toContain('Motif : Nous devons vérifier votre identité avant le paiement.')
    expect(rej.body).not.toContain('blurry')
    expect(row(out.withdrawalId).adminNote).toBe('ID photo blurry')
  })
})

describe('classifyStatusCheck', () => {
  it('reads only the transaction status as success', () => {
    expect(classifyStatusCheck({ raw: { transStatus: 'successful' } }).verdict).toBe('successful')
    expect(classifyStatusCheck({ raw: { message: 'successful' } }).verdict).toBe('ambiguous')
    expect(classifyStatusCheck({ raw: { transStatus: 'Failed' } }).verdict).toBe('failed')
    expect(classifyStatusCheck({ raw: { message: 'Transaction Not Found' } }).verdict).toBe('not_found')
    expect(classifyStatusCheck({ error: new Error('MonCash REST request failed (404): nope') }).verdict).toBe('not_found')
    expect(classifyStatusCheck({ error: new Error('MonCash REST request failed (500): x') }).verdict).toBe('ambiguous')
    expect(classifyStatusCheck({ error: new TypeError('fetch failed') }).verdict).toBe('ambiguous')
  })
})
