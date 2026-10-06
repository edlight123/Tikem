import { NextResponse } from 'next/server'
// @ts-expect-error no types
import webpush from 'web-push'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { createHash } from 'crypto'
import { safePushPath } from '@/lib/push/safePushPath'

function encodeEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}

export const runtime = 'nodejs'

interface UserSendPayload {
  userId?: string
  title?: string
  body?: string
  url?: string
  data?: Record<string, any>
}

const MAX_PER_HOUR = 20

async function checkRateLimit(userId: string) {
  const ref = adminDb.collection('pushRateLimits').doc(userId)
  const doc = await ref.get()
  const now = Date.now()
  const hourMs = 60 * 60 * 1000
  const current = doc.exists ? doc.data() : null
  const resetAt = current?.resetAt ? Number(current.resetAt) : 0
  let count = current?.count ? Number(current.count) : 0
  if (!resetAt || now > resetAt) {
    // reset window
    count = 0
  }
  if (count >= MAX_PER_HOUR) {
    return { allowed: false }
  }
  await ref.set({ count: count + 1, resetAt: now > resetAt ? now + hourMs : resetAt || now + hourMs }, { merge: true })
  return { allowed: true }
}

export async function POST(req: Request) {
  const { user, error: authError } = await requireAdmin()
  if (authError || !user) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }

  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not set' }, { status: 500 })
  }
  let payload: UserSendPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const userId = typeof payload.userId === 'string' && payload.userId.length <= 128 ? payload.userId : null
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  // Rate limit
  const rl = await checkRateLimit(userId)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', limit: MAX_PER_HOUR }, { status: 429 })
  }

  const snap = await adminDb.collection('pushSubscriptions').where('userId', '==', userId).get()
  const subs: any[] = snap.docs.map((d: any) => ({ endpoint: d.data().endpoint, keys: d.data().keys }))
    .filter((s: any) => s.endpoint && s.keys && s.keys.p256dh && s.keys.auth)
  if (!subs.length) {
    return NextResponse.json({ error: 'No subscriptions for user' }, { status: 404 })
  }

  webpush.setVapidDetails('mailto:support@tikem.co', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)

  const title = payload.title || 'Tikèm'
  const body = payload.body || 'Notification'
  const url = safePushPath(payload.url)
  if (!url) {
    return NextResponse.json({ error: 'url must be a same-origin relative path (e.g. /events/123)' }, { status: 400 })
  }
  // `data` may not smuggle a different click target past the check above.
  const extraData = payload.data && typeof payload.data === 'object' ? { ...payload.data } : {}
  delete (extraData as any).url
  const notificationPayload = JSON.stringify({ title, body, data: { ...extraData, url, userId } })

  interface SendResult { endpoint: string; ok: boolean; error?: string; statusCode?: number }
  const results: SendResult[] = await Promise.all(subs.map(s => webpush
    .sendNotification({ endpoint: s.endpoint, keys: s.keys }, notificationPayload)
    .then((): SendResult => ({ endpoint: s.endpoint, ok: true }))
    .catch((e: any): SendResult => ({ endpoint: s.endpoint, ok: false, error: String(e?.message || 'error'), statusCode: e?.statusCode }))
  ))

  const expired: SendResult[] = results.filter((r: SendResult) => !r.ok && (r.statusCode === 404 || r.statusCode === 410))
  if (expired.length) {
    await Promise.all(expired.map((r: SendResult) => adminDb.collection('pushSubscriptions').doc(encodeEndpoint(r.endpoint)).delete()))
  }

  // Analytics log
  try {
    await adminDb.collection('pushDispatchLogs').add({
      kind: 'user',
      userId,
      title,
      body,
      url,
      sentCount: results.length,
      successCount: results.filter(r => r.ok).length,
      pruned: expired.map(e => e.endpoint),
      timestamp: new Date().toISOString()
    })
  } catch {}

  return NextResponse.json({ sent: results, pruned: expired.map(e => e.endpoint) })
}
