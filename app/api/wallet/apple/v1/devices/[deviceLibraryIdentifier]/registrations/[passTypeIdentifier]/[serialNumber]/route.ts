/**
 * Apple PassKit web service: register / unregister a device for a pass.
 *
 *   POST   .../v1/devices/{device}/registrations/{passType}/{serial}  body { pushToken }
 *   DELETE .../v1/devices/{device}/registrations/{passType}/{serial}
 *
 * Authorization: `ApplePass <authenticationToken>` of that serial
 * (lib/wallet/apple-web-service.ts). Responses per Apple's spec: 201 new,
 * 200 already registered / unregistered, 401 bad token.
 */

import { NextResponse } from 'next/server'
import { getAppleWalletConfig } from '@/lib/wallet/config'
import {
  isSaneAppleId,
  parseAppleSerial,
  registerAppleDevice,
  unregisterAppleDevice,
  verifyApplePassAuth,
} from '@/lib/wallet/apple-web-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { deviceLibraryIdentifier: string; passTypeIdentifier: string; serialNumber: string }

async function authorize(
  request: Request,
  params: Promise<Params>
): Promise<{ ok: true; device: string; passType: string; serial: string } | { ok: false; status: number }> {
  const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = await params
  const config = getAppleWalletConfig()
  const device = String(deviceLibraryIdentifier || '')
  const passType = String(passTypeIdentifier || '')
  const serial = String(serialNumber || '')
  if (!config || passType !== config.passTypeIdentifier) return { ok: false, status: 404 }
  if (!isSaneAppleId(device) || !parseAppleSerial(serial)) return { ok: false, status: 404 }
  if (!verifyApplePassAuth(request.headers.get('authorization'), serial)) return { ok: false, status: 401 }
  return { ok: true, device, passType, serial }
}

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const auth = await authorize(request, params)
    if (!auth.ok) return new NextResponse(null, { status: auth.status })

    const body: any = await request.json().catch(() => null)
    const pushToken = typeof body?.pushToken === 'string' ? body.pushToken.trim() : ''
    if (!isSaneAppleId(pushToken)) return new NextResponse(null, { status: 400 })

    const result = await registerAppleDevice({ ...auth, pushToken })
    return new NextResponse(null, { status: result === 'created' ? 201 : 200 })
  } catch (error: any) {
    console.error('[wallet/apple] register failed', { message: error?.message })
    return new NextResponse(null, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const auth = await authorize(request, params)
    if (!auth.ok) return new NextResponse(null, { status: auth.status })
    await unregisterAppleDevice(auth)
    return new NextResponse(null, { status: 200 })
  } catch (error: any) {
    console.error('[wallet/apple] unregister failed', { message: error?.message })
    return new NextResponse(null, { status: 500 })
  }
}
