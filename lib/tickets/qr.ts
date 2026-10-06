/**
 * Ticket QR payloads that change when a ticket changes hands.
 *
 * Every ticket carries a server-only `qr_version` (absent = 0). Tickets that
 * have never changed hands keep the LEGACY payload they were issued with (the
 * ticket id, stored as `qr_code_data`), so every code already in the field,
 * every email, screenshot and wallet pass, keeps scanning.
 *
 * When a ticket is transferred, `qr_version` is bumped and the payload becomes
 * a SIGNED one:
 *
 *     {"ticketId":"<id>","v":<version>,"s":"<hmac>"}
 *
 * JSON on purpose: every scanner already in the field (web parseTicketId,
 * mobile lib/scanner.ts, doorRules parseTicketCode) pulls `ticketId` out of a
 * JSON payload, so an old build still resolves the RIGHT ticket from a new
 * code. The server then refuses, for a ticket at version >= 1:
 *   - any payload that is not signed (the bare legacy id),
 *   - a signed payload of an older version ("transferred"),
 *   - a payload whose signature does not verify ("invalid code").
 *
 * The signature is what stops the PREVIOUS holder, who knows the ticket id,
 * from minting `{"ticketId":id,"v":<current>}` themselves.
 *
 * The new payload is written to BOTH `qr_code_data` (what the web, emails and
 * wallet passes read) and `qr_code` (what the Expo app reads first, see
 * mobile/lib/ticket.ts ticketQrValue), so even an app build that predates this
 * change shows the new holder their new code.
 */

import crypto from 'node:crypto'
import { parseSignedTicketQr, ticketQrVersionOf, type ScannedCodeCheck } from '@/lib/scan/doorRules'

export { parseSignedTicketQr, ticketQrVersionOf }
export type { ScannedCodeCheck }

/**
 * The signing key. A dedicated TICKET_QR_SECRET is strongly preferred: the
 * fallbacks are secrets that already exist in every deployment, but rotating
 * one of them would invalidate every transferred ticket's code.
 *
 * Returns null when nothing is configured in production, so a transfer fails
 * closed instead of signing codes with a guessable key.
 */
function qrSecret(): Buffer | null {
  const raw =
    process.env.TICKET_QR_SECRET?.trim() ||
    process.env.TICKET_ID_SECRET?.trim() ||
    process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
    process.env.STRIPE_SECRET_KEY?.trim() ||
    (process.env.NODE_ENV !== 'production' ? 'tikem-dev-only-ticket-qr' : '')
  if (!raw) return null
  // Domain-separated so the same env value used elsewhere never yields the
  // same MAC as it does here.
  return crypto.createHash('sha256').update(`tikem-ticket-qr|${raw}`).digest()
}

export function isTicketQrSigningConfigured(): boolean {
  return qrSecret() !== null
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 128-bit truncated HMAC-SHA256 over (ticket id, version). */
function signatureFor(ticketId: string, version: number, secret: Buffer): string {
  return base64url(
    crypto.createHmac('sha256', secret).update(`${ticketId}|${version}`).digest().subarray(0, 16)
  )
}

/** The signed payload for a ticket at a version. Throws when no key is configured. */
export function signTicketQr(ticketId: string, version: number): string {
  const secret = qrSecret()
  if (!secret) throw new Error('TICKET_QR_SECRET is not configured')
  // Key order is fixed so the same (id, version) always yields the same string.
  return JSON.stringify({ ticketId: String(ticketId), v: version, s: signatureFor(String(ticketId), version, secret) })
}

/** Constant-time check of a signed payload's MAC. */
export function verifyTicketQrSignature(ticketId: string, version: number, signature: string): boolean {
  const secret = qrSecret()
  if (!secret) return false
  const expected = Buffer.from(signatureFor(ticketId, version, secret), 'utf8')
  const given = Buffer.from(String(signature || ''), 'utf8')
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/** The code a ticket presents NOW: its stored payload, else its id (legacy). */
export function currentTicketQrPayload(ticketId: string, ticket: Record<string, any>): string {
  const stored = [ticket?.qr_code_data, ticket?.qr_code].find((v) => typeof v === 'string' && v.trim())
  return stored ? String(stored).trim() : String(ticketId)
}

/**
 * Server judgement of a scanned code against the ticket it resolved to.
 *
 *   OK            admit (subject to every other door rule)
 *   TRANSFERRED   a code from before the latest change of hands
 *   INVALID_CODE  a signed code whose MAC fails, or that names another ticket
 *                 or a version the ticket has never had
 *
 * `scanned` empty/absent = no code to judge (a manual pick by name); the caller
 * decides what that means.
 */
export function verifyScannedTicketCode(
  scanned: string | null | undefined,
  ticketId: string,
  ticket: Record<string, any>
): ScannedCodeCheck {
  const raw = String(scanned ?? '').trim()
  if (!raw) return 'OK'
  const current = ticketQrVersionOf(ticket)
  const signed = parseSignedTicketQr(raw)
  if (signed) {
    if (signed.ticketId !== String(ticketId)) return 'INVALID_CODE'
    if (!verifyTicketQrSignature(signed.ticketId, signed.v, signed.s)) return 'INVALID_CODE'
    if (signed.v < current) return 'TRANSFERRED'
    if (signed.v > current) return 'INVALID_CODE'
    return 'OK'
  }
  // Legacy, unsigned payload (bare id, /tickets/{id} URL, {"ticketId":..}).
  return current >= 1 ? 'TRANSFERRED' : 'OK'
}

/**
 * The fields that rotate a ticket's code. Written inside the transfer
 * transaction, so the change of hands and the new code land together.
 */
export function rotatedTicketQrFields(
  ticketId: string,
  ticket: Record<string, any>,
  nowMs: number = Date.now()
): { qr_version: number; qr_code: string; qr_code_data: string; qr_rotated_at: string; wallet_pass_updated_at: number } {
  const next = ticketQrVersionOf(ticket) + 1
  const payload = signTicketQr(ticketId, next)
  return {
    qr_version: next,
    qr_code: payload,
    qr_code_data: payload,
    qr_rotated_at: new Date(nowMs).toISOString(),
    // The Apple Wallet web service's "updated since" tag for this ticket.
    wallet_pass_updated_at: nowMs,
  }
}
