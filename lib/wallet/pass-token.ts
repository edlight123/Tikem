/**
 * Short-lived, single-ticket download tokens for `.pkpass` files.
 *
 * WHY THIS EXISTS: the only way iOS presents the "Add to Apple Wallet" sheet is
 * by opening a URL that serves `application/vnd.apple.pkpass`. The app hands
 * that URL to Safari, and Safari carries none of the app's Firebase auth. So the
 * URL itself has to be the credential.
 *
 * It is therefore built to be a *weak* credential on purpose:
 *   • it names exactly one ticket and one user, and is signed so neither can be
 *     edited;
 *   • it expires in minutes;
 *   • and the download route re-verifies ownership and ticket status against
 *     Firestore anyway (lib/wallet/ticket-access.ts), so a leaked token can
 *     never outlive a refund or a transfer.
 */

import crypto from 'node:crypto'

/** How long a minted pass link stays usable. Long enough to hop into Safari. */
export const PASS_TOKEN_TTL_SECONDS = 10 * 60

interface PassTokenPayload {
  /** version — lets the format change without honouring old tokens */
  v: 1
  /** ticket document id */
  t: string
  /** user id the pass was minted for */
  u: string
  /** expiry, epoch seconds */
  e: number
}

export interface VerifiedPassToken {
  ticketId: string
  userId: string
  expiresAt: number
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * The HMAC key for pass links.
 *
 * Prefers a dedicated `WALLET_PASS_LINK_SECRET`. When that is absent it is
 * derived from the Apple signing key material, which is already a secret that
 * must be present for any Apple pass to exist at all — so the owner is not
 * forced to invent and rotate yet another secret just to ship this.
 * Returns null when neither is available, which callers surface as
 * "not configured" rather than signing with a guessable key.
 */
function linkSecret(): Buffer | null {
  const explicit = process.env.WALLET_PASS_LINK_SECRET?.trim()
  if (explicit) return Buffer.from(explicit, 'utf8')

  const derivedFrom = process.env.APPLE_PASS_KEY_PEM_BASE64?.trim()
  if (derivedFrom) {
    return crypto.createHash('sha256').update(`tikem-wallet-pass-link|${derivedFrom}`).digest()
  }

  return null
}

/**
 * The same wallet key, for the Apple Wallet web service's per-pass
 * authenticationToken (lib/wallet/apple-web-service.ts). Null = not configured.
 */
export function walletSigningSecret(): Buffer | null {
  return linkSecret()
}

function sign(body: string, secret: Buffer): string {
  return base64url(crypto.createHmac('sha256', secret).update(body).digest())
}

/**
 * Mint a token for `ticketId`, bound to `userId`.
 * Returns null when there is no key to sign with.
 */
export function mintPassToken(
  ticketId: string,
  userId: string,
  nowMs: number = Date.now()
): { token: string; expiresAt: string } | null {
  const secret = linkSecret()
  if (!secret) return null

  const expiresAtSeconds = Math.floor(nowMs / 1000) + PASS_TOKEN_TTL_SECONDS
  const payload: PassTokenPayload = { v: 1, t: ticketId, u: userId, e: expiresAtSeconds }
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return {
    token: `${body}.${sign(body, secret)}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  }
}

/**
 * Verify a token. Returns the ticket/user it names, or a failure reason.
 * Signature comparison is constant-time; an unsigned or re-signed token is
 * indistinguishable from a malformed one from the caller's point of view.
 */
export function verifyPassToken(
  token: string,
  nowMs: number = Date.now()
): { ok: true; value: VerifiedPassToken } | { ok: false; reason: 'invalid' | 'expired' } {
  const secret = linkSecret()
  if (!secret) return { ok: false, reason: 'invalid' }

  const parts = String(token || '').split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' }

  const [body, providedSignature] = parts
  const expected = sign(body, secret)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(providedSignature, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'invalid' }
  }

  let payload: PassTokenPayload
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (payload?.v !== 1 || typeof payload.t !== 'string' || typeof payload.u !== 'string') {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof payload.e !== 'number' || !Number.isFinite(payload.e)) {
    return { ok: false, reason: 'invalid' }
  }
  if (payload.e * 1000 <= nowMs) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, value: { ticketId: payload.t, userId: payload.u, expiresAt: payload.e } }
}
