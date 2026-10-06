/**
 * Apple PassKit web service: the latest version of a pass.
 *
 *   GET .../v1/passes/{passType}/{serial}   Authorization: ApplePass <token>
 *
 * The serial names a ticket AND a QR version (lib/wallet/apple-web-service.ts).
 * A serial older than the ticket's current version belongs to a holder the
 * ticket has since left, so it is served VOIDED with no barcode; so is a
 * ticket that is no longer live (refunded, cancelled). Otherwise the current
 * pass, with the current code.
 */

import { NextResponse } from 'next/server'
import { buildApplePkpass } from '@/lib/wallet/apple'
import { getAppleWalletConfig } from '@/lib/wallet/config'
import { parseAppleSerial, verifyApplePassAuth } from '@/lib/wallet/apple-web-service'
import { loadWalletTicketById } from '@/lib/wallet/ticket-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ passTypeIdentifier: string; serialNumber: string }> }
) {
  try {
    const { passTypeIdentifier, serialNumber } = await params
    const config = getAppleWalletConfig()
    const serial = String(serialNumber || '')
    if (!config || String(passTypeIdentifier || '') !== config.passTypeIdentifier) {
      return new NextResponse(null, { status: 404 })
    }
    const parsed = parseAppleSerial(serial)
    if (!parsed) return new NextResponse(null, { status: 404 })
    if (!verifyApplePassAuth(request.headers.get('authorization'), serial)) {
      return new NextResponse(null, { status: 401 })
    }

    const loaded = await loadWalletTicketById(parsed.ticketId)
    if (!loaded) return new NextResponse(null, { status: 404 })
    const current = loaded.ticket.qrVersion
    // A version the ticket has never had is not a pass we issued.
    if (parsed.version > current) return new NextResponse(null, { status: 404 })
    const voided = parsed.version < current || !loaded.live

    const updatedMs = Number(loaded.data.wallet_pass_updated_at) || 0
    const lastModified = updatedMs > 0 ? new Date(Math.floor(updatedMs / 1000) * 1000) : null
    const ims = request.headers.get('if-modified-since')
    if (lastModified && ims) {
      const since = Date.parse(ims)
      if (!Number.isNaN(since) && lastModified.getTime() <= since) {
        return new NextResponse(null, { status: 304 })
      }
    }

    const pkpass = await buildApplePkpass(loaded.ticket, config, { voided, serialNumber: serial })
    return new NextResponse(new Uint8Array(pkpass), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Cache-Control': 'no-store, private',
        ...(lastModified ? { 'Last-Modified': lastModified.toUTCString() } : {}),
      },
    })
  } catch (error: any) {
    console.error('[wallet/apple] latest pass failed', { message: error?.message })
    return new NextResponse(null, { status: 500 })
  }
}
