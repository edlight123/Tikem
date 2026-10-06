import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { createHash } from 'crypto'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'

function encodeEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log('[push/subscribe] Received:', { endpoint: body?.endpoint?.substring(0, 50), hasKeys: !!body?.keys })
    if (!body || typeof body.endpoint !== 'string' || !/^https:\/\//i.test(body.endpoint) || body.endpoint.length > 2048) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    }

    // Accept optional topics array from client (e.g. ["reminders", "promotions"])
    const topics: string[] = Array.isArray(body.topics)
      ? (body.topics as unknown[])
          .filter((t: unknown): t is string => typeof t === 'string')
          .filter((t: string) => t.length <= 32)
          .slice(0, 10)
      : []

    const docId = encodeEndpoint(body.endpoint)
    const ref = adminDb.collection('pushSubscriptions').doc(docId)
    const doc = await ref.get()
    const existing = doc.exists ? doc.data() : null
    const mergedTopics = Array.from(new Set([...(existing?.topics || []), ...topics]))
    // The subscription is bound to the SESSION's uid, never a body-supplied
    // one: otherwise anyone could attach their browser to another user's
    // account and receive that user's targeted pushes. Signed-out callers keep
    // whatever binding the endpoint already had (or none).
    const sessionUser = await getCurrentUser().catch(() => null)
    const userId = sessionUser?.id || existing?.userId || null

    const data = {
      endpoint: body.endpoint,
      keys: body.keys || {},
      topics: mergedTopics,
      userId,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString()
    }
    await ref.set(data, { merge: true })
    console.log('[push/subscribe] Success:', { endpoint: data.endpoint.substring(0, 50), topics: data.topics })
    return NextResponse.json({ ok: true, topics: data.topics })
  } catch (e) {
    console.error('[push/subscribe] Error:', e)
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 })
  }
}
