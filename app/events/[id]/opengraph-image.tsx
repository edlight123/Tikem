/* eslint-disable @next/next/no-img-element */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { getEventById } from '@/lib/data/events'
import { getPosterTheme } from '@/lib/posterGradient'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { fetchOwnPoster } from '@/lib/posters/hosts'

// nodejs, not edge: getEventById reaches Firestore through firebase-admin, which
// cannot run on the edge runtime at all. (app/icon.tsx is edge only because it
// renders a static glyph and touches no data.)
export const runtime = 'nodejs'
export const revalidate = 300

// The poster's own shape (4:5), owner 2026-11-17: "make sure it is the actual
// size, the width fills the entire thing". No landscape card, no side wash.
export const size = { width: 1080, height: 1350 }
// JPEG, not the PNG ImageResponse produces natively. A 1200x630 card carrying a
// photographic poster comes out ~345KB as PNG, and WhatsApp — the way most of
// these links actually get shared — gets unreliable with big images. The same
// card as JPEG is a fraction of that with no visible loss on a photo.
export const contentType = 'image/jpeg'
export const alt = 'Event on Tikèm'

// The share image IS the poster, at its own 4:5 proportions, edge to edge.
// Earlier versions built a 1200x630 landscape card (poster beside a caption,
// then poster centred on a blurred wash); the owner wanted the poster alone
// at full width. The words live under the image, where chat apps print
// og:title and the one-line og:description (generateMetadata in page.tsx).
// Trade-off: apps that force a wide preview (WhatsApp, X) may trim it.
const POSTER_W = size.width
const POSTER_X = 0

const CANVAS = '#0a0a0a'
const INK = '#f5f4f1'

// The poster is fetched HERE, never by satori: only OUR posters (our storage
// bucket or a flyer-library Unsplash photo; lib/posters/hosts isOwnPoster),
// redirects refused, streamed with a 15MB cap and a timeout. sharp then
// re-encodes it to a JPEG data URL with a pixel limit (a decompression bomb
// is refused, not decoded), which also covers webp/avif that satori would
// throw on. Anything unreadable falls through to the gradient, exactly like
// the in-app poster fallback.
async function usablePoster(url: string | undefined): Promise<string | null> {
  try {
    const bytes = await fetchOwnPoster(url, { timeoutMs: 6000 })
    if (!bytes) return null
    const { default: sharp } = await import('sharp')
    const data = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: POSTER_W, withoutEnlargement: true })
      .flatten({ background: CANVAS })
      .jpeg({ quality: 85 })
      .toBuffer()
    return `data:image/jpeg;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

export default async function OpengraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const event: any = isDemoMode()
    ? DEMO_EVENTS.find((e) => e.id === id)
    : await getEventById(id)

  // Read off disk rather than the `new URL(..., import.meta.url)` pattern: the
  // bundler rewrites that to a /_next/static path, which fetch() cannot parse
  // server-side ("Failed to parse URL"). next.config.js traces assets/fonts so
  // these files reach the serverless bundle.
  const fontDir = path.join(process.cwd(), 'assets', 'fonts')
  const [italic, regular] = await Promise.all([
    readFile(path.join(fontDir, 'InstrumentSerif-Italic.ttf')),
    readFile(path.join(fontDir, 'InstrumentSerif-Regular.ttf')),
  ])

  const fonts = [
    { name: 'Instrument', data: italic, style: 'italic' as const, weight: 400 as const },
    { name: 'Instrument', data: regular, style: 'normal' as const, weight: 400 as const },
  ]

  const title = String(event?.title || 'Event')
  const theme = getPosterTheme(event?.id || title, event?.category)
  const poster = await usablePoster(event?.banner_image_url)

  const png = new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: '100%',
          height: '100%',
          background: CANVAS,
          alignItems: 'center',
        }}
      >
        {/* The poster, full bleed. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: POSTER_X,
            width: POSTER_W,
            height: '100%',
            backgroundImage: theme.bg,
          }}
        >
          {poster ? (
            <img src={poster} width={POSTER_W} height={size.height} style={{ objectFit: 'cover' }} alt="" />
          ) : (
            // No poster: the gradient stands in for the artwork, and the title
            // goes ON it (the one case where the card has to say what it is).
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                width: '100%',
                height: '100%',
                padding: 88,
              }}
            >
              <div style={{ display: 'flex', width: 96, height: 5, background: theme.accent, marginBottom: 32 }} />
              <div
                style={{
                  fontFamily: 'Instrument',
                  fontStyle: 'italic',
                  fontSize: title.length > 24 ? 88 : 108,
                  lineHeight: 1.04,
                  color: INK,
                  display: 'flex',
                  lineClamp: 4,
                }}
              >
                {title}
              </div>
            </div>
          )}
        </div>

      </div>
    ),
    { ...size, fonts }
  )

  // Re-encode to JPEG. If sharp is unavailable or throws for any reason, serve
  // the PNG rather than failing the card — a heavy preview beats no preview.
  try {
    const { default: sharp } = await import('sharp')
    const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
      .jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer()

    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('opengraph-image: JPEG re-encode failed, serving PNG', err)
    return png
  }
}
