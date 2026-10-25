/**
 * Wallet-pass configuration, read exclusively from environment variables.
 *
 * NOTHING here is ever read from a file in the repo and nothing is hardcoded:
 * the Apple signing certificate, its private key and the Google service account
 * are secrets and live only in the deployment environment.
 *
 * The whole module is deliberately *lazy* — every getter reads `process.env` at
 * call time rather than at import time — so a route can honestly answer "wallet
 * passes aren't configured" per request, and so tests can flip configuration on
 * and off without re-importing modules.
 */

import { solidPng } from './png'

/** Machine-readable reasons a pass could not be produced. Clients localize off these. */
export const WALLET_ERROR_CODES = {
  unauthorized: 'unauthorized',
  missingTicketId: 'missing_ticket_id',
  ticketNotFound: 'ticket_not_found',
  notTicketOwner: 'not_ticket_owner',
  ticketNotActive: 'ticket_not_active',
  appleNotConfigured: 'apple_wallet_not_configured',
  googleNotConfigured: 'google_wallet_not_configured',
  unsupportedPlatform: 'unsupported_platform',
  passBuildFailed: 'pass_build_failed',
  invalidPassLink: 'invalid_pass_link',
  passLinkExpired: 'pass_link_expired',
} as const

export interface AppleWalletConfig {
  passTypeIdentifier: string
  teamIdentifier: string
  /** PEM-encoded Pass Type ID certificate (the leaf that Apple issued). */
  signerCert: Buffer
  /** PEM-encoded private key matching `signerCert`. */
  signerKey: Buffer
  /** PEM-encoded Apple WWDR intermediate certificate. */
  wwdr: Buffer
  /** Only needed when the key PEM is itself encrypted. */
  signerKeyPassphrase?: string
  organizationName: string
  iconPng: Buffer
  logoPng: Buffer
}

export interface GoogleWalletConfig {
  issuerId: string
  clientEmail: string
  /** PEM-encoded RSA private key from the service-account JSON. */
  privateKey: string
  issuerName: string
}

/** Trimmed env string, or null when unset/blank. */
function envString(name: string): string | null {
  const raw = process.env[name]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Decode a base64 env var into a Buffer.
 * Returns null (rather than throwing) on anything unusable so a misconfigured
 * deployment degrades into "not configured" instead of a 500.
 */
function envBase64(name: string): Buffer | null {
  const raw = envString(name)
  if (!raw) return null
  try {
    // Tolerate the newlines a `base64` CLI or a pasted secret often carries.
    const decoded = Buffer.from(raw.replace(/\s+/g, ''), 'base64')
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

/** The brand mark used when the owner has not supplied real pass artwork. */
const TIKEM_TEAL: [number, number, number] = [13, 148, 136]

/**
 * The Apple Wallet configuration, or null when the deployment cannot sign passes.
 *
 * Every field is mandatory: a pass signed without the WWDR intermediate, or with
 * a Pass Type ID that does not match the certificate, is silently rejected by
 * iOS — so a partial configuration is treated as no configuration.
 */
export function getAppleWalletConfig(): AppleWalletConfig | null {
  const passTypeIdentifier = envString('APPLE_PASS_TYPE_ID')
  const teamIdentifier = envString('APPLE_TEAM_ID')
  const signerCert = envBase64('APPLE_PASS_CERT_PEM_BASE64')
  const signerKey = envBase64('APPLE_PASS_KEY_PEM_BASE64')
  const wwdr = envBase64('APPLE_WWDR_CERT_PEM_BASE64')

  if (!passTypeIdentifier || !teamIdentifier || !signerCert || !signerKey || !wwdr) {
    return null
  }

  return {
    passTypeIdentifier,
    teamIdentifier,
    signerCert,
    signerKey,
    wwdr,
    signerKeyPassphrase: envString('APPLE_WALLET_KEY_PASSPHRASE') || undefined,
    organizationName: envString('WALLET_ORGANIZATION_NAME') || 'Tikèm',
    // 29pt @1x is the Wallet icon size; the logo sits in the pass header.
    iconPng: envBase64('APPLE_PASS_ICON_PNG_BASE64') || solidPng(29, TIKEM_TEAL),
    logoPng: envBase64('APPLE_PASS_LOGO_PNG_BASE64') || solidPng(160, TIKEM_TEAL),
  }
}

/**
 * The Google Wallet configuration, or null when the deployment cannot sign
 * "Save to Google Wallet" links.
 */
export function getGoogleWalletConfig(): GoogleWalletConfig | null {
  const issuerId = envString('GOOGLE_WALLET_ISSUER_ID')
  const serviceAccountRaw = envString('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON')
  if (!issuerId || !serviceAccountRaw) return null

  let parsed: any
  try {
    parsed = JSON.parse(serviceAccountRaw)
  } catch {
    // Also accept the JSON base64-encoded, which is how it survives some CI UIs.
    try {
      parsed = JSON.parse(Buffer.from(serviceAccountRaw, 'base64').toString('utf8'))
    } catch {
      return null
    }
  }

  const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email.trim() : ''
  // Env vars flatten real newlines to the two characters \ and n.
  const privateKey =
    typeof parsed?.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n') : ''

  if (!clientEmail || !privateKey.includes('PRIVATE KEY')) return null

  return {
    issuerId,
    clientEmail,
    privateKey,
    issuerName: envString('WALLET_ORGANIZATION_NAME') || 'Tikèm',
  }
}

/**
 * What this deployment can actually produce, as two booleans.
 *
 * Cheap enough (env reads only, no signing, no I/O) that clients can call it
 * before rendering an "Add to Wallet" button and simply not show a button that
 * could never work.
 */
/**
 * Is Google Wallet offered to buyers? Off until Google approves the issuer for
 * production: in demo mode only the console admin can save a pass, so the
 * button would be a tap that fails for everyone else.
 *
 * One LIVE switch, no deploy and no app update: Firestore config/wallet
 * { google_enabled: true }, flipped with `node scripts/set-google-wallet.mjs on`
 * the day the approval email arrives. Web and app both ask GET
 * /api/wallet/generate, which reads it (cached a minute here, five at the
 * edge). NEXT_PUBLIC_GOOGLE_WALLET_ENABLED=true also forces it on.
 */
let googleOfferedCache: { at: number; value: boolean } | null = null

/** Tests only: forget the cached switch value. */
export function resetGoogleWalletOfferCache(): void {
  googleOfferedCache = null
}

export async function isGoogleWalletOffered(): Promise<boolean> {
  if (String(process.env.NEXT_PUBLIC_GOOGLE_WALLET_ENABLED || '').trim().toLowerCase() === 'true') return true
  if (googleOfferedCache && Date.now() - googleOfferedCache.at < 60_000) return googleOfferedCache.value
  let value = false
  try {
    const { adminDb } = await import('@/lib/firebase/admin')
    const snap = await adminDb.collection('config').doc('wallet').get()
    value = snap.exists && snap.data()?.google_enabled === true
  } catch {
    value = googleOfferedCache?.value ?? false
  }
  googleOfferedCache = { at: Date.now(), value }
  return value
}

export async function getWalletCapability(): Promise<{ apple: boolean; google: boolean }> {
  return {
    apple: getAppleWalletConfig() !== null,
    // The app and the website both hide the button when this says false.
    google: getGoogleWalletConfig() !== null && (await isGoogleWalletOffered()),
  }
}
