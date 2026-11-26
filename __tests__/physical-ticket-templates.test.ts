/**
 * @jest-environment node
 *
 * Printed-ticket design gallery (lib/physical/design, owner 2026-11-25):
 *  - the template registry (six tall stub designs, swatches, tiers, names);
 *  - every template draws the security essentials (QR, serial on body and
 *    stub, "VALIDE UNE FOIS VENDU", holder line, microtext with the serial)
 *    in French for a Haiti event, in the PDF and in the SVG proof;
 *  - the order route refuses a batch whose proof was not approved, and stores
 *    the approved design on the batch; "pay" refuses an unapproved batch;
 *  - the per-template surcharge lands in the quote and the charged total;
 *  - the print PDF still prints only unsold tickets, in the batch's design.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
const BUCKET = 'tikem-test.appspot.com'
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
  adminStorage: { bucket: () => ({ name: 'tikem-test.appspot.com', file: () => ({ download: async () => [Buffer.alloc(0)] }) }) },
}))

const reserveSeats = jest.fn()
const releaseSeats = jest.fn()
jest.mock('@/lib/tickets/inventoryShards', () => ({
  reserveSeats: (...a: any[]) => reserveSeats(...a),
  releaseSeats: (...a: any[]) => releaseSeats(...a),
}))

const gateUser = { id: 'u1', email: 'o@x.co' }
jest.mock('@/lib/organizer/context', () => ({
  requireEventAccess: async (eventId: string) => ({
    ok: true,
    value: { user: gateUser, event: db.store.get(`events/${eventId}`) || {}, eventId, orgId: 'org1', role: 'owner' },
  }),
  teamCol: () => ({ get: async () => ({ docs: [] }), doc: () => ({ get: async () => ({ exists: false }) }) }),
}))
jest.mock('@/lib/rate-limit', () => ({ consumeRateLimit: async () => ({ limited: false }) }))
const startMonCashBatchPayment = jest.fn(async (b: any) => ({ redirectUrl: `https://moncash.example/${b.id}`, orderId: 'o1' }))
jest.mock('@/lib/physical/payments', () => ({
  CardFxUnavailableError: class extends Error {},
  startMonCashBatchPayment: (b: any) => startMonCashBatchPayment(b),
  startCardBatchPayment: jest.fn(),
  verifyCardBatchPayment: jest.fn(),
  verifyMonCashBatchPayment: jest.fn(),
}))
jest.mock('@/lib/physical/balanceOffset', () => ({
  canUseBalance: async () => false,
  loadOffsetCandidates: async () => [],
  payBatchFromBalance: jest.fn(),
  cancelPaidFromBalance: jest.fn(),
  reconcileOffset: async () => 'none',
}))

import { TICKET_TEMPLATES, TEMPLATE_IDS, designOf, getTemplate, validateDesignInput } from '@/lib/physical/design/registry'
import { buildTicketFacts, ticketPrice, TICKET_LABELS } from '@/lib/physical/design/facts'
import { drawProofSvg } from '@/lib/physical/design/proof'
import { quoteBatch, validatePhysicalConfig, DEFAULT_PHYSICAL_CONFIG, normalizeStoredConfig } from '@/lib/physical/config'
import { sheetLayout, ticketBox, TICKET_PT } from '@/lib/physical/pdf'
import { POST as orderPOST } from '@/app/api/organizer/events/[id]/physical-batches/route'
import { POST as batchPOST } from '@/app/api/organizer/events/[id]/physical-batches/[batchId]/route'
import { createBatch, getBatch } from '@/lib/physical/batches'

const EVENT = 'ev1'
// Saturday 20 June 2026, 8:00 PM in Port-au-Prince.
const HT_EVENT = {
  title: 'Fête de la Musique',
  start_datetime: '2026-06-21T00:00:00.000Z',
  country: 'HT',
  city: 'Port-au-Prince',
  venue_name: 'Champ de Mars',
  currency: 'HTG',
  organizer_id: 'org1',
  banner_image: 'https://firebasestorage.googleapis.com/v0/b/tikem-test.appspot.com/o/event-images%2Fposter.jpg?alt=media&token=t',
}
const ownUpload = (name: string, eventId = EVENT) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`event-photos/${eventId}/printed/${name}`)}?alt=media&token=x`

beforeEach(() => {
  db.store.clear()
  reserveSeats.mockReset().mockResolvedValue({ ok: true })
  releaseSeats.mockReset().mockResolvedValue({ released: true })
  startMonCashBatchPayment.mockClear()
  db.store.set(`events/${EVENT}`, { ...HT_EVENT })
  db.store.set('ticket_tiers/vip', { event_id: EVENT, name: 'VIP', price: 7000 })
})

describe('template registry', () => {
  it('has the six approved designs, versioned, named in en/fr/ht', () => {
    expect(TEMPLATE_IDS).toEqual(['coloured_card', 'kraft_foil', 'clean_white', 'poster_photo', 'bold_type', 'veve_border'])
    for (const t of TICKET_TEMPLATES) {
      expect(t.version).toBeGreaterThanOrEqual(1)
      expect(t.name.en && t.name.fr && t.name.ht).toBeTruthy()
      expect(t.swatches.length).toBeGreaterThanOrEqual(4)
      expect(t.swatches.length).toBeLessThanOrEqual(6)
      for (const s of t.swatches) {
        expect(s.hex).toMatch(/^#[0-9A-F]{6}$/)
        expect(s.name.fr).toBeTruthy()
      }
      expect(['cybercafe', 'print_shop']).toContain(t.tier)
    }
    expect(getTemplate('coloured_card')).toMatchObject({ tier: 'cybercafe', usesPhoto: true, swatchRole: 'stock' })
    expect(getTemplate('poster_photo')).toMatchObject({ tier: 'print_shop', usesPhoto: true })
    expect(getTemplate('bold_type')).toMatchObject({ usesPhoto: false })
  })

  it('validates a design: template, colour, only this event’s uploads or its poster, ≤ 3 logos, clean wording', () => {
    const sources = { isOwnUpload: (u: string) => u.includes(`event-photos%2F${EVENT}%2Fprinted%2F`), posterUrl: HT_EVENT.banner_image }
    expect(validateDesignInput({ template: 'nope' }, sources)).toMatchObject({ ok: false, code: 'unknown_template' })
    expect(validateDesignInput({ template: 'coloured_card', color: 'teal' }, sources)).toMatchObject({ ok: false, code: 'unknown_color' })
    expect(validateDesignInput({ template: 'coloured_card', photoUrl: 'https://evil.example/x.jpg' }, sources)).toMatchObject({ ok: false, code: 'bad_photo' })
    expect(validateDesignInput({ template: 'coloured_card', photoUrl: ownUpload('p.jpg', 'other') }, sources)).toMatchObject({ ok: false, code: 'bad_photo' })
    expect(validateDesignInput({ template: 'clean_white', logos: [ownUpload('a.png'), ownUpload('b.png'), ownUpload('c.png'), ownUpload('d.png')] }, sources)).toMatchObject({
      ok: false,
      code: 'too_many_logos',
    })
    const ok = validateDesignInput(
      { template: 'coloured_card', color: 'pink', photoUrl: HT_EVENT.banner_image, logos: [ownUpload('a.png')], overrides: { title: '  Fête\u0000 de la\n Musique ', phone: '+509 3187 5567', priceLine: '' } },
      sources
    )
    expect(ok).toMatchObject({
      ok: true,
      value: { template: 'coloured_card', version: 1, color: 'pink', photo_source: 'poster', logos: [ownUpload('a.png')], overrides: { title: 'Fête de la Musique', phone: '+509 3187 5567' } },
    })
    // A template without a photo drops it.
    expect(validateDesignInput({ template: 'bold_type', photoUrl: ownUpload('p.jpg') }, sources)).toMatchObject({ ok: true, value: { photo_url: null } })
  })

  it('a batch ordered before the gallery prints the default design', () => {
    expect(designOf({})).toMatchObject({ template: 'clean_white', color: 'teal', approved_at: null })
    expect(designOf({ design: { template: 'kraft_foil', color: 'sage' } })).toMatchObject({ template: 'kraft_foil', color: 'sage' })
  })
})

describe('ticket facts for a Haiti event', () => {
  it('French, 12-hour clock, HTG without decimals', () => {
    const f = buildTicketFacts({ event: HT_EVENT, tierName: 'VIP', tierPrice: 7000, currency: 'HTG', lang: 'fr' })
    expect(f).toMatchObject({ dayShort: 'Sam 20 juin', time: '8:00 PM', priceLine: '7 000 HTG', venueLine: 'Champ de Mars, Port-au-Prince', dateNumeric: '20.06.26' })
    expect(f.dateLong).toBe('samedi 20 juin 2026')
    expect(ticketPrice(1500.5, 'HTG', 'fr')).toBe('1 500,50 HTG')
    expect(buildTicketFacts({ event: HT_EVENT, tierName: 'VIP', tierPrice: 0, lang: 'fr' }).priceLine).toBe('GRATUIT')
  })
})

const ticket = { serial: 'FETE-VIP-B1-0001', qrPayload: 'TKP2.test', tierName: 'VIP' }

describe('every template draws the security essentials', () => {
  const facts = buildTicketFacts({ event: HT_EVENT, tierName: 'VIP', tierPrice: 7000, currency: 'HTG', lang: 'fr' })

  it.each(TEMPLATE_IDS)('%s: SVG proof front and back', (id) => {
    const design = designOf({ design: { template: id } })
    const front = drawProofSvg({ design, facts, lang: 'fr', assets: { photo: null, logos: [] }, serial: ticket.serial, side: 'front' })
    expect(front).toMatch(/^<svg /)
    expect(front).toContain('FETE-VIP-B1-0001') // serial (stub)
    expect(front).toContain('TALON · VALIDE UNE FOIS VENDU')
    expect(front).toContain('TITULAIRE')
    expect(front).toMatch(/TIKEM·SECURE·FETE-VIP-B1-0001·TIKEM·SECURE/) // microtext
    expect(front).toContain('shape-rendering="crispEdges"') // the QR
    expect(front).toContain('8:00 PM')
    expect(front).toMatch(/7 000 HTG/)
    // Perforation notches are die-cut (the kraft design has a dotted tear line instead).
    if (id !== 'kraft_foil') expect(front).toContain('mask=')
    expect(front).not.toMatch(/ADMIT ONE|STUB ·|HOLDER/)
    const back = drawProofSvg({ design, facts, lang: 'fr', assets: { photo: null, logos: [] }, serial: ticket.serial, side: 'back' })
    expect(back).toContain('COMMENT FONCTIONNE CE BILLET')
    expect(back).toContain('FETE-VIP-B1-0001')
  })

  it('escapes the organizer’s words in the SVG', () => {
    const f = buildTicketFacts({ event: { ...HT_EVENT, title: '<script>x</script>' }, tierName: 'VIP', tierPrice: 1, lang: 'fr' })
    const svg = drawProofSvg({ design: designOf({ design: { template: 'clean_white' } }), facts: f, lang: 'fr', assets: { photo: null, logos: [] }, serial: 'A-0001', side: 'front' })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it.each(TEMPLATE_IDS)('%s: the PDF writes the serial, the French labels and the QR', async (id) => {
    const drawn: string[] = []
    let rects = 0
    jest.doMock('jspdf', () => {
      const real = jest.requireActual('jspdf')
      class Recording extends real.jsPDF {
        constructor(...args: any[]) {
          super(...args)
          const text = (this as any).text.bind(this)
          ;(this as any).text = (t: any, ...rest: any[]) => {
            drawn.push(...(Array.isArray(t) ? t : [t]).map(String))
            return text(t, ...rest)
          }
          const rect = (this as any).rect.bind(this)
          ;(this as any).rect = (...a: any[]) => {
            rects++
            return rect(...a)
          }
        }
      }
      return { ...real, jsPDF: Recording }
    })
    let render: any
    jest.isolateModules(() => {
      render = require('@/lib/physical/pdf').renderBatchPdf
    })
    const pdf: Uint8Array = await render({ design: designOf({ design: { template: id } }), facts, tickets: [ticket], lang: 'fr', backs: true })
    jest.dontMock('jspdf')
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
    expect(drawn).toEqual(expect.arrayContaining(['FETE-VIP-B1-0001', 'TALON · VALIDE UNE FOIS VENDU', 'TITULAIRE', 'COMMENT FONCTIONNE CE BILLET']))
    expect(drawn.some((s) => s.includes('TIKEM·SECURE·FETE-VIP-B1-0001'))).toBe(true)
    expect(drawn.join(' ')).toMatch(/8:00 PM/)
    expect(drawn.join(' ')).not.toMatch(/ADMIT ONE|HOLDER|20:00/)
    expect(rects).toBeGreaterThan(60) // the QR's module runs (vector)
  }, 60_000)

  it('imposes tall 2.75 × 7 in tickets: 3 across Letter, 4 across A4, inside a printable margin; backs mirror', () => {
    expect(TICKET_PT).toEqual({ w: 198, h: 504 })
    expect(sheetLayout('letter').cols).toBe(3)
    expect(sheetLayout('a4').cols).toBe(4)
    for (const paper of ['letter', 'a4'] as const) {
      const n = sheetLayout(paper).cols
      const first = ticketBox(paper, 0)
      const last = ticketBox(paper, n - 1)
      const page = paper === 'a4' ? { w: 841.89, h: 595.28 } : { w: 792, h: 612 }
      expect(first.x).toBeGreaterThanOrEqual(18)
      expect(page.w - (last.x + last.w)).toBeGreaterThanOrEqual(17.99)
      expect(first.y).toBeGreaterThanOrEqual(18)
      expect(ticketBox(paper, 0, true).x).toBeCloseTo(last.x)
    }
  })
})

describe('the template surcharge is in the quote', () => {
  it('validates per-template surcharges and adds them per ticket', () => {
    expect(validatePhysicalConfig({ ...DEFAULT_PHYSICAL_CONFIG, displayPrices: null, templateSurcharges: { nope: 5 } })).toMatchObject({ ok: false, field: 'templateSurcharges' })
    expect(validatePhysicalConfig({ ...DEFAULT_PHYSICAL_CONFIG, displayPrices: null, templateSurcharges: { kraft_foil: -1 } })).toMatchObject({ ok: false })
    const v = validatePhysicalConfig({ ...DEFAULT_PHYSICAL_CONFIG, displayPrices: { USD: [0.3, 0.23] }, templateSurcharges: { kraft_foil: 10, clean_white: 0 } })
    expect(v).toMatchObject({ ok: true, value: { templateSurcharges: { kraft_foil: 10 } } })
    const config = (v as any).value
    expect(quoteBatch(config, 100, 'clean_white')).toMatchObject({ ok: true, unitPriceHtg: 40, surchargeHtgPerTicket: 0, totalHtg: 4000 })
    const q = quoteBatch(config, 100, 'kraft_foil') as any
    expect(q).toMatchObject({ ok: true, unitPriceHtg: 50, baseUnitPriceHtg: 40, surchargeHtgPerTicket: 10, totalHtg: 5000 })
    expect(q.display.USD.unit).toBeCloseTo(0.38, 2)
    // Default: none. A stored doc keeps them.
    expect(quoteBatch(DEFAULT_PHYSICAL_CONFIG, 100, 'kraft_foil')).toMatchObject({ totalHtg: 4000 })
    expect(normalizeStoredConfig({ ...DEFAULT_PHYSICAL_CONFIG, templateSurcharges: { kraft_foil: 10 } }).templateSurcharges).toEqual({ kraft_foil: 10 })
  })
})

const post = (body: any) => new Request(`http://localhost/api/organizer/events/${EVENT}/physical-batches`, { method: 'POST', body: JSON.stringify(body) }) as any
const ctx = { params: Promise.resolve({ id: EVENT }) }

describe('the proof must be approved, server-side', () => {
  const design = { template: 'kraft_foil', color: 'sage', photoUrl: ownUpload('artist.jpg'), logos: [ownUpload('logo.png')], overrides: { phone: '+509 3187 5567' } }

  it('refuses an order without the approval: nothing reserved, nothing charged', async () => {
    const res = await orderPOST(post({ tierId: 'vip', quantity: 100, method: 'moncash', design }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('proof_not_approved')
    expect(reserveSeats).not.toHaveBeenCalled()
    expect(startMonCashBatchPayment).not.toHaveBeenCalled()
  })

  it('refuses a design without a template, or with an outside image', async () => {
    expect((await (await orderPOST(post({ tierId: 'vip', quantity: 100, approveProof: true }), ctx)).json()).code).toBe('design_required')
    const res = await orderPOST(post({ tierId: 'vip', quantity: 100, approveProof: true, design: { ...design, photoUrl: 'https://evil.example/a.jpg' } }), ctx)
    expect(res.status).toBe(400)
    expect(reserveSeats).not.toHaveBeenCalled()
  })

  it('stores the approved design on the batch and charges the surcharge', async () => {
    db.store.set('config/physical_tickets', { ...DEFAULT_PHYSICAL_CONFIG, templateSurcharges: { kraft_foil: 10 } })
    const res = await orderPOST(post({ tierId: 'vip', quantity: 100, method: 'moncash', design, approveProof: true }), ctx)
    expect(res.status).toBe(200)
    const { batchId, totalHtg } = await res.json()
    expect(totalHtg).toBe(5000)
    const batch = (await getBatch(batchId))!
    expect(batch.design).toMatchObject({
      template: 'kraft_foil',
      version: 1,
      color: 'sage',
      photo_url: ownUpload('artist.jpg'),
      photo_source: 'upload',
      logos: [ownUpload('logo.png')],
      overrides: { phone: '+509 3187 5567' },
      template_name: { en: 'Kraft + foil', fr: 'Kraft et dorure', ht: 'Kraft ak dorur' },
      approved_by: 'u1',
    })
    expect(Date.parse(batch.design.approved_at)).toBeGreaterThan(0)
    expect(batch).toMatchObject({ unit_price_htg: 50, surcharge_htg_per_ticket: 10, total_htg: 5000 })
  })

  it('"pay" refuses a batch whose proof was never approved', async () => {
    const created = await createBatch({ eventId: EVENT, event: HT_EVENT, orgId: 'org1', tierId: 'vip', quantity: 100, method: 'moncash', createdBy: 'u1' })
    if (!created.ok) throw new Error(created.error)
    const res = await batchPOST(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ action: 'pay', method: 'moncash' }) }) as any,
      { params: Promise.resolve({ id: EVENT, batchId: created.batch.id }) }
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('proof_not_approved')
    expect(startMonCashBatchPayment).not.toHaveBeenCalled()
  })

  it('createBatch itself refuses an unapproved design', async () => {
    const d = { ...designOf({ design: { template: 'bold_type' } }), approved_at: null }
    expect(await createBatch({ eventId: EVENT, event: HT_EVENT, orgId: 'org1', tierId: 'vip', quantity: 100, method: 'moncash', createdBy: 'u1', design: d })).toMatchObject({
      ok: false,
      code: 'proof_not_approved',
    })
    expect(reserveSeats).not.toHaveBeenCalled()
  })
})

describe('labels', () => {
  it('every language has every ticket word', () => {
    const keys = Object.keys(TICKET_LABELS.fr).sort()
    expect(Object.keys(TICKET_LABELS.en).sort()).toEqual(keys)
    expect(Object.keys(TICKET_LABELS.ht).sort()).toEqual(keys)
    expect(TICKET_LABELS.fr.validOnceSold).toBe('Valide une fois vendu')
  })
})
