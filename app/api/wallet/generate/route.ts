/**
 * POST /api/wallet/generate — mint an "Add to Wallet" link for ONE ticket.
 * GET  /api/wallet/generate — what this deployment can actually produce.
 *
 * This route was referenced by mobile/components/AddToWalletButton.tsx but never
 * existed, so every "Add to Apple Wallet" tap 404'd and the button reported
 * "Please try again" — advice that could never work.
 *
 * Shape, dictated by the shipped mobile client:
 *   • iOS     -> `{ passUrl }`, an https URL the app hands to Safari. Safari
 *                downloads `application/vnd.apple.pkpass` and iOS shows the
 *                Add-to-Wallet sheet. Safari carries none of the app's auth, so
 *                the URL is a signed, 10-minute, single-ticket token whose
 *                download route re-verifies ownership (lib/wallet/pass-token.ts).
 *   • Android -> `{ saveUrl }`, Google's signed save link.
 *
 * AUTHORIZATION: authenticated caller only, and only for a ticket they own. The
 * `ticketId` from the body is used solely as a lookup key — the owner, the
 * status and the QR payload are all read back from Firestore
 * (lib/wallet/ticket-access.ts).
 *
 * UNCONFIGURED: returns 503 with `code: 'apple_wallet_not_configured'` /
 * `'google_wallet_not_configured'`, distinct from any 500, so the client can say
 * "not available yet" instead of "try again".
 */

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  WALLET_ERROR_CODES,
  getAppleWalletConfig,
  getGoogleWalletConfig,
  getWalletCapability,
} from '@/lib/wallet/config'
import { buildGoogleSaveUrl } from '@/lib/wallet/google'
import { mintPassToken } from '@/lib/wallet/pass-token'
import { loadWalletTicket } from '@/lib/wallet/ticket-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Mirrors app/api/tickets/claim-free/route.ts:31 — English `error` + stable `code`. */
function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

/**
 * Capability probe. Booleans only — no secrets, nothing ticket-specific — so a
 * client can hide a button that could never work rather than offering a tap
 * that always fails.
 */
export async function GET() {
  const capability = await getWalletCapability()
  return NextResponse.json(capability, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return fail('Unauthorized', WALLET_ERROR_CODES.unauthorized, 401)
    }

    const body = await request.json().catch(() => ({}))
    const ticketId = String(body?.ticketId ?? '').trim()
    if (!ticketId) {
      return fail('Ticket ID is required', WALLET_ERROR_CODES.missingTicketId, 400)
    }

    // 'ios' | 'android' from React Native's Platform.OS. Anything else is
    // refused rather than guessed — we would otherwise pick a wallet the caller
    // cannot open.
    const platform = String(body?.platform ?? '').trim().toLowerCase()
    if (platform !== 'ios' && platform !== 'android') {
      return fail(
        'Unsupported platform for wallet passes',
        WALLET_ERROR_CODES.unsupportedPlatform,
        400
      )
    }

    // ── AuthZ: exists, owned by THIS caller, still live ──────────────────────
    const access = await loadWalletTicket(ticketId, user.id)
    if (!access.ok) {
      const message =
        access.code === 'ticket_not_found'
          ? 'Ticket not found'
          : access.code === 'not_ticket_owner'
            ? 'This ticket does not belong to you'
            : 'This ticket is no longer valid'
      return fail(message, access.code, access.status)
    }
    const ticket = access.ticket

    if (platform === 'ios') {
      const appleConfig = getAppleWalletConfig()
      if (!appleConfig) {
        return fail(
          'Apple Wallet passes are not configured on this server',
          WALLET_ERROR_CODES.appleNotConfigured,
          503
        )
      }

      const minted = mintPassToken(ticket.id, user.id)
      if (!minted) {
        // Only reachable if the signing key vanished between the two reads.
        return fail(
          'Apple Wallet passes are not configured on this server',
          WALLET_ERROR_CODES.appleNotConfigured,
          503
        )
      }

      const origin =
        process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
        new URL(request.url).origin

      return NextResponse.json({
        platform: 'ios',
        passUrl: `${origin}/api/wallet/pass/${minted.token}`,
        expiresAt: minted.expiresAt,
      })
    }

    const googleConfig = getGoogleWalletConfig()
    if (!googleConfig) {
      return fail(
        'Google Wallet passes are not configured on this server',
        WALLET_ERROR_CODES.googleNotConfigured,
        503
      )
    }

    let saveUrl: string
    try {
      saveUrl = buildGoogleSaveUrl(ticket, googleConfig)
    } catch (error: any) {
      console.error('[wallet] google save link signing failed', { message: error?.message })
      return fail(
        'Could not build the Google Wallet pass',
        WALLET_ERROR_CODES.passBuildFailed,
        502
      )
    }

    return NextResponse.json({ platform: 'android', saveUrl })
  } catch (error: any) {
    console.error('[wallet] generate failed', error)
    return fail(error?.message || 'Failed to generate wallet pass', 'server_error', 500)
  }
}
