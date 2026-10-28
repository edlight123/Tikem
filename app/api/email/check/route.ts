import { NextResponse } from 'next/server'
import { promises as dns } from 'node:dns'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { suggestEmailFix } from '@/lib/email/suggest'

/**
 * Can this address's domain receive mail at all? A DNS lookup only (MX, else
 * an A record); it never contacts the mailbox, so it reveals nothing about
 * whether a given person has an account. Used by the sign-up and checkout
 * forms (web + app) to stop addresses we already know will bounce.
 *
 * POST { email } -> { ok: true } | { ok: false, reason: 'no_mail_server' }
 * plus `suggestion` when the domain looks misspelled. Anything uncertain
 * (DNS timeout, rate limit) answers ok: a real person is never blocked by us.
 */
export const dynamic = 'force-dynamic'

const cache = new Map<string, { ok: boolean; at: number }>()
const TTL_MS = 6 * 60 * 60 * 1000

async function domainTakesMail(domain: string): Promise<boolean> {
  const hit = cache.get(domain)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok
  const lookup = async () => {
    try {
      const mx = await dns.resolveMx(domain)
      // A "null MX" (RFC 7505, exchange ".") means the domain refuses all mail.
      return mx.some((r) => r.exchange && r.exchange !== '.')
    } catch (e: any) {
      if (e?.code !== 'ENODATA' && e?.code !== 'ENOTFOUND') throw e
      try {
        return (await dns.resolve4(domain)).length > 0
      } catch (e2: any) {
        if (e2?.code === 'ENODATA' || e2?.code === 'ENOTFOUND') return false
        throw e2
      }
    }
  }
  const ok = await Promise.race([
    lookup(),
    new Promise<boolean>((_, fail) => setTimeout(() => fail(new Error('timeout')), 3000)),
  ])
  cache.set(domain, { ok, at: Date.now() })
  return ok
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const email = String(body?.email || '').trim().toLowerCase()
  const domain = email.split('@')[1] || ''
  if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || domain.length > 253) {
    return NextResponse.json({ ok: false, reason: 'malformed' })
  }
  const suggestion = suggestEmailFix(email) || undefined

  const { limited } = await consumeRateLimit({
    key: `email-check:${clientIp(request)}`,
    limit: 30,
    windowMs: 60_000,
    failOpen: true,
  })
  if (limited) return NextResponse.json({ ok: true, suggestion })

  try {
    const ok = await domainTakesMail(domain)
    return ok
      ? NextResponse.json({ ok: true, suggestion })
      : NextResponse.json({ ok: false, reason: 'no_mail_server', suggestion })
  } catch {
    return NextResponse.json({ ok: true, suggestion })
  }
}
