/**
 * The Apple Wallet web service (PassKit "Updating a pass"), the minimum Apple
 * needs to keep a pass current:
 *
 *   POST   /v1/devices/{device}/registrations/{passType}/{serial}   register
 *   DELETE /v1/devices/{device}/registrations/{passType}/{serial}   unregister
 *   GET    /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=tag
 *   GET    /v1/passes/{passType}/{serial}                           latest pass
 *   POST   /v1/log
 *
 * mounted at app/api/wallet/apple/v1/**. Every pass built from now on carries
 * `webServiceURL` + `authenticationToken`, so iOS registers it here; when the
 * ticket changes hands we push to the registered devices (lib/wallet/apns.ts)
 * and the previous holder's Wallet fetches a VOIDED pass with no barcode.
 *
 * SERIALS carry the ticket's QR version: `<ticketId>` at version 0 (every pass
 * issued before this change) and `<ticketId>.v<n>` after the n-th transfer. Two
 * holders' passes therefore never share a serial, so "the latest pass for this
 * serial" is unambiguous: an older serial is always the voided one.
 *
 * AUTH: the per-pass token is an HMAC of the serial (no storage), checked on
 * every endpoint Apple authenticates. It is only ever handed out inside a pass
 * the download route built for the ticket's holder at the time.
 */

import crypto from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { walletSigningSecret } from './pass-token'

export const APPLE_REGISTRATIONS_COLLECTION = 'wallet_apple_registrations'

/** Serial for a ticket at a QR version. Version 0 keeps the historical serial (the id). */
export function appleSerialFor(ticketId: string, version: number): string {
  return version >= 1 ? `${ticketId}.v${version}` : String(ticketId)
}

/**
 * Inverse of appleSerialFor. (Ticket ids are Firestore auto ids or Stripe
 * payment ids, never ending in `.v<digits>`.)
 */
export function parseAppleSerial(serial: string): { ticketId: string; version: number } | null {
  const raw = String(serial || '').trim()
  if (!raw || raw.includes('/')) return null
  const match = raw.match(/^([A-Za-z0-9_.-]+)\.v(\d{1,6})$/)
  if (match) return { ticketId: match[1], version: Number(match[2]) }
  return /^[A-Za-z0-9_.-]+$/.test(raw) ? { ticketId: raw, version: 0 } : null
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The pass's authenticationToken (Apple requires >= 16 chars). Null when unconfigured. */
export function appleAuthTokenFor(serial: string): string | null {
  const secret = walletSigningSecret()
  if (!secret) return null
  return base64url(crypto.createHmac('sha256', secret).update(`apple-pass-auth|${serial}`).digest())
}

/** `Authorization: ApplePass <token>` matches this serial's token (constant time). */
export function verifyApplePassAuth(header: string | null | undefined, serial: string): boolean {
  const expected = appleAuthTokenFor(serial)
  if (!expected) return false
  const match = String(header || '').match(/^ApplePass\s+(.+)$/)
  if (!match) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(match[1].trim(), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Where iOS should reach the web service. Apple only talks to https; an
 * explicit APPLE_WALLET_WEB_SERVICE_URL wins, else the app's canonical origin.
 * The origin must be the one that does NOT redirect (www.tikem.co), since iOS
 * drops the Authorization header on a redirect.
 */
export function appleWebServiceUrl(): string | null {
  const explicit = process.env.APPLE_WALLET_WEB_SERVICE_URL?.trim().replace(/\/$/, '')
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  const url = explicit || (origin ? `${origin}/api/wallet/apple` : '')
  return url.startsWith('https://') ? url : null
}

/** Firestore doc id for one (device, pass type, serial) registration. */
export function registrationDocId(device: string, passType: string, serial: string): string {
  return crypto.createHash('sha256').update(`${device}|${passType}|${serial}`).digest('hex')
}

/** Apple's device library ids and push tokens are opaque; just keep them sane. */
export function isSaneAppleId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/.test(String(value || ''))
}

export async function registerAppleDevice(params: {
  device: string
  passType: string
  serial: string
  pushToken: string
}): Promise<'created' | 'exists'> {
  const parsed = parseAppleSerial(params.serial)
  const ref = adminDb
    .collection(APPLE_REGISTRATIONS_COLLECTION)
    .doc(registrationDocId(params.device, params.passType, params.serial))
  const snap = await ref.get()
  const now = new Date().toISOString()
  await ref.set(
    {
      device_library_identifier: params.device,
      pass_type_identifier: params.passType,
      serial_number: params.serial,
      ticket_id: parsed?.ticketId || null,
      push_token: params.pushToken,
      updated_at: now,
      ...(snap.exists ? {} : { created_at: now }),
    },
    { merge: true }
  )
  return snap.exists ? 'exists' : 'created'
}

export async function unregisterAppleDevice(params: {
  device: string
  passType: string
  serial: string
}): Promise<void> {
  await adminDb
    .collection(APPLE_REGISTRATIONS_COLLECTION)
    .doc(registrationDocId(params.device, params.passType, params.serial))
    .delete()
}

/** The tag a serial was last updated at: the ticket's wallet_pass_updated_at (ms), else 0. */
function updatedTagOf(ticket: Record<string, any> | undefined): number {
  const v = Number(ticket?.wallet_pass_updated_at)
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * Serials registered on a device that changed after `since`. Null = nothing
 * changed (the route answers 204).
 */
export async function serialsUpdatedSince(params: {
  device: string
  passType: string
  since: number | null
}): Promise<{ serialNumbers: string[]; lastUpdated: string } | null> {
  const snap = await adminDb
    .collection(APPLE_REGISTRATIONS_COLLECTION)
    .where('device_library_identifier', '==', params.device)
    .where('pass_type_identifier', '==', params.passType)
    .get()
  if (snap.empty) return null

  const serials: string[] = Array.from(
    new Set(snap.docs.map((d: any) => String(d.data()?.serial_number || '')).filter(Boolean))
  )
  const ticketIds = Array.from(
    new Set(serials.map((s) => parseAppleSerial(s)?.ticketId).filter(Boolean) as string[])
  )
  const tags = new Map<string, number>()
  for (let i = 0; i < ticketIds.length; i += 300) {
    const refs = ticketIds.slice(i, i + 300).map((id) => adminDb.collection('tickets').doc(id))
    const docs = refs.length ? await adminDb.getAll(...refs) : []
    for (const doc of docs as any[]) tags.set(doc.id, doc.exists ? updatedTagOf(doc.data()) : 0)
  }

  let latest = 0
  const changed: string[] = []
  for (const serial of serials) {
    const tag = tags.get(parseAppleSerial(serial)?.ticketId || '') ?? 0
    latest = Math.max(latest, tag)
    if (params.since === null || tag > params.since) changed.push(serial)
  }
  if (changed.length === 0) return null
  return { serialNumbers: changed, lastUpdated: String(latest) }
}

/** Push tokens of every device holding the pass with this serial. */
export async function registrationsForSerial(
  serial: string
): Promise<Array<{ id: string; pushToken: string }>> {
  const snap = await adminDb
    .collection(APPLE_REGISTRATIONS_COLLECTION)
    .where('serial_number', '==', serial)
    .get()
  return snap.docs
    .map((d: any) => ({ id: String(d.id), pushToken: String(d.data()?.push_token || '') }))
    .filter((r: { pushToken: string }) => r.pushToken)
}

export async function deleteRegistration(id: string): Promise<void> {
  await adminDb.collection(APPLE_REGISTRATIONS_COLLECTION).doc(id).delete()
}
