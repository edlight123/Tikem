/**
 * Account completion, email on a phone account, and account merges.
 *
 *   POST /api/account/profile/complete  { firstName, lastName }            -> { ok }
 *   POST /api/account/email/start       { email, locale? }                 -> { ok, taken, resendAfterSec }
 *   POST /api/account/email/verify      { email, code }                    -> { status: attached | merge_available | needs_review | blocked, mergeId? }
 *   POST /api/account/email/later       { email }                          -> { ok }   ("Verify later")
 *   POST /api/account/merge             { mergeId }                        -> { status: merged, token? }
 *
 * Same request hardening as the phone routes (lib/auth/otp/handlers): JSON
 * only, Origin allowlist, and the caller is ONLY a Firebase ID token in
 * `Authorization: Bearer` (never the session cookie).
 *
 * A merge needs fresh proof of BOTH identities:
 *   - the OTHER account: a code just verified for its email (email/verify) or
 *     its phone number (phone link/verify). That opens a merge session
 *     (account_merge_sessions, server-only, 15 minutes, bound to the caller).
 *   - the CALLER: an ID token minted by a sign-in in the last 10 minutes
 *     (auth_time). Older -> 401 reauth_required; the app re-verifies (phone
 *     code, password, Google or Apple) and retries.
 * Rate limited per account and per IP. Nothing here is client-writable.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { otpSecret } from '@/lib/auth/otp/crypto'
import { isAllowedOrigin } from '@/lib/auth/otp/handlers'
import { normalizeLocale, type OtpSender } from '@/lib/auth/otp/senders'
import { startOtp, verifyOtp, type OtpLimits } from '@/lib/auth/otp/service'
import type { OtpStore } from '@/lib/auth/otp/store'
import { composeFullName, normalizeEmail } from './completion'
import { assessMerge, openMergeReview, runAccountMerge, type MergeAuthAdmin, type MergeProof, type MergeReason } from './merge'

export const MERGE_SESSIONS = 'account_merge_sessions'
export const SESSION_TTL_MS = 15 * 60 * 1000
export const FRESH_SIGNIN_SEC = 10 * 60

export interface AccountAuthAdmin extends MergeAuthAdmin {
  getUser(uid: string): Promise<{ uid: string; email?: string; emailVerified?: boolean; phoneNumber?: string; disabled?: boolean }>
  getUserByEmail(email: string): Promise<{ uid: string; disabled?: boolean }>
  createCustomToken(uid: string): Promise<string>
}

export interface Caller {
  uid: string
  /** Seconds since epoch of the sign-in that minted this token. */
  authTime: number
}

export interface AccountDeps {
  /** Email + merge routes follow the phone sign-in switch (404 when off). */
  enabled: () => Promise<boolean>
  db: () => any
  auth: () => AccountAuthAdmin
  store: () => OtpStore
  emailSender: () => OtpSender | null
  /** Verified ID token (revocation checked) -> caller, or null. */
  caller: (idToken: string) => Promise<Caller | null>
  /** Shared fixed-window limiter (lib/rate-limit consumeRateLimit). */
  rateLimit: (key: string, limit: number, windowMs: number) => Promise<{ limited: boolean }>
  ipKey: (req: Request) => string
  /** Security notice once a number lands on an account through a merge. */
  onMerged?: (targetUid: string, phone: string | null) => Promise<void>
  allowedOrigin?: (origin: string) => boolean
  secret?: () => string | null
  limits?: () => OtpLimits
  now?: () => number
}

const HOUR = 60 * 60 * 1000

const MESSAGES: Record<string, string> = {
  unsupported_media_type: 'Send JSON.',
  forbidden_origin: 'Origin not allowed.',
  bad_request: 'Malformed request.',
  unauthorized: 'Sign in first.',
  invalid_name: 'Enter your first and last name.',
  invalid_email: 'Enter a valid email address.',
  email_already_set: 'This account already has an email.',
  email_taken: 'This email already has a Tikèm account.',
  cooldown: 'Please wait before requesting another code.',
  rate_limited: 'Too many attempts. Please try again later.',
  send_failed: 'We could not send the code. Please try again.',
  unavailable: 'Temporarily unavailable.',
  invalid_code: 'That code is not valid.',
  too_many_attempts: 'Too many wrong codes. Request a new code.',
  account_disabled: 'This account cannot be used.',
  merge_expired: 'This request expired. Start again.',
  reauth_required: 'Confirm it is you, then try again.',
  merge_in_progress: 'Already combining these accounts.',
  target_has_other_phone: 'That account already has another phone number.',
  organizer_merge_needs_review: 'Contact support to combine two organizer accounts.',
}

function fail(code: string, status: number, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (typeof extra.retryAfterSec === 'number') headers['Retry-After'] = String(extra.retryAfterSec)
  return NextResponse.json({ error: MESSAGES[code] ?? 'Error', code, ...extra }, { status, headers })
}

const ok = (body: Record<string, unknown>) => NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

function rejectRequest(req: Request, deps: AccountDeps): Response | null {
  const ct = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (ct !== 'application/json') return fail('unsupported_media_type', 415)
  const origin = req.headers.get('origin')
  if (origin !== null) {
    const allowed = deps.allowedOrigin ? deps.allowedOrigin(origin) : isAllowedOrigin(origin)
    if (!allowed) return fail('forbidden_origin', 403)
  }
  return null
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function callerOf(req: Request, deps: AccountDeps): Promise<Caller | null> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') || '').trim())
  if (!m) return null
  try {
    return await deps.caller(m[1].trim())
  } catch {
    return null
  }
}

/** Common preamble: hardening, caller, body. */
async function prepare(req: Request, deps: AccountDeps) {
  const rejected = rejectRequest(req, deps)
  if (rejected) return { res: rejected }
  const caller = await callerOf(req, deps)
  if (!caller) return { res: fail('unauthorized', 401) }
  const body = await readBody(req)
  if (!body) return { res: fail('bad_request', 400) }
  return { caller, body }
}

const nowOf = (deps: AccountDeps) => (deps.now ? deps.now() : Date.now())
const isCode = (err: unknown, code: string) => (err as { code?: string })?.code === code

async function limited(deps: AccountDeps, req: Request, uid: string, scope: string, perUid: number, perIp: number) {
  const [a, b] = await Promise.all([
    deps.rateLimit(`acct:${scope}:uid:${uid}`, perUid, HOUR),
    deps.rateLimit(`acct:${scope}:ip:${deps.ipKey(req)}`, perIp, HOUR),
  ])
  return a.limited || b.limited
}

async function emailOwner(auth: AccountAuthAdmin, email: string): Promise<{ uid: string; disabled?: boolean } | null> {
  try {
    return await auth.getUserByEmail(email)
  } catch (err) {
    if (isCode(err, 'auth/user-not-found')) return null
    throw err
  }
}

// ── Merge sessions ──────────────────────────────────────────────────────────

export interface MergeSession {
  caller_uid: string
  source_uid: string
  target_uid: string
  reason: MergeReason
  proofs: { source: MergeProof; target: MergeProof }
  created_at: number
  expires_at: number
  used_at?: number | null
}

/**
 * Open a merge session after the OTHER account's identity was just proven.
 * Returns what the app should show: merge_available, needs_review (an
 * organizer on the source side; an admin review item is opened) or blocked.
 */
export async function openMergeSession(
  deps: Pick<AccountDeps, 'db' | 'auth' | 'now'>,
  s: { callerUid: string; sourceUid: string; targetUid: string; reason: MergeReason; proofs: MergeSession['proofs'] }
): Promise<{ mergeId: string; mergeStatus: 'merge_available' | 'needs_review' | 'blocked'; blockedCode?: string }> {
  const db = deps.db()
  const now = deps.now ? deps.now() : Date.now()
  const assessed = await assessMerge(db, deps.auth(), s.sourceUid, s.targetUid, {
    requireVerifiedTargetEmail: s.reason === 'phone_account_added_email',
  })
  const mergeId = crypto.randomBytes(18).toString('hex')
  if (!assessed.ok && assessed.kind === 'blocked') {
    return { mergeId: '', mergeStatus: 'blocked', blockedCode: assessed.code }
  }
  if (!assessed.ok) {
    await openMergeReview(db, {
      sourceUid: s.sourceUid,
      targetUid: s.targetUid,
      reasons: assessed.reasons,
      source: assessed.source,
      target: assessed.target,
      reason: s.reason,
      nowIso: new Date(now).toISOString(),
    })
    return { mergeId: '', mergeStatus: 'needs_review' }
  }
  const session: MergeSession = {
    caller_uid: s.callerUid,
    source_uid: s.sourceUid,
    target_uid: s.targetUid,
    reason: s.reason,
    proofs: s.proofs,
    created_at: now,
    expires_at: now + SESSION_TTL_MS,
    used_at: null,
  }
  await db.collection(MERGE_SESSIONS).doc(mergeId).set({ ...session, expireAt: new Date(now + 24 * HOUR) })
  return { mergeId, mergeStatus: 'merge_available' }
}

// ── Handlers ────────────────────────────────────────────────────────────────

/** Name (required) for any signed-in account; users + public_profiles together. */
export async function handleCompleteProfile(req: Request, deps: AccountDeps) {
  const p = await prepare(req, deps)
  if ('res' in p) return p.res
  const name = composeFullName(p.body.firstName, p.body.lastName)
  if (!name) return fail('invalid_name', 400)
  if (await limited(deps, req, p.caller.uid, 'profile', 30, 120)) return fail('rate_limited', 429)
  const db = deps.db()
  const nowIso = new Date(nowOf(deps)).toISOString()
  await db
    .collection('users')
    .doc(p.caller.uid)
    .set({ first_name: name.first, last_name: name.last, full_name: name.full, updated_at: nowIso }, { merge: true })
  // Others see the name through the public projection (H4); keep it in step.
  await db.collection('public_profiles').doc(p.caller.uid).set({ full_name: name.full }, { merge: true })
  return ok({ ok: true, fullName: name.full })
}

export async function handleEmailStart(req: Request, deps: AccountDeps) {
  if (!(await deps.enabled())) return notFound()
  const p = await prepare(req, deps)
  if ('res' in p) return p.res
  const email = normalizeEmail(p.body.email)
  if (!email) return fail('invalid_email', 400)
  if (await limited(deps, req, p.caller.uid, 'email_start', 10, 60)) return fail('rate_limited', 429)

  const auth = deps.auth()
  const me = await auth.getUser(p.caller.uid)
  if (me.email && me.email.toLowerCase() !== email) return fail('email_already_set', 409)
  const owner = await emailOwner(auth, email)
  const taken = Boolean(owner && owner.uid !== p.caller.uid)
  if (owner && taken && owner.disabled) return fail('account_disabled', 403)

  const secret = deps.secret ? deps.secret() : otpSecret()
  const sender = deps.emailSender()
  if (!secret || !sender) return fail('unavailable', 503)
  const result = await startOtp({
    store: deps.store(),
    sender,
    secret,
    e164: email,
    locale: normalizeLocale(p.body.locale),
    ip: deps.ipKey(req),
    purpose: 'email',
    uid: p.caller.uid,
    now: nowOf(deps),
    limits: deps.limits?.(),
  })
  if (result.ok) return ok({ ok: true, taken, resendAfterSec: result.resendAfterSec, expiresInSec: result.expiresInSec })
  if (result.code === 'send_failed' || result.code === 'not_on_whatsapp') return fail('send_failed', 502)
  return fail(result.code, 429, { retryAfterSec: result.retryAfterSec })
}

export async function handleEmailVerify(req: Request, deps: AccountDeps) {
  if (!(await deps.enabled())) return notFound()
  const p = await prepare(req, deps)
  if ('res' in p) return p.res
  const email = normalizeEmail(p.body.email)
  if (!email) return fail('invalid_code', 400)
  const secret = deps.secret ? deps.secret() : otpSecret()
  if (!secret) return fail('unavailable', 503)

  const checked = await verifyOtp({
    store: deps.store(),
    secret,
    e164: email,
    code: p.body.code,
    ip: deps.ipKey(req),
    purpose: 'email',
    uid: p.caller.uid,
    now: nowOf(deps),
    limits: deps.limits?.(),
  })
  if (!checked.ok) return fail(checked.code, checked.code === 'rate_limited' ? 429 : 400)

  const auth = deps.auth()
  const db = deps.db()
  const uid = p.caller.uid
  const me = await auth.getUser(uid)
  if (me.email && me.email.toLowerCase() !== email) return fail('email_already_set', 409)

  let owner = await emailOwner(auth, email)
  if (!owner || owner.uid === uid) {
    try {
      await auth.updateUser(uid, { email, emailVerified: true })
    } catch (err) {
      if (!isCode(err, 'auth/email-already-exists')) throw err
      owner = await emailOwner(auth, email) // lost a race: someone else took it
    }
    if (!owner || owner.uid === uid) {
      await db.collection('users').doc(uid).set(
        {
          email,
          email_verified: true,
          email_verified_at: new Date(nowOf(deps)).toISOString(),
          pending_email: null,
          updated_at: new Date(nowOf(deps)).toISOString(),
        },
        { merge: true }
      )
      return ok({ status: 'attached', email })
    }
  }

  if (owner.disabled) return fail('account_disabled', 403)
  // The email belongs to another account and the caller just proved they read
  // its inbox. Merge INTO that (older, email) account.
  const session = await openMergeSession(deps, {
    callerUid: uid,
    sourceUid: uid,
    targetUid: owner.uid,
    reason: 'phone_account_added_email',
    proofs: { source: 'fresh_signin', target: 'email_code' },
  })
  return ok({ status: session.mergeStatus, mergeId: session.mergeId || undefined, code: session.blockedCode })
}

/** "Verify later": keep the address on the profile, unverified. */
export async function handleEmailLater(req: Request, deps: AccountDeps) {
  if (!(await deps.enabled())) return notFound()
  const p = await prepare(req, deps)
  if ('res' in p) return p.res
  const email = normalizeEmail(p.body.email)
  if (!email) return fail('invalid_email', 400)
  if (await limited(deps, req, p.caller.uid, 'email_later', 20, 120)) return fail('rate_limited', 429)
  const auth = deps.auth()
  const me = await auth.getUser(p.caller.uid)
  if (me.email) return fail('email_already_set', 409)
  const owner = await emailOwner(auth, email)
  // An address that is another account's can only be added by proving it
  // (which leads to the merge), never parked here.
  if (owner && owner.uid !== p.caller.uid) return fail('email_taken', 409)
  await deps
    .db()
    .collection('users')
    .doc(p.caller.uid)
    .set({ pending_email: email, email_verified: false, updated_at: new Date(nowOf(deps)).toISOString() }, { merge: true })
  return ok({ ok: true })
}

export async function handleMerge(req: Request, deps: AccountDeps) {
  if (!(await deps.enabled())) return notFound()
  const p = await prepare(req, deps)
  if ('res' in p) return p.res
  if (await limited(deps, req, p.caller.uid, 'merge', 10, 30)) return fail('rate_limited', 429)
  const mergeId = typeof p.body.mergeId === 'string' ? p.body.mergeId : ''
  if (!/^[a-f0-9]{36}$/.test(mergeId)) return fail('merge_expired', 404)

  const db = deps.db()
  const ref = db.collection(MERGE_SESSIONS).doc(mergeId)
  const snap = await ref.get()
  const s = (snap.exists ? snap.data() : null) as MergeSession | null
  const now = nowOf(deps)
  // A session belongs to the account that opened it; anyone else sees "expired".
  if (!s || s.caller_uid !== p.caller.uid) return fail('merge_expired', 404)
  const retry = Boolean(s.used_at)
  if (!retry && Number(s.expires_at) <= now) return fail('merge_expired', 404)
  if (!retry && now / 1000 - p.caller.authTime > FRESH_SIGNIN_SEC) return fail('reauth_required', 401)

  const auth = deps.auth()
  const outcome = await runAccountMerge(db, auth, {
    sourceUid: s.source_uid,
    targetUid: s.target_uid,
    reason: s.reason,
    proofs: s.proofs,
    requestedBy: p.caller.uid,
    now: new Date(now),
  })
  if (outcome.status === 'busy') return fail('merge_in_progress', 409)
  if (outcome.status === 'blocked') return fail(outcome.code, 409)
  if (outcome.status === 'needs_review') return fail('organizer_merge_needs_review', 409)

  if (!retry) await ref.set({ used_at: now }, { merge: true })
  if (deps.onMerged && !outcome.alreadyDone) {
    await deps.onMerged(s.target_uid, outcome.movedPhone).catch((err) =>
      console.warn('[account-merge] notice failed', (err as Error)?.message)
    )
  }
  // When the caller WAS the source, its account is now retired: hand back a
  // sign-in for the account everything moved to.
  const token = s.source_uid === p.caller.uid ? await auth.createCustomToken(s.target_uid) : undefined
  return ok({ status: 'merged', targetUid: s.target_uid, token, counts: outcome.counts })
}
