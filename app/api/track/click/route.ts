// Click beacon for tracking links (`?t=`) and promoter links (`?ref=`).
//
// Called fire-and-forget (keepalive) by the web event page and by the app when
// a universal link opens an event, so it must be cheap and must never make
// anyone wait: it always answers 204 — counted, deduped, throttled or junk
// alike — and does at most one Firestore read + one increment per target.
//
// Hygiene, in order:
//  1. Obvious bots (crawlers, link unfurlers, HTTP libraries) are ignored.
//  2. Per-IP fixed-window throttle (generous: carrier NAT shares addresses).
//  3. Per-browser dedupe: a 30-minute cookie per link, set here, on top of the
//     client's own localStorage/AsyncStorage window. The app has no cookie jar
//     to rely on, so its AsyncStorage window is the dedupe there.
//  4. The target is re-resolved against the event before anything counts.

import { NextResponse } from 'next/server'
import {
  CLICK_DEDUPE_WINDOW_MS,
  clickDedupeKey,
  createIpRateLimiter,
  isLikelyBot,
  normalizePromoterRef,
  normalizeTrackingLinkId,
} from '@/lib/attribution'
import { incrementPromoterClick, incrementTrackingLinkClick } from '@/lib/tracking-links'

export const dynamic = 'force-dynamic'

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const COOKIE_PREFIX = 'tk_clk_'

// 60 beacons / minute / IP / instance.
const limiter = createIpRateLimiter({ limit: 60, windowMs: 60_000 })

function clientIp(request: Request): string {
  return (
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

function done(reason: string, setCookies: string[] = []) {
  const res = new NextResponse(null, { status: 204, headers: { 'x-tikem-click': reason } })
  for (const c of setCookies) res.headers.append('set-cookie', c)
  return res
}

export async function POST(request: Request) {
  try {
    if (isLikelyBot(request.headers.get('user-agent'))) return done('bot')
    if (limiter.hit(clientIp(request))) return done('throttled')

    const body = await request.json().catch(() => null)
    const eventId = String(body?.eventId || '').trim()
    if (!EVENT_ID_PATTERN.test(eventId)) return done('invalid')

    const trackingLinkId = normalizeTrackingLinkId(body?.t)
    const promoterRef = normalizePromoterRef(body?.ref)
    if (!trackingLinkId && !promoterRef) return done('invalid')

    const secure = new URL(request.url).protocol === 'https:'
    const maxAge = Math.round(CLICK_DEDUPE_WINDOW_MS / 1000)
    const cookieFor = (key: string) =>
      `${COOKIE_PREFIX}${key}=1; Max-Age=${maxAge}; Path=/api/track; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`

    const setCookies: string[] = []
    const counted: string[] = []

    const linkKey = trackingLinkId ? clickDedupeKey(eventId, { t: trackingLinkId }) : null
    if (trackingLinkId && linkKey && !readCookie(request, `${COOKIE_PREFIX}${linkKey}`)) {
      if (await incrementTrackingLinkClick(eventId, trackingLinkId)) {
        counted.push('t')
        setCookies.push(cookieFor(linkKey))
      }
    }

    const refKey = promoterRef ? clickDedupeKey(eventId, { ref: promoterRef }) : null
    if (promoterRef && refKey && !readCookie(request, `${COOKIE_PREFIX}${refKey}`)) {
      if (await incrementPromoterClick(eventId, promoterRef)) {
        counted.push('ref')
        setCookies.push(cookieFor(refKey))
      }
    }

    return done(counted.length ? `counted:${counted.join(',')}` : 'deduped_or_unknown', setCookies)
  } catch (err: any) {
    console.warn('[track/click] failed', err?.message)
    return done('error')
  }
}
