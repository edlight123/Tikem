/**
 * The app's printed-ticket helpers (mobile/lib/physicalTickets.ts): parity with
 * the web rules (lib/physical/rules.ts), and the offline activation queue.
 */
import {
  SALE_METHODS,
  activationMessageKey,
  cleanHolderName,
  enqueueActivation,
  isUnsoldPrinted,
  isVoidedPrinted,
  looksLikeSerial,
  newClientRef,
  normalizeSerial,
  parsePhysicalQr,
  syncActivationQueue,
  type PostOutcome,
  type QueuedActivation,
} from '../mobile/lib/physicalTickets'
import * as web from '@/lib/physical/rules'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

const TOKEN = 'abcdefghijklmnopqrstuv' // 22 chars, base64url
const qr = (id: string, v = 1, s = TOKEN) => JSON.stringify({ ticketId: id, v, s })

const item = (over: Partial<QueuedActivation> = {}): QueuedActivation => ({
  clientRef: over.clientRef ?? newClientRef(),
  eventId: 'ev1',
  code: null,
  serial: 'FETE-VIP-0001',
  name: 'Marie Joseph',
  phone: null,
  method: 'cash',
  clientActivatedAt: '2026-11-24T20:00:00.000Z',
  ...over,
})

describe('pure helpers match the web rules', () => {
  const codes = [
    qr('t1'),
    qr('t1', 2),
    qr('t1', 0),
    JSON.stringify({ ticketId: 't1', v: 1, s: 'short' }),
    'FETE-VIP-0001',
    '',
    '{not json',
    JSON.stringify({ ticketId: '', v: 1, s: TOKEN }),
  ]
  it.each(codes)('parsePhysicalQr(%s)', (c) => {
    expect(parsePhysicalQr(c)).toEqual(web.parsePhysicalQr(c))
  })

  const serials = [' fete vip 0001 ', 'FETE–VIP–0012', 'fete__vip--0003', 'x', 'FETE-VIP-12']
  it.each(serials)('normalizeSerial / looksLikeSerial(%s)', (s) => {
    expect(normalizeSerial(s)).toBe(web.normalizeSerial(s))
    expect(looksLikeSerial(s)).toBe(web.looksLikeSerial(s))
  })

  it('cleans the holder name the same way and requires one', () => {
    for (const n of ['  Marie   Joseph ', '', '   ', 'x'.repeat(200)]) expect(cleanHolderName(n)).toBe(web.cleanHolderName(n))
    expect(cleanHolderName('   ')).toBe('')
  })

  it('offers the same sale methods, cash first (the default)', () => {
    expect(SALE_METHODS).toEqual(web.SALE_METHODS)
    expect(SALE_METHODS[0]).toBe('cash')
  })

  it('recognizes unsold / voided printed statuses (door verdicts)', () => {
    expect(isUnsoldPrinted('printed_unsold')).toBe(true)
    expect(isUnsoldPrinted('valid')).toBe(false)
    expect(isVoidedPrinted('voided')).toBe(true)
    expect(isVoidedPrinted('released')).toBe(true)
    expect(isVoidedPrinted('refunded')).toBe(false)
  })
})

describe('offline queue: enqueue', () => {
  it('replaces an item with the same clientRef', () => {
    const a = item({ clientRef: 'r1', name: 'A' })
    const { queue } = enqueueActivation([a], { ...a, name: 'B' })
    expect(queue).toHaveLength(1)
    expect(queue[0].name).toBe('B')
  })

  it('refuses a second queued sale of the same ticket (by serial, normalized)', () => {
    const first = item({ serial: 'FETE-VIP-0001' })
    const r = enqueueActivation([first], item({ serial: 'fete vip 0001' }))
    expect(r.duplicate).toBe(true)
    expect(r.queue).toEqual([first])
  })

  it('refuses a second queued sale of the same ticket (by QR, any version)', () => {
    const first = item({ code: qr('t9'), serial: null })
    expect(enqueueActivation([first], item({ code: qr('t9', 2, 'zyxwvutsrqponmlkjihgfe'), serial: null })).duplicate).toBe(true)
  })

  it('keeps different tickets and other events', () => {
    let q: QueuedActivation[] = []
    q = enqueueActivation(q, item({ serial: 'FETE-VIP-0001' })).queue
    q = enqueueActivation(q, item({ serial: 'FETE-VIP-0002' })).queue
    q = enqueueActivation(q, item({ eventId: 'ev2', serial: 'FETE-VIP-0001' })).queue
    expect(q).toHaveLength(3)
  })

  it('mints distinct client refs', () => {
    expect(newClientRef(1, () => 0.1)).not.toBe(newClientRef(1, () => 0.2))
  })
})

describe('offline queue: sync', () => {
  const judged = (response: any): PostOutcome => ({ type: 'judged', response })

  it('drops activated and refused items, reports the first-wins conflict', async () => {
    const a = item({ serial: 'FETE-VIP-0001', name: 'A' })
    const b = item({ serial: 'FETE-VIP-0002', name: 'B' })
    const post = jest.fn(async (it: QueuedActivation) =>
      it === a
        ? judged({ ok: true, ticketId: 't1', serial: 'FETE-VIP-0001', holderName: 'A', tier: 'VIP' })
        : judged({ ok: false, code: 'ALREADY_ACTIVATED', holderName: 'Jean', serial: 'FETE-VIP-0002' }),
    )
    const report = await syncActivationQueue([a, b], post)
    expect(report.queue).toEqual([])
    expect(report.activated).toBe(1)
    expect(report.refused).toBe(1)
    const conflict = report.outcomes.find((o) => o.kind === 'refused') as any
    expect(conflict.item).toBe(b)
    expect(conflict.response.code).toBe('ALREADY_ACTIVATED')
    expect(conflict.response.holderName).toBe('Jean')
  })

  it('keeps the item that hit a network error and everything after it, in order', async () => {
    const a = item({ serial: 'FETE-VIP-0001' })
    const b = item({ serial: 'FETE-VIP-0002' })
    const c = item({ serial: 'FETE-VIP-0003' })
    const post = jest.fn(async (it: QueuedActivation): Promise<PostOutcome> =>
      it === a ? judged({ ok: true, ticketId: 't', serial: '', holderName: 'x', tier: '' }) : { type: 'offline' },
    )
    const report = await syncActivationQueue([a, b, c], post)
    expect(report.queue).toEqual([b, c])
    expect(report.remaining).toBe(2)
    expect(post).toHaveBeenCalledTimes(2) // stops at the first network failure
  })

  it('treats a thrown post as offline (kept)', async () => {
    const a = item()
    const report = await syncActivationQueue([a], async () => {
      throw new Error('network')
    })
    expect(report.queue).toEqual([a])
  })

  it('drops items the server will never accept (no longer a seller)', async () => {
    const a = item()
    const report = await syncActivationQueue([a], async () => ({ type: 'denied', status: 403 }))
    expect(report.queue).toEqual([])
    expect(report.outcomes[0].kind).toBe('denied')
  })

  it('a retry the server already applied (alreadyDone) counts as activated', async () => {
    const a = item()
    const report = await syncActivationQueue([a], async () =>
      judged({ ok: true, ticketId: 't', serial: 'S', holderName: 'A', tier: 'VIP', alreadyDone: true }),
    )
    expect(report.activated).toBe(1)
    expect(report.queue).toEqual([])
  })

  it('only syncs the given event and leaves the others queued', async () => {
    const a = item({ eventId: 'ev1' })
    const b = item({ eventId: 'ev2' })
    const post = jest.fn(async () => judged({ ok: true, ticketId: 't', serial: '', holderName: '', tier: '' }))
    const report = await syncActivationQueue([a, b], post, { eventId: 'ev1' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(report.queue).toEqual([b])
    expect(report.remaining).toBe(0)
  })
})

describe('messages', () => {
  const get = (obj: any, path: string) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
  it('every refusal code maps to a key present in en/fr/ht', () => {
    const codes = ['NOT_FOUND', 'WRONG_EVENT', 'NOT_PHYSICAL', 'NAME_REQUIRED', 'ALREADY_ACTIVATED', 'VOIDED', 'RELEASED', 'INVALID_CODE', 'NOT_YOUR_RANGE', 'BATCH_NOT_READY'] as const
    for (const c of codes) {
      const key = activationMessageKey(c)
      for (const dict of [en, fr, ht]) expect(typeof get(dict, key)).toBe('string')
    }
  })

  it('has the door verdict strings and the seller role label', () => {
    for (const dict of [en, fr, ht] as any[]) {
      expect(typeof dict.physicalSell.door.notSold).toBe('string')
      expect(typeof dict.physicalSell.door.voided).toBe('string')
      expect(typeof dict.orgTeam.roles.seller).toBe('string')
      expect(typeof dict.orgTeam.roleBlurbs.seller).toBe('string')
      expect(typeof dict.organizerOrgTeam.roles.seller).toBe('string')
    }
  })
})
