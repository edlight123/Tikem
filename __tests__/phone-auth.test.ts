/**
 * Phone sign-in with WhatsApp one-time codes (lib/auth/otp, app/api/auth/phone).
 *
 * Covers: E.164 normalisation and the country allowlist; code generation and
 * hashing; expiry, max attempts, single use and the resend cooldown; per-phone,
 * per-IP and global rate limits; the WhatsApp payload; creating vs finding a
 * user; link conflicts; and the flag (routes 404 when off).
 *
 * Nothing here talks to Meta or Firebase: Auth is faked, the store is the
 * in-memory one, and fetch is a jest mock.
 *
 * @jest-environment node
 */

jest.mock('server-only', () => ({}))

const fakeDb: any = { docs: new Map<string, any>(), failReads: false }
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (fakeDb.failReads) throw new Error('unavailable')
          const d = fakeDb.docs.get(`${c}/${id}`)
          return { exists: d !== undefined, data: () => d }
        },
      }),
    }),
  },
  adminAuth: {},
}))
jest.mock('@/lib/firebase/server', () => ({ getServerSession: jest.fn(async () => ({ user: null })) }))
jest.mock('@/lib/firestore/user-profile-admin', () => ({ createUserProfileAdmin: jest.fn(async () => {}) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => 'n1') }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn(async () => {}) }))
jest.mock('@/lib/email', () => ({ escapeHtml: (s: string) => s, sendEmail: jest.fn(async () => ({ success: true })) }))

import { normalizePhone, allowedCountries, maskPhone } from '@/lib/auth/otp/phone'
import {
  generateCode,
  hashCode,
  otpDocId,
  otpSecret,
  safeEqualHex,
  isWellFormedCode,
} from '@/lib/auth/otp/crypto'
import {
  DevLogSender,
  SmsSender,
  WhatsAppCloudSender,
  buildWhatsAppTemplatePayload,
  selectOtpSender,
  templateLanguage,
  normalizeLocale,
  type OtpSender,
} from '@/lib/auth/otp/senders'
import { startOtp, verifyOtp, DEFAULT_LIMITS, limitsFromEnv, type OtpLimits } from '@/lib/auth/otp/service'
import { memoryOtpStore, OTP_COLLECTION } from '@/lib/auth/otp/store'
import { signInVerifiedPhone, linkVerifiedPhone, type PhoneAuthAdmin, type ProfileWriter } from '@/lib/auth/otp/users'
import {
  decidePhoneAuthEnabled,
  isPhoneAuthEnabled,
  __resetPhoneAuthFlagCache,
} from '@/lib/auth/otp/flag'
import {
  handleStart,
  handleVerify,
  handleLinkStart,
  handleLinkVerify,
  handleStatus,
  clientIp,
  isAllowedOrigin,
  type PhoneAuthDeps,
} from '@/lib/auth/otp/handlers'
import { phoneLinkedCopy, notifyPhoneLinked } from '@/lib/auth/otp/notify'

const SECRET = 'test-secret-test-secret-test-secret-1234'
const HT = '+50937123456'
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)

beforeEach(() => {
  DevLogSender.sent.clear()
})

// ── Phone normalisation ──────────────────────────────────────────────────────

describe('normalizePhone', () => {
  const ALL = ['HT', 'US', 'CA', 'FR', 'DO']

  it.each([
    ['+50937123456', undefined, '+50937123456', 'HT'],
    ['+509 3712-3456', undefined, '+50937123456', 'HT'],
    ['3712 3456', 'HT', '+50937123456', 'HT'],
    ['0050937123456', undefined, '+50937123456', 'HT'],
    ['(212) 555-0123', 'US', '+12125550123', 'US'],
    ['+1 416 555 0123', undefined, '+14165550123', 'CA'],
    ['+1 809 555 0123', undefined, '+18095550123', 'DO'],
    ['06 12 34 56 78', 'FR', '+33612345678', 'FR'],
  ])('%s (%s) -> %s', (input, def, e164, country) => {
    expect(normalizePhone(input, { defaultCountry: def, allowed: ALL })).toEqual({ ok: true, e164, country })
  })

  it.each([[''], ['abc'], ['+509 12'], ['+1 555'], [123 as any], ['+50937123456 ext 2'], ['9'.repeat(40)]])(
    'rejects %p as invalid',
    (input) => {
      expect(normalizePhone(input, { allowed: ALL })).toEqual({ ok: false, code: 'invalid_phone' })
    }
  )

  it('refuses +1 Caribbean ranges outside the allowlist (Jamaica)', () => {
    expect(normalizePhone('+1 876 555 0123', { allowed: ALL })).toEqual({ ok: false, code: 'unsupported_country' })
  })

  it('refuses premium-rate and toll-free numbers even in allowed countries', () => {
    expect(normalizePhone('+33 8 99 12 34 56', { allowed: ALL })).toEqual({ ok: false, code: 'unsupported_country' })
    expect(normalizePhone('+1 900 555 0123', { allowed: ALL })).toEqual({ ok: false, code: 'unsupported_country' })
    expect(normalizePhone('+1 800 555 0123', { allowed: ALL })).toEqual({ ok: false, code: 'unsupported_country' })
  })

  it('reads the allowlist from env, defaulting to HT/US/CA/FR/DO', () => {
    expect(allowedCountries({})).toEqual(['HT', 'US', 'CA', 'FR', 'DO'])
    expect(allowedCountries({ PHONE_OTP_ALLOWED_COUNTRIES: 'ht, fr ,xx1' })).toEqual(['HT', 'FR'])
    expect(normalizePhone('+12125550123', { allowed: allowedCountries({ PHONE_OTP_ALLOWED_COUNTRIES: 'HT' }) })).toEqual({
      ok: false,
      code: 'unsupported_country',
    })
  })

  it('masks numbers for logs', () => {
    expect(maskPhone(HT)).toBe('+509 •••• 3456')
  })
})

// ── Codes and hashing ────────────────────────────────────────────────────────

describe('code generation and hashing', () => {
  it('generates 6-digit numeric codes with leading zeros kept', () => {
    const codes = Array.from({ length: 500 }, generateCode)
    for (const c of codes) expect(c).toMatch(/^\d{6}$/)
    expect(new Set(codes).size).toBeGreaterThan(480)
  })

  it('hashes are keyed, bound to the doc, and compared in constant time', () => {
    const id = otpDocId(SECRET, HT, 'signin')
    const h = hashCode(SECRET, id, '123456')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('123456')
    expect(hashCode(SECRET, id, '123456')).toBe(h)
    expect(hashCode('other-secret', id, '123456')).not.toBe(h)
    expect(hashCode(SECRET, otpDocId(SECRET, '+50937123457', 'signin'), '123456')).not.toBe(h)
    expect(safeEqualHex(h, h)).toBe(true)
    expect(safeEqualHex(h, hashCode(SECRET, id, '123457'))).toBe(false)
    expect(safeEqualHex(h, '')).toBe(false)
    expect(safeEqualHex(h, 'abcd')).toBe(false)
  })

  it('binds the doc id to purpose and account', () => {
    expect(otpDocId(SECRET, HT, 'signin')).not.toBe(otpDocId(SECRET, HT, 'link', 'u1'))
    expect(otpDocId(SECRET, HT, 'link', 'u1')).not.toBe(otpDocId(SECRET, HT, 'link', 'u2'))
  })

  it('requires a real secret in production only', () => {
    expect(otpSecret({ NODE_ENV: 'production' })).toBeNull()
    expect(otpSecret({ NODE_ENV: 'production', AUTH_OTP_SECRET: 'short' })).toBeNull()
    expect(otpSecret({ NODE_ENV: 'production', AUTH_OTP_SECRET: SECRET })).toBe(SECRET)
    expect(otpSecret({ NODE_ENV: 'development' })).toBeTruthy()
  })

  it('validates code shape', () => {
    expect(isWellFormedCode('012345')).toBe(true)
    expect(isWellFormedCode('12345')).toBe(false)
    expect(isWellFormedCode('12345a')).toBe(false)
    expect(isWellFormedCode(123456)).toBe(false)
  })
})

// ── Service: issue / check ───────────────────────────────────────────────────

function setup(limits: Partial<OtpLimits> = {}) {
  const store = memoryOtpStore()
  const sender = new DevLogSender({ NODE_ENV: 'test' })
  const L = { ...DEFAULT_LIMITS, ...limits }
  const start = (o: { e164?: string; ip?: string; now?: number; purpose?: 'signin' | 'link'; uid?: string; sender?: OtpSender } = {}) =>
    startOtp({
      store,
      sender: o.sender ?? sender,
      secret: SECRET,
      e164: o.e164 ?? HT,
      locale: 'ht',
      ip: o.ip ?? '1.1.1.1',
      purpose: o.purpose ?? 'signin',
      uid: o.uid,
      now: o.now ?? T0,
      limits: L,
    })
  const verify = (code: unknown, o: { e164?: string; ip?: string; now?: number; purpose?: 'signin' | 'link'; uid?: string } = {}) =>
    verifyOtp({
      store,
      secret: SECRET,
      e164: o.e164 ?? HT,
      code,
      ip: o.ip ?? '1.1.1.1',
      purpose: o.purpose ?? 'signin',
      uid: o.uid,
      now: o.now ?? T0 + 1000,
      limits: L,
    })
  return { store, start, verify, L }
}

describe('startOtp / verifyOtp', () => {
  it('sends a code, stores only its hash, and accepts it exactly once', async () => {
    const { store, start, verify } = setup()
    expect(await start()).toEqual({ ok: true, resendAfterSec: 60, expiresInSec: 600 })
    const code = DevLogSender.lastCode(HT)!
    expect(DevLogSender.sent.get(HT)?.locale).toBe('ht')

    const stored = JSON.stringify(Array.from(store.data.entries()))
    expect(stored).not.toContain(code)
    expect(stored).not.toContain('37123456')

    expect(await verify(code)).toEqual({ ok: true })
    expect(await verify(code)).toEqual({ ok: false, code: 'invalid_code' })
    expect(Array.from(store.data.keys()).some((k) => k.startsWith(`${OTP_COLLECTION}/`))).toBe(false)
  })

  it('expires codes after 10 minutes', async () => {
    const { start, verify } = setup()
    await start()
    const code = DevLogSender.lastCode(HT)!
    expect(await verify(code, { now: T0 + 10 * 60 * 1000 + 1 })).toEqual({ ok: false, code: 'invalid_code' })
  })

  it('kills a code after 5 wrong guesses, even if the 6th is right', async () => {
    const { start, verify } = setup()
    await start()
    const code = DevLogSender.lastCode(HT)!
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 4; i++) expect(await verify(wrong)).toEqual({ ok: false, code: 'invalid_code' })
    expect(await verify(wrong)).toEqual({ ok: false, code: 'too_many_attempts' })
    expect(await verify(code)).toEqual({ ok: false, code: 'invalid_code' })
  })

  it('counts malformed codes as wrong guesses', async () => {
    const { start, verify } = setup()
    await start()
    expect(await verify('12')).toEqual({ ok: false, code: 'invalid_code' })
    expect(await verify(null)).toEqual({ ok: false, code: 'invalid_code' })
  })

  it('a code for another number never verifies', async () => {
    const { start, verify } = setup()
    await start()
    const code = DevLogSender.lastCode(HT)!
    expect(await verify(code, { e164: '+50937123457' })).toEqual({ ok: false, code: 'invalid_code' })
  })

  it('holds re-sends back for 60 seconds, without spending quota', async () => {
    const { start } = setup()
    await start()
    expect(await start({ now: T0 + 30_000 })).toEqual({ ok: false, code: 'cooldown', retryAfterSec: 30 })
    expect(DevLogSender.sent.size).toBe(1)
    expect((await start({ now: T0 + 61_000 })).ok).toBe(true)
  })

  it('a resend replaces the code', async () => {
    const { start, verify } = setup()
    await start()
    const first = DevLogSender.lastCode(HT)!
    await start({ now: T0 + 61_000 })
    const second = DevLogSender.lastCode(HT)!
    if (first !== second) {
      expect(await verify(first, { now: T0 + 62_000 })).toEqual({ ok: false, code: 'invalid_code' })
    }
    expect(await verify(second, { now: T0 + 63_000 })).toEqual({ ok: true })
  })

  it('caps sends per number per hour, then per day', async () => {
    const { start } = setup()
    let t = T0
    for (let i = 0; i < 5; i++) {
      expect((await start({ now: t })).ok).toBe(true)
      t += 61_000
    }
    const blocked = await start({ now: t })
    expect(blocked).toMatchObject({ ok: false, code: 'rate_limited' })

    // Next hours: 5 more fit in the day, then the daily cap holds.
    t = T0 + 60 * 60 * 1000
    for (let i = 0; i < 5; i++) {
      expect((await start({ now: t, ip: `9.9.9.${i}` })).ok).toBe(true)
      t += 61_000
    }
    t = T0 + 3 * 60 * 60 * 1000
    expect(await start({ now: t })).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('caps sends per IP across many numbers', async () => {
    const { start } = setup({ ipPerHour: 3 })
    for (let i = 0; i < 3; i++) expect((await start({ e164: `+5093712345${i}` })).ok).toBe(true)
    expect(await start({ e164: '+50937123459' })).toMatchObject({ ok: false, code: 'rate_limited' })
    expect((await start({ e164: '+50937123459', ip: '2.2.2.2' })).ok).toBe(true)
  })

  it('enforces the global daily ceiling (cost guard)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { start } = setup({ globalPerDay: 2 })
    expect((await start({ e164: '+50937123450', ip: 'a' })).ok).toBe(true)
    expect((await start({ e164: '+50937123451', ip: 'b' })).ok).toBe(true)
    expect(await start({ e164: '+50937123452', ip: 'c' })).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(DevLogSender.sent.size).toBe(2)
    // A new UTC day resets it.
    expect((await start({ e164: '+50937123452', ip: 'c', now: T0 + 24 * 60 * 60 * 1000 })).ok).toBe(true)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('GLOBAL DAILY CAP'), expect.anything())
    errSpy.mockRestore()
  })

  it('caps code guesses per IP across numbers', async () => {
    const { start, verify } = setup({ ipVerifyPerHour: 2 })
    await start()
    expect(await verify('000001')).toMatchObject({ code: 'invalid_code' })
    expect(await verify('000002')).toMatchObject({ code: 'invalid_code' })
    expect(await verify(DevLogSender.lastCode(HT))).toEqual({ ok: false, code: 'rate_limited' })
  })

  it('on a failed send, reports send_failed and lifts the cooldown', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { start } = setup()
    const broken: OtpSender = { name: 'broken', send: async () => { throw new Error('boom') } }
    expect(await start({ sender: broken })).toEqual({ ok: false, code: 'send_failed' })
    expect((await start({ now: T0 + 1000 })).ok).toBe(true)
    errSpy.mockRestore()
  })

  it('a sign-in code cannot complete a link, and a link code is bound to its account', async () => {
    const { start, verify } = setup()
    await start()
    const signinCode = DevLogSender.lastCode(HT)!
    expect(await verify(signinCode, { purpose: 'link', uid: 'u1' })).toEqual({ ok: false, code: 'invalid_code' })

    await start({ purpose: 'link', uid: 'u1', now: T0 + 61_000 })
    const linkCode = DevLogSender.lastCode(HT)!
    expect(await verify(linkCode, { purpose: 'link', uid: 'u2', now: T0 + 62_000 })).toEqual({ ok: false, code: 'invalid_code' })
    expect(await verify(linkCode, { purpose: 'link', uid: 'u1', now: T0 + 62_000 })).toEqual({ ok: true })
  })

  it('reads limits from env', () => {
    expect(limitsFromEnv({ PHONE_OTP_DAILY_CAP: '50', PHONE_OTP_PER_PHONE_HOURLY: 'x' })).toMatchObject({
      globalPerDay: 50,
      phonePerHour: DEFAULT_LIMITS.phonePerHour,
    })
  })
})

// ── Senders ──────────────────────────────────────────────────────────────────

describe('WhatsApp Cloud sender', () => {
  it('builds the authentication-template payload with the copy-code button', () => {
    expect(buildWhatsAppTemplatePayload('+50937123456', '123456', 'fr', 'tikem_login_code')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '50937123456',
      type: 'template',
      template: {
        name: 'tikem_login_code',
        language: { code: 'fr' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    })
  })

  it('maps ht to French unless an ht template language is configured', () => {
    expect(templateLanguage('ht', {})).toBe('fr')
    expect(templateLanguage('ht', { WHATSAPP_TEMPLATE_LANG_HT: 'ht' })).toBe('ht')
    expect(templateLanguage('en', {})).toBe('en')
    expect(templateLanguage('en', { WHATSAPP_TEMPLATE_LANG_EN: 'en_US' })).toBe('en_US')
    expect(normalizeLocale('ht-HT')).toBe('ht')
    expect(normalizeLocale('es')).toBe('en')
  })

  it('POSTs to the Graph API with a bearer token', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid' }] }), { status: 200 }))
    const sender = new WhatsAppCloudSender(
      { accessToken: 'TOKEN', phoneNumberId: '1234', templateName: 'tikem_login_code', apiVersion: 'v25.0' },
      {},
      fetchMock as any
    )
    await sender.send(HT, '654321', 'ht')
    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v25.0/1234/messages')
    expect((init.headers as any).Authorization).toBe('Bearer TOKEN')
    const body = JSON.parse(String(init.body))
    expect(body.template.language.code).toBe('fr')
    expect(body.template.components[1].parameters[0].text).toBe('654321')
  })

  it('throws on a Meta error without leaking the code to logs', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ error: { code: 131026 } }), { status: 400 }))
    const sender = new WhatsAppCloudSender(
      { accessToken: 'T', phoneNumberId: '1', templateName: 'x', apiVersion: 'v25.0' },
      {},
      fetchMock as any
    )
    await expect(sender.send(HT, '999888', 'en')).rejects.toThrow('whatsapp_rejected')
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('999888')
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('37123456')
    errSpy.mockRestore()
  })

  it('selects senders safely per environment', () => {
    const wa = { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' }
    expect(selectOtpSender({ NODE_ENV: 'production' })).toBeNull()
    expect(selectOtpSender({ NODE_ENV: 'production', ...wa })?.name).toBe('whatsapp')
    expect(selectOtpSender({ NODE_ENV: 'development' })?.name).toBe('dev-log')
    expect(selectOtpSender({ NODE_ENV: 'development', OTP_SENDER: 'whatsapp', ...wa })?.name).toBe('whatsapp')
    expect(() => new DevLogSender({ NODE_ENV: 'production' })).toThrow()
  })

  it('the SMS slot is a placeholder that never sends', async () => {
    await expect(new SmsSender().send()).rejects.toThrow('sms_not_configured')
  })
})

// ── Users: find / create / link ──────────────────────────────────────────────

function fakeAuth(initial: Array<{ uid: string; phoneNumber?: string; disabled?: boolean }> = []) {
  const users = new Map(initial.map((u) => [u.uid, { ...u }]))
  let n = 0
  const err = (code: string) => Object.assign(new Error(code), { code })
  const auth: PhoneAuthAdmin & { users: typeof users } = {
    users,
    async getUserByPhoneNumber(phone) {
      const u = Array.from(users.values()).find((x) => x.phoneNumber === phone)
      if (!u) throw err('auth/user-not-found')
      return u
    },
    async getUser(uid) {
      const u = users.get(uid)
      if (!u) throw err('auth/user-not-found')
      return u
    },
    async createUser({ phoneNumber }) {
      if (Array.from(users.values()).some((x) => x.phoneNumber === phoneNumber)) throw err('auth/phone-number-already-exists')
      const uid = `new${++n}`
      users.set(uid, { uid, phoneNumber })
      return { uid }
    },
    async updateUser(uid, { phoneNumber }) {
      if (Array.from(users.values()).some((x) => x.phoneNumber === phoneNumber && x.uid !== uid)) {
        throw err('auth/phone-number-already-exists')
      }
      users.get(uid)!.phoneNumber = phoneNumber
    },
    async createCustomToken(uid) {
      return `token-for-${uid}`
    },
  }
  return auth
}

function fakeProfiles(existing: string[] = []) {
  const docs = new Map<string, any>(existing.map((u) => [u, { role: 'attendee' }]))
  const writer: ProfileWriter & { docs: typeof docs } = {
    docs,
    async exists(uid) {
      return docs.has(uid)
    },
    async create(uid, e164, locale, country) {
      docs.set(uid, { phone_number: e164, language: locale, default_country: country, role: 'attendee' })
    },
    async setPhone(uid, e164) {
      docs.set(uid, { ...(docs.get(uid) || {}), phone_number: e164 })
    },
  }
  return writer
}

describe('signInVerifiedPhone', () => {
  it('creates an account and its profile for a new number', async () => {
    const auth = fakeAuth()
    const profiles = fakeProfiles()
    const r = await signInVerifiedPhone({ auth, profiles, e164: HT, country: 'HT', locale: 'ht' })
    expect(r).toEqual({ ok: true, uid: 'new1', token: 'token-for-new1', isNewUser: true })
    expect(profiles.docs.get('new1')).toMatchObject({ phone_number: HT, language: 'ht', role: 'attendee' })
  })

  it('finds the existing account and does not touch its profile', async () => {
    const auth = fakeAuth([{ uid: 'u1', phoneNumber: HT }])
    const profiles = fakeProfiles(['u1'])
    const r = await signInVerifiedPhone({ auth, profiles, e164: HT, country: 'HT', locale: 'en' })
    expect(r).toEqual({ ok: true, uid: 'u1', token: 'token-for-u1', isNewUser: false })
    expect(profiles.docs.get('u1')).toEqual({ role: 'attendee' })
  })

  it('heals a missing profile for an existing account', async () => {
    const auth = fakeAuth([{ uid: 'u1', phoneNumber: HT }])
    const profiles = fakeProfiles()
    await signInVerifiedPhone({ auth, profiles, e164: HT, country: 'HT', locale: 'en' })
    expect(profiles.docs.has('u1')).toBe(true)
  })

  it('refuses disabled accounts', async () => {
    const auth = fakeAuth([{ uid: 'u1', phoneNumber: HT, disabled: true }])
    expect(await signInVerifiedPhone({ auth, profiles: fakeProfiles(['u1']), e164: HT, country: 'HT', locale: 'en' })).toEqual({
      ok: false,
      code: 'account_disabled',
    })
  })

  it('survives losing a create race', async () => {
    const auth = fakeAuth()
    const realGet = auth.getUserByPhoneNumber.bind(auth)
    let first = true
    auth.getUserByPhoneNumber = async (p) => {
      if (first) {
        first = false
        auth.users.set('racer', { uid: 'racer', phoneNumber: HT })
        throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' })
      }
      return realGet(p)
    }
    const r = await signInVerifiedPhone({ auth, profiles: fakeProfiles(['racer']), e164: HT, country: 'HT', locale: 'en' })
    expect(r).toMatchObject({ ok: true, uid: 'racer', isNewUser: false })
  })
})

describe('linkVerifiedPhone', () => {
  it('adds a free number to the signed-in account', async () => {
    const auth = fakeAuth([{ uid: 'me' }])
    const profiles = fakeProfiles(['me'])
    expect(await linkVerifiedPhone({ auth, profiles, uid: 'me', e164: HT })).toEqual({ ok: true, phoneNumber: HT })
    expect(auth.users.get('me')!.phoneNumber).toBe(HT)
    expect(profiles.docs.get('me').phone_number).toBe(HT)
  })

  it('refuses a number owned by another account', async () => {
    const auth = fakeAuth([{ uid: 'me' }, { uid: 'other', phoneNumber: HT }])
    expect(await linkVerifiedPhone({ auth, profiles: fakeProfiles(), uid: 'me', e164: HT })).toEqual({
      ok: false,
      code: 'phone_in_use',
    })
    expect(auth.users.get('me')!.phoneNumber).toBeUndefined()
  })

  it('maps a concurrent claim (already-exists on update) to phone_in_use', async () => {
    const auth = fakeAuth([{ uid: 'me' }])
    auth.updateUser = async () => {
      throw Object.assign(new Error('x'), { code: 'auth/phone-number-already-exists' })
    }
    expect(await linkVerifiedPhone({ auth, profiles: fakeProfiles(), uid: 'me', e164: HT })).toEqual({
      ok: false,
      code: 'phone_in_use',
    })
  })

  it('will not silently replace a different number', async () => {
    const auth = fakeAuth([{ uid: 'me', phoneNumber: '+50937000000' }])
    expect(await linkVerifiedPhone({ auth, profiles: fakeProfiles(), uid: 'me', e164: HT })).toEqual({
      ok: false,
      code: 'phone_already_set',
    })
  })

  it('is idempotent for the same number', async () => {
    const auth = fakeAuth([{ uid: 'me', phoneNumber: HT }])
    expect(await linkVerifiedPhone({ auth, profiles: fakeProfiles(), uid: 'me', e164: HT })).toEqual({ ok: true, phoneNumber: HT })
  })
})

// ── Flag ─────────────────────────────────────────────────────────────────────

describe('feature flag', () => {
  beforeEach(() => {
    __resetPhoneAuthFlagCache()
    fakeDb.docs.clear()
    fakeDb.failReads = false
  })

  it('needs the env key, and in production the remote switch too', () => {
    expect(decidePhoneAuthEnabled({ envEnabled: false, remoteSwitch: true, production: true })).toBe(false)
    expect(decidePhoneAuthEnabled({ envEnabled: true, remoteSwitch: false, production: true })).toBe(false)
    expect(decidePhoneAuthEnabled({ envEnabled: true, remoteSwitch: true, production: true })).toBe(true)
    expect(decidePhoneAuthEnabled({ envEnabled: true, remoteSwitch: false, production: false })).toBe(true)
  })

  it('is off by default', async () => {
    expect(await isPhoneAuthEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(await isPhoneAuthEnabled({ NODE_ENV: 'development' })).toBe(false)
  })

  it('fails closed in production: missing doc, false, or read error', async () => {
    const env = { NODE_ENV: 'production', PHONE_AUTH_ENABLED: 'true' }
    expect(await isPhoneAuthEnabled(env)).toBe(false)

    __resetPhoneAuthFlagCache()
    fakeDb.docs.set('config/auth', { phone_whatsapp: 'true' })
    expect(await isPhoneAuthEnabled(env)).toBe(false)

    __resetPhoneAuthFlagCache()
    fakeDb.docs.set('config/auth', { phone_whatsapp: true })
    expect(await isPhoneAuthEnabled(env)).toBe(true)

    __resetPhoneAuthFlagCache()
    fakeDb.failReads = true
    expect(await isPhoneAuthEnabled(env)).toBe(false)
  })
})

// ── Handlers (HTTP) ──────────────────────────────────────────────────────────

function req(body: unknown, ip = '5.5.5.5', headers: Record<string, string> = {}) {
  return new Request('https://www.tikem.co/api/auth/phone/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** A request carrying a (fake) Firebase ID token for `uid`. */
const asUser = (uid: string, body: unknown, extra: Record<string, string> = {}) =>
  req(body, '5.5.5.5', { authorization: `Bearer idtoken-${uid}`, ...extra })

function deps(over: Partial<PhoneAuthDeps> = {}) {
  const store = memoryOtpStore()
  const auth = fakeAuth([{ uid: 'me' }, { uid: 'other', phoneNumber: '+50937999999' }])
  const profiles = fakeProfiles(['me', 'other'])
  const d: PhoneAuthDeps = {
    enabled: async () => true,
    store: () => store,
    sender: () => new DevLogSender({ NODE_ENV: 'test' }),
    auth: () => auth,
    profiles: () => profiles,
    // Fake verifyIdToken: "idtoken-<uid>" is valid for <uid>; anything else is not.
    bearerUid: async (t: string) => (t.startsWith('idtoken-') ? t.slice('idtoken-'.length) : null),
    onPhoneLinked: jest.fn(async () => {}),
    secret: () => SECRET,
    allowedCountries: () => ['HT', 'US', 'CA', 'FR', 'DO'],
    ...over,
  }
  return { d, auth, profiles }
}

describe('handlers', () => {
  it('every route answers 404 when the feature is off', async () => {
    const { d } = deps({ enabled: async () => false })
    for (const res of [
      await handleStatus(d),
      await handleStart(req({ phone: HT }), d),
      await handleVerify(req({ phone: HT, code: '123456' }), d),
      await handleLinkStart(req({ phone: HT }), d),
      await handleLinkVerify(req({ phone: HT, code: '123456' }), d),
    ]) {
      expect(res.status).toBe(404)
    }
  })

  it('sign in end to end: start, then verify returns a custom token', async () => {
    const { d, auth } = deps()
    const s = await handleStart(req({ phone: '3712 3456', country: 'HT', locale: 'fr' }), d)
    expect(s.status).toBe(200)
    expect(await s.json()).toEqual({ ok: true, resendAfterSec: 60, expiresInSec: 600 })
    expect(s.headers.get('cache-control')).toBe('no-store')

    const code = DevLogSender.lastCode(HT)!
    const bad = await handleVerify(req({ phone: HT, code: code === '000000' ? '111111' : '000000' }), d)
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe('invalid_code')

    const v = await handleVerify(req({ phone: HT, code }), d)
    expect(v.status).toBe(200)
    const body = await v.json()
    expect(body.token).toMatch(/^token-for-new/)
    expect(body.isNewUser).toBe(true)
    expect(Array.from(auth.users.values()).find((u) => u.phoneNumber === HT)).toBeTruthy()
  })

  it('answers the same for a known and an unknown number (no enumeration)', async () => {
    const { d } = deps()
    const known = await handleStart(req({ phone: '+50937999999' }, '7.7.7.1'), d)
    const unknown = await handleStart(req({ phone: '+50937888888' }, '7.7.7.2'), d)
    expect(known.status).toBe(unknown.status)
    expect(await known.json()).toEqual(await unknown.json())
  })

  it('validates input', async () => {
    const { d } = deps()
    expect((await (await handleStart(req('not json'), d)).json()).code).toBe('bad_request')
    expect((await (await handleStart(req({ phone: 'abc' }), d)).json()).code).toBe('invalid_phone')
    expect((await (await handleStart(req({ phone: '+1 876 555 0123' }), d)).json()).code).toBe('unsupported_country')
  })

  it('returns 429 with Retry-After on cooldown', async () => {
    const { d } = deps()
    await handleStart(req({ phone: HT }), d)
    const again = await handleStart(req({ phone: HT }), d)
    expect(again.status).toBe(429)
    expect(again.headers.get('retry-after')).toBeTruthy()
    expect((await again.json()).code).toBe('cooldown')
  })

  it('503s (and sends nothing) when enabled but unconfigured', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { d } = deps({ sender: () => null })
    const res = await handleStart(req({ phone: HT }), d)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('unavailable')
    errSpy.mockRestore()
  })

  it('link routes require a bearer ID token', async () => {
    const { d } = deps()
    expect((await handleLinkStart(req({ phone: HT }), d)).status).toBe(401)
    expect((await handleLinkVerify(req({ phone: HT, code: '123456' }), d)).status).toBe(401)
    expect((await handleLinkStart(req({ phone: HT }, '1.1.1.1', { authorization: 'Bearer forged' }), d)).status).toBe(401)
  })

  it('CSRF: a session cookie alone never authenticates the link routes', async () => {
    // Even with a session layer that would accept the cookie, the handlers
    // only look at the Authorization header.
    const { d, auth } = deps()
    const cookieOnly = { cookie: 'session=valid-session-cookie-for-me', origin: 'https://www.tikem.co' }
    expect((await handleLinkStart(req({ phone: HT }, '1.1.1.1', cookieOnly), d)).status).toBe(401)
    expect((await handleLinkVerify(req({ phone: HT, code: '123456' }, '1.1.1.1', cookieOnly), d)).status).toBe(401)
    expect(DevLogSender.sent.size).toBe(0)
    expect(auth.users.get('me')!.phoneNumber).toBeUndefined()
  })

  it('CSRF: non-JSON bodies are refused with 415 on every POST', async () => {
    const { d } = deps()
    const form = (body: string, extra: Record<string, string> = {}) =>
      new Request('https://www.tikem.co/api/auth/phone/x', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra },
        body,
      })
    expect((await handleStart(form('phone=%2B50937123456'), d)).status).toBe(415)
    expect((await handleVerify(form('phone=x&code=123456'), d)).status).toBe(415)
    expect((await handleLinkStart(form('phone=x', { authorization: 'Bearer idtoken-me' }), d)).status).toBe(415)
    expect((await handleLinkVerify(form('phone=x&code=1', { authorization: 'Bearer idtoken-me' }), d)).status).toBe(415)
    const noType = new Request('https://www.tikem.co/x', { method: 'POST', body: JSON.stringify({ phone: HT }) })
    noType.headers.delete('content-type')
    expect((await handleStart(noType, d)).status).toBe(415)
    expect((await handleStart(req({ phone: HT }, '1.1.1.1', { 'content-type': 'application/json; charset=utf-8' }), d)).status).toBe(200)
    expect(DevLogSender.sent.size).toBe(1)
  })

  it('CSRF: a foreign Origin is refused with 403 on every POST', async () => {
    const { d } = deps()
    const evil = { origin: 'https://evil.example' }
    expect((await handleStart(req({ phone: HT }, '1.1.1.1', evil), d)).status).toBe(403)
    expect((await handleVerify(req({ phone: HT, code: '123456' }, '1.1.1.1', evil), d)).status).toBe(403)
    expect((await handleLinkStart(asUser('me', { phone: HT }, evil), d)).status).toBe(403)
    expect((await handleLinkVerify(asUser('me', { phone: HT, code: '123456' }, evil), d)).status).toBe(403)
    expect((await handleStart(req({ phone: HT }, '1.1.1.1', { origin: 'null' }), d)).status).toBe(403)
    expect(DevLogSender.sent.size).toBe(0)
    // First-party origin, and no Origin at all (native app), both pass.
    expect((await handleStart(req({ phone: HT }, '1.1.1.1', { origin: 'https://www.tikem.co' }), d)).status).toBe(200)
    expect((await handleLinkStart(asUser('me', { phone: '+50937123400' }), d)).status).toBe(200)
  })

  it('origin allowlist: tikem.co, configured extras, localhost only outside production', () => {
    const prod = { NODE_ENV: 'production' }
    expect(isAllowedOrigin('https://www.tikem.co', prod)).toBe(true)
    expect(isAllowedOrigin('https://tikem.co', prod)).toBe(true)
    expect(isAllowedOrigin('http://www.tikem.co', prod)).toBe(false)
    expect(isAllowedOrigin('https://www.tikem.co.evil.com', prod)).toBe(false)
    expect(isAllowedOrigin('http://localhost:3000', prod)).toBe(false)
    expect(isAllowedOrigin('http://localhost:3000', { NODE_ENV: 'development' })).toBe(true)
    expect(isAllowedOrigin('https://preview.vercel.app', { ...prod, PHONE_AUTH_ALLOWED_ORIGINS: 'https://preview.vercel.app/' })).toBe(true)
  })

  it('links a number to the signed-in account and sends the security notice', async () => {
    const { d, auth } = deps()
    expect((await handleLinkStart(asUser('me', { phone: HT }), d)).status).toBe(200)
    const code = DevLogSender.lastCode(HT)!
    const res = await handleLinkVerify(asUser('me', { phone: HT, code }), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phoneNumber: HT })
    expect(auth.users.get('me')!.phoneNumber).toBe(HT)
    expect(d.onPhoneLinked).toHaveBeenCalledWith('me', HT)
  })

  it('a link code started by one account is refused for another', async () => {
    const { d, auth } = deps()
    auth.users.set('victim', { uid: 'victim' })
    await handleLinkStart(asUser('me', { phone: HT }), d)
    const code = DevLogSender.lastCode(HT)!
    const res = await handleLinkVerify(asUser('victim', { phone: HT, code }), d)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_code')
    expect(auth.users.get('victim')!.phoneNumber).toBeUndefined()
    // ...and it is still good for the account that started it.
    expect((await handleLinkVerify(asUser('me', { phone: HT, code }), d)).status).toBe(200)
  })

  it('a sign-in code cannot be used on the link route', async () => {
    const { d, auth } = deps()
    await handleStart(req({ phone: HT }), d)
    const code = DevLogSender.lastCode(HT)!
    expect((await handleLinkVerify(asUser('me', { phone: HT, code }), d)).status).toBe(400)
    expect(auth.users.get('me')!.phoneNumber).toBeUndefined()
  })

  it('link conflict: a number on another account is refused with 409, no notice', async () => {
    const { d, auth } = deps()
    await handleLinkStart(asUser('me', { phone: '+50937999999' }), d)
    const code = DevLogSender.lastCode('+50937999999')!
    const res = await handleLinkVerify(asUser('me', { phone: '+50937999999', code }), d)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('phone_in_use')
    expect(auth.users.get('me')!.phoneNumber).toBeUndefined()
    expect(d.onPhoneLinked).not.toHaveBeenCalled()
  })

  it('takes the client IP from the first forwarded hop', () => {
    expect(clientIp(req({}, '8.8.8.8'))).toBe('8.8.8.8')
    expect(clientIp(new Request('https://x.co'))).toBe('unknown')
  })
})

// ── Security notice ──────────────────────────────────────────────────────────

describe('phone-linked notice', () => {
  it('is localised and masks the number', () => {
    expect(phoneLinkedCopy('ht', HT).title).toBe('Nimewo telefòn ajoute')
    expect(phoneLinkedCopy('fr', HT).body).toContain('+509 •••• 3456')
    expect(phoneLinkedCopy(undefined, HT).body).not.toContain('37123456')
    for (const l of ['en', 'fr', 'ht']) expect(phoneLinkedCopy(l, HT).body.includes('\u2014')).toBe(false)
  })

  it('writes the bell entry, pushes, and emails when the account has an email', async () => {
    fakeDb.failReads = false
    fakeDb.docs.set('users/me', { language: 'fr', email: 'me@example.com' })
    const { createNotification } = require('@/lib/notifications/helpers')
    const { sendPushNotification } = require('@/lib/notification-triggers')
    const { sendEmail } = require('@/lib/email')
    await notifyPhoneLinked('me', HT)
    expect(createNotification).toHaveBeenCalledWith('me', 'account_security', 'Numéro de téléphone ajouté', expect.any(String), '/profile', expect.anything())
    expect(sendPushNotification).toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'me@example.com' }))
  })
})

// ── The real route files, flag off ───────────────────────────────────────────

describe('route files with the flag off (production defaults)', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    __resetPhoneAuthFlagCache()
    delete process.env.PHONE_AUTH_ENABLED
  })
  afterAll(() => {
    process.env = saved
  })

  it.each([
    ['start', () => require('@/app/api/auth/phone/start/route').POST],
    ['verify', () => require('@/app/api/auth/phone/verify/route').POST],
    ['link/start', () => require('@/app/api/auth/phone/link/start/route').POST],
    ['link/verify', () => require('@/app/api/auth/phone/link/verify/route').POST],
  ])('POST %s -> 404', async (_name, load) => {
    const res = await load()(req({ phone: HT, code: '123456' }))
    expect(res.status).toBe(404)
  })

  it('GET status -> 404', async () => {
    const { GET } = require('@/app/api/auth/phone/status/route')
    expect((await GET()).status).toBe(404)
  })
})
