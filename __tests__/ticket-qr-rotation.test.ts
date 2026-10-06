/**
 * "The QR changes when a ticket changes hands."
 *
 *   - accepting a transfer bumps the ticket's qr_version and writes a signed
 *     payload to qr_code AND qr_code_data, in the same transaction;
 *   - the door (staff API, web door mode) admits the current signed code,
 *     refuses a pre-transfer code as TRANSFERRED (distinct from "already in")
 *     and a forged one as INVALID_CODE;
 *   - a never-transferred ticket keeps scanning with its legacy bare code, and
 *     a transferred one refuses it;
 *   - an id-only scan from an app build that predates QR versions is refused
 *     for a transferred ticket with a verdict that build understands;
 *   - the door list (the offline manifest) carries each ticket's version, and
 *     the Expo app's offline judge agrees with the server;
 *   - the previous holder's Apple / Google Wallet passes are voided on
 *     transfer (APNs + Wallet REST mocked), and the PassKit web service serves
 *     the stale serial voided.
 *
 * @jest-environment node
 */

import crypto from 'node:crypto'

type Doc = Record<string, any>

// ---------------------------------------------------------------------------
// Fake Firestore: chained where(==), limit, getAll, set/update/delete, tx.
// ---------------------------------------------------------------------------

const db = {
  store: new Map<string, Doc>(),
  ref(path: string): any {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => db.snap(path),
      set: async (data: Doc, opts?: { merge?: boolean }) => db.write(path, data, opts?.merge),
      update: async (data: Doc) => db.write(path, data, true),
      delete: async () => {
        db.store.delete(path)
      },
      collection: (name: string) => db.collection(`${path}/${name}`),
    }
  },
  snap(path: string) {
    const data = db.store.get(path)
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data ? { ...data } : undefined), ref: db.ref(path) }
  },
  write(path: string, data: Doc, merge?: boolean) {
    db.store.set(path, { ...(merge ? db.store.get(path) || {} : {}), ...data })
  },
  collection(name: string, filters: Array<[string, any]> = [], max = Infinity): any {
    return {
      doc: (id: string) => db.ref(`${name}/${id}`),
      where: (f: string, _op: string, v: any) => db.collection(name, [...filters, [f, v]], max),
      limit: (n: number) => db.collection(name, filters, n),
      get: async () => {
        const docs = Array.from(db.store.keys())
          .filter((p) => p.startsWith(`${name}/`) && !p.slice(name.length + 1).includes('/'))
          .filter((p) => filters.every(([f, v]) => db.store.get(p)![f] === v))
          .slice(0, max)
          .map((p) => db.snap(p))
        return { docs, empty: docs.length === 0, size: docs.length }
      },
    }
  },
  async getAll(...refs: any[]) {
    return refs.map((r) => db.snap(r.path))
  },
  async runTransaction(fn: (tx: any) => Promise<any>) {
    const writes: Array<() => void> = []
    const tx = {
      get: async (r: any) => (r.path ? db.snap(r.path) : r.get()),
      update: (r: any, d: Doc) => writes.push(() => db.write(r.path, d, true)),
      set: (r: any, d: Doc, o?: any) => writes.push(() => db.write(r.path, d, o?.merge)),
    }
    const result = await fn(tx) // a throw discards the writes, like Firestore
    writes.forEach((w) => w())
    return result
  },
}

jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__ts__' } }))

const auth: { user: any } = { user: null }
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => auth.user) }))
jest.mock('@/lib/admin', () => ({ isAdmin: () => false }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(), getTicketTransferResponseEmail: () => '' }))

// The wallet void is exercised for real in its own describe; the transfer
// route only has to call it with the version the old holder's passes carry.
const voidSpy = jest.fn(async (_p: any) => ({ apple: null, google: null }))
jest.mock('@/lib/wallet/revoke', () => {
  const actual = jest.requireActual('@/lib/wallet/revoke')
  return { ...actual, voidPreviousHolderPasses: (p: any, d?: any) => voidSpy(p, d) }
})

// PKCS#7 signing stand-in: records what the PassKit route asked to build.
const built: Array<{ ticket: any; options: any }> = []
jest.mock('@/lib/wallet/apple', () => ({
  buildApplePkpass: jest.fn(async (ticket: any, _config: any, options: any) => {
    built.push({ ticket, options })
    return Buffer.from('PKPASS')
  }),
}))

process.env.TICKET_QR_SECRET = 'test-ticket-qr-secret'

import {
  currentTicketQrPayload,
  rotatedTicketQrFields,
  signTicketQr,
  verifyScannedTicketCode,
} from '@/lib/tickets/qr'
import { judgeDoorRow as serverJudge, judgeScannedCodeAgainstRow as serverCodeJudge, toDoorRow } from '@/lib/scan/doorRules'
import {
  findDoorRow,
  judgeDoorRow as mobileJudge,
  judgeScannedCodeAgainstRow as mobileCodeJudge,
} from '../mobile/lib/doorList'
import { POST as respondPOST } from '@/app/api/tickets/transfer/respond/route'
import { POST as checkInPOST } from '@/app/api/staff/events/[id]/check-in/route'
import { GET as doorListGET } from '@/app/api/staff/events/[id]/door-list/route'
import { checkInTicket } from '@/lib/scan/checkInTicket'
import { appleAuthTokenFor, appleSerialFor, parseAppleSerial } from '@/lib/wallet/apple-web-service'
import { googleObjectIdFor } from '@/lib/wallet/google'
import { GET as latestPassGET } from '@/app/api/wallet/apple/v1/passes/[passTypeIdentifier]/[serialNumber]/route'
import {
  POST as registerPOST,
  DELETE as unregisterDELETE,
} from '@/app/api/wallet/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]/route'
import { GET as serialsGET } from '@/app/api/wallet/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/route'

const { voidPreviousHolderPasses } = jest.requireActual('@/lib/wallet/revoke') as typeof import('@/lib/wallet/revoke')

const EVENT = 'evt1'
const future = new Date(Date.now() + 7 * 864e5).toISOString()
const OWNER = { id: 'owner1', email: 'o@x.co', role: 'organizer' }

function seed() {
  db.store.clear()
  built.length = 0
  voidSpy.mockClear()
  db.write(`events/${EVENT}`, { title: 'Kanaval', organizer_id: 'owner1', allow_reentry: false })
  db.write('tickets/t1', {
    event_id: EVENT,
    status: 'valid',
    attendee_id: 'seller',
    user_id: 'seller',
    attendee_name: 'Seller',
    qr_code_data: 't1',
    end_datetime: future,
  })
  db.write('ticket_transfers/tr1', {
    ticket_id: 't1',
    from_user_id: 'seller',
    to_email: 'buyer@x.co',
    status: 'pending',
    transfer_token: 'tok',
    expires_at: future,
  })
}

async function acceptTransfer(token = 'tok', as = { id: 'buyer', email: 'buyer@x.co' }) {
  auth.user = as
  return respondPOST({ json: async () => ({ transferToken: token, action: 'accept' }) } as any)
}

const checkIn = (body: any) => {
  auth.user = OWNER
  return checkInPOST(
    new Request(`http://localhost/api/staff/events/${EVENT}/check-in`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: EVENT }) }
  ).then((r) => r.json())
}

beforeEach(seed)

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

describe('signed QR payloads', () => {
  const v0 = { status: 'valid' }
  const v2 = { status: 'valid', qr_version: 2 }

  it('a never-transferred ticket accepts its legacy bare code', () => {
    expect(verifyScannedTicketCode('t1', 't1', v0)).toBe('OK')
    expect(verifyScannedTicketCode('https://www.tikem.co/tickets/t1', 't1', v0)).toBe('OK')
  })

  it('a transferred ticket refuses the legacy bare code', () => {
    expect(verifyScannedTicketCode('t1', 't1', { qr_version: 1 })).toBe('TRANSFERRED')
  })

  it('accepts the current signed code, refuses an older one and a forged one', () => {
    expect(verifyScannedTicketCode(signTicketQr('t1', 2), 't1', v2)).toBe('OK')
    expect(verifyScannedTicketCode(signTicketQr('t1', 1), 't1', v2)).toBe('TRANSFERRED')
    const forged = JSON.stringify({ ticketId: 't1', v: 2, s: 'AAAAAAAAAAAAAAAAAAAAAA' })
    expect(verifyScannedTicketCode(forged, 't1', v2)).toBe('INVALID_CODE')
    // A real signature for another ticket, or a version never issued.
    expect(verifyScannedTicketCode(signTicketQr('t9', 2), 't1', v2)).toBe('INVALID_CODE')
    expect(verifyScannedTicketCode(signTicketQr('t1', 3), 't1', v2)).toBe('INVALID_CODE')
  })

  it('is deterministic per (ticket, version) and parseable by every legacy scanner', () => {
    expect(signTicketQr('t1', 1)).toBe(signTicketQr('t1', 1))
    expect(signTicketQr('t1', 1)).not.toBe(signTicketQr('t1', 2))
    // Old web + mobile parsers pull `ticketId` out of a JSON payload.
    expect(JSON.parse(signTicketQr('t1', 1)).ticketId).toBe('t1')
  })

  it('rotation bumps the version and stores the payload where web and app read it', () => {
    const f = rotatedTicketQrFields('t1', { qr_version: 1 }, 1700000000000)
    expect(f.qr_version).toBe(2)
    expect(f.qr_code).toBe(signTicketQr('t1', 2))
    expect(f.qr_code_data).toBe(f.qr_code)
    expect(f.wallet_pass_updated_at).toBe(1700000000000)
    expect(currentTicketQrPayload('t1', f)).toBe(f.qr_code)
  })
})

// ---------------------------------------------------------------------------
// Transfer accept
// ---------------------------------------------------------------------------

describe('transfer accept rotates the code', () => {
  it('bumps qr_version and writes the signed payload with the change of hands', async () => {
    const res = await acceptTransfer()
    expect(res.status).toBe(200)
    const t = db.store.get('tickets/t1')!
    expect(t.attendee_id).toBe('buyer')
    expect(t.qr_version).toBe(1)
    expect(t.qr_code).toBe(signTicketQr('t1', 1))
    expect(t.qr_code_data).toBe(t.qr_code)
    expect(typeof t.wallet_pass_updated_at).toBe('number')
    expect(voidSpy).toHaveBeenCalledWith({ ticketId: 't1', previousVersion: 0 }, undefined)
  })

  it('a second transfer bumps again and voids the version-1 passes', async () => {
    await acceptTransfer()
    db.write('ticket_transfers/tr2', {
      ticket_id: 't1',
      from_user_id: 'buyer',
      to_email: 'third@x.co',
      status: 'pending',
      transfer_token: 'tok2',
      expires_at: future,
    })
    voidSpy.mockClear()
    await acceptTransfer('tok2', { id: 'third', email: 'third@x.co' })
    const t = db.store.get('tickets/t1')!
    expect(t.qr_version).toBe(2)
    expect(t.qr_code).toBe(signTicketQr('t1', 2))
    expect(voidSpy).toHaveBeenCalledWith({ ticketId: 't1', previousVersion: 1 }, undefined)
  })

  it('a rejected transfer leaves the code alone', async () => {
    auth.user = { id: 'buyer', email: 'buyer@x.co' }
    await respondPOST({ json: async () => ({ transferToken: 'tok', action: 'reject' }) } as any)
    const t = db.store.get('tickets/t1')!
    expect(t.qr_version).toBeUndefined()
    expect(t.qr_code_data).toBe('t1')
    expect(voidSpy).not.toHaveBeenCalled()
  })

  it('fails closed in production when no signing key is configured', async () => {
    const saved = { ...process.env }
    try {
      for (const k of ['TICKET_QR_SECRET', 'TICKET_ID_SECRET', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY']) delete process.env[k]
      ;(process.env as any).NODE_ENV = 'production'
      const res = await acceptTransfer()
      expect(res.status).toBe(503)
      expect(db.store.get('tickets/t1')!.attendee_id).toBe('seller')
    } finally {
      process.env = saved
    }
  })
})

// ---------------------------------------------------------------------------
// Door: staff API (the path every current mobile build commits through)
// ---------------------------------------------------------------------------

describe('door check-in API', () => {
  it('a never-transferred ticket still checks in with its legacy bare code', async () => {
    const res = await checkIn({ code: 't1' })
    expect(res.verdict).toBe('CHECKED_IN')
  })

  it('after a transfer: the new code admits, the old bare code is refused as transferred', async () => {
    await acceptTransfer()
    const stale = await checkIn({ code: 't1' })
    expect(stale.verdict).toBe('TRANSFERRED')
    expect(db.store.get('tickets/t1')!.checked_in).toBeUndefined()

    const fresh = await checkIn({ code: signTicketQr('t1', 1), ticketId: 't1' })
    expect(fresh.verdict).toBe('CHECKED_IN')
  })

  it('reads "transferred", not "already in", when the old code follows the new holder in', async () => {
    await acceptTransfer()
    await checkIn({ code: signTicketQr('t1', 1) })
    const stale = await checkIn({ code: 't1' })
    expect(stale.verdict).toBe('TRANSFERRED')
    const again = await checkIn({ code: signTicketQr('t1', 1) })
    expect(again.verdict).toBe('ALREADY_CHECKED_IN')
  })

  it('refuses an older signed version and a bad signature', async () => {
    await acceptTransfer()
    db.write('tickets/t1', rotatedTicketQrFields('t1', db.store.get('tickets/t1')!), true) // now v2
    expect((await checkIn({ code: signTicketQr('t1', 1) })).verdict).toBe('TRANSFERRED')
    const forged = JSON.stringify({ ticketId: 't1', v: 2, s: 'xxxxxxxxxxxxxxxxxxxxxx' })
    expect((await checkIn({ code: forged })).verdict).toBe('INVALID_CODE')
    expect((await checkIn({ code: signTicketQr('t1', 2) })).verdict).toBe('CHECKED_IN')
  })

  it('an id-only scan from an older app build is refused with a verdict that build renders as a refusal', async () => {
    await acceptTransfer()
    const res = await checkIn({ ticketId: 't1', method: 'scan' })
    expect(res.verdict).toBe('CANCELLED')
    expect(res.reason).toBe('TRANSFERRED')
    expect(res.ok).toBe(false)
  })

  it('a manual pick by name still admits a transferred ticket', async () => {
    await acceptTransfer()
    const res = await checkIn({ ticketId: 't1', method: 'manual' })
    expect(res.verdict).toBe('CHECKED_IN')
  })
})

// ---------------------------------------------------------------------------
// Door: web door mode (server action engine)
// ---------------------------------------------------------------------------

describe('web door mode', () => {
  const base = { ticketId: 't1', eventId: EVENT, entryPoint: 'Main', scannedBy: 'owner1' }

  it('legacy code admits an untransferred ticket', async () => {
    expect((await checkInTicket({ ...base, code: 't1' })).type).toBe('VALID')
  })

  it('refuses the pre-transfer code and admits the new one', async () => {
    await acceptTransfer()
    const stale: any = await checkInTicket({ ...base, code: 't1' })
    expect(stale).toEqual({ success: false, type: 'INVALID', reason: 'TRANSFERRED' })
    const forged: any = await checkInTicket({ ...base, code: JSON.stringify({ ticketId: 't1', v: 1, s: 'nope' }) })
    expect(forged.reason).toBe('INVALID_CODE')
    expect((await checkInTicket({ ...base, code: signTicketQr('t1', 1) })).type).toBe('VALID')
  })
})

// ---------------------------------------------------------------------------
// Offline: the door list carries the version; the app's judge agrees.
// ---------------------------------------------------------------------------

describe('offline door list', () => {
  it('carries each ticket\'s current QR version and code', async () => {
    await acceptTransfer()
    db.write('tickets/t2', { event_id: EVENT, status: 'valid', qr_code_data: 't2', end_datetime: future })
    auth.user = OWNER
    const res = await doorListGET(new Request('http://localhost'), { params: Promise.resolve({ id: EVENT }) })
    const rows: any[] = (await res.json()).rows
    const t1 = rows.find((r) => r.id === 't1')
    const t2 = rows.find((r) => r.id === 't2')
    expect(t1.qrVersion).toBe(1)
    expect(t1.code).toBe(signTicketQr('t1', 1))
    expect(t2.qrVersion).toBe(0)
    expect(t2.code).toBe('t2')
  })

  const current = toDoorRow('t1', { status: 'valid', qr_version: 2, qr_code_data: signTicketQr('t1', 2) })
  const legacy = toDoorRow('t1', { status: 'valid', qr_code_data: 't1' })
  const cases: Array<[string, any, string]> = [
    ['legacy row, bare code', legacy, 't1'],
    ['transferred row, bare code', current, 't1'],
    ['transferred row, current code', current, signTicketQr('t1', 2)],
    ['transferred row, older code', current, signTicketQr('t1', 1)],
    ['transferred row, forged current version', current, JSON.stringify({ ticketId: 't1', v: 2, s: 'zz' })],
    ['transferred row, newer version', current, signTicketQr('t1', 3)],
  ]

  it.each(cases)('%s: app and server agree', (_l, row, code) => {
    expect(mobileCodeJudge(code, row)).toBe(serverCodeJudge(code, row))
    const ctx = { allowReentry: false, codeCheck: serverCodeJudge(code, row) }
    expect(mobileJudge(row, ctx)).toEqual(serverJudge(row, { eventId: EVENT, ...ctx }))
  })

  it('offline: the current code admits, an older one reads transferred', () => {
    expect(mobileJudge(current as any, { allowReentry: false, codeCheck: mobileCodeJudge(signTicketQr('t1', 2), current) }).verdict).toBe('CHECKED_IN')
    expect(mobileJudge(current as any, { allowReentry: false, codeCheck: mobileCodeJudge('t1', current) }).verdict).toBe('TRANSFERRED')
  })

  it('finds a row from a signed payload', () => {
    expect(findDoorRow([current as any], signTicketQr('t1', 1))?.id).toBe('t1')
  })
})

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function withWalletEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env }
  Object.assign(process.env, {
    APPLE_PASS_TYPE_ID: 'pass.co.tikem.ticket',
    APPLE_TEAM_ID: 'TEAM123',
    APPLE_PASS_CERT_PEM_BASE64: Buffer.from('CERT').toString('base64'),
    APPLE_PASS_KEY_PEM_BASE64: Buffer.from('KEY').toString('base64'),
    APPLE_WWDR_CERT_PEM_BASE64: Buffer.from('WWDR').toString('base64'),
    GOOGLE_WALLET_ISSUER_ID: '3388000000012345',
    GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'svc@x.iam.gserviceaccount.com', private_key: PEM }),
    NEXT_PUBLIC_APP_URL: 'https://www.tikem.co',
  })
  return fn().finally(() => {
    process.env = saved
  })
}

describe('voiding the previous holder\'s passes', () => {
  it('pushes every Apple device on the old serial and PATCHes the old Google object INACTIVE', async () => {
    await withWalletEnv(async () => {
      db.write('wallet_apple_registrations/r1', { serial_number: 't1', push_token: 'tokA', device_library_identifier: 'devA' })
      db.write('wallet_apple_registrations/r2', { serial_number: 't1', push_token: 'tokB', device_library_identifier: 'devB' })
      db.write('wallet_apple_registrations/r3', { serial_number: 't1.v1', push_token: 'tokNew', device_library_identifier: 'devC' })

      const pushed: string[] = []
      const apnsSender = async (token: string) => {
        pushed.push(token)
        return token === 'tokB' ? 410 : 200
      }
      const calls: Array<{ url: string; init: any }> = []
      const fetchImpl = async (url: string, init: any) => {
        calls.push({ url, init })
        if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT' }) }
        return { ok: true, status: 200, json: async () => ({}) }
      }

      const report = await voidPreviousHolderPasses({ ticketId: 't1', previousVersion: 0 }, { apnsSender, fetchImpl })

      // Only the OLD serial's devices; the new holder's device is left alone.
      expect(pushed.sort()).toEqual(['tokA', 'tokB'])
      expect(report.apple).toEqual({ serial: 't1', devices: 2, pushed: 1, pruned: 1 })
      expect(db.store.has('wallet_apple_registrations/r2')).toBe(false) // 410 pruned

      const patch = calls.find((c) => c.init?.method === 'PATCH')!
      expect(patch.url).toBe(
        'https://walletobjects.googleapis.com/walletobjects/v1/eventTicketObject/3388000000012345.tkt_t1'
      )
      expect(patch.init.headers.Authorization).toBe('Bearer AT')
      const body = JSON.parse(patch.init.body)
      expect(body.state).toBe('INACTIVE')
      expect(body.barcode.value).not.toContain('t1')
      expect(report.google).toBe('voided')
    })
  })

  it('treats a Google object the holder never saved as nothing to void', async () => {
    await withWalletEnv(async () => {
      const fetchImpl = async (url: string) =>
        url.includes('oauth2')
          ? { ok: true, status: 200, json: async () => ({ access_token: 'AT' }) }
          : { ok: false, status: 404, json: async () => ({}) }
      const report = await voidPreviousHolderPasses({ ticketId: 't1', previousVersion: 1 }, { apnsSender: async () => 200, fetchImpl })
      expect(report.google).toBe('not_saved')
      expect(report.apple?.serial).toBe('t1.v1')
    })
  })

  it('new passes get a new identity per version', () => {
    expect(appleSerialFor('t1', 0)).toBe('t1')
    expect(appleSerialFor('t1', 2)).toBe('t1.v2')
    expect(parseAppleSerial('t1.v2')).toEqual({ ticketId: 't1', version: 2 })
    expect(parseAppleSerial('t1')).toEqual({ ticketId: 't1', version: 0 })
    const cfg = { issuerId: 'ISS', clientEmail: '', privateKey: '', issuerName: '' }
    expect(googleObjectIdFor(cfg, 't1', 0)).toBe('ISS.tkt_t1')
    expect(googleObjectIdFor(cfg, 't1', 1)).toBe('ISS.tkt_t1_v1')
  })
})

describe('Apple PassKit web service', () => {
  const PT = 'pass.co.tikem.ticket'
  const passReq = (serial: string, token?: string | null) =>
    latestPassGET(
      new Request(`https://www.tikem.co/api/wallet/apple/v1/passes/${PT}/${serial}`, {
        headers: token === null ? {} : { Authorization: `ApplePass ${token ?? appleAuthTokenFor(serial)}` },
      }),
      { params: Promise.resolve({ passTypeIdentifier: PT, serialNumber: serial }) }
    )

  it('serves the stale serial VOIDED and the current serial live, after a transfer', async () => {
    await withWalletEnv(async () => {
      await acceptTransfer()
      const stale = await passReq('t1')
      expect(stale.status).toBe(200)
      expect(stale.headers.get('content-type')).toBe('application/vnd.apple.pkpass')
      expect(built[0].options).toEqual({ voided: true, serialNumber: 't1' })

      const live = await passReq('t1.v1')
      expect(live.status).toBe(200)
      expect(built[1].options).toEqual({ voided: false, serialNumber: 't1.v1' })
      expect(built[1].ticket.qrPayload).toBe(signTicketQr('t1', 1))
    })
  })

  it('refuses a missing or wrong authentication token, and a version never issued', async () => {
    await withWalletEnv(async () => {
      expect((await passReq('t1', null)).status).toBe(401)
      expect((await passReq('t1', 'wrong-token-wrong-token')).status).toBe(401)
      // A token for one serial does not open another.
      expect((await passReq('t1.v1', appleAuthTokenFor('t1'))).status).toBe(401)
      expect((await passReq('t1.v5')).status).toBe(404)
    })
  })

  it('registers, lists updated serials, and unregisters a device', async () => {
    await withWalletEnv(async () => {
      const ctx = { params: Promise.resolve({ deviceLibraryIdentifier: 'dev1', passTypeIdentifier: PT, serialNumber: 't1' }) }
      const reg = (auth?: string) =>
        registerPOST(
          new Request('https://x/', {
            method: 'POST',
            headers: { Authorization: auth ?? `ApplePass ${appleAuthTokenFor('t1')}` },
            body: JSON.stringify({ pushToken: 'push1' }),
          }),
          ctx
        )
      expect((await reg('ApplePass nope')).status).toBe(401)
      expect((await reg()).status).toBe(201)
      expect((await reg()).status).toBe(200)

      const list = () =>
        serialsGET(new Request(`https://x/?passesUpdatedSince=${since}`), {
          params: Promise.resolve({ deviceLibraryIdentifier: 'dev1', passTypeIdentifier: PT }),
        })
      let since = 0
      expect((await list()).status).toBe(204) // nothing changed yet
      await acceptTransfer()
      const changed = await list()
      expect(changed.status).toBe(200)
      const json = await changed.json()
      expect(json.serialNumbers).toEqual(['t1'])
      since = Number(json.lastUpdated)
      expect((await list()).status).toBe(204)

      const del = await unregisterDELETE(
        new Request('https://x/', { method: 'DELETE', headers: { Authorization: `ApplePass ${appleAuthTokenFor('t1')}` } }),
        ctx
      )
      expect(del.status).toBe(200)
      expect(Array.from(db.store.keys()).some((k) => k.startsWith('wallet_apple_registrations/'))).toBe(false)
    })
  })
})
