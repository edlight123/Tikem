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

interface SendPayload {
  title?: string
  body?: string
  url?: string
  topics?: string[]
  data?: Record<string, any>
}

export async function POST(req: Request) {
  const { user, error: authError } = await requireAdmin()
  if (authError || !user) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }

  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not set' }, { status: 500 })
  }
  let payload: SendPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const title = payload.title || 'Tikèm'
  const body = payload.body || 'Notification'
  const url = safePushPath(payload.url)
  if (!url) {
    return NextResponse.json({ error: 'url must be a same-origin relative path (e.g. /events/123)' }, { status: 400 })
  }
  // `data` may not smuggle a different click target past the check above.
  const extraData = payload.data && typeof payload.data === 'object' ? { ...payload.data } : {}
  delete (extraData as any).url
  const topicsFilter = Array.isArray(payload.topics) && payload.topics.length ? payload.topics : null

  const snap = await adminDb.collection('pushSubscriptions').get()
  const subs: any[] = snap.docs
    .map((d: any) => ({ endpoint: d.data().endpoint, keys: d.data().keys, topics: (d.data().topics || []) as string[] }))
    .filter((s: any) => s.endpoint && (!topicsFilter || s.topics.some((t: string) => topicsFilter.includes(t))) && s.keys && s.keys.p256dh && s.keys.auth)

  if (!subs.length) return NextResponse.json({ error: 'No valid matching subscriptions (keys missing or no topic match)' }, { status: 404 })

  webpush.setVapidDetails('mailto:support@tikem.co', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)

  const notificationPayload = JSON.stringify({
    title,
    body,
    data: { ...extraData, url }
  })

  const results = await Promise.all(subs.map(s => webpush
    .sendNotification({ endpoint: s.endpoint, keys: s.keys }, notificationPayload)
    .then(() => ({ endpoint: s.endpoint, ok: true }))
    .catch((e: any) => ({ endpoint: s.endpoint, ok: false, error: String(e?.message || 'error'), statusCode: e?.statusCode }))
  ))

  // Prune expired (410 Gone or 404 Not Found)
  const expired = results.filter((r: any) => !r.ok && (r.statusCode === 410 || r.statusCode === 404))
  await Promise.all(expired.map((r: any) => adminDb.collection('pushSubscriptions').doc(encodeEndpoint(r.endpoint)).delete()))

  // Dispatch log (non-blocking)
  try {
    await adminDb.collection('pushDispatchLogs').add({
      kind: 'topic',
      topics: topicsFilter || [],
      title,
      body,
      url,
      sentCount: results.length,
      successCount: results.filter((r: any) => r.ok).length,
      pruned: expired.map((e: any) => e.endpoint),
      timestamp: new Date().toISOString()
    })
  } catch {}

  return NextResponse.json({ sent: results, pruned: expired.map((e: any) => e.endpoint) })
}
