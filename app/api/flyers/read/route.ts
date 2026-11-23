/**
 * POST /api/flyers/read  { url } → { read: FlyerRead }
 *
 * "Fill from flyer" in both composers: read the uploaded flyer's text with
 * Tesseract (lib/flyer/ocr-server) and turn it into composer fields with
 * plain rules (lib/flyer/parse; English, French and Kreyòl). Free, no AI.
 * Nothing is saved or published from a read: the organizer reviews the
 * filled form.
 *
 * Only OUR uploaded images are read (lib/posters/hosts.isOwnPoster), so it is
 * not an open fetcher. The guest composer (/create) may read too, its flyer
 * waits in our bucket under guest-uploads/, with a tighter per-IP budget.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { fetchOwnPoster, isOwnPoster } from '@/lib/posters/hosts'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { parseFlyerText } from '@/lib/flyer/parse'

// Tesseract (WebAssembly in a worker thread) and sharp need Node.
export const runtime = 'nodejs'
// A cold start loads the models (~1s); a read takes 2-6s.
export const maxDuration = 60

const DAY = 24 * 60 * 60 * 1000

export async function POST(request: Request) {
  let body: any = null
  try {
    body = await request.json()
  } catch {
    /* handled below */
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!isOwnPoster(url)) {
    return NextResponse.json({ error: 'not_our_image' }, { status: 400 })
  }

  const user = await getCurrentUser().catch(() => null)
  const { limited } = await consumeRateLimit(
    user
      ? { key: `flyer-read:user:${user.id}`, limit: 40, windowMs: DAY }
      : { key: `flyer-read:ip:${clientIp(request)}`, limit: 10, windowMs: DAY }
  )
  if (limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let image: Buffer | null = null
  try {
    image = await fetchOwnPoster(url)
  } catch {
    return NextResponse.json({ error: 'unreadable' }, { status: 422 })
  }
  if (!image) return NextResponse.json({ error: 'not_our_image' }, { status: 400 })

  try {
    const { ocrFlyer } = await import('@/lib/flyer/ocr-server')
    const lines = await ocrFlyer(image)
    const read = parseFlyerText(lines)
    return NextResponse.json({ read }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    console.error('[flyers/read] failed', (e as Error)?.message)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }
}
