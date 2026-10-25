/**
 * Wallet passes: POST/GET /api/wallet/generate and GET /api/wallet/pass/[token].
 *
 * Exercises the REAL route handlers against a fake Firestore. The gate a wallet
 * pass has to clear is the gate the ticket itself lives by, because the pass
 * carries a working QR code:
 *
 *   • the caller is authenticated;
 *   • the ticket EXISTS and the caller is its current holder;
 *   • the ticket is still live (refunded / cancelled / transferred-away refused);
 *   • an unconfigured deployment says so specifically (503 + a `*_not_configured`
 *     code) rather than throwing a generic 500 that reads as "try again";
 *   • and a configured happy path serves `application/vnd.apple.pkpass`
 *     carrying the ticket's EXISTING QR payload, never a freshly minted one.
 *
 * PKCS#7 signing is mocked, so these tests need no Apple certificates. What that
 * leaves untested is called out in the summary.
 *
 * @jest-environment node
 */

const state: any = {
  user: { id: 'u1', email: 'u@x.com', full_name: 'Ura Attendee' } as any,
  tickets: {} as Record<string, any>,
  events: {} as Record<string, any>,
  /** Props handed to the (mocked) PKPass constructor, for assertions. */
  passProps: null as any,
  passFiles: null as any,
  passCerts: null as any,
  passBarcodes: [] as any[],
  passRelevantDates: [] as any[],
  /** Force the mocked signer to blow up, like bad certificate material would. */
  signingThrows: false,
}

jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => state.user) }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection(name: string) {
      const store = name === 'tickets' ? state.tickets : name === 'events' ? state.events : null
      if (!store) throw new Error(`unexpected collection ${name}`)
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: Boolean(store[id]),
            id,
            data: () => store[id],
          }),
        }),
      }
    },
  },
}))

/**
 * Stand-in for passkit-generator. Records what the builder asked for and hands
 * back a deterministic "archive" so the route's plumbing (content type, headers,
 * byte passthrough) is what's under test — not node-forge's PKCS#7 output.
 */
jest.mock('passkit-generator', () => {
  class FakePKPass {
    headerFields: any[] = []
    primaryFields: any[] = []
    secondaryFields: any[] = []
    auxiliaryFields: any[] = []
    backFields: any[] = []
    type: string | undefined

    constructor(files: any, certificates: any, props: any) {
      if (state.signingThrows) throw new Error('invalid signer certificate')
      state.passFiles = files
      state.passCerts = certificates
      state.passProps = props
      state.passBarcodes = []
    }

    setBarcodes(...barcodes: any[]) {
      state.passBarcodes = barcodes
    }

    // passkit-generator's real PKPass exposes this and the pass builder calls
    // it. The stand-in lacked it, so every build threw
    // "pass.setRelevantDates is not a function" and the route answered 502 —
    // a failure of the mock, not of the signing path it was meant to prove.
    setRelevantDates(...dates: any[]) {
      state.passRelevantDates = dates
    }

    // The builder falls back to the older singular API when the newer one is
    // unavailable, so the stand-in has to offer both or the fallback throws too.
    setRelevantDate(...dates: any[]) {
      state.passRelevantDates = dates
    }

    getAsBuffer() {
      // Not a real zip — just something byte-identifiable that embeds the QR
      // payload, so the route test can prove the existing code was used.
      return Buffer.from(
        JSON.stringify({
          pass: state.passProps,
          barcodes: state.passBarcodes,
          files: Object.keys(state.passFiles || {}),
        }),
        'utf8'
      )
    }
  }
  return { PKPass: FakePKPass }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST, GET: CAPABILITY } = require('@/app/api/wallet/generate/route')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET: DOWNLOAD } = require('@/app/api/wallet/pass/[token]/route')

function req(body: any, url = 'https://tikem.co/api/wallet/generate') {
  return { url, json: async () => body } as any
}

/** Fake but structurally plausible PEM material — never a real certificate. */
const FAKE_CERT_PEM = Buffer.from(
  '-----BEGIN CERTIFICATE-----\nZmFrZS1jZXJ0\n-----END CERTIFICATE-----\n'
).toString('base64')
const FAKE_KEY_PEM = Buffer.from(
  '-----BEGIN PRIVATE KEY-----\nZmFrZS1rZXk=\n-----END PRIVATE KEY-----\n'
).toString('base64')

function configureApple() {
  process.env.APPLE_PASS_TYPE_ID = 'pass.co.tikem.ticket'
  process.env.APPLE_TEAM_ID = 'ABCDE12345'
  process.env.APPLE_PASS_CERT_PEM_BASE64 = FAKE_CERT_PEM
  process.env.APPLE_PASS_KEY_PEM_BASE64 = FAKE_KEY_PEM
  process.env.APPLE_WWDR_CERT_PEM_BASE64 = FAKE_CERT_PEM
}

/** A throwaway RSA key so the Google JWT signing path runs for real. */
function configureGoogle() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateKeyPairSync } = require('node:crypto')
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000000000000'
  process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: 'service_account',
    client_email: 'wallet@tikem.iam.gserviceaccount.com',
    private_key: privateKey,
  })
}

function clearWalletEnv() {
  for (const key of [
    'APPLE_PASS_TYPE_ID',
    'APPLE_TEAM_ID',
    'APPLE_PASS_CERT_PEM_BASE64',
    'APPLE_PASS_KEY_PEM_BASE64',
    'APPLE_WWDR_CERT_PEM_BASE64',
    'APPLE_WALLET_KEY_PASSPHRASE',
    'APPLE_PASS_ICON_PNG_BASE64',
    'APPLE_PASS_LOGO_PNG_BASE64',
    'WALLET_PASS_LINK_SECRET',
    'WALLET_ORGANIZATION_NAME',
    'GOOGLE_WALLET_ISSUER_ID',
    'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
    'NEXT_PUBLIC_APP_URL',
  ]) {
    delete process.env[key]
  }
}

function reset() {
  clearWalletEnv()
  state.user = { id: 'u1', email: 'u@x.com', full_name: 'Ura Attendee' }
  state.signingThrows = false
  state.passProps = null
  state.passFiles = null
  state.passCerts = null
  state.passBarcodes = []
  state.tickets = {
    tkt1: {
      event_id: 'evt1',
      attendee_id: 'u1',
      user_id: 'u1',
      attendee_name: 'Ura Attendee',
      status: 'valid',
      price_paid: 0,
      currency: 'HTG',
      tier_name: 'Free RSVP',
      // The EXISTING code the scanner already resolves.
      qr_code_data: 'tkt1',
      start_datetime: '2026-09-01T18:00:00.000Z',
      end_datetime: '2026-09-01T23:00:00.000Z',
      venue_name: 'Karibe Convention Center',
      city: 'Pétion-Ville',
    },
    tktSomeoneElse: {
      event_id: 'evt1',
      attendee_id: 'u2',
      user_id: 'u2',
      status: 'valid',
      qr_code_data: 'tktSomeoneElse',
    },
    tktRefunded: {
      event_id: 'evt1',
      attendee_id: 'u1',
      user_id: 'u1',
      status: 'refunded',
      qr_code_data: 'tktRefunded',
    },
    tktCancelled: {
      event_id: 'evt1',
      attendee_id: 'u1',
      user_id: 'u1',
      status: 'cancelled',
      qr_code_data: 'tktCancelled',
    },
    tktRefundApproved: {
      event_id: 'evt1',
      attendee_id: 'u1',
      user_id: 'u1',
      status: 'valid',
      refund_status: 'approved',
      qr_code_data: 'tktRefundApproved',
    },
  }
  state.events = {
    evt1: {
      title: 'Konpa Night',
      venue_name: 'Karibe Convention Center',
      city: 'Pétion-Ville',
      start_datetime: '2026-09-01T18:00:00.000Z',
    },
  }
  jest.clearAllMocks()
}

describe('POST /api/wallet/generate — authorization', () => {
  beforeEach(reset)

  it('refuses an unauthenticated caller with 401', async () => {
    state.user = null
    configureApple()
    const res = await POST(req({ ticketId: 'tkt1', platform: 'ios' }))
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.code).toBe('unauthorized')
    expect(body.passUrl).toBeUndefined()
  })

  it('refuses a ticket the caller does not own with 403', async () => {
    configureApple()
    const res = await POST(req({ ticketId: 'tktSomeoneElse', platform: 'ios' }))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('not_ticket_owner')
    expect(body.passUrl).toBeUndefined()
  })

  it('refuses a ticket that does not exist with 404', async () => {
    configureApple()
    const res = await POST(req({ ticketId: 'nope', platform: 'ios' }))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('ticket_not_found')
  })

  it('refuses a refunded / cancelled / refund-approved ticket with 409', async () => {
    configureApple()
    for (const ticketId of ['tktRefunded', 'tktCancelled', 'tktRefundApproved']) {
      const res = await POST(req({ ticketId, platform: 'ios' }))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('ticket_not_active')
    }
  })

  it('refuses an unknown ticket status rather than waving it through', async () => {
    configureApple()
    state.tickets.tkt1.status = 'some_new_state_nobody_here_knows'
    const res = await POST(req({ ticketId: 'tkt1', platform: 'ios' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ticket_not_active')
  })

  it('requires a ticket id and a known platform', async () => {
    configureApple()
    expect((await (await POST(req({ platform: 'ios' }))).json()).code).toBe('missing_ticket_id')
    expect((await (await POST(req({ ticketId: 'tkt1' }))).json()).code).toBe('unsupported_platform')
    expect((await (await POST(req({ ticketId: 'tkt1', platform: 'web' }))).json()).code).toBe(
      'unsupported_platform'
    )
  })

  it('accepts the ticket when the holder arrived via transfer (user_id only)', async () => {
    configureApple()
    state.tickets.tkt1 = { ...state.tickets.tkt1, attendee_id: undefined, user_id: 'u1' }
    const res = await POST(req({ ticketId: 'tkt1', platform: 'ios' }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/wallet/generate — unconfigured deployment', () => {
  beforeEach(reset)

  it('returns 503 apple_wallet_not_configured, not a generic 500', async () => {
    const res = await POST(req({ ticketId: 'tkt1', platform: 'ios' }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.code).toBe('apple_wallet_not_configured')
    expect(body.error).toMatch(/not configured/i)
  })

  it('returns 503 google_wallet_not_configured, not a generic 500', async () => {
    const res = await POST(req({ ticketId: 'tkt1', platform: 'android' }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.code).toBe('google_wallet_not_configured')
  })

  it('treats a PARTIAL Apple configuration as unconfigured', async () => {
    configureApple()
    delete process.env.APPLE_WWDR_CERT_PEM_BASE64
    const res = await POST(req({ ticketId: 'tkt1', platform: 'ios' }))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('apple_wallet_not_configured')
  })

  it('still refuses a foreign ticket BEFORE it reports configuration state', async () => {
    // Ownership is checked first, so an unconfigured server cannot be used to
    // probe which ticket ids exist.
    const res = await POST(req({ ticketId: 'tktSomeoneElse', platform: 'ios' }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/wallet/generate — capability probe', () => {
  beforeEach(reset)

  it('reports both false when nothing is configured', async () => {
    expect(await (await CAPABILITY()).json()).toEqual({ apple: false, google: false })
  })

  it('reports apple true once the certificate material is present', async () => {
    configureApple()
    expect(await (await CAPABILITY()).json()).toEqual({ apple: true, google: false })
  })

  it('keeps google false while NEXT_PUBLIC_GOOGLE_WALLET_ENABLED is off (issuer in demo mode)', async () => {
    configureGoogle()
    delete process.env.NEXT_PUBLIC_GOOGLE_WALLET_ENABLED
    expect(await (await CAPABILITY()).json()).toEqual({ apple: false, google: false })
  })

  it('reports google true once the service account is present and the flag is on', async () => {
    configureGoogle()
    process.env.NEXT_PUBLIC_GOOGLE_WALLET_ENABLED = 'true'
    try {
      expect(await (await CAPABILITY()).json()).toEqual({ apple: false, google: true })
    } finally {
      delete process.env.NEXT_PUBLIC_GOOGLE_WALLET_ENABLED
    }
  })
})

describe('Apple happy path — mint link, then download the .pkpass', () => {
  beforeEach(reset)

  it('mints an https pass link with an expiry', async () => {
    configureApple()
    const res = await POST(req({ ticketId: 'tkt1', platform: 'ios' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.platform).toBe('ios')
    expect(body.passUrl).toMatch(/^https:\/\/tikem\.co\/api\/wallet\/pass\/[\w.-]+$/)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('serves application/vnd.apple.pkpass carrying the EXISTING QR payload', async () => {
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    const token = String(minted.passUrl).split('/').pop()

    const res = await DOWNLOAD({} as any, { params: { token } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass')
    expect(res.headers.get('content-disposition')).toContain('.pkpass')
    expect(res.headers.get('cache-control')).toContain('no-store')

    const archive = JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8'))
    // The ticket's own code, not a new one.
    expect(archive.barcodes).toEqual([
      {
        format: 'PKBarcodeFormatQR',
        message: 'tkt1',
        messageEncoding: 'iso-8859-1',
        altText: 'TKM-TKT1',
      },
    ])
    // Identity + the artwork Apple refuses to open a pass without.
    expect(archive.pass.passTypeIdentifier).toBe('pass.co.tikem.ticket')
    expect(archive.pass.teamIdentifier).toBe('ABCDE12345')
    expect(archive.pass.serialNumber).toBe('tkt1')
    expect(archive.files).toEqual(
      expect.arrayContaining(['icon.png', 'icon@2x.png', 'logo.png'])
    )
    // Nothing money-related on the pass.
    expect(JSON.stringify(archive)).not.toMatch(/price_paid|u@x\.com/)
  })

  it('signs with the configured cert/key/WWDR triple and names the event on the pass', async () => {
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    await DOWNLOAD({} as any, { params: { token: String(minted.passUrl).split('/').pop() } })

    expect(state.passProps.description).toContain('Konpa Night')
    expect(state.passProps.description).toContain('Free RSVP')
    // All three pieces of certificate material reach the signer — a pass signed
    // without the WWDR intermediate is silently rejected by iOS.
    expect(state.passCerts.signerCert.toString()).toContain('BEGIN CERTIFICATE')
    expect(state.passCerts.signerKey.toString()).toContain('BEGIN PRIVATE KEY')
    expect(state.passCerts.wwdr.toString()).toContain('BEGIN CERTIFICATE')
    // No passphrase configured -> the key is not claimed to be encrypted.
    expect(state.passCerts.signerKeyPassphrase).toBeUndefined()
  })

  it('re-checks ownership at DOWNLOAD time — a refund after minting kills the link', async () => {
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    const token = String(minted.passUrl).split('/').pop()

    state.tickets.tkt1.status = 'refunded'
    const res = await DOWNLOAD({} as any, { params: { token } })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ticket_not_active')
  })

  it('re-checks ownership at DOWNLOAD time — a transfer away kills the link', async () => {
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    const token = String(minted.passUrl).split('/').pop()

    state.tickets.tkt1.attendee_id = 'u2'
    state.tickets.tkt1.user_id = 'u2'
    const res = await DOWNLOAD({} as any, { params: { token } })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_ticket_owner')
  })

  it('refuses a forged or tampered token', async () => {
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    const token = String(minted.passUrl).split('/').pop() as string
    const [body] = token.split('.')

    // Re-point the token at someone else's ticket, keeping the old signature.
    const forgedBody = Buffer.from(
      JSON.stringify({ v: 1, t: 'tktSomeoneElse', u: 'u1', e: Math.floor(Date.now() / 1000) + 600 })
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const forged = `${forgedBody}.${token.split('.')[1]}`

    expect((await DOWNLOAD({} as any, { params: { token: forged } })).status).toBe(401)
    expect((await DOWNLOAD({} as any, { params: { token: `${body}.deadbeef` } })).status).toBe(401)
    expect((await DOWNLOAD({} as any, { params: { token: 'garbage' } })).status).toBe(401)
  })

  it('reports a SIGNING failure as pass_build_failed, never as a valid pass', async () => {
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    const token = String(minted.passUrl).split('/').pop()

    state.signingThrows = true
    const res = await DOWNLOAD({} as any, { params: { token } })
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('pass_build_failed')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('refuses the download when Apple is unconfigured, even with a valid-looking token', async () => {
    // Mint with a link secret that survives clearing the certificate material.
    process.env.WALLET_PASS_LINK_SECRET = 'link-secret-for-this-test'
    configureApple()
    const minted = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    const token = String(minted.passUrl).split('/').pop()

    delete process.env.APPLE_PASS_CERT_PEM_BASE64
    const res = await DOWNLOAD({} as any, { params: { token } })
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('apple_wallet_not_configured')
  })

  it('honours NEXT_PUBLIC_APP_URL for the link origin', async () => {
    configureApple()
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.tikem.co/'
    const body = await (await POST(req({ ticketId: 'tkt1', platform: 'ios' }))).json()
    expect(body.passUrl).toMatch(/^https:\/\/www\.tikem\.co\/api\/wallet\/pass\//)
  })
})

/**
 * The fallback pass artwork. Apple refuses to open a `.pkpass` with no
 * `icon.png`, and this encoder is hand-rolled, so its output is checked against
 * the PNG spec here rather than trusted.
 */
describe('fallback pass artwork (lib/wallet/png.ts)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { solidPng } = require('@/lib/wallet/png')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('node:zlib')

  it('emits a structurally valid 8-bit truecolour PNG', () => {
    const png: Buffer = solidPng(29, [13, 148, 136])

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    // IHDR: 29x29, bit depth 8, colour type 2 (RGB), no interlace.
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(29)
    expect(png.readUInt32BE(20)).toBe(29)
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(2)
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND')

    // The IDAT payload must inflate back to 29 scanlines of filter-0 + RGB.
    const idatStart = png.indexOf(Buffer.from('IDAT', 'ascii'))
    const idatLength = png.readUInt32BE(idatStart - 4)
    const pixels = zlib.inflateSync(png.subarray(idatStart + 4, idatStart + 4 + idatLength))
    expect(pixels.length).toBe(29 * (1 + 29 * 3))
    expect(pixels[0]).toBe(0) // filter: None
    expect([pixels[1], pixels[2], pixels[3]]).toEqual([13, 148, 136])
  })
})

describe('Google happy path', () => {
  beforeEach(reset)

  it('returns a signed Save-to-Google-Wallet URL carrying the EXISTING QR payload', async () => {
    configureGoogle()
    const res = await POST(req({ ticketId: 'tkt1', platform: 'android' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.platform).toBe('android')
    expect(body.saveUrl).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//)

    const jwt = String(body.saveUrl).replace('https://pay.google.com/gp/v/save/', '')
    const [header, claims, signature] = jwt.split('.')
    expect(signature).toBeTruthy()
    expect(JSON.parse(Buffer.from(header, 'base64').toString('utf8'))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })

    const decoded = JSON.parse(Buffer.from(claims, 'base64').toString('utf8'))
    expect(decoded.aud).toBe('google')
    expect(decoded.typ).toBe('savetowallet')
    expect(decoded.iss).toBe('wallet@tikem.iam.gserviceaccount.com')

    const object = decoded.payload.eventTicketObjects[0]
    expect(object.barcode).toEqual({
      type: 'QR_CODE',
      value: 'tkt1',
      alternateText: 'TKM-TKT1',
    })
    expect(object.id).toBe('3388000000000000000.tkt_tkt1')
    expect(object.state).toBe('ACTIVE')

    const eventClass = decoded.payload.eventTicketClasses[0]
    expect(eventClass.id).toBe('3388000000000000000.evt_evt1')
    expect(eventClass.eventName.defaultValue.value).toBe('Konpa Night')
    expect(object.classId).toBe(eventClass.id)

    // No money, no email on the pass.
    expect(JSON.stringify(decoded.payload)).not.toMatch(/price_paid|u@x\.com/)
  })

  it('applies the same authorization gate on the Google path', async () => {
    configureGoogle()
    expect((await POST(req({ ticketId: 'tktSomeoneElse', platform: 'android' }))).status).toBe(403)
    expect((await POST(req({ ticketId: 'tktRefunded', platform: 'android' }))).status).toBe(409)
    state.user = null
    expect((await POST(req({ ticketId: 'tkt1', platform: 'android' }))).status).toBe(401)
  })
})
