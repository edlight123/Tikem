/**
 * @jest-environment node
 *
 * Door team service (lib/doorTeam): the standard quote from the admin config,
 * config validation + the admin config route's auth and audit, request
 * validation (48h rule, minimum crew), the price set only by a platform admin
 * (negotiated needs a note), payments reusing the printed-ticket rails
 * (idempotent paid transition, late payments flagged, current-session-only
 * expiry, balance offset debit + credit back), crew door access granted only
 * for that event and its window, and the cancellation / refund rules.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
const authUsers: Record<string, { uid: string; displayName?: string }> = {}
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
  adminAuth: {
    getUser: async (uid: string) => ({ uid, email: `${uid}@example.com` }),
    getUserByEmail: async (email: string) => {
      const u = authUsers[email]
      if (!u) throw new Error('not found')
      return u
    },
  },
}))

jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: (fn: () => unknown) => void fn() }))

const requireAdmin = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireAdmin: () => requireAdmin(),
  getCurrentUser: jest.fn(async () => null),
  requireAuth: jest.fn(async () => ({ user: gateUser, error: gateUser ? null : 'Unauthorized' })),
}))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn(async () => undefined) }))
const logAdminAction = jest.fn()
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: (...a: any[]) => logAdminAction(...a) }))
jest.mock('@/lib/rate-limit', () => ({ consumeRateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('@/lib/doorTeam/notify', () => ({
  notifyAdmins: jest.fn(async () => undefined),
  notifyQuoted: jest.fn(async () => undefined),
  notifyDeclined: jest.fn(async () => undefined),
  notifyConfirmed: jest.fn(async () => undefined),
}))

// The event gate: whoever the test says may manage the event.
let gateUser: any = { id: 'org1', role: 'organizer' }
jest.mock('@/lib/organizer/context', () => ({
  requireEventAccess: jest.fn(async (eventId: string) => {
    const snap = await (db as any).collection('events').doc(eventId).get()
    if (!snap.exists) return { ok: false, response: new Response(JSON.stringify({ error: 'Event not found' }), { status: 404 }) }
    if (!gateUser) return { ok: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) }
    return { ok: true, value: { user: gateUser, event: snap.data(), eventId, orgId: snap.data().organizer_id, role: 'owner' } }
  }),
  teamSeatIn: jest.fn(async () => null),
  teamRoleIn: jest.fn(async () => null),
  canOnEvent: jest.fn(async () => ({ allowed: true, role: 'owner' })),
  eventOrgId: (e: any) => String(e?.organizer_id || ''),
  teamCol: (orgId: string) => (db as any).collection(`organizers/${orgId}/team`),
}))

// FX, MonCash and Stripe (never called live).
const getUsdToHtgBaseRate = jest.fn()
jest.mock('@/lib/fx/usd-htg', () => ({
  getUsdToHtgBaseRate: (...a: any[]) => getUsdToHtgBaseRate(...a),
  isFxRateUnavailableError: (e: any) => e?.code === 'fx_rate_unavailable',
}))
const retrieveMonCashOrderPayment = jest.fn()
jest.mock('@/lib/moncash', () => ({ retrieveMonCashOrderPayment: (...a: any[]) => retrieveMonCashOrderPayment(...a) }))
jest.mock('@/lib/moncash-button', () => ({
  createMonCashButtonCheckoutToken: jest.fn(async () => ({ token: 'tok' })),
  getMonCashButtonRedirectUrl: (t: string) => `https://moncash.example/${t}`,
  isMonCashButtonPaidAmountAcceptable: (expected: number, cost: any) => ({
    ok: cost == null || Math.abs(Number(cost) - expected) <= 1,
    verified: cost != null,
    expected,
    paid: cost ?? null,
  }),
}))
const sessions = new Map<string, any>()
const stripeCreate = jest.fn(async (args: any) => {
  const id = `cs_${sessions.size + 1}`
  const s = { id, url: `https://stripe.example/${id}`, status: 'open', payment_status: 'unpaid', currency: 'usd', amount_total: args.line_items[0].price_data.unit_amount, metadata: args.metadata, payment_intent: `pi_${id}` }
  sessions.set(id, s)
  return s
})
const stripeExpire = jest.fn(async (id: string) => {
  sessions.get(id).status = 'expired'
})
jest.mock('stripe', () => () => ({
  checkout: { sessions: { create: (a: any) => stripeCreate(a), retrieve: async (id: string) => sessions.get(id), expire: (id: string) => stripeExpire(id) } },
}))

// Released balance per event, and the withdrawal debit's real contract.
const released: Record<string, number> = {}
jest.mock('@/lib/payouts/availability-server', () => ({
  loadOrganizerAvailability: jest.fn(async () => ({
    events: Object.keys(released).map((id) => ({ eventId: id, title: id, currency: 'HTG', availableNowMinor: released[id], reason: null })),
  })),
  loadEventAvailability: jest.fn(async ({ eventId }: any) => ({
    eventId,
    currency: 'HTG',
    availableNowMinor: released[eventId] || 0,
    balanceMinor: released[eventId] || 0,
    ceilingMinor: released[eventId] || 0,
    reason: null,
    gateInputs: { grossMinor: 0, refundedMinor: 0 },
  })),
}))
jest.mock('@/lib/payouts/availability', () => ({ gateEventData: (e: any) => e, integrityRefusal: () => null }))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({ gateHaitiWithdrawal: jest.fn(async () => ({ allowed: true })) }))
jest.mock('@/lib/payouts/organizer-debt', () => ({ syncOrganizerDebt: jest.fn(async () => ({ failed: [] })) }))
jest.mock('@/lib/earnings', () => {
  const ledger = (eventId: string) => (db as any).collection('event_earnings').doc(eventId)
  return {
    readRefundClaimVersion: jest.fn(async () => 0),
    findEventEarningsDocInTransaction: async (tx: any, eventId: string) => {
      const snap = await tx.get(ledger(eventId))
      return snap.exists ? { ref: ledger(eventId), data: snap.data() } : null
    },
    withdrawFromEarnings: jest.fn(async (eventId: string, amount: number, _id: string, opts: any) =>
      (db as any).runTransaction(async (tx: any) => {
        const snap = await tx.get(ledger(eventId))
        const req = await tx.get(opts.fileRequest.ref)
        const withdrawn = Number(snap.data()?.withdrawnAmount || 0)
        if (req.exists) return { success: false, error: 'Withdrawal request already exists' }
        if (opts.ceilingMinor - withdrawn < amount) return { success: false, error: 'Insufficient funds' }
        tx.update(ledger(eventId), { withdrawnAmount: withdrawn + amount })
        tx.set(opts.fileRequest.ref, { ...opts.fileRequest.data, reservedCents: amount })
        return { success: true }
      })
    ),
  }
})
import { withdrawFromEarnings } from '@/lib/earnings'

import { DEFAULT_DOOR_TEAM_CONFIG, normalizeStoredDoorTeamConfig, quoteDoorTeam, validateDoorTeamConfig } from '@/lib/doorTeam/config'
import {
  cancelDecision,
  canMoveRequest,
  crewAccessWindow,
  firstNameOf,
  organizerView,
  quoteExpiresAt,
  showBalanceFor,
  validateQuotePrice,
  validateRequestInput,
  withinAccessWindow,
} from '@/lib/doorTeam/rules'
import {
  assignCrew,
  completeRequest,
  confirmRequest,
  createRequest,
  getRequest,
  markRequestPaid,
  quoteRequest,
  removeCrew,
} from '@/lib/doorTeam/requests'
import {
  cancelDoorTeamRequest,
  handleDoorTeamCardSessionExpired,
  payDoorTeamFromBalance,
  startCardDoorTeamPayment,
  startMonCashDoorTeamPayment,
  sweepDoorTeam,
  verifyCardDoorTeamPayment,
  verifyMonCashDoorTeamPayment,
} from '@/lib/doorTeam/payments'
import { evaluateDoorAccess } from '@/lib/scan/doorRules'
import { markRefunded } from '@/lib/doorTeam/requests'
import { checkDoorTeamPayment, creditBackDoorTeamOffset, paymentWindowEnd } from '@/lib/doorTeam/payments'
import { GET as staffGET } from '@/app/api/organizer/events/[id]/staff/route'
import { POST as staffPermissions } from '@/app/api/staff/members/permissions/route'
import { POST as staffRemove } from '@/app/api/staff/members/remove/route'
import { POST as staffAssign } from '@/app/api/staff/members/assign/route'
import { POST as staffResolve } from '@/app/api/staff/members/resolve/route'
import { GET as configGET, PUT as configPUT } from '@/app/api/admin/door-team/config/route'
import { POST as adminAction } from '@/app/api/admin/door-team/requests/[requestId]/route'
import { POST as organizerCreate } from '@/app/api/organizer/events/[id]/door-team/route'
import { POST as organizerAction } from '@/app/api/organizer/events/[id]/door-team/[requestId]/route'

const HOUR = 3600_000
const NOW = Date.parse('2026-12-01T12:00:00Z')
const EVENT = 'ev1'
const C = DEFAULT_DOOR_TEAM_CONFIG
const OWNER = { id: 'org1', role: 'organizer' } as any
const ADMIN = { uid: 'admin1' }

beforeEach(() => {
  db.store.clear()
  sessions.clear()
  for (const k of Object.keys(released)) delete released[k]
  for (const k of Object.keys(authUsers)) delete authUsers[k]
  gateUser = OWNER
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  getUsdToHtgBaseRate.mockReset().mockResolvedValue({ baseRate: 130, source: 'live' })
  retrieveMonCashOrderPayment.mockReset()
  stripeCreate.mockClear()
  stripeExpire.mockClear()
  requireAdmin.mockReset()
  logAdminAction.mockClear()
  ;(withdrawFromEarnings as jest.Mock).mockClear()
  setEvent(NOW + 7 * 24 * HOUR)
})

function setEvent(startMs: number) {
  db.store.set(`events/${EVENT}`, {
    title: 'Fête',
    organizer_id: 'org1',
    currency: 'HTG',
    start_datetime: new Date(startMs).toISOString(),
    end_datetime: new Date(startMs + 6 * HOUR).toISOString(),
  })
}

/** Released HTG (minor units) on another event of the same org. */
function fund(eventId: string, minor: number) {
  released[eventId] = minor
  db.store.set(`events/${eventId}`, { title: eventId, organizer_id: 'org1', currency: 'HTG' })
}

const eventStart = () => Date.parse(db.store.get(`events/${EVENT}`)!.start_datetime)

function input(over: Record<string, any> = {}) {
  return {
    staffCount: 3,
    hours: 6,
    arrivalAt: new Date(eventStart() - HOUR).toISOString(),
    notes: 'Two entrances, VIP lane on the left',
    contactName: 'Marie Joseph',
    contactPhone: '+509 3712 3456',
    ...over,
  }
}

async function newRequest(over: Record<string, any> = {}, now = NOW) {
  const r = await createRequest({ eventId: EVENT, event: db.store.get(`events/${EVENT}`)!, orgId: 'org1', input: input(over), createdBy: 'org1', now })
  if (!r.ok) throw new Error(r.error)
  return r.request
}

async function quoted(over: Record<string, any> = {}, price?: { priceHtg?: number; note?: string }) {
  const r = await newRequest(over)
  const q = await quoteRequest(r.id, ADMIN, price || {}, NOW)
  if (!q.ok) throw new Error(q.error)
  return q.request
}

// ── quote ────────────────────────────────────────────────────────────────────

describe('standard quote from the config', () => {
  it('3,500 HTG per staff up to 6 hours, min 2 staff', () => {
    expect(quoteDoorTeam(C, { staff: 2, hours: 6 })).toMatchObject({ ok: true, unitHtg: 3500, totalHtg: 7000, extraHoursHtg: 0 })
    expect(quoteDoorTeam(C, { staff: 1, hours: 6 })).toMatchObject({ ok: false, code: 'below_min_staff' })
  })
  it('+600 HTG per extra hour per staff', () => {
    // 3 × 3,500 + 3 × 2h × 600
    expect(quoteDoorTeam(C, { staff: 3, hours: 8 })).toMatchObject({ ok: true, baseHtg: 10500, extraHours: 2, extraHoursHtg: 3600, totalHtg: 14100 })
  })
  it('5+ staff: 3,000 HTG each', () => {
    expect(quoteDoorTeam(C, { staff: 4, hours: 6 })).toMatchObject({ totalHtg: 14000, volume: false })
    expect(quoteDoorTeam(C, { staff: 5, hours: 6 })).toMatchObject({ totalHtg: 15000, volume: true, unitHtg: 3000 })
    expect(quoteDoorTeam(C, { staff: 5, hours: 7 })).toMatchObject({ totalHtg: 15000 + 5 * 600 })
  })
  it('refuses fractions, too many and disabled', () => {
    expect(quoteDoorTeam(C, { staff: 2.5, hours: 6 })).toMatchObject({ ok: false, code: 'invalid_staff' })
    expect(quoteDoorTeam(C, { staff: 2, hours: 0 })).toMatchObject({ ok: false, code: 'invalid_hours' })
    expect(quoteDoorTeam(C, { staff: 2, hours: C.maxHours + 1 })).toMatchObject({ ok: false, code: 'above_max_hours' })
    expect(quoteDoorTeam(C, { staff: C.maxStaff + 1, hours: 6 })).toMatchObject({ ok: false, code: 'above_max_staff' })
    expect(quoteDoorTeam({ ...C, enabled: false }, { staff: 2, hours: 6 })).toMatchObject({ ok: false, code: 'disabled' })
  })
  it('follows an edited config (not hard-coded)', () => {
    expect(quoteDoorTeam({ ...C, ratePerStaffHtg: 4000 }, { staff: 2, hours: 6 })).toMatchObject({ totalHtg: 8000 })
  })
})

describe('config validation', () => {
  it('accepts the defaults', () => {
    const { updated_at, updated_by, updated_by_email, ...plain } = C as any
    expect(validateDoorTeamConfig(plain).ok).toBe(true)
  })
  it.each([
    [{ ...C, extra: 1 }, 'Unknown'],
    [{ ...C, ratePerStaffHtg: 0 }, 'Rate'],
    [{ ...C, ratePerStaffHtg: 3500.5 }, 'Rate'],
    [{ ...C, volumeRatePerStaffHtg: 4000 }, 'volume rate'],
    [{ ...C, minStaff: 10, maxStaff: 5 }, 'Maximum crew'],
    [{ ...C, includedHours: 20, maxHours: 16 }, 'Included hours'],
    [{ ...C, enabled: 'yes' }, 'enabled'],
  ])('refuses %#', (raw, msg) => {
    const v = validateDoorTeamConfig(raw)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(msg as string)
  })
  it('a broken stored doc falls back to the defaults (never quotes 0)', () => {
    expect(normalizeStoredDoorTeamConfig({ enabled: true, ratePerStaffHtg: -1 })).toMatchObject({ ratePerStaffHtg: 3500 })
    expect(normalizeStoredDoorTeamConfig(null)).toMatchObject(C)
  })
})

describe('admin config route', () => {
  const req = (body: unknown) => new Request('http://localhost/api/admin/door-team/config', { method: 'PUT', body: JSON.stringify(body) }) as any
  it('401 signed out, 403 for non-admins; nothing written', async () => {
    requireAdmin.mockResolvedValue({ user: null, error: 'Not authenticated' })
    expect((await configGET()).status).toBe(401)
    requireAdmin.mockResolvedValue({ user: null, error: 'Admin access required' })
    expect((await configPUT(req(C))).status).toBe(403)
    expect(db.store.get('config/door_team')).toBeUndefined()
  })
  it('400 on an invalid config', async () => {
    requireAdmin.mockResolvedValue({ user: { id: 'a1', email: 'a@tikem.co' }, error: null })
    expect((await configPUT(req({ ...C, minStaff: 0 }))).status).toBe(400)
    expect(db.store.get('config/door_team')).toBeUndefined()
  })
  it('saves, keeps history, audits; new requests quote with it', async () => {
    requireAdmin.mockResolvedValue({ user: { id: 'a1', email: 'a@tikem.co' }, error: null })
    const res = await configPUT(req({ ...C, ratePerStaffHtg: 4000 }))
    expect(res.status).toBe(200)
    expect(db.store.get('config/door_team')).toMatchObject({ ratePerStaffHtg: 4000, updated_by: 'a1', updated_by_email: 'a@tikem.co' })
    expect(db.docsIn('config/door_team/history')).toHaveLength(1)
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'door_team.config.update', adminId: 'a1' }))
    const r = await newRequest({ staffCount: 2 })
    expect(r.standard_quote?.totalHtg).toBe(8000)
  })
})

// ── request validation ───────────────────────────────────────────────────────

describe('request validation', () => {
  const ctx = (startInHours: number) => ({ config: C, now: NOW, eventStart: new Date(NOW + startInHours * HOUR), eventEnd: new Date(NOW + (startInHours + 6) * HOUR) })
  const raw = (startInHours: number, over: Record<string, any> = {}) => ({
    staffCount: 2,
    hours: 6,
    arrivalAt: new Date(NOW + (startInHours - 1) * HOUR).toISOString(),
    contactName: 'Jean',
    contactPhone: '+509 3712 3456',
    ...over,
  })
  it('the event must be at least 48h away', () => {
    expect(validateRequestInput(raw(47), ctx(47))).toMatchObject({ ok: false, code: 'too_late' })
    expect(validateRequestInput(raw(48), ctx(48)).ok).toBe(true)
  })
  it('minimum crew', () => {
    expect(validateRequestInput(raw(72, { staffCount: 1 }), ctx(72))).toMatchObject({ ok: false, code: 'below_min_staff' })
  })
  it('arrival around the event, and an on-site contact', () => {
    expect(validateRequestInput(raw(72, { arrivalAt: new Date(NOW + 50 * HOUR).toISOString() }), ctx(72))).toMatchObject({ code: 'arrival_too_early' })
    expect(validateRequestInput(raw(72, { arrivalAt: new Date(NOW + 80 * HOUR).toISOString() }), ctx(72))).toMatchObject({ code: 'arrival_after_event' })
    expect(validateRequestInput(raw(72, { arrivalAt: 'soon' }), ctx(72))).toMatchObject({ code: 'invalid_arrival' })
    expect(validateRequestInput(raw(72, { contactName: '' }), ctx(72))).toMatchObject({ code: 'contact_name_required' })
    expect(validateRequestInput(raw(72, { contactPhone: 'call me' }), ctx(72))).toMatchObject({ code: 'contact_phone_invalid' })
  })
  it('an event with no date cannot be staffed', () => {
    expect(validateRequestInput(raw(72), { ...ctx(72), eventStart: null })).toMatchObject({ code: 'event_has_no_date' })
  })
  it('the organizer API quotes server-side and refuses a second open request', async () => {
    const post = (body: unknown) =>
      organizerCreate(new Request(`http://localhost/api/organizer/events/${EVENT}/door-team`, { method: 'POST', body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: EVENT }) })
    // A client-sent price is ignored: the standard quote comes from the config.
    const res = await post({ ...input({ staffCount: 2 }), priceHtg: 1, totalHtg: 1 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.request).toMatchObject({ status: 'requested', price_htg: null, standard_quote: { totalHtg: 7000 } })
    expect((await post(input())).status).toBe(409)
  })
  it('too late through the API: 400, nothing written', async () => {
    setEvent(Date.now() + 24 * HOUR)
    const res = await organizerCreate(
      new Request('http://x', { method: 'POST', body: JSON.stringify(input()) }) as any,
      { params: Promise.resolve({ id: EVENT }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('too_late')
    expect(db.docsIn('door_team_requests')).toHaveLength(0)
  })
})

// ── price: admin only ────────────────────────────────────────────────────────

describe('the price is set by a platform admin only', () => {
  it('standard unless a different price, which needs a note', () => {
    expect(validateQuotePrice({}, 7000)).toMatchObject({ ok: true, priceHtg: 7000, kind: 'standard' })
    expect(validateQuotePrice({ priceHtg: 7000 }, 7000)).toMatchObject({ ok: true, kind: 'standard' })
    expect(validateQuotePrice({ priceHtg: 6000 }, 7000)).toMatchObject({ ok: false, code: 'note_required' })
    expect(validateQuotePrice({ priceHtg: 6000, note: 'Repeat client' }, 7000)).toMatchObject({ ok: true, kind: 'negotiated', priceHtg: 6000 })
    expect(validateQuotePrice({ priceHtg: 60.5, note: 'x y z' }, 7000)).toMatchObject({ ok: false, code: 'invalid_price' })
    expect(validateQuotePrice({ priceHtg: -1, note: 'x y z' }, 7000)).toMatchObject({ ok: false, code: 'invalid_price' })
  })
  it('the organizer route has no quote action', async () => {
    const r = await newRequest()
    const res = await organizerAction(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'quote', priceHtg: 1 }) }) as any,
      { params: Promise.resolve({ id: EVENT, requestId: r.id }) }
    )
    expect(res.status).toBe(400)
    expect((await getRequest(r.id))!.price_htg).toBeNull()
  })
  it('the admin route refuses non-admins', async () => {
    const r = await newRequest()
    requireAdmin.mockResolvedValue({ user: null, error: 'Admin access required' })
    const res = await adminAction(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'quote', priceHtg: 100, note: 'cheap' }) }) as any, {
      params: Promise.resolve({ requestId: r.id }),
    })
    expect(res.status).toBe(403)
    expect((await getRequest(r.id))!.status).toBe('requested')
  })
  it('a negotiated quote is audited with the standard price beside it', async () => {
    const r = await newRequest()
    requireAdmin.mockResolvedValue({ user: { id: 'a1', email: 'a@tikem.co' }, error: null })
    const res = await adminAction(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'quote', priceHtg: 9000, note: 'Repeat client discount' }) }) as any, {
      params: Promise.resolve({ requestId: r.id }),
    })
    expect(res.status).toBe(200)
    expect(await getRequest(r.id)).toMatchObject({ status: 'quoted', price_htg: 9000, price_kind: 'negotiated', quote_note: 'Repeat client discount' })
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'door_team.request.quote', details: expect.objectContaining({ price_htg: 9000, price_kind: 'negotiated', standard_htg: 10500 }) })
    )
  })
  it('a quote closes 24h before the event at the latest', () => {
    const start = new Date(NOW + 72 * HOUR)
    expect(quoteExpiresAt(NOW, start)).toBe(new Date(NOW + 48 * HOUR).toISOString())
    expect(quoteExpiresAt(NOW, new Date(NOW + 30 * 24 * HOUR))).toBe(new Date(NOW + 5 * 24 * HOUR).toISOString())
  })
  it('status moves', () => {
    expect(canMoveRequest('requested', 'quoted')).toBe(true)
    expect(canMoveRequest('requested', 'paid')).toBe(false)
    expect(canMoveRequest('done', 'cancelled')).toBe(false)
    expect(canMoveRequest('confirmed', 'done')).toBe(true)
  })
})

// ── payments ─────────────────────────────────────────────────────────────────

describe('paid transition', () => {
  const proof = (reference: string, price = 10500) => ({ funds_rail: 'moncash' as const, reference, amount: price, currency: 'HTG', price_htg: price })
  it('is idempotent; a second different payment is flagged for refund', async () => {
    const r = await quoted()
    expect(await markRequestPaid(r.id, proof('T1'))).toEqual({ ok: true })
    expect(await markRequestPaid(r.id, proof('T1'))).toMatchObject({ ok: true, alreadyPaid: true })
    expect((await getRequest(r.id))!.status).toBe('paid')
    const dup = await markRequestPaid(r.id, proof('T2'))
    expect(dup).toMatchObject({ ok: false, needsRefund: true, code: 'duplicate' })
    const after = await getRequest(r.id)
    expect(after!.needs_refund).toBe(true)
    expect(after!.payment.reference).toBe('T1')
    expect(after!.late_payments).toHaveLength(1)
  })
  it('a payment on a closed request, or for another price, is flagged, never applied', async () => {
    const r = await quoted()
    expect(await markRequestPaid(r.id, proof('T9', 5000))).toMatchObject({ ok: false, code: 'price_mismatch', needsRefund: true })
    expect((await getRequest(r.id))!.status).toBe('quoted')
    await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', NOW)
    expect(await markRequestPaid(r.id, proof('T3'))).toMatchObject({ ok: false, code: 'closed', needsRefund: true })
    expect((await getRequest(r.id))!.status).toBe('cancelled')
  })
})

describe('MonCash and card reuse the platform rails', () => {
  it('MonCash: order doc → verified amount → paid', async () => {
    const r = await quoted()
    const { orderId, redirectUrl } = await startMonCashDoorTeamPayment(r)
    expect(redirectUrl).toBe('https://moncash.example/tok')
    expect(db.store.get(`door_team_orders/${orderId}`)).toMatchObject({ request_id: r.id, amount_htg: 10500 })
    retrieveMonCashOrderPayment.mockResolvedValue({ success: true, cost: 100, transactionId: 'MC1' })
    expect(await verifyMonCashDoorTeamPayment(orderId)).toMatchObject({ paid: false, reason: 'amount_mismatch' })
    retrieveMonCashOrderPayment.mockResolvedValue({ success: true, cost: 10500, transactionId: 'MC1' })
    expect(await verifyMonCashDoorTeamPayment(orderId)).toMatchObject({ paid: true, requestId: r.id })
    expect((await getRequest(r.id))!.payment).toMatchObject({ funds_rail: 'moncash', reference: 'MC1', status: 'paid' })
  })
  it("card: guarded FX 'lowest', amount on the session, platform charge, verified against itself", async () => {
    const r = await quoted()
    const started = await startCardDoorTeamPayment(r, 'https://www.tikem.co')
    expect(getUsdToHtgBaseRate).toHaveBeenCalledWith({ fallback: 'lowest' })
    // 10,500 / 130 = 80.769… → 8077 cents, rounded up
    expect(started.amountUsdCents).toBe(8077)
    const args = stripeCreate.mock.calls[0][0]
    expect(args.metadata).toMatchObject({ kind: 'door_team', requestId: r.id, expectedUsdCents: '8077', htgTotal: '10500' })
    expect(args).not.toHaveProperty('payment_intent_data.transfer_data')
    expect(args.success_url).toContain(`/organizer/events/${EVENT}/door-team?request=${r.id}`)
    const s = sessions.get(started.sessionId)
    s.payment_status = 'paid'
    s.amount_total = 8000
    expect(await verifyCardDoorTeamPayment(s.id, r.id)).toMatchObject({ paid: false, reason: 'amount_mismatch' })
    s.amount_total = 8077
    expect(await verifyCardDoorTeamPayment(s.id, r.id)).toMatchObject({ paid: true })
    expect((await getRequest(r.id))!.payment).toMatchObject({ funds_rail: 'stripe_platform', currency: 'USD' })
  })
  it('no trustworthy FX rate: card refused', async () => {
    getUsdToHtgBaseRate.mockRejectedValue({ code: 'fx_rate_unavailable' })
    const r = await quoted()
    await expect(startCardDoorTeamPayment(r, 'https://x')).rejects.toMatchObject({ code: 'fx_unavailable' })
    expect(stripeCreate).not.toHaveBeenCalled()
  })
  it('a restart expires the earlier session; only the CURRENT session expiring clears the attempt', async () => {
    const r = await quoted()
    const first = await startCardDoorTeamPayment(r, 'https://x')
    const second = await startCardDoorTeamPayment((await getRequest(r.id))!, 'https://x')
    expect(stripeExpire).toHaveBeenCalledWith(first.sessionId)
    expect(await handleDoorTeamCardSessionExpired({ id: first.sessionId, metadata: { kind: 'door_team', requestId: r.id } })).toBe(false)
    expect((await getRequest(r.id))!.payment.stripe_session_id).toBe(second.sessionId)
    expect(await handleDoorTeamCardSessionExpired({ id: second.sessionId, metadata: { kind: 'door_team', requestId: r.id } })).toBe(true)
    expect(await getRequest(r.id)).toMatchObject({ status: 'quoted', payment: { status: 'expired', stripe_session_id: null } })
  })
  it('switching to MonCash retires the open card session first', async () => {
    const r = await quoted()
    const card = await startCardDoorTeamPayment(r, 'https://x')
    await startMonCashDoorTeamPayment((await getRequest(r.id))!)
    expect(stripeExpire).toHaveBeenCalledWith(card.sessionId)
    expect((await getRequest(r.id))!.payment).toMatchObject({ method: 'moncash', stripe_session_id: null, retired_stripe_session_id: card.sessionId })
  })
})

describe('pay from balance', () => {
  it('only when one event’s released HTG covers it all', () => {
    expect(showBalanceFor({ canUse: true, availableHtg: 10500 }, 10500)).toBe(true)
    expect(showBalanceFor({ canUse: true, availableHtg: 10499 }, 10500)).toBe(false)
    expect(showBalanceFor({ canUse: false, availableHtg: 99999 }, 10500)).toBe(false)
  })
  it('owner / finance only', async () => {
    const r = await quoted()
    fund('ev9', 2_000_000)
    const res = await payDoorTeamFromBalance({ request: r, user: { id: 'manager1', role: 'organizer' } as any })
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(withdrawFromEarnings).not.toHaveBeenCalled()
  })
  it('refused when no single event covers it', async () => {
    const r = await quoted()
    fund('ev8', 600_000)
    fund('ev9', 600_000)
    const res = await payDoorTeamFromBalance({ request: r, user: OWNER })
    expect(res).toMatchObject({ ok: false, code: 'insufficient_balance' })
    expect((await getRequest(r.id))!.status).toBe('quoted')
  })
  it('debits once (deterministic row), marks paid; a retry never debits twice', async () => {
    const r = await quoted()
    fund('ev9', 2_000_000)
    const res = await payDoorTeamFromBalance({ request: r, user: OWNER })
    expect(res).toMatchObject({ ok: true, withdrawalId: `doorteam_${r.id}` })
    expect(db.store.get(`withdrawal_requests/doorteam_${r.id}`)).toMatchObject({ method: 'balance_offset', status: 'completed', amount: 1_050_000, purpose: 'door_team', doorTeamRequestId: r.id })
    expect((await getRequest(r.id))!.payment).toMatchObject({ funds_rail: 'balance_offset', status: 'paid' })
    const again = await payDoorTeamFromBalance({ request: (await getRequest(r.id))!, user: OWNER })
    expect(again).toMatchObject({ ok: true, alreadyDone: true })
    expect(withdrawFromEarnings).toHaveBeenCalledTimes(1)
    expect(db.store.get('event_earnings/ev9')).toMatchObject({ withdrawnAmount: 1_050_000 })
  })
})

// ── crew access ──────────────────────────────────────────────────────────────

describe('crew door access', () => {
  async function paidRequest() {
    const r = await quoted()
    await markRequestPaid(r.id, { funds_rail: 'moncash', reference: 'MC1', amount: 10500, currency: 'HTG', price_htg: 10500 })
    return (await getRequest(r.id))!
  }
  it('not before payment', async () => {
    const r = await quoted()
    expect(await assignCrew(r.id, { uid: 'crew1', firstName: 'Jean' }, ADMIN)).toMatchObject({ ok: false, code: 'not_paid' })
    expect(db.store.get(`events/${EVENT}/members/crew1`)).toBeUndefined()
  })
  it('a door-only seat on THIS event, time-boxed, no attendee list', async () => {
    const r = await paidRequest()
    const res = await assignCrew(r.id, { uid: 'crew1', firstName: 'Jean' }, ADMIN)
    expect(res.ok).toBe(true)
    const seat = db.store.get(`events/${EVENT}/members/crew1`)!
    expect(seat).toMatchObject({ role: 'staff', permissions: { checkin: true, viewAttendees: false }, source: 'tikem_door_team', door_team_request_id: r.id })
    const window = crewAccessWindow(r)
    expect(seat.access_from).toEqual(window.from)
    expect(seat.access_until).toEqual(window.until)
    // Nothing on any other event, nothing on the org team.
    expect(Array.from(db.store.keys()).filter((k) => k.includes('/members/'))).toEqual([`events/${EVENT}/members/crew1`])
    expect(Array.from(db.store.keys()).some((k) => k.startsWith('organizers/'))).toBe(false)

    const ev = db.store.get(`events/${EVENT}`)!
    const at = (ms: number) => evaluateDoorAccess({ uid: 'crew1', isAdmin: false, event: ev, member: seat, now: ms })
    expect(at(eventStart())).toMatchObject({ allowed: true, role: 'staff', canViewAttendees: false })
    expect(at(window.from.getTime() - 1)).toMatchObject({ allowed: false, status: 403 })
    expect(at(window.until.getTime() + 1)).toMatchObject({ allowed: false, status: 403 })
    // Another event: no seat, no access.
    expect(evaluateDoorAccess({ uid: 'crew1', isAdmin: false, event: { organizer_id: 'org2' }, member: null, now: eventStart() })).toMatchObject({ allowed: false })
  })
  it('never overwrites a seat the organizer created, and never removes it', async () => {
    const r = await paidRequest()
    db.store.set(`events/${EVENT}/members/staff7`, { uid: 'staff7', role: 'staff', permissions: { checkin: true, viewAttendees: true }, source: 'org_team' })
    expect(await assignCrew(r.id, { uid: 'staff7', firstName: 'Paul' }, ADMIN)).toMatchObject({ ok: false, code: 'already_member' })
    expect(db.store.get(`events/${EVENT}/members/staff7`)).toMatchObject({ source: 'org_team', permissions: { viewAttendees: true } })
  })
  it('crew size is capped; confirm needs crew; done removes only our seats', async () => {
    const r = await paidRequest()
    expect(await confirmRequest(r.id, ADMIN)).toMatchObject({ ok: false })
    for (const [uid, name] of [['c1', 'Ana'], ['c2', 'Bo'], ['c3', 'Cy']]) {
      expect((await assignCrew(r.id, { uid, firstName: name }, ADMIN)).ok).toBe(true)
    }
    expect(await assignCrew(r.id, { uid: 'c4', firstName: 'Di' }, ADMIN)).toMatchObject({ ok: false, code: 'crew_full' })
    await removeCrew(r.id, 'c3', ADMIN)
    expect(db.store.get(`events/${EVENT}/members/c3`)).toBeUndefined()
    expect((await confirmRequest(r.id, ADMIN)).ok).toBe(true)
    db.store.set(`events/${EVENT}/members/staff7`, { uid: 'staff7', role: 'staff', permissions: { checkin: true }, source: 'org_team' })
    expect((await completeRequest(r.id, 'admin1')).ok).toBe(true)
    expect(db.store.get(`events/${EVENT}/members/c1`)).toBeUndefined()
    expect(db.store.get(`events/${EVENT}/members/c2`)).toBeUndefined()
    expect(db.store.get(`events/${EVENT}/members/staff7`)).toBeDefined()
  })
  it('the organizer sees first names only', async () => {
    const r = await paidRequest()
    await assignCrew(r.id, { uid: 'crew1', firstName: firstNameOf('Jean Baptiste') }, ADMIN)
    const view = organizerView((await getRequest(r.id))!)
    expect(view.crew).toEqual([{ first_name: 'Jean' }])
    expect(JSON.stringify(view)).not.toContain('crew1')
    expect(firstNameOf('someone@example.com')).toBe('')
  })
  it('admin assigns by email through the API (audited)', async () => {
    const r = await paidRequest()
    authUsers['crew@tikem.co'] = { uid: 'crewX', displayName: 'Rose Pierre' }
    requireAdmin.mockResolvedValue({ user: { id: 'a1', email: 'a@tikem.co' }, error: null })
    const res = await adminAction(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'assign_crew', email: 'crew@tikem.co' }) }) as any, {
      params: Promise.resolve({ requestId: r.id }),
    })
    expect(res.status).toBe(200)
    expect((await getRequest(r.id))!.crew).toEqual([expect.objectContaining({ uid: 'crewX', first_name: 'Rose' })])
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'door_team.request.assign_crew' }))
  })
  it('the sweep closes a confirmed request after the window, and expires unpaid quotes', async () => {
    const r = await paidRequest()
    await assignCrew(r.id, { uid: 'crew1', firstName: 'Jean' }, ADMIN)
    await confirmRequest(r.id, ADMIN)
    const q = await quoted({}, undefined).catch(() => null)
    expect(q).toBeNull() // one open request per event
    const until = Date.parse((await getRequest(r.id))!.access_until)
    expect(await sweepDoorTeam({ now: until - 1 })).toMatchObject({ done: 0 })
    expect(await sweepDoorTeam({ now: until + 1 })).toMatchObject({ done: 1 })
    expect((await getRequest(r.id))!.status).toBe('done')
    expect(db.store.get(`events/${EVENT}/members/crew1`)).toBeUndefined()
  })
  it('the seat window check', () => {
    expect(withinAccessWindow({ access_from: new Date(10), access_until: new Date(20) }, 15)).toBe(true)
    expect(withinAccessWindow({ access_from: new Date(10), access_until: new Date(20) }, 21)).toBe(false)
    expect(withinAccessWindow({}, 21)).toBe(true)
  })
})

describe('quote expiry sweep', () => {
  it('asks the gateway once more, then expires', async () => {
    const r = await quoted()
    const { orderId } = await startMonCashDoorTeamPayment(r)
    retrieveMonCashOrderPayment.mockResolvedValue({ success: false, payment_status: 'pending' })
    const later = Date.parse((await getRequest(r.id))!.quote_expires_at) + 3 * HOUR
    expect(await sweepDoorTeam({ now: later })).toMatchObject({ expired: 1 })
    expect(await getRequest(r.id)).toMatchObject({ status: 'expired', payment: { status: 'abandoned' } })
    // A payment that lands afterwards is flagged, never applied.
    retrieveMonCashOrderPayment.mockResolvedValue({ success: true, cost: 10500, transactionId: 'LATE' })
    expect(await verifyMonCashDoorTeamPayment(orderId)).toMatchObject({ paid: false })
    expect(await getRequest(r.id)).toMatchObject({ status: 'expired', needs_refund: true })
  })
  it('a payment found at the last check marks it paid instead', async () => {
    const r = await quoted()
    await startMonCashDoorTeamPayment(r)
    retrieveMonCashOrderPayment.mockResolvedValue({ success: true, cost: 10500, transactionId: 'MC7' })
    const later = Date.parse((await getRequest(r.id))!.quote_expires_at) + 3 * HOUR
    expect(await sweepDoorTeam({ now: later })).toMatchObject({ paid: 1, expired: 0 })
    expect((await getRequest(r.id))!.status).toBe('paid')
  })
})

// ── cancellation ─────────────────────────────────────────────────────────────

describe('cancellation', () => {
  const cut = C.refundCutoffHours
  const start = new Date(NOW + 72 * HOUR).toISOString()
  it('the decision', () => {
    expect(cancelDecision({ status: 'quoted', event_start_at: start }, { now: NOW, refundCutoffHours: cut })).toEqual({ ok: true, refund: 'none', reason: 'unpaid' })
    expect(cancelDecision({ status: 'paid', payment: { funds_rail: 'moncash' }, event_start_at: start }, { now: NOW, refundCutoffHours: cut })).toEqual({ ok: true, refund: 'refund_original', reason: 'in_time' })
    expect(cancelDecision({ status: 'confirmed', payment: { funds_rail: 'balance_offset' }, event_start_at: start }, { now: NOW, refundCutoffHours: cut })).toEqual({ ok: true, refund: 'credit_balance', reason: 'in_time' })
    expect(cancelDecision({ status: 'paid', payment: { funds_rail: 'moncash' }, event_start_at: start }, { now: NOW + 25 * HOUR, refundCutoffHours: cut })).toEqual({ ok: true, refund: 'none', reason: 'too_late' })
    expect(cancelDecision({ status: 'done' }, { now: NOW, refundCutoffHours: cut })).toMatchObject({ ok: false })
  })
  it('paid by card / MonCash ≥48h before: cancelled, flagged for a refund to the original method, crew removed', async () => {
    const r = await quoted()
    await markRequestPaid(r.id, { funds_rail: 'stripe_platform', reference: 'pi_1', amount: 80.77, currency: 'USD', price_htg: 10500 })
    await assignCrew(r.id, { uid: 'crew1', firstName: 'Jean' }, ADMIN)
    const res = await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', NOW)
    expect(res).toEqual({ ok: true, refund: 'refund_original' })
    expect(await getRequest(r.id)).toMatchObject({ status: 'cancelled', needs_refund: true, refund: { due: true, rail: 'stripe_platform', status: 'pending' } })
    expect(db.store.get(`events/${EVENT}/members/crew1`)).toBeUndefined()
  })
  it('later than that: cancelled, no refund', async () => {
    const r = await quoted()
    await markRequestPaid(r.id, { funds_rail: 'moncash', reference: 'MC1', amount: 10500, currency: 'HTG', price_htg: 10500 })
    const res = await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', eventStart() - 10 * HOUR)
    expect(res).toEqual({ ok: true, refund: 'none' })
    expect(await getRequest(r.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'organizer_cancelled_late', refund: { due: false } })
    expect((await getRequest(r.id))!.needs_refund).toBe(false)
  })
  it('paid from balance in time: credited straight back, once', async () => {
    const r = await quoted()
    fund('ev9', 2_000_000)
    await payDoorTeamFromBalance({ request: r, user: OWNER })
    const res = await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', NOW)
    expect(res).toMatchObject({ ok: true, refund: 'credit_balance', creditedHtg: 10500 })
    expect(db.store.get(`withdrawal_requests/doorteam_${r.id}`)).toMatchObject({ status: 'cancelled', reversalReason: 'door_team_cancelled' })
    expect(db.store.get('event_earnings/ev9')).toMatchObject({ withdrawnAmount: 0 })
    expect(await getRequest(r.id)).toMatchObject({ status: 'cancelled', refund: { status: 'credited' } })
    expect(await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', NOW)).toMatchObject({ ok: false })
    expect(db.store.get('event_earnings/ev9')).toMatchObject({ withdrawnAmount: 0 })
  })
  it('unpaid: just cancelled, and the open card session is expired', async () => {
    const r = await quoted()
    const card = await startCardDoorTeamPayment(r, 'https://x')
    expect(await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', NOW)).toEqual({ ok: true, refund: 'none' })
    expect(stripeExpire).toHaveBeenCalledWith(card.sessionId)
    expect((await getRequest(r.id))!.status).toBe('cancelled')
  })
})

// ── rules file ───────────────────────────────────────────────────────────────

describe('firestore.rules', () => {
  const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
  it('new collections are server-only', () => {
    for (const m of ['match /door_team_requests/{requestId}', 'match /door_team_orders/{orderId}', 'match /config/door_team']) {
      const at = rules.indexOf(m)
      expect(at).toBeGreaterThan(-1)
      expect(rules.slice(at, at + 120)).toMatch(/allow read, write: if false;/)
    }
  })
  it('a time-boxed door seat checks in only inside its window', () => {
    expect(rules).toMatch(/function memberSeatLive\(m\)/)
    expect(rules).toMatch(/m\.get\('access_until', null\) == null \|\| request\.time <= m\.access_until/)
    const fn = rules.slice(rules.indexOf('function canCheckin'), rules.indexOf('function canViewAttendees'))
    expect(fn).toContain('memberSeatLive(')
  })
})

// ── review fixes ─────────────────────────────────────────────────────────────

describe('review fixes', () => {
  async function paidRequest(reference = 'MC1') {
    const r = await quoted()
    await markRequestPaid(r.id, { funds_rail: 'moncash', reference, amount: 10500, currency: 'HTG', price_htg: 10500 })
    return (await getRequest(r.id))!
  }
  const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any

  it('1. re-checking a cancelled or refunded request never re-flags its own payment', async () => {
    const r = await quoted()
    const { orderId } = await startMonCashDoorTeamPayment(r)
    retrieveMonCashOrderPayment.mockResolvedValue({ success: true, cost: 10500, transactionId: 'MC1' })
    expect((await verifyMonCashDoorTeamPayment(orderId)).paid).toBe(true)
    await cancelDoorTeamRequest((await getRequest(r.id))!, 'org1', NOW)
    expect(await getRequest(r.id)).toMatchObject({ status: 'cancelled', needs_refund: true })
    await markRefunded(r.id, ADMIN, 're_123')
    expect((await getRequest(r.id))!.needs_refund).toBe(false)
    // The MonCash return / webhook replay of the SAME payment: nothing new.
    expect(await verifyMonCashDoorTeamPayment(orderId)).toMatchObject({ paid: true })
    expect(await markRequestPaid(r.id, { funds_rail: 'moncash', reference: 'MC1', amount: 10500, currency: 'HTG', price_htg: 10500 })).toMatchObject({ ok: true, alreadyPaid: true })
    // "Check payment" on a closed request does not ask the gateways at all.
    retrieveMonCashOrderPayment.mockClear()
    expect(await checkDoorTeamPayment((await getRequest(r.id))!)).toEqual({ paid: false, reason: 'not_awaiting_payment' })
    expect(retrieveMonCashOrderPayment).not.toHaveBeenCalled()
    const after = (await getRequest(r.id))!
    expect(after.needs_refund).toBe(false)
    expect(after.late_payments || []).toHaveLength(0)
    expect(after.refund.status).toBe('refunded')
  })

  it('2. an expired quote cannot be paid or kept alive', async () => {
    const r = await quoted()
    db.store.set(`door_team_requests/${r.id}`, { ...db.store.get(`door_team_requests/${r.id}`), quote_expires_at: new Date(Date.now() - 60_000).toISOString() })
    for (const method of ['moncash', 'card', 'balance']) {
      const res = await organizerAction(post({ action: 'pay', method }), { params: Promise.resolve({ id: EVENT, requestId: r.id }) })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('quote_expired')
    }
    await expect(startMonCashDoorTeamPayment((await getRequest(r.id))!)).rejects.toMatchObject({ code: 'quote_expired' })
    await expect(startCardDoorTeamPayment((await getRequest(r.id))!, 'https://x')).rejects.toMatchObject({ code: 'quote_expired' })
    fund('ev9', 2_000_000)
    expect(await payDoorTeamFromBalance({ request: (await getRequest(r.id))!, user: OWNER })).toMatchObject({ ok: false, code: 'quote_expired' })
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(withdrawFromEarnings).not.toHaveBeenCalled()
    // The payment window never runs past the quote's close.
    const closes = new Date(NOW + 30 * 60_000).toISOString()
    expect(paymentWindowEnd(NOW, closes)).toBe(closes)
    expect(paymentWindowEnd(NOW, new Date(NOW - 1).toISOString())).toBe(new Date(NOW - 1).toISOString())
  })

  describe('3. crew seats on the organizer staff APIs', () => {
    async function withCrew() {
      const r = await paidRequest()
      await assignCrew(r.id, { uid: 'crew1', firstName: 'Jean' }, ADMIN)
      db.store.set(`events/${EVENT}/members/staff7`, { uid: 'staff7', role: 'staff', permissions: { checkin: true, viewAttendees: false }, source: 'org_team', createdAt: new Date() })
      db.store.set('users/crew1', { full_name: 'Jean Baptiste', email: 'jean@private.example', photo_url: 'https://x/p.jpg' })
      return r
    }
    it('listed as first name + Tikèm crew only (no uid, email, photo)', async () => {
      await withCrew()
      const res = await staffGET(new Request('http://x') as any, { params: Promise.resolve({ id: EVENT }) })
      const body = await res.json()
      const crew = body.members.filter((m: any) => m.tikemCrew)
      expect(crew).toEqual([
        { id: 'tikem-crew-1', role: 'tikem_crew', tikemCrew: true, permissions: { checkin: true, viewAttendees: false }, createdAt: null, profile: { email: null, full_name: 'Jean', photo_url: null } },
      ])
      const raw = JSON.stringify(body)
      expect(raw).not.toContain('crew1')
      expect(raw).not.toContain('jean@private.example')
      expect(raw).not.toContain('Baptiste')
      expect(body.members.some((m: any) => m.id === 'staff7')).toBe(true)
    })
    it('the organizer cannot change permissions, remove or re-assign a crew seat', async () => {
      await withCrew()
      const perm = await staffPermissions(post({ eventId: EVENT, memberId: 'crew1', permissions: { viewAttendees: true } }))
      expect(perm.status).toBe(403)
      expect((await perm.json()).code).toBe('tikem_crew_seat')
      expect(db.store.get(`events/${EVENT}/members/crew1`)!.permissions).toEqual({ checkin: true, viewAttendees: false })
      expect((await staffRemove(post({ eventId: EVENT, memberId: 'crew1' }))).status).toBe(403)
      expect(db.store.get(`events/${EVENT}/members/crew1`)).toBeDefined()
      const { teamRoleIn } = jest.requireMock('@/lib/organizer/context')
      teamRoleIn.mockResolvedValueOnce('staff')
      expect((await staffAssign(post({ eventId: EVENT, uid: 'crew1', permissions: { viewAttendees: true } }))).status).toBe(403)
      expect(db.store.get(`events/${EVENT}/members/crew1`)).toMatchObject({ source: 'tikem_door_team', permissions: { viewAttendees: false } })
      // Ordinary staff stay editable.
      expect((await staffPermissions(post({ eventId: EVENT, memberId: 'staff7', permissions: { viewAttendees: true } }))).status).toBe(200)
    })
    it('resolve never returns a crew email', async () => {
      await withCrew()
      const res = await staffResolve(post({ eventId: EVENT, uids: ['crew1', 'staff7'] }))
      const body = await res.json()
      expect(body.profiles.crew1).toEqual({ email: null, full_name: 'Jean' })
      expect(body.profiles.staff7.email).toBe('staff7@example.com')
    })
  })

  it('4. crediting a stray balance debit back does not mark a card-paid request refunded', async () => {
    const r = await paidRequest('pi_card')
    db.store.set(`door_team_requests/${r.id}`, { ...db.store.get(`door_team_requests/${r.id}`), payment: { ...r.payment, funds_rail: 'stripe_platform' } })
    db.store.set(`withdrawal_requests/doorteam_${r.id}`, { method: 'balance_offset', status: 'completed', amount: 1_050_000, eventId: 'ev9', doorTeamRequestId: r.id })
    db.store.set('event_earnings/ev9', { withdrawnAmount: 1_050_000 })
    expect(await creditBackDoorTeamOffset(r.id, 'system')).toMatchObject({ ok: true })
    expect(db.store.get('event_earnings/ev9')).toMatchObject({ withdrawnAmount: 0 })
    const after = (await getRequest(r.id))!
    expect(after.refund).toBeUndefined()
    expect(after.payment.refunded_to_balance_at).toBeUndefined()
  })

  it('5. the crew size and duplicates are re-checked inside the transaction', async () => {
    const r = await quoted({ staffCount: 2 })
    await markRequestPaid(r.id, { funds_rail: 'moncash', reference: 'MC1', amount: 7000, currency: 'HTG', price_htg: 7000 })
    await assignCrew(r.id, { uid: 'a', firstName: 'A' }, ADMIN)
    // Another admin's commit lands between this call's pre-check and its transaction.
    const concurrent = (uid: string) => {
      const real = db.runTransaction.bind(db)
      const spy = jest.spyOn(db, 'runTransaction').mockImplementationOnce(async (fn: any) => {
        const path = `door_team_requests/${r.id}`
        const cur = db.store.get(path)!
        db.store.set(path, { ...cur, crew: [...cur.crew, { uid, first_name: uid }], crew_uids: [...cur.crew_uids, uid] })
        return real(fn)
      })
      return spy
    }
    concurrent('b')
    expect(await assignCrew(r.id, { uid: 'c', firstName: 'C' }, ADMIN)).toMatchObject({ ok: false, code: 'crew_full' })
    expect(db.store.get(`events/${EVENT}/members/c`)).toBeUndefined()
    const mid = (await getRequest(r.id))!
    db.store.set(`door_team_requests/${r.id}`, { ...mid, crew: mid.crew.slice(0, 1), crew_uids: mid.crew_uids.slice(0, 1) })
    concurrent('d')
    // 'd' was just added concurrently: adding 'd' again is a no-op, not a duplicate.
    expect((await assignCrew(r.id, { uid: 'd', firstName: 'D' }, ADMIN)).ok).toBe(true)
    const after = (await getRequest(r.id))!
    expect(after.crew_uids).toEqual(['a', 'd'])
    jest.restoreAllMocks()
  })

  it('6. a paid request never confirmed is closed after the event (flagged for review)', async () => {
    const r = await paidRequest()
    await assignCrew(r.id, { uid: 'crew1', firstName: 'Jean' }, ADMIN)
    const over = Date.parse(r.event_end_at!) + 7 * HOUR
    const until = Date.parse((await getRequest(r.id))!.access_until)
    expect(await sweepDoorTeam({ now: Math.max(over, until + 1) })).toMatchObject({ done: 1 })
    expect(await getRequest(r.id)).toMatchObject({ status: 'done', needs_review: 'paid_never_confirmed' })
    expect(db.store.get(`events/${EVENT}/members/crew1`)).toBeUndefined()
  })

  it('7. before expiring, every rail started is asked (a card paid after switching to MonCash)', async () => {
    const r = await quoted()
    const card = await startCardDoorTeamPayment(r, 'https://x')
    await startMonCashDoorTeamPayment((await getRequest(r.id))!)
    // The card session was paid anyway, before Stripe expired it.
    Object.assign(sessions.get(card.sessionId), { payment_status: 'paid', amount_total: card.amountUsdCents })
    retrieveMonCashOrderPayment.mockResolvedValue({ success: false, payment_status: 'pending' })
    const later = Date.parse((await getRequest(r.id))!.quote_expires_at) + HOUR
    expect(await sweepDoorTeam({ now: later })).toMatchObject({ paid: 1, expired: 0 })
    expect((await getRequest(r.id))!.payment).toMatchObject({ funds_rail: 'stripe_platform', status: 'paid' })
  })

  it('8. crew never get the attendee list (door access and rules)', async () => {
    const seat = { role: 'staff', permissions: { checkin: true, viewAttendees: true }, source: 'tikem_door_team', access_from: new Date(NOW - HOUR), access_until: new Date(NOW + HOUR) }
    expect(evaluateDoorAccess({ uid: 'crew1', isAdmin: false, event: { organizer_id: 'org1' }, member: seat, now: NOW })).toMatchObject({ allowed: true, canViewAttendees: false })
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    const fn = rules.slice(rules.indexOf('function canViewAttendees'), rules.indexOf('function isTicketOwner'))
    expect(fn).toContain("get('source', '') != 'tikem_door_team'")
    expect(fn).toContain('memberSeatLive(')
  })
})
