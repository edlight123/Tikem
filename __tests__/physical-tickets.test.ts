/**
 * @jest-environment node
 *
 * Printed (physical) tickets — lib/physical. Pricing from the admin config,
 * batch creation reserving seats, QR tokens, activation (name required, first
 * wins, voided / reprinted refused, seller ranges), door states, releasing
 * unsold seats, and the admin config route's validation + auth.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

const reserveSeats = jest.fn()
const releaseSeats = jest.fn()
jest.mock('@/lib/tickets/inventoryShards', () => ({
  reserveSeats: (...a: any[]) => reserveSeats(...a),
  releaseSeats: (...a: any[]) => releaseSeats(...a),
}))

const requireAdmin = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireAdmin: () => requireAdmin(),
  getCurrentUser: jest.fn(async () => null),
}))
const logAdminAction = jest.fn()
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: (...a: any[]) => logAdminAction(...a) }))

import {
  DEFAULT_PHYSICAL_CONFIG,
  normalizeStoredConfig,
  quoteBatch,
  tierForQuantity,
  validatePhysicalConfig,
} from '@/lib/physical/config'
import {
  activationRefusal,
  canMoveBatch,
  checkPhysicalCode,
  formatSerial,
  looksLikeSerial,
  normalizeSerial,
  parsePhysicalQr,
  physicalDoorReason,
  physicalQrPayload,
  serialPrefix,
  tallyPhysical,
  tokenFromBytes,
} from '@/lib/physical/rules'
import {
  activatePhysicalTicket,
  assignRange,
  createBatch,
  getBatch,
  issueBatchTickets,
  markBatchPaid,
  moveBatch,
  newPhysicalToken,
  releaseUnsold,
  reprintBatch,
  voidRange,
} from '@/lib/physical/batches'
import { activationRoleFor } from '@/lib/physical/access'
import { ticketBlockReason } from '@/lib/scan/checkInTicket'
import { belongsOnDoorList, judgeDoorRow, judgeScannedCodeAgainstRow, toDoorRow } from '@/lib/scan/doorRules'
import { verifyScannedTicketCode } from '@/lib/tickets/qr'
import { htgToUsdCents } from '@/lib/physical/payments'
import { GET as configGET, PUT as configPUT } from '@/app/api/admin/physical-tickets/config/route'

beforeEach(() => {
  db.store.clear()
  reserveSeats.mockReset().mockResolvedValue({ ok: true, reservationId: 'r' })
  releaseSeats.mockReset().mockResolvedValue({ released: true, state: 'sold' })
  requireAdmin.mockReset()
  logAdminAction.mockReset()
})

// ── pricing ──────────────────────────────────────────────────────────────────

describe('pricing tiers from config', () => {
  const cfg = DEFAULT_PHYSICAL_CONFIG
  it('defaults: 100–499 = 40 HTG, 500+ = 30 HTG, minimum 100', () => {
    expect(quoteBatch(cfg, 100)).toMatchObject({ ok: true, unitPriceHtg: 40, totalHtg: 4000 })
    expect(quoteBatch(cfg, 499)).toMatchObject({ ok: true, unitPriceHtg: 40, totalHtg: 19960 })
    expect(quoteBatch(cfg, 500)).toMatchObject({ ok: true, unitPriceHtg: 30, totalHtg: 15000 })
    expect(quoteBatch(cfg, 99)).toMatchObject({ ok: false, code: 'below_minimum' })
    expect(quoteBatch(cfg, 100.5)).toMatchObject({ ok: false, code: 'invalid_quantity' })
    expect(quoteBatch(cfg, cfg.maxBatch + 1)).toMatchObject({ ok: false, code: 'above_maximum' })
  })

  it('reads whatever the admin stored, not hard-coded numbers', () => {
    const stored = normalizeStoredConfig({ enabled: true, minBatch: 50, maxBatch: 1000, tiers: [{ minQty: 50, priceHtgPerTicket: 55 }, { minQty: 200, priceHtgPerTicket: 25 }] })
    expect(quoteBatch(stored, 60)).toMatchObject({ ok: true, unitPriceHtg: 55 })
    expect(quoteBatch(stored, 200)).toMatchObject({ ok: true, unitPriceHtg: 25, totalHtg: 5000 })
    expect(tierForQuantity(stored, 49)).toBeNull()
  })

  it('disabled config refuses every order', () => {
    expect(quoteBatch({ ...cfg, enabled: false }, 300)).toMatchObject({ ok: false, code: 'disabled' })
  })

  it('a broken stored doc falls back to the defaults (never prices at 0)', () => {
    const n = normalizeStoredConfig({ enabled: true, minBatch: 100, tiers: [{ minQty: 100, priceHtgPerTicket: 0 }] })
    expect(n.tiers).toEqual(DEFAULT_PHYSICAL_CONFIG.tiers)
  })

  it('display prices are per tier', () => {
    const c = normalizeStoredConfig({ ...cfg, displayPrices: { USD: [0.3, 0.23] } })
    const q = quoteBatch(c, 500)
    expect(q.ok && q.display.USD).toEqual({ unit: 0.23, total: 115 })
  })

  it('card amount: HTG → USD cents at the rate, 50¢ floor', () => {
    expect(htgToUsdCents(12000, 0.0076)).toBe(9120)
    expect(htgToUsdCents(10, 0.0076)).toBe(50)
    expect(() => htgToUsdCents(100, 0)).toThrow()
  })
})

describe('admin config validation', () => {
  const good = { enabled: true, minBatch: 100, maxBatch: 5000, tiers: [{ minQty: 100, priceHtgPerTicket: 40 }, { minQty: 500, priceHtgPerTicket: 30 }] }
  it('accepts a sound config', () => {
    expect(validatePhysicalConfig(good)).toEqual({ ok: true, value: { ...good, displayPrices: null } })
  })
  it.each([
    ['unknown key', { ...good, fee: 1 }],
    ['non-boolean enabled', { ...good, enabled: 'yes' }],
    ['zero price', { ...good, tiers: [{ minQty: 100, priceHtgPerTicket: 0 }] }],
    ['tiers not ascending', { ...good, tiers: [{ minQty: 100, priceHtgPerTicket: 40 }, { minQty: 100, priceHtgPerTicket: 30 }] }],
    ['first tier not at the minimum', { ...good, tiers: [{ minQty: 200, priceHtgPerTicket: 40 }] }],
    ['max below min', { ...good, maxBatch: 50 }],
    ['fractional minimum', { ...good, minBatch: 100.5 }],
    ['no tiers', { ...good, tiers: [] }],
    ['unsupported display currency', { ...good, displayPrices: { JPY: [1, 1] } }],
    ['display list wrong length', { ...good, displayPrices: { USD: [1] } }],
  ])('refuses %s', (_label, input) => {
    expect(validatePhysicalConfig(input).ok).toBe(false)
  })
})

describe('admin config route', () => {
  const req = (body: unknown) => new Request('http://localhost/api/admin/physical-tickets/config', { method: 'PUT', body: JSON.stringify(body) }) as any
  it('401 signed out, 403 for non-admins', async () => {
    requireAdmin.mockResolvedValue({ user: null, error: 'Not authenticated' })
    expect((await configGET()).status).toBe(401)
    requireAdmin.mockResolvedValue({ user: null, error: 'Admin access required' })
    expect((await configPUT(req(DEFAULT_PHYSICAL_CONFIG))).status).toBe(403)
    expect(db.store.size).toBe(0)
  })
  it('400 on an invalid config, nothing written', async () => {
    requireAdmin.mockResolvedValue({ user: { id: 'a1', email: 'a@tikem.co' }, error: null })
    const res = await configPUT(req({ enabled: true, minBatch: 100, maxBatch: 10, tiers: [] }))
    expect(res.status).toBe(400)
    expect(db.store.get('config/physical_tickets')).toBeUndefined()
  })
  it('saves, records who/when, keeps history and audits', async () => {
    requireAdmin.mockResolvedValue({ user: { id: 'a1', email: 'a@tikem.co' }, error: null })
    const body = { enabled: true, minBatch: 100, maxBatch: 4000, tiers: [{ minQty: 100, priceHtgPerTicket: 45 }, { minQty: 1000, priceHtgPerTicket: 28 }] }
    const res = await configPUT(req(body))
    expect(res.status).toBe(200)
    const saved = db.store.get('config/physical_tickets')!
    expect(saved).toMatchObject({ ...body, updated_by: 'a1', updated_by_email: 'a@tikem.co' })
    expect(typeof saved.updated_at).toBe('string')
    expect(db.docsIn('config/physical_tickets/history')).toHaveLength(1)
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'physical_tickets.config.update', adminId: 'a1' }))
    const got = await (await configGET()).json()
    expect(got.config.tiers[0].priceHtgPerTicket).toBe(45)
  })
})

// ── tokens & serials ─────────────────────────────────────────────────────────

describe('QR tokens', () => {
  it('128-bit, base64url, unique, not derived from anything', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      const tok = newPhysicalToken()
      expect(tok).toMatch(/^[A-Za-z0-9_-]{22}$/)
      seen.add(tok)
    }
    expect(seen.size).toBe(2000)
    expect(() => tokenFromBytes(new Uint8Array(8))).toThrow()
  })
  it('payload round-trips and never contains the serial', () => {
    const tok = newPhysicalToken()
    const p = physicalQrPayload('tk1', 1, tok)
    expect(parsePhysicalQr(p)).toEqual({ ticketId: 'tk1', v: 1, s: tok })
    expect(p).not.toContain('FETE')
    expect(parsePhysicalQr('tk1')).toBeNull()
    expect(parsePhysicalQr(JSON.stringify({ ticketId: 'tk1', v: 0, s: tok }))).toBeNull()
  })
  it('serials', () => {
    expect(serialPrefix('Fête de la Musique', 'VIP')).toBe('FETE-VIP')
    expect(formatSerial('FETE-VIP', 7, 300)).toBe('FETE-VIP-0007')
    expect(formatSerial('A-B', 7, 12000)).toBe('A-B-00007')
    expect(normalizeSerial(' fete–vip 0007 ')).toBe('FETE-VIP-0007')
    expect(looksLikeSerial('fete-vip-0007')).toBe(true)
    expect(looksLikeSerial('{"ticketId":"x"}')).toBe(false)
  })
})

// ── batches ──────────────────────────────────────────────────────────────────

const EVENT = 'ev1'
function seedEvent() {
  db.store.set(`events/${EVENT}`, { title: 'Fête de la Musique', organizer_id: 'org1', currency: 'HTG' })
  db.store.set('ticket_tiers/vip', { event_id: EVENT, name: 'VIP', price: 1500, total_quantity: 400 })
}

async function readyBatch(quantity = 100) {
  const b = await paidBatch(quantity)
  await moveBatch(b.id, 'printing', 'admin')
  await moveBatch(b.id, 'ready', 'admin')
  return (await getBatch(b.id))!
}

async function paidBatch(quantity = 120) {
  seedEvent()
  const created = await createBatch({ eventId: EVENT, event: db.store.get(`events/${EVENT}`)!, orgId: 'org1', tierId: 'vip', quantity, method: 'moncash', createdBy: 'u1' })
  if (!created.ok) throw new Error(created.error)
  await markBatchPaid(created.batch.id, { funds_rail: 'moncash', reference: 'tx1', amount: created.batch.total_htg, currency: 'HTG' })
  return (await getBatch(created.batch.id))!
}

const tickets = () => db.docsIn('tickets').map(([p, d]) => ({ id: p.split('/')[1], ...d }))

describe('batch creation', () => {
  it('prices from the live config and reserves the seats immediately (sold, on the shards)', async () => {
    seedEvent()
    db.store.set('config/physical_tickets', { enabled: true, minBatch: 100, maxBatch: 5000, tiers: [{ minQty: 100, priceHtgPerTicket: 35 }] })
    const r = await createBatch({ eventId: EVENT, event: db.store.get(`events/${EVENT}`)!, orgId: 'org1', tierId: 'vip', quantity: 300, method: 'card', createdBy: 'u1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(reserveSeats).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT, quantity: 300, tierIncrements: [{ tierId: 'vip', quantity: 300 }], mode: 'sold', reservationId: `phys_${r.batch.id}` })
    )
    expect(r.batch).toMatchObject({ status: 'awaiting_payment', unit_price_htg: 35, total_htg: 10500, serial_prefix: 'FETE-VIP' })
    expect(r.batch.payment.funds_rail).toBe('stripe_platform')
    // Nothing issued before payment.
    expect(tickets()).toHaveLength(0)
  })

  it('refuses when the tier has no room and writes nothing', async () => {
    seedEvent()
    reserveSeats.mockResolvedValue({ ok: false, reason: 'tier_capacity', remaining: 40 })
    const r = await createBatch({ eventId: EVENT, event: {}, orgId: 'org1', tierId: 'vip', quantity: 100, method: 'moncash', createdBy: 'u1' })
    expect(r).toMatchObject({ ok: false, status: 409, remaining: 40 })
    expect(db.docsIn('physical_batches')).toHaveLength(0)
  })

  it('refuses a tier of another event and a quantity below the minimum', async () => {
    seedEvent()
    db.store.set('ticket_tiers/other', { event_id: 'ev2', name: 'GA' })
    expect(await createBatch({ eventId: EVENT, event: {}, orgId: 'org1', tierId: 'other', quantity: 100, method: 'moncash', createdBy: 'u1' })).toMatchObject({ ok: false, code: 'tier_not_found' })
    expect(await createBatch({ eventId: EVENT, event: {}, orgId: 'org1', tierId: 'vip', quantity: 99, method: 'moncash', createdBy: 'u1' })).toMatchObject({ ok: false, code: 'below_minimum' })
    expect(reserveSeats).not.toHaveBeenCalled()
  })

  it('payment issues N printed_unsold tickets once (idempotent), each with its own serial and token', async () => {
    const batch = await paidBatch(120)
    expect(batch.status).toBe('paid')
    expect(batch.payment).toMatchObject({ status: 'paid', funds_rail: 'moncash' })
    let all = tickets()
    expect(all).toHaveLength(120)
    expect(new Set(all.map((t) => t.physical_serial)).size).toBe(120)
    expect(new Set(all.map((t) => t.qr_code_data)).size).toBe(120)
    for (const t of all) {
      expect(t).toMatchObject({ kind: 'physical', status: 'printed_unsold', price_paid: 0, qr_version: 1, reservation_id: `phys_${batch.id}` })
      expect(parsePhysicalQr(t.qr_code_data)?.ticketId).toBe(t.id)
    }
    // A second confirmation (webhook + return) issues nothing more.
    await markBatchPaid(batch.id, { funds_rail: 'moncash', reference: 'tx1', amount: 1, currency: 'HTG' })
    await issueBatchTickets(batch.id)
    all = tickets()
    expect(all).toHaveLength(120)
  })
})

// ── activation ───────────────────────────────────────────────────────────────

describe('activation rules', () => {
  const tok = 'A'.repeat(22)
  const base = { event_id: EVENT, kind: 'physical', status: 'printed_unsold', physical_seller_uid: 'seller1', qr_code_data: physicalQrPayload('t1', 2, tok) }
  const manager = { uid: 'm1', role: 'manager' as const }
  const seller = { uid: 'seller1', role: 'seller' as const }
  const ok = { name: 'Marie Pierre' }
  const judge = (over: Record<string, any> = {}, extra: Record<string, any> = {}) =>
    activationRefusal({ ticketId: 't1', ticket: { ...base, ...over }, eventId: EVENT, actor: manager, input: ok, ...extra })

  it('admits an unsold ticket with a name', () => {
    expect(judge()).toBeNull()
    expect(judge({}, { actor: seller })).toBeNull()
    expect(judge({}, { code: physicalQrPayload('t1', 2, tok) })).toBeNull()
  })
  it('name is required', () => {
    expect(judge({}, { input: { name: '   ' } })).toBe('NAME_REQUIRED')
  })
  it('first activation wins', () => {
    expect(judge({ status: 'valid', attendee_name: 'Jean' })).toBe('ALREADY_ACTIVATED')
  })
  it('voided / released / reprinted codes are refused', () => {
    expect(judge({ status: 'voided' })).toBe('VOIDED')
    expect(judge({ status: 'released' })).toBe('RELEASED')
    expect(judge({}, { code: physicalQrPayload('t1', 1, tok) })).toBe('VOIDED')
    expect(judge({}, { code: physicalQrPayload('t1', 2, 'B'.repeat(22)) })).toBe('INVALID_CODE')
    expect(judge({}, { code: physicalQrPayload('t2', 2, tok) })).toBe('INVALID_CODE')
  })
  it('sellers only inside their assigned range; managers anywhere', () => {
    expect(judge({ physical_seller_uid: 'someone_else' }, { actor: seller })).toBe('NOT_YOUR_RANGE')
    expect(judge({ physical_seller_uid: null }, { actor: seller })).toBe('NOT_YOUR_RANGE')
    expect(judge({ physical_seller_uid: 'someone_else' })).toBeNull()
  })
  it('wrong event, not physical, missing', () => {
    expect(judge({ event_id: 'other' })).toBe('WRONG_EVENT')
    expect(judge({ kind: undefined })).toBe('NOT_PHYSICAL')
    expect(activationRefusal({ ticketId: 't1', ticket: null, eventId: EVENT, actor: manager, input: ok })).toBe('NOT_FOUND')
  })
  it('activation role: managers and org sellers only', () => {
    expect(activationRoleFor({ managesEvent: true, orgRole: 'manager' })).toBe('manager')
    expect(activationRoleFor({ managesEvent: false, orgRole: 'seller' })).toBe('seller')
    expect(activationRoleFor({ managesEvent: false, orgRole: 'staff' })).toBeNull()
    expect(activationRoleFor({ managesEvent: false, orgRole: null })).toBeNull()
  })
})

describe('activation end to end (seller ranges, first wins, offline retry)', () => {
  it('a batch still at the printer cannot sell; the first sale flips ready → active', async () => {
    const paid = await paidBatch(100)
    const t = tickets()[0]
    const manager = { uid: 'm1', role: 'manager' as const }
    expect(await activatePhysicalTicket({ eventId: EVENT, serial: t.physical_serial, input: { name: 'X' }, actor: manager })).toMatchObject({ ok: false, code: 'BATCH_NOT_READY' })
    await moveBatch(paid.id, 'printing', 'admin')
    await moveBatch(paid.id, 'ready', 'admin')
    expect(await activatePhysicalTicket({ eventId: EVENT, serial: t.physical_serial, input: { name: 'X' }, actor: manager })).toMatchObject({ ok: true })
    expect((await getBatch(paid.id))!.status).toBe('active')
  })

  it('assign → activate by serial and by QR → second activation refused', async () => {
    const batch = await readyBatch(100)
    await assignRange({ batch, range: { from: 1, to: 10 }, seller: { uid: 's1', name: 'Seller One' } })
    const b2 = (await getBatch(batch.id))!
    expect(b2.seller_uids).toEqual(['s1'])
    const all = tickets().sort((a, b) => a.physical_serial_no - b.physical_serial_no)
    expect(all.filter((t) => t.physical_seller_uid === 's1')).toHaveLength(10)

    const seller = { uid: 's1', role: 'seller' as const }
    // Outside the range.
    expect(await activatePhysicalTicket({ eventId: EVENT, serial: all[20].physical_serial, input: { name: 'X' }, actor: seller })).toMatchObject({ ok: false, code: 'NOT_YOUR_RANGE' })
    // Name required.
    expect(await activatePhysicalTicket({ eventId: EVENT, serial: all[0].physical_serial, input: { name: '' }, actor: seller })).toMatchObject({ ok: false, code: 'NAME_REQUIRED' })
    // By typed serial (any case/spacing).
    const r1 = await activatePhysicalTicket({ eventId: EVENT, serial: all[0].physical_serial.toLowerCase(), input: { name: 'Marie', phone: '+509 3700 0000', method: 'cash', amount: 1500 }, actor: seller, clientRef: 'q1', offline: true })
    expect(r1).toMatchObject({ ok: true, holderName: 'Marie' })
    const t0 = db.store.get(`tickets/${all[0].id}`)!
    expect(t0).toMatchObject({ status: 'valid', attendee_name: 'Marie', holder_phone: '+50937000000', price_paid: 0 })
    expect(t0.physical_sale).toMatchObject({ method: 'cash', amount: 1500, activated_by: 's1', offline: true, client_ref: 'q1' })
    // The same queued activation retried: done, not a conflict.
    expect(await activatePhysicalTicket({ eventId: EVENT, serial: all[0].physical_serial, input: { name: 'Marie' }, actor: seller, clientRef: 'q1' })).toMatchObject({ ok: true, alreadyDone: true })
    // Another phone, later: first wins.
    expect(await activatePhysicalTicket({ eventId: EVENT, code: all[0].qr_code_data, input: { name: 'Paul' }, actor: { uid: 'm1', role: 'manager' }, clientRef: 'q9' })).toMatchObject({ ok: false, code: 'ALREADY_ACTIVATED', holderName: 'Marie' })
    // By QR.
    expect(await activatePhysicalTicket({ eventId: EVENT, code: all[1].qr_code_data, input: { name: 'Ana' }, actor: seller })).toMatchObject({ ok: true })
  })

  it('reprint voids the old codes; a voided range cannot be activated', async () => {
    const batch = await readyBatch(100)
    const before = tickets().sort((a, b) => a.physical_serial_no - b.physical_serial_no)
    const r = await reprintBatch(batch.id, 'admin')
    expect(r).toMatchObject({ ok: true, reissued: 100 })
    const manager = { uid: 'm1', role: 'manager' as const }
    expect(await activatePhysicalTicket({ eventId: EVENT, code: before[0].qr_code_data, input: { name: 'X' }, actor: manager })).toMatchObject({ ok: false, code: 'VOIDED' })
    const fresh = db.store.get(`tickets/${before[0].id}`)!
    expect(parsePhysicalQr(fresh.qr_code_data)?.v).toBe(2)
    expect(await activatePhysicalTicket({ eventId: EVENT, code: fresh.qr_code_data, input: { name: 'X' }, actor: manager })).toMatchObject({ ok: true })

    await voidRange({ batch: (await getBatch(batch.id))!, range: { from: 50, to: 59 }, by: 'm1', reason: 'lost' })
    expect(await activatePhysicalTicket({ eventId: EVENT, serial: before[49].physical_serial, input: { name: 'X' }, actor: manager })).toMatchObject({ ok: false, code: 'VOIDED' })
  })
})

// ── door ─────────────────────────────────────────────────────────────────────

describe('door states for printed tickets', () => {
  const tok = 'C'.repeat(22)
  const unsold = { event_id: EVENT, kind: 'physical', status: 'printed_unsold', qr_version: 1, qr_code_data: physicalQrPayload('p1', 1, tok) }
  const sold = { ...unsold, status: 'valid', attendee_name: 'Marie' }

  it('unactivated = "not sold, not valid"; activated admits with the holder name', () => {
    expect(ticketBlockReason(unsold)).toBe('NOT_SOLD')
    expect(physicalDoorReason(unsold)).toBe('NOT_SOLD')
    expect(ticketBlockReason({ ...unsold, status: 'voided' })).toBe('VOIDED')
    expect(ticketBlockReason({ ...unsold, status: 'released' })).toBe('VOIDED')
    expect(ticketBlockReason(sold)).toBeNull()
  })

  it('the server checks the printed token, not an HMAC', () => {
    expect(verifyScannedTicketCode(sold.qr_code_data, 'p1', sold)).toBe('OK')
    expect(verifyScannedTicketCode(physicalQrPayload('p1', 1, 'D'.repeat(22)), 'p1', sold)).toBe('INVALID_CODE')
    expect(verifyScannedTicketCode('p1', 'p1', sold)).toBe('INVALID_CODE')
    expect(checkPhysicalCode(physicalQrPayload('p1', 0 + 1, tok), 'p1', { ...sold, qr_code_data: physicalQrPayload('p1', 2, 'E'.repeat(22)) })).toBe('VOIDED_CODE')
  })

  it('door list carries unsold printed tickets (refused offline), and judges like the scanner', () => {
    expect(belongsOnDoorList(unsold)).toBe(true)
    expect(belongsOnDoorList({ ...unsold, status: 'voided' })).toBe(false)
    const rowUnsold = toDoorRow('p1', unsold)
    expect(rowUnsold.live).toBe(false)
    expect(judgeDoorRow(rowUnsold, { eventId: EVENT, allowReentry: false, codeCheck: 'OK' }).verdict).toBe('CANCELLED')
    const rowSold = toDoorRow('p1', sold)
    expect(judgeDoorRow(rowSold, { eventId: EVENT, allowReentry: false, codeCheck: 'OK' })).toMatchObject({ verdict: 'CHECKED_IN', admit: true })
    expect(rowSold.name).toBe('Marie')
    // Offline: only the exact current code admits (a bare id or an old version does not).
    expect(judgeScannedCodeAgainstRow(sold.qr_code_data, rowSold)).toBe('OK')
    expect(judgeScannedCodeAgainstRow('p1', rowSold)).toBe('TRANSFERRED')
    expect(judgeScannedCodeAgainstRow(physicalQrPayload('p1', 1, 'F'.repeat(22)), rowSold)).toBe('INVALID_CODE')
    // Already in: one scan only.
    const rowIn = toDoorRow('p1', { ...sold, checked_in: true, checked_in_at: '2026-01-01T00:00:00Z' })
    expect(judgeDoorRow(rowIn, { eventId: EVENT, allowReentry: false, codeCheck: 'OK' }).verdict).toBe('ALREADY_CHECKED_IN')
  })
})

// ── release, dashboard, flow ─────────────────────────────────────────────────

describe('release unsold seats', () => {
  it('releases unsold + voided seats once, leaves sold tickets alone', async () => {
    const batch = await readyBatch(100)
    const all = tickets().sort((a, b) => a.physical_serial_no - b.physical_serial_no)
    const manager = { uid: 'm1', role: 'manager' as const }
    for (const t of all.slice(0, 30)) {
      await activatePhysicalTicket({ eventId: EVENT, serial: t.physical_serial, input: { name: 'Buyer' }, actor: manager })
    }
    await voidRange({ batch, range: { from: 31, to: 40 }, by: 'm1' })
    const r = await releaseUnsold({ batch: (await getBatch(batch.id))!, by: 'm1' })
    expect(r).toEqual({ ok: true, released: 70 })
    expect(releaseSeats).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: `phys_${batch.id}`, quantity: 70, tierIncrements: [{ tierId: 'vip', quantity: 70 }] })
    )
    const after = tickets()
    expect(after.filter((t) => t.status === 'valid')).toHaveLength(30)
    expect(after.filter((t) => t.status === 'released')).toHaveLength(60)
    expect(after.filter((t) => t.status === 'voided')).toHaveLength(10)
    // Running it again releases nothing more.
    releaseSeats.mockClear()
    expect(await releaseUnsold({ batch: (await getBatch(batch.id))!, by: 'm1' })).toEqual({ ok: true, released: 0 })
    expect(releaseSeats).not.toHaveBeenCalled()

    const tally = tallyPhysical(after)
    expect(tally.total).toMatchObject({ printed: 100, activated: 30, released: 60, voided: 10, unsold: 0 })
  })
})

describe('batch status flow', () => {
  it('moves one step at a time; only unpaid batches cancel', () => {
    expect(canMoveBatch('awaiting_payment', 'paid')).toBe(true)
    expect(canMoveBatch('paid', 'printing')).toBe(true)
    expect(canMoveBatch('printing', 'ready')).toBe(true)
    expect(canMoveBatch('ready', 'active')).toBe(true)
    expect(canMoveBatch('paid', 'ready')).toBe(false)
    expect(canMoveBatch('active', 'printing')).toBe(false)
    expect(canMoveBatch('awaiting_payment', 'cancelled')).toBe(true)
    expect(canMoveBatch('paid', 'cancelled')).toBe(false)
  })
})
