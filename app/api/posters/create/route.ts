import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminStorage } from '@/lib/firebase/admin'
import { cleanInput, renderPoster } from '@/lib/posters/render'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { downloadUrl } from '@/lib/firebase/downloadUrl'

export const runtime = 'nodejs'

/**
 * POST /api/posters/create  { template, palette, title, start, venue, city,
 *   lineup[], presenter, locale, photo }  →  { url }
 *
 * Draws the chosen template at full size and stores it as an ordinary poster
 * image, so it behaves like any uploaded flyer everywhere (cards, share
 * cards, emails, wallet passes). The composer then saves `url` as the event's
 * banner_image_url like any other poster.
 *
 * Signed out (the /create guest composer) it is stored exactly like a guest
 * upload: under guest-uploads/ with a download token, so the composer's
 * existing promote step moves it to its permanent home when the event is
 * created, and the 7-day cleanup clears abandoned ones.
 */
const HOUR = 60 * 60 * 1000

export async function POST(req: Request) {
  const user = await getCurrentUser()

  const input = cleanInput(await req.json().catch(() => ({})))
  if (!input) return NextResponse.json({ error: 'invalid poster' }, { status: 400 })

  const { limited } = await consumeRateLimit(
    user
      ? { key: `poster-create:uid:${user.id}`, limit: 60, windowMs: HOUR }
      : { key: `poster-create:ip:${clientIp(req)}`, limit: 20, windowMs: HOUR }
  )
  if (limited) return NextResponse.json({ error: 'rate limited' }, { status: 429 })

  try {
    const jpeg = await renderPoster(input)
    const bucket = adminStorage.bucket()

    if (!user) {
      const token = randomUUID()
      const dest = `guest-uploads/${randomUUID()}.jpg`
      await bucket.file(dest).save(jpeg, {
        contentType: 'image/jpeg',
        metadata: {
          cacheControl: 'public, max-age=3600',
          // Same markers as /api/guest-upload, which the cleanup cron reads.
          metadata: { firebaseStorageDownloadTokens: token, guest_upload: '1', uploaded_at: new Date().toISOString() },
        },
      })
      return NextResponse.json({
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`,
      })
    }

    // Same poster → same file name, so saving twice doesn't pile up copies.
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)
    const fileName = `posters/${user.id}/${hash}.jpg`
    const file = bucket.file(fileName)
    await file.save(jpeg, {
      contentType: 'image/jpeg',
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    })
    return NextResponse.json({ url: await downloadUrl(file) })
  } catch (e) {
    console.error('[posters/create]', (e as Error)?.message)
    return NextResponse.json({ error: 'render failed' }, { status: 500 })
  }
}
