/**
 * Google Wallet "Save to Google Wallet" links.
 *
 * Google's save flow is a signed JWT in a URL: the JWT carries the
 * EventTicketClass + EventTicketObject and is signed RS256 with the issuer's
 * service-account key, and Google creates/updates both on first save. That
 * removes the need for an OAuth round-trip to the Wallet REST API on the
 * ticket-viewing hot path, and means no extra dependency — Node's own `crypto`
 * signs the JWT.
 *
 * The link itself IS the credential (that is how Google's flow works), so it is
 * only ever handed to a caller who has already proved they own the ticket
 * (lib/wallet/ticket-access.ts).
 */

import crypto from 'node:crypto'
import type { GoogleWalletConfig } from './config'
import type { WalletTicket } from './ticket-access'

/** Google ids allow only `[a-zA-Z0-9._-]` after the issuer prefix. */
function sanitizeIdSuffix(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'unknown'
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** A Google Wallet localized string. */
function localized(value: string) {
  return { defaultValue: { language: 'en-US', value } }
}

/**
 * The EventTicketClass for this ticket's event. One class per event, shared by
 * every ticket for it, so all of an event's passes group together in Wallet.
 */
function buildEventTicketClass(ticket: WalletTicket, config: GoogleWalletConfig) {
  const classId = `${config.issuerId}.evt_${sanitizeIdSuffix(ticket.eventId || ticket.id)}`

  const eventClass: Record<string, any> = {
    id: classId,
    issuerName: config.issuerName,
    // Passes created through the JWT flow start under review; Google promotes
    // them automatically for issuers in good standing.
    reviewStatus: 'UNDER_REVIEW',
    eventName: localized(ticket.eventTitle),
    hexBackgroundColor: '#0a0a0a',
  }

  if (ticket.venueName || ticket.city) {
    eventClass.venue = {
      name: localized(ticket.venueName || ticket.city),
      address: localized([ticket.venueName, ticket.city].filter(Boolean).join(', ')),
    }
  }

  if (ticket.startDatetime) {
    eventClass.dateTime = {
      start: ticket.startDatetime,
      ...(ticket.endDatetime ? { end: ticket.endDatetime } : {}),
    }
  }

  return { classId, eventClass }
}

/**
 * The object id for a ticket at a QR version. Version 0 keeps the historical
 * id; from the first transfer on the version is part of it, so the new
 * holder's save creates a NEW object instead of landing on the previous
 * holder's (now inactive) one. A JWT save never updates an existing object.
 */
export function googleObjectIdFor(config: GoogleWalletConfig, ticketId: string, version: number): string {
  const suffix = version >= 1 ? `${ticketId}_v${version}` : ticketId
  return `${config.issuerId}.tkt_${sanitizeIdSuffix(suffix)}`
}

/** The EventTicketObject — this specific ticket. */
function buildEventTicketObject(
  ticket: WalletTicket,
  config: GoogleWalletConfig,
  classId: string
) {
  const object: Record<string, any> = {
    id: googleObjectIdFor(config, ticket.id, ticket.qrVersion || 0),
    classId,
    state: 'ACTIVE',
    ticketNumber: ticket.orderRef,
    ticketType: localized(ticket.tierName),
    // THE existing QR payload — the same value the scanner already resolves.
    barcode: {
      type: 'QR_CODE',
      value: ticket.qrPayload,
      alternateText: ticket.orderRef,
    },
  }

  if (ticket.holderName) object.ticketHolderName = ticket.holderName

  return object
}

/**
 * Build a "Save to Google Wallet" URL for one ticket.
 * @throws if the service-account private key cannot sign (bad key material).
 */
export function buildGoogleSaveUrl(ticket: WalletTicket, config: GoogleWalletConfig): string {
  const { classId, eventClass } = buildEventTicketClass(ticket, config)
  const object = buildEventTicketObject(ticket, config, classId)

  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: config.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    payload: {
      eventTicketClasses: [eventClass],
      eventTicketObjects: [object],
    },
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(config.privateKey)

  return `https://pay.google.com/gp/v/save/${signingInput}.${base64url(signature)}`
}

// ---------------------------------------------------------------------------
// Voiding a saved pass (Wallet REST API)
// ---------------------------------------------------------------------------

const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer'
const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1'

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>

/** An OAuth access token for the issuer's service account (JWT bearer grant). */
export async function getGoogleWalletAccessToken(
  config: GoogleWalletConfig,
  fetchImpl: FetchLike = fetch as any
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: config.clientEmail,
    scope: WALLET_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(config.privateKey)
  const assertion = `${signingInput}.${base64url(signature)}`

  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || typeof json?.access_token !== 'string') {
    throw new Error(`google token exchange failed (${res.status})`)
  }
  return json.access_token
}

/**
 * Mark the previous holder's saved pass INACTIVE and replace its barcode with
 * one that resolves to nothing, after the ticket changed hands.
 *
 * 'not_saved' = Google has no such object (the holder never saved it), which
 * is the common case and not an error. Never throws.
 */
export async function voidGoogleTicketObject(
  config: GoogleWalletConfig,
  ticketId: string,
  version: number,
  fetchImpl: FetchLike = fetch as any
): Promise<'voided' | 'not_saved' | 'failed'> {
  const objectId = googleObjectIdFor(config, ticketId, version)
  try {
    const token = await getGoogleWalletAccessToken(config, fetchImpl)
    const res = await fetchImpl(`${WALLET_API}/eventTicketObject/${encodeURIComponent(objectId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: 'INACTIVE',
        barcode: { type: 'QR_CODE', value: 'TIKEM-VOID', alternateText: 'VOID' },
        textModulesData: [
          {
            id: 'voided',
            header: 'This pass is void',
            body: 'This ticket was transferred. This pass no longer admits anyone at the door.',
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404) return 'not_saved'
    if (!res.ok) {
      console.warn('[wallet] google void failed', { objectId, status: res.status })
      return 'failed'
    }
    return 'voided'
  } catch (error) {
    console.warn('[wallet] google void failed', { objectId, message: (error as any)?.message })
    return 'failed'
  }
}
