/**
 * Apple PassKit web service: devices report web-service errors here.
 *
 *   POST .../v1/log   body { logs: string[] }
 *
 * Unauthenticated by Apple's design, so it only ever writes a capped amount
 * to the server log.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body: any = await request.json().catch(() => null)
    const logs = Array.isArray(body?.logs) ? body.logs.slice(0, 20) : []
    for (const line of logs) {
      console.warn('[wallet/apple] device log', String(line).slice(0, 500))
    }
  } catch {
    // never fail a log call
  }
  return new NextResponse(null, { status: 200 })
}
