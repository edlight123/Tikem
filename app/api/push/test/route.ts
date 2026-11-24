import { NextResponse } from 'next/server'
// @ts-expect-error no types
import webpush from 'web-push'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { createHash, timingSafeEqual } from 'crypto'

function encodeEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}

export const runtime = 'nodejs'

async function runTestSend() {
  // Fetch all stored subscriptions
  const snap = await adminDb.collection('pushSubscriptions').get()
  const subs: any[] = snap.docs
    .map((d: any) => ({ endpoint: d.data().endpoint, keys: d.data().keys }))
    .filter((s: any) => s.endpoint && s.keys && s.keys.p256dh && s.keys.auth)
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not set' }, { status: 500 })
  }
  if (!subs.length) return NextResponse.json({ error: 'No valid subscriptions (keys missing)' }, { status: 404 })
  webpush.setVapidDetails('mailto:support@tikem.co', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const payload = JSON.stringify({ title: 'Tikèm', body: 'Test notification', data: { url: '/tickets' } })
  type SendResult = { endpoint: string; ok: boolean; error?: string; statusCode?: number }
  const results: SendResult[] = await Promise.all(subs.map(s => webpush
    .sendNotification(s, payload)
    .then((): SendResult => ({ endpoint: s.endpoint, ok: true }))
    .catch((e: any): SendResult => ({ endpoint: s.endpoint, ok: false, error: String(e?.message || 'error'), statusCode: e?.statusCode }))
  ))
  const expired = results.filter((r: SendResult) => !r.ok && (r.statusCode === 410 || r.statusCode === 404))
  await Promise.all(expired.map((r: SendResult) => adminDb.collection('pushSubscriptions').doc(encodeEndpoint(r.endpoint)).delete()))
  // Dispatch log (non-blocking)
  try {
    await adminDb.collection('pushDispatchLogs').add({
      kind: 'test',
      title: 'Tikèm',
      body: 'Test notification',
      url: '/tickets',
      sentCount: results.length,
      successCount: results.filter(r => r.ok).length,
      pruned: expired.map(e => e.endpoint),
      timestamp: new Date().toISOString()
    })
  } catch {}
  return NextResponse.json({ sent: results, pruned: expired.map((e: SendResult) => e.endpoint) })
}

/** The PUSH_TEST_SECRET header matches (constant time); false when it is unset. */
function secretMatches(request: Request): boolean {
  const secret = process.env.PUSH_TEST_SECRET
  const given = request.headers.get('x-push-test-secret')
  if (!secret || !given) return false
  const a = Buffer.from(secret)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Broadcast a test notification to every subscription. POST only: a signed-in
 * admin, or a script sending the PUSH_TEST_SECRET in the x-push-test-secret
 * header. There is no GET: a link (or a link preview, a prefetch, a crawler)
 * must never be able to fire a broadcast, and a secret in a query string ends
 * up in logs and browser history.
 */
export async function POST(request: Request) {
  if (secretMatches(request)) return runTestSend()
  const { user, error: authError } = await requireAdmin()
  if (authError || !user) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }
  return runTestSend()
}
