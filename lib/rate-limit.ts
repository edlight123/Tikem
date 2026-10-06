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
