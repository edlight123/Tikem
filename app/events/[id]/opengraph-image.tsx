/* eslint-disable @next/next/no-img-element */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { getEventById } from '@/lib/data/events'
import { getPosterTheme } from '@/lib/posterGradient'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { isAllowedPosterUrl } from '@/lib/posters/hosts'

// nodejs, not edge: getEventById reaches Firestore through firebase-admin, which
// cannot run on the edge runtime at all. (app/icon.tsx is edge only because it
// renders a static glyph and touches no data.)
export const runtime = 'nodejs'
export const revalidate = 300

export const size = { width: 1200, height: 630 }
// JPEG, not the PNG ImageResponse produces natively. A 1200x630 card carrying a
// photographic poster comes out ~345KB as PNG, and WhatsApp — the way most of
// these links actually get shared — gets unreliable with big images. The same
// card as JPEG is a fraction of that with no visible loss on a photo.
export const contentType = 'image/jpeg'
export const alt = 'Event on Tikèm'

// Posters are portrait (~4:5), social cards are landscape — which is the whole
// reason this route exists: handing a raw 1080x1350 poster to a
// summary_large_image card made every platform centre-crop the art to nothing.
//
// So the poster is shown uncropped at the largest 4:5 this height allows, and a
// blurred copy of it fills the rest of the frame. The card then reads as the
// artwork at the thumbnail size a chat app actually renders, with the billing
// demoted to a caption beside it. The poster and caption are inset together and
// optically centred: pinning the poster flush left left ~700px of near-black
// doing nothing, which made the card read as mostly empty.
const POSTER_W = 504 // 630 * 4/5
// The poster IS the card (owner, 2026-11-17: "make the poster the main
// focus"): centred, full height, nothing beside it. The words live UNDER the
// image, where every chat app prints og:title and a one-line og:description
// (see generateMetadata in page.tsx), so the card carries no caption at all.
const POSTER_X = (1200 - POSTER_W) / 2

const CANVAS = '#0a0a0a'
const INK = '#f5f4f1'
const MUTED = '#a8a39a'
const TEAL = '#2dd4bf'

// Satori renders only png/apng/jpeg/gif/svg, and it THROWS on webp/avif rather
// than skipping — which would fail the whole route and leave the share with no
// image at all. A HEAD first is cheaper than that outcome. Anything unreadable
// falls through to the gradient, exactly like the in-app poster fallback.
// Only poster hosts are fetched (SSRF guard): see lib/posters/hosts.
async function usablePoster(url: string | undefined): Promise<string | null> {
  if (!isAllowedPosterUrl(url)) return null
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'error' })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').toLowerCase()
    return /^image\/(png|apng|jpeg|jpg|gif|svg\+xml)/.test(type) ? url : null
  } catch {
    return null
  }
}

// The fill behind the card. A cover-scaled copy of the poster at full size
// showed recognisable-but-cropped shapes — a half a face, a cut-off word — which
// reads as a mistake rather than as atmosphere. Downsampling to thumbnail size
// and blurring turns it into an ambient wash of the poster's own colour instead.
// It has to happen here because satori implements no filter: blur().
async function ambientFill(url: string | null): Promise<string | null> {
  if (!isAllowedPosterUrl(url)) return null
  try {
    const res = await fetch(url, { redirect: 'error' })
    if (!res.ok) return null
    const { default: sharp } = await import('sharp')
    const buf = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(64, 34, { fit: 'cover' })
      .blur(3)
      .jpeg({ quality: 62 })
      .toBuffer()
    // 64x34 is ~2KB, so inlining it costs nothing and saves satori a second
    // trip to the CDN for an image it would only smear anyway.
    return `data:image/jpeg;base64,${buf.toString('base64')}`
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
  const fill = await ambientFill(poster)

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
        {/* Ambient fill — the blurred poster, or its deterministic gradient. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            ...(fill
              ? { backgroundImage: `url(${fill})`, backgroundSize: '1200px 630px' }
              : { backgroundImage: theme.bg }),
          }}
        />

        {/* One even scrim: the wash stays a background on both sides of the
            poster instead of competing with it. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(10,10,10,0.66)',
          }}
        />

        {/* The poster, uncropped, centred, full height. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: POSTER_X,
            width: POSTER_W,
            height: '100%',
            backgroundImage: theme.bg,
            boxShadow: '0 30px 120px rgba(0,0,0,0.65)',
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
                padding: 44,
              }}
            >
              <div style={{ display: 'flex', width: 56, height: 3, background: theme.accent, marginBottom: 18 }} />
              <div
                style={{
                  fontFamily: 'Instrument',
                  fontStyle: 'italic',
                  fontSize: title.length > 24 ? 44 : 54,
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

        {/* A quiet signature in the wash, bottom right: the only words on the card. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            position: 'absolute',
            right: 40,
            bottom: 30,
          }}
        >
          <div style={{ fontFamily: 'Instrument', fontStyle: 'italic', fontSize: 30, color: MUTED, lineHeight: 1.1 }}>
            tikèm
          </div>
          <div
            style={{
              display: 'flex',
              width: 6,
              height: 6,
              borderRadius: 6,
              background: TEAL,
              marginLeft: 6,
              marginBottom: 12,
            }}
          />
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
