import { fetchOwnPoster } from '@/lib/posters/hosts'
import { toneFrom } from '@/lib/posters/tone'

/**
 * The event's poster thumbnail (JPEG, 4:5) and its colour (a deep shade of
 * the poster's average) for export headers. Best effort: no poster, or one
 * that fails to load, gives the ink header and no thumbnail.
 */
export async function loadEventArt(event: Record<string, any>): Promise<{ poster: Buffer | null; tone: string }> {
  let poster: Buffer | null = null
  let tone = '#141414'
  const posterUrl = event?.banner_image_url || event?.cover_image_url || null
  try {
    const buf = posterUrl ? await fetchOwnPoster(posterUrl) : null
    if (buf) {
      const { default: sharp } = await import('sharp')
      poster = await sharp(buf, { limitInputPixels: 50_000_000 })
        .resize(320, 400, { fit: 'cover' })
        .jpeg({ quality: 82 })
        .toBuffer()
      const { data } = await sharp(buf, { limitInputPixels: 50_000_000 })
        .resize(1, 1, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      tone = toneFrom(data[0], data[1], data[2])
    }
  } catch {
    poster = null
  }
  return { poster, tone }
}
