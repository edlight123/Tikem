import { createHash } from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Fixed-window rate limiter backed by Firestore, shared across serverless
 * instances (an in-memory counter resets on every cold start).
 *
 * Keys are hashed before they become document ids, so a phone number or email
 * used as a key is never stored in clear. Writes go through the Admin SDK only;
 * the `rate_limits` collection needs no client rule (default deny).
 *
 * `failOpen` decides what a Firestore error means. Default false: a limiter on
 * an abuse-prone endpoint should refuse when it cannot count.
 */
export async function consumeRateLimit(opts: {
  key: string
  limit: number
  windowMs: number
  failOpen?: boolean
  /** Units to consume (defaults to 1), e.g. number of phones in a batch. */
  cost?: number
}): Promise<{ limited: boolean }> {
  const raw = String(opts.key || '').trim()
  if (!raw) return { limited: false }
  const cost = Math.max(1, Math.floor(opts.cost ?? 1))
  const id = createHash('sha256').update(raw).digest('hex').slice(0, 40)
  const ref = adminDb.collection('rate_limits').doc(id)
  const now = Date.now()

  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const data = snap.exists ? snap.data() || {} : {}
      const windowStart = Number(data.window_start || 0)
      const withinWindow = Boolean(windowStart && now - windowStart < opts.windowMs)
      const count = withinWindow ? Number(data.count || 0) : 0

      if (count + cost > opts.limit) return { limited: true }

      tx.set(ref, {
        count: count + cost,
        window_start: withinWindow ? windowStart : now,
        expires_at: new Date((withinWindow ? windowStart : now) + opts.windowMs),
      })
      return { limited: false }
    })
  } catch (e) {
    console.error('[rate-limit] counter failed', (e as any)?.message)
    return { limited: !opts.failOpen }
  }
}

/** First hop of x-forwarded-for, else x-real-ip, else 'unknown'. */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * The rate-limit key for a client address. IPv4 as is; IPv6 reduced to its
 * /64, because one connection is routinely handed a whole /64 and keying on
 * the full address lets a single client rotate through endless "addresses".
 */
export function clientIpKey(request: Request): string {
  return ipLimitKey(clientIp(request))
}

export function ipLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is really IPv4.
  const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return mapped[1]
  const [head, tail] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail !== undefined && tail !== '' ? tail.split(':') : []
  const fill = tail !== undefined ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : []
  const groups = [...left, ...fill, ...right].slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''))
  return `${groups.join(':')}::/64`
}
