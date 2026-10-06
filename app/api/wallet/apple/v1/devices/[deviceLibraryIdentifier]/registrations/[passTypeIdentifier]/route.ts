/**
 * Apple PassKit web service: which of a device's passes changed.
 *
 *   GET .../v1/devices/{device}/registrations/{passType}?passesUpdatedSince=<tag>
 *
 * 200 { serialNumbers, lastUpdated } or 204 when nothing changed. Apple does
 * not authenticate this call; it reveals only serials the device itself
 * registered (lib/wallet/apple-web-service.ts serialsUpdatedSince).
 */

import { NextResponse } from 'next/server'
import { getAppleWalletConfig } from '@/lib/wallet/config'
import { isSaneAppleId, serialsUpdatedSince } from '@/lib/wallet/apple-web-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ deviceLibraryIdentifier: string; passTypeIdentifier: string }> }
) {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier } = await params
    const config = getAppleWalletConfig()
    const device = String(deviceLibraryIdentifier || '')
    if (!config || String(passTypeIdentifier || '') !== config.passTypeIdentifier || !isSaneAppleId(device)) {
      return new NextResponse(null, { status: 404 })
    }

    const raw = new URL(request.url).searchParams.get('passesUpdatedSince')
    const since = raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : null

    const result = await serialsUpdatedSince({ device, passType: config.passTypeIdentifier, since })
    if (!result) return new NextResponse(null, { status: 204 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('[wallet/apple] serials lookup failed', { message: error?.message })
    return new NextResponse(null, { status: 500 })
  }
}
