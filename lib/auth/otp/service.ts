/**
 * The one-time-code state machine: issue a code, check a code.
 *
 * Pure of HTTP and of firebase-admin: it takes a store, a sender and a secret,
 * which is what lets the tests drive every branch (expiry, attempts, cooldown,
 * each rate limit, the global ceiling) against an in-memory store.
 *
 * Guarantees
 *   - Only an HMAC of the code is stored; comparison is constant-time.
 *   - A code is single-use: the doc is deleted in the same transaction that
 *     accepts it, so two concurrent verifies cannot both succeed.
 *   - A code expires after 10 minutes and dies after 5 wrong guesses.
 *   - Re-sending is held back for 60 seconds per number.
 *   - Sends are capped per number (hour + day), per IP (hour + day) and
 *     globally per day (the cost guard against SMS/WhatsApp pumping).
 *   - Answers never depend on whether an account exists for the number.
 */

import {
  generateCode,
  hashCode,
  ipKey,
  otpDocId,
  phoneKey,
  safeEqualHex,
  isWellFormedCode,
  type OtpPurpose,
} from './crypto'
import { maskPhone } from './phone'
import { OTP_COLLECTION, RATE_COLLECTION, type OtpStore, type OtpTx, type Doc } from './store'
import type { OtpLocale, OtpSender } from './senders'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export interface OtpLimits {
  codeTtlMs: number
  maxAttempts: number
  resendCooldownMs: number
  phonePerHour: number
  phonePerDay: number
  ipPerHour: number
  ipPerDay: number
  ipVerifyPerHour: number
  globalPerDay: number
}

export const DEFAULT_LIMITS: OtpLimits = {
  codeTtlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 60 * 1000,
  phonePerHour: 5,
  phonePerDay: 10,
  // Haitian mobile carriers put many people behind one IP (carrier-grade NAT),
  // so the per-IP caps are generous; the per-number and global caps do the
  // real work.
  ipPerHour: 30,
  ipPerDay: 100,
  ipVerifyPerHour: 60,
  globalPerDay: 2000,
}

function intEnv(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): OtpLimits {
  return {
    ...DEFAULT_LIMITS,
    phonePerHour: intEnv(env.PHONE_OTP_PER_PHONE_HOURLY, DEFAULT_LIMITS.phonePerHour),
    phonePerDay: intEnv(env.PHONE_OTP_PER_PHONE_DAILY, DEFAULT_LIMITS.phonePerDay),
    ipPerHour: intEnv(env.PHONE_OTP_PER_IP_HOURLY, DEFAULT_LIMITS.ipPerHour),
    ipPerDay: intEnv(env.PHONE_OTP_PER_IP_DAILY, DEFAULT_LIMITS.ipPerDay),
    globalPerDay: intEnv(env.PHONE_OTP_DAILY_CAP, DEFAULT_LIMITS.globalPerDay),
  }
}

// ── Fixed-window counters ────────────────────────────────────────────────────

interface Window {
  w: number
  n: number
}

function bump(win: Window | undefined, bucket: number): Window {
  return win && win.w === bucket ? { w: bucket, n: win.n + 1 } : { w: bucket, n: 1 }
}

function count(win: Window | undefined, bucket: number): number {
  return win && win.w === bucket ? win.n : 0
}

function secondsUntil(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

// ── Issue ────────────────────────────────────────────────────────────────────

export interface StartParams {
  store: OtpStore
  sender: OtpSender
  secret: string
  e164: string
  locale: OtpLocale
  ip: string
  purpose: OtpPurpose
  /** The signed-in account, for purpose 'link'. */
  uid?: string
  now?: number
  limits?: OtpLimits
}

export type StartResult =
  | { ok: true; resendAfterSec: number; expiresInSec: number }
  | { ok: false; code: 'cooldown'; retryAfterSec: number }
  | { ok: false; code: 'rate_limited'; retryAfterSec: number }
  | { ok: false; code: 'send_failed' }

export async function startOtp(p: StartParams): Promise<StartResult> {
  const limits = p.limits ?? DEFAULT_LIMITS
  const now = p.now ?? Date.now()
  const hour = Math.floor(now / HOUR)
  const day = Math.floor(now / DAY)
  const docId = otpDocId(p.secret, p.e164, p.purpose, p.uid ?? '')
  const phoneRateId = `p_${phoneKey(p.secret, p.e164)}`
  const ipRateId = `i_${ipKey(p.secret, p.ip)}`
  const globalRateId = `global`
  const code = generateCode()

  const outcome = await p.store.transact(async (tx: OtpTx) => {
    const [existing, phoneRate, ipRate, globalRate] = await Promise.all([
      tx.get(OTP_COLLECTION, docId),
      tx.get(RATE_COLLECTION, phoneRateId),
      tx.get(RATE_COLLECTION, ipRateId),
      tx.get(RATE_COLLECTION, globalRateId),
    ])

    // Cooldown first: a double tap must not burn quota.
    const lastSentAt = Number(existing?.lastSentAt) || 0
    if (lastSentAt && now - lastSentAt < limits.resendCooldownMs) {
      return {
        ok: false as const,
        code: 'cooldown' as const,
        retryAfterSec: secondsUntil(limits.resendCooldownMs - (now - lastSentAt)),
      }
    }

    const nextHour = (hour + 1) * HOUR - now
    const nextDay = (day + 1) * DAY - now
    if (count(globalRate?.d, day) >= limits.globalPerDay) {
      console.error('[otp] GLOBAL DAILY CAP reached; refusing all sends until UTC midnight', {
        cap: limits.globalPerDay,
      })
      return { ok: false as const, code: 'rate_limited' as const, retryAfterSec: secondsUntil(nextDay) }
    }
    if (count(phoneRate?.d, day) >= limits.phonePerDay || count(ipRate?.d, day) >= limits.ipPerDay) {
      return { ok: false as const, code: 'rate_limited' as const, retryAfterSec: secondsUntil(nextDay) }
    }
    if (count(phoneRate?.h, hour) >= limits.phonePerHour || count(ipRate?.h, hour) >= limits.ipPerHour) {
      return { ok: false as const, code: 'rate_limited' as const, retryAfterSec: secondsUntil(nextHour) }
    }

    const expireAt = new Date(now + DAY)
    tx.set(RATE_COLLECTION, phoneRateId, { h: bump(phoneRate?.h, hour), d: bump(phoneRate?.d, day), expireAt })
    tx.set(RATE_COLLECTION, ipRateId, { h: bump(ipRate?.h, hour), d: bump(ipRate?.d, day), expireAt })
    tx.set(RATE_COLLECTION, globalRateId, { d: bump(globalRate?.d, day) })

    const doc: Doc = {
      purpose: p.purpose,
      codeHash: hashCode(p.secret, docId, code),
      expiresAt: now + limits.codeTtlMs,
      attempts: 0,
      sendCount: (Number(existing?.sendCount) || 0) + 1,
      lastSentAt: now,
      createdAt: Number(existing?.createdAt) || now,
      // Firestore TTL policy field (see the setup doc): stale docs self-delete.
      expireAt: new Date(now + DAY),
    }
    if (p.uid) doc.uid = p.uid
    tx.set(OTP_COLLECTION, docId, doc)
    return null
  })

  if (outcome) return outcome

  try {
    await p.sender.send(p.e164, code, p.locale)
  } catch (err) {
    console.error('[otp] send failed', { to: maskPhone(p.e164), sender: p.sender.name, err: (err as Error)?.message })
    // Let the person retry straight away rather than wait out a cooldown for
    // a message that never left. The quota stays spent (it may have cost us).
    await p.store.patch(OTP_COLLECTION, docId, { lastSentAt: 0, codeHash: null }).catch(() => {})
    return { ok: false, code: 'send_failed' }
  }

  return {
    ok: true,
    resendAfterSec: Math.round(limits.resendCooldownMs / 1000),
    expiresInSec: Math.round(limits.codeTtlMs / 1000),
  }
}

// ── Check ────────────────────────────────────────────────────────────────────

export interface VerifyParams {
  store: OtpStore
  secret: string
  e164: string
  code: unknown
  ip: string
  purpose: OtpPurpose
  uid?: string
  now?: number
  limits?: OtpLimits
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; code: 'invalid_code' | 'too_many_attempts' | 'rate_limited' }

export async function verifyOtp(p: VerifyParams): Promise<VerifyResult> {
  const limits = p.limits ?? DEFAULT_LIMITS
  const now = p.now ?? Date.now()
  const hour = Math.floor(now / HOUR)
  const docId = otpDocId(p.secret, p.e164, p.purpose, p.uid ?? '')
  const ipVerifyId = `v_${ipKey(p.secret, p.ip)}`
  const wellFormed = isWellFormedCode(p.code)
  const candidate = wellFormed ? hashCode(p.secret, docId, p.code as string) : ''

  return p.store.transact(async (tx: OtpTx) => {
    const [doc, ipRate] = await Promise.all([
      tx.get(OTP_COLLECTION, docId),
      tx.get(RATE_COLLECTION, ipVerifyId),
    ])

    // Per-IP guess ceiling, so one client cannot spray guesses across many
    // numbers (each with its own 5-attempt budget).
    if (count(ipRate?.h, hour) >= limits.ipVerifyPerHour) {
      return { ok: false as const, code: 'rate_limited' as const }
    }
    tx.set(RATE_COLLECTION, ipVerifyId, { h: bump(ipRate?.h, hour), expireAt: new Date(now + DAY) })

    if (!doc || !doc.codeHash || doc.purpose !== p.purpose) {
      return { ok: false as const, code: 'invalid_code' as const }
    }
    if (p.purpose === 'link' && doc.uid !== p.uid) {
      return { ok: false as const, code: 'invalid_code' as const }
    }
    if (Number(doc.expiresAt) <= now) {
      tx.delete(OTP_COLLECTION, docId)
      return { ok: false as const, code: 'invalid_code' as const }
    }
    const attempts = Number(doc.attempts) || 0
    if (attempts >= limits.maxAttempts) {
      tx.delete(OTP_COLLECTION, docId)
      return { ok: false as const, code: 'too_many_attempts' as const }
    }

    if (wellFormed && safeEqualHex(candidate, String(doc.codeHash))) {
      tx.delete(OTP_COLLECTION, docId)
      return { ok: true as const }
    }

    const used = attempts + 1
    if (used >= limits.maxAttempts) {
      tx.delete(OTP_COLLECTION, docId)
      return { ok: false as const, code: 'too_many_attempts' as const }
    }
    tx.set(OTP_COLLECTION, docId, { ...doc, attempts: used })
    return { ok: false as const, code: 'invalid_code' as const }
  })
}
