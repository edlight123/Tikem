/**
 * POST /api/events/[id]/view: count one page view (lib/events/views.ts).
 *
 * Fire-and-forget from the web event page and the app's event screen: always
 * answers 204 (counted, deduped, own view, throttled or junk alike) with the
 * reason in `x-tikem-view`. Body (app): { deviceId }: an opaque random id
 * kept in AsyncStorage. The web has no body id; it gets an HttpOnly `tk_vid`
 * cookie (random, no personal data) issued here on first view.
 *
 * Hygiene: obvious bots ignored; per-IP in-memory throttle (the IP is never
 * stored); one count per viewer per event per day; the organizer and their
 * team never count; published events only.
 */
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createIpRateLimiter, isLikelyBot } from '@/lib/attribution'
import { clientIp } from '@/lib/rate-limit'
import { getServerSession } from '@/lib/firebase/server'
import { VIEWER_COOKIE, normalizeDeviceId, recordEventView } from '@/lib/events/views'
import { firestoreViewDeps } from '@/lib/events/views-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 30 views / minute / IP / instance: room for a household on one carrier NAT
// browsing a few events, not for a script cycling device ids.
const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 })
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

function done(reason: string, setCookie?: string) {
  const res = new NextResponse(null, { status: 204, headers: { 'x-tikem-view': reason, 'cache-control': 'no-store' } })
  if (setCookie) res.headers.append('set-cookie', setCookie)
  return res
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (isLikelyBot(request.headers.get('user-agent'))) return done('bot')
    if (limiter.hit(clientIp(request))) return done('throttled')

    const body = await request.json().catch(() => null)
    const deviceId = normalizeDeviceId(body?.deviceId)

    let uid: string | null = null
    try {
      const { user } = await getServerSession()
      uid = user?.id || null
    } catch {
      uid = null
    }

    let cookieId = normalizeDeviceId(readCookie(request, VIEWER_COOKIE))
    let setCookie: string | undefined
    if (!uid && !deviceId && !cookieId) {
      cookieId = randomBytes(16).toString('hex')
      const secure = new URL(request.url).protocol === 'https:'
      setCookie = `${VIEWER_COOKIE}=${cookieId}; Max-Age=${COOKIE_MAX_AGE}; Path=/api/events; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
    }

    const outcome = await recordEventView({ eventId: id, uid, deviceId, cookieId }, firestoreViewDeps)
    return done(outcome, setCookie)
  } catch (err: any) {
    console.warn('[events/view] failed', err?.message)
    return done('error')
  }
}
