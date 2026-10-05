/**
 * HTTP handlers for phone sign-in, separated from the route files so tests can
 * inject a store, a sender and a fake Auth.
 *
 *   POST /api/auth/phone/start         { phone, locale?, country? }
 *   POST /api/auth/phone/verify        { phone, code, locale?, country? } -> { token }
 *   POST /api/auth/phone/link/start    (signed in) { phone, locale?, country? }
 *   POST /api/auth/phone/link/verify   (signed in) { phone, code, country? } -> { phoneNumber }
 *   GET  /api/auth/phone/status        -> { enabled: true }  (404 when off)
 *
 * Every route answers 404 when the feature is off, so a disabled deployment
 * is indistinguishable from one without the feature.
 *
 * Request hardening (CSRF): every POST must be `Content-Type: application/json`
 * (415), which a cross-site HTML form cannot send without a CORS preflight we
 * never answer. A present Origin must be on the allowlist (403). The link
 * routes authenticate ONLY with a Firebase ID token in `Authorization: Bearer`
 * (verified with revocation checks), never the ambient session cookie, so a
 * cross-site request riding a signed-in victim's cookie cannot attach the
 * attacker's number to the victim's account. Native apps send no Origin; that
 * is accepted, and on the link routes only together with the bearer token.
 *
 * Error bodies carry a machine `code` the app localises; the English `error`
 * is for logs only. Codes are deliberately coarse: nothing reveals whether an
 * account exists for a number.
 */

import { NextResponse } from 'next/server'
import { normalizePhone, type NormalizedPhone } from './phone'
import { otpSecret } from './crypto'
import { normalizeLocale, type OtpSender } from './senders'
import { startOtp, verifyOtp, type OtpLimits } from './service'
import type { OtpStore } from './store'
import {
  linkVerifiedPhone,
  signInVerifiedPhone,
  type PhoneAuthAdmin,
  type ProfileWriter,
} from './users'

export interface PhoneAuthDeps {
  enabled: () => Promise<boolean>
  store: () => OtpStore
  sender: () => OtpSender | null
  auth: () => PhoneAuthAdmin
  profiles: () => ProfileWriter
  /**
   * Verify a Firebase ID token (with revocation check) and return its uid, or
   * null. The link routes use this and nothing else: no cookies.
   */
  bearerUid: (idToken: string) => Promise<string | null>
  /** Is this Origin header value allowed? Defaults to isAllowedOrigin(process.env). */
  allowedOrigin?: (origin: string) => boolean
  /** Security notice after a number is linked (best-effort; awaited, never throws). */
  onPhoneLinked?: (uid: string, e164: string) => Promise<void>
  secret?: () => string | null
  limits?: () => OtpLimits
  allowedCountries?: () => string[]
}

const MESSAGES: Record<string, string> = {
  not_found: 'Not found',
  unsupported_media_type: 'Send JSON.',
  forbidden_origin: 'Origin not allowed.',
  bad_request: 'Malformed request.',
  invalid_phone: 'Enter a valid phone number.',
  unsupported_country: 'Phone sign-in is not available for this number.',
  cooldown: 'Please wait before requesting another code.',
  rate_limited: 'Too many attempts. Please try again later.',
  send_failed: 'We could not send the code. Please try again.',
  unavailable: 'Phone sign-in is temporarily unavailable.',
  invalid_code: 'That code is not valid.',
  too_many_attempts: 'Too many wrong codes. Request a new code.',
  account_disabled: 'This account cannot sign in.',
  unauthorized: 'Sign in first.',
  phone_in_use: 'This number is already linked to another account.',
  phone_already_set: 'This account already has a phone number.',
}

function fail(code: string, status: number, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (typeof extra.retryAfterSec === 'number') headers['Retry-After'] = String(extra.retryAfterSec)
  return NextResponse.json({ error: MESSAGES[code] ?? 'Error', code, ...extra }, { status, headers })
}

function ok(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** The caller's IP as Vercel reports it; the first hop of x-forwarded-for otherwise. */
export function clientIp(req: Request): string {
  const h = req.headers
  const raw =
    h.get('x-vercel-forwarded-for') || h.get('x-real-ip') || h.get('x-forwarded-for') || 'unknown'
  return raw.split(',')[0].trim().slice(0, 64) || 'unknown'
}

const FIRST_PARTY_ORIGINS = ['https://www.tikem.co', 'https://tikem.co']

/**
 * Origins allowed to call the phone routes from a browser: the production
 * site, any extra origins in PHONE_AUTH_ALLOWED_ORIGINS (comma-separated, e.g.
 * a preview URL), and localhost outside production.
 */
export function isAllowedOrigin(origin: string, env: Record<string, string | undefined> = process.env): boolean {
  const extra = (env.PHONE_AUTH_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
  if ([...FIRST_PARTY_ORIGINS, ...extra].includes(origin)) return true
  return env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

/** Content type + Origin checks shared by every POST. Null means "go on". */
function rejectRequest(req: Request, deps: PhoneAuthDeps): Response | null {
  const ct = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (ct !== 'application/json') return fail('unsupported_media_type', 415)
  const origin = req.headers.get('origin')
  if (origin !== null) {
    const allowed = deps.allowedOrigin ? deps.allowedOrigin(origin) : isAllowedOrigin(origin)
    if (!allowed) return fail('forbidden_origin', 403)
  }
  return null
}

/** The link routes' caller: a verified ID token from the Authorization header, only. */
async function linkCaller(req: Request, deps: PhoneAuthDeps): Promise<string | null> {
  const token = bearerToken(req)
  if (!token) return null
  try {
    return await deps.bearerUid(token)
  } catch {
    return null
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parsePhone(body: Record<string, unknown>, deps: PhoneAuthDeps): NormalizedPhone {
  return normalizePhone(body.phone, {
    defaultCountry: typeof body.country === 'string' ? body.country : undefined,
    allowed: deps.allowedCountries?.(),
  })
}

function resolveSecret(deps: PhoneAuthDeps): string | null {
  return deps.secret ? deps.secret() : otpSecret()
}

export async function handleStatus(deps: PhoneAuthDeps) {
  if (!(await deps.enabled())) return notFound()
  return ok({ enabled: true })
}

async function handleStartFor(req: Request, deps: PhoneAuthDeps, purpose: 'signin' | 'link') {
  if (!(await deps.enabled())) return notFound()
  const rejected = rejectRequest(req, deps)
  if (rejected) return rejected

  let uid: string | undefined
  if (purpose === 'link') {
    uid = (await linkCaller(req, deps)) ?? undefined
    if (!uid) return fail('unauthorized', 401)
  }

  const body = await readBody(req)
  if (!body) return fail('bad_request', 400)
  const phone = parsePhone(body, deps)
  if (!phone.ok) return fail(phone.code, 400)

  const secret = resolveSecret(deps)
  const sender = deps.sender()
  if (!secret || !sender) {
    console.error('[otp] phone auth enabled but not configured', { hasSecret: !!secret, hasSender: !!sender })
    return fail('unavailable', 503)
  }

  const result = await startOtp({
    store: deps.store(),
    sender,
    secret,
    e164: phone.e164,
    locale: normalizeLocale(body.locale),
    ip: clientIp(req),
    purpose,
    uid,
    limits: deps.limits?.(),
  })

  if (result.ok) return ok({ ok: true, resendAfterSec: result.resendAfterSec, expiresInSec: result.expiresInSec })
  if (result.code === 'send_failed') return fail('send_failed', 502)
  return fail(result.code, 429, { retryAfterSec: result.retryAfterSec })
}

export const handleStart = (req: Request, deps: PhoneAuthDeps) => handleStartFor(req, deps, 'signin')
export const handleLinkStart = (req: Request, deps: PhoneAuthDeps) => handleStartFor(req, deps, 'link')

async function checkCode(
  req: Request,
  deps: PhoneAuthDeps,
  purpose: 'signin' | 'link',
  uid?: string
): Promise<
  | { ok: true; e164: string; country: string; body: Record<string, unknown> }
  | { ok: false; res: Response }
> {
  const body = await readBody(req)
  if (!body) return { ok: false, res: fail('bad_request', 400) }
  const phone = parsePhone(body, deps)
  // A malformed number cannot have a pending code; answer like a wrong code.
  if (!phone.ok) return { ok: false, res: fail('invalid_code', 400) }

  const secret = resolveSecret(deps)
  if (!secret) return { ok: false, res: fail('unavailable', 503) }

  const result = await verifyOtp({
    store: deps.store(),
    secret,
    e164: phone.e164,
    code: body.code,
    ip: clientIp(req),
    purpose,
    uid,
    limits: deps.limits?.(),
  })
  if (!result.ok) {
    return { ok: false, res: fail(result.code, result.code === 'rate_limited' ? 429 : 400) }
  }
  return { ok: true, e164: phone.e164, country: phone.country, body }
}

export async function handleVerify(req: Request, deps: PhoneAuthDeps) {
  if (!(await deps.enabled())) return notFound()
  const rejected = rejectRequest(req, deps)
  if (rejected) return rejected
  const checked = await checkCode(req, deps, 'signin')
  if (!checked.ok) return checked.res

  try {
    const resolved = await signInVerifiedPhone({
      auth: deps.auth(),
      profiles: deps.profiles(),
      e164: checked.e164,
      country: checked.country,
      locale: normalizeLocale(checked.body.locale),
    })
    if (!resolved.ok) return fail(resolved.code, 403)
    return ok({ token: resolved.token, isNewUser: resolved.isNewUser })
  } catch (err) {
    console.error('[otp] sign-in after verified code failed', (err as Error)?.message)
    return fail('unavailable', 500)
  }
}

export async function handleLinkVerify(req: Request, deps: PhoneAuthDeps) {
  if (!(await deps.enabled())) return notFound()
  const rejected = rejectRequest(req, deps)
  if (rejected) return rejected
  // The code was issued to (purpose 'link', this uid, this number); a code
  // started by any other account cannot verify here.
  const uid = await linkCaller(req, deps)
  if (!uid) return fail('unauthorized', 401)

  const checked = await checkCode(req, deps, 'link', uid)
  if (!checked.ok) return checked.res

  try {
    const linked = await linkVerifiedPhone({
      auth: deps.auth(),
      profiles: deps.profiles(),
      uid,
      e164: checked.e164,
    })
    if (!linked.ok) return fail(linked.code, 409)
    if (deps.onPhoneLinked) {
      await deps.onPhoneLinked(uid, linked.phoneNumber).catch((err) =>
        console.warn('[otp] phone-linked notice failed', (err as Error)?.message)
      )
    }
    return ok({ ok: true, phoneNumber: linked.phoneNumber })
  } catch (err) {
    console.error('[otp] link after verified code failed', (err as Error)?.message)
    return fail('unavailable', 500)
  }
}
