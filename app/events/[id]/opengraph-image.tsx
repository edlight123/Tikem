/* eslint-disable @next/next/no-img-element */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { getEventById } from '@/lib/data/events'
import { getPosterTheme } from '@/lib/posterGradient'
import { resolveEventPricing } from '@/lib/ticketPricing'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'

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
const MARGIN = 112
const GAP = 60
const TEXT_X = MARGIN + POSTER_W + GAP
const TEXT_W = 1200 - TEXT_X - MARGIN

const CANVAS = '#0a0a0a'
const INK = '#f5f4f1'
const MUTED = '#a8a39a'
const FAINT = '#6f6a61'
const TEAL = '#2dd4bf'

// Satori renders only png/apng/jpeg/gif/svg, and it THROWS on webp/avif rather
// than skipping — which would fail the whole route and leave the share with no
// image at all. A HEAD first is cheaper than that outcome. Anything unreadable
// falls through to the gradient, exactly like the in-app poster fallback.
// banner_image_url is organizer-supplied, and this route fetches it from the
// server: left open, it is an SSRF primitive (internal metadata endpoints,
// localhost). Only the hosts posters are actually stored on are fetched, over
// https, and redirects are refused so an allowed host cannot bounce elsewhere.
const POSTER_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'images.unsplash.com',
])

function isAllowedPosterUrl(url: string | undefined | null): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && POSTER_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

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

function formatDate(raw: unknown): string | null {
  // start_datetime is an ISO string for docs stored as Timestamps and a raw
  // string for legacy ones, so this can genuinely be Invalid Date.
  const d = new Date(String(raw ?? ''))
  if (isNaN(d.getTime())) return null
  return d
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase()
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

  const date = formatDate(event?.start_datetime)
  const place = [event?.venue_name, event?.city].filter(Boolean).join(', ')

  // Price is the lowest tier and is 0 for a free tier sitting alongside paid
  // ones, so it cannot decide freeness on its own — resolveEventPricing is the
  // single source of truth the rest of the app uses.
  const pricing = resolveEventPricing(event)
  const lowest = pricing.lowestPaidPrice ?? (Number(event?.ticket_price) || 0)
  const currency = String(event?.currency || 'HTG').toUpperCase()
  const priceLabel = !pricing.hasPaidTier
    ? 'Free entry'
    : `${pricing.hasFreeTier ? 'From ' : ''}${new Intl.NumberFormat('en-US').format(lowest)} ${currency}`

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

        {/* Two scrims rather than one. The flat pass keeps the wash dark enough
            to be a background everywhere; the ramp adds what the caption side
            needs on its own, so the poster's colour still reads on the left
            instead of the whole card going to mud. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(10,10,10,0.60)',
          }}
        />
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundImage:
              'linear-gradient(90deg, rgba(10,10,10,0.10) 0%, rgba(10,10,10,0.25) 40%, rgba(10,10,10,0.72) 62%, rgba(10,10,10,0.80) 100%)',
          }}
        />

        {/* Poster — the art, uncropped, and the thing the eye lands on first. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: MARGIN,
            width: POSTER_W,
            height: '100%',
            backgroundImage: theme.bg,
            boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
          }}
        >
          {poster ? (
            <img src={poster} width={POSTER_W} height={size.height} style={{ objectFit: 'cover' }} alt="" />
          ) : (
            // No poster: the deterministic gradient stands in for the artwork,
            // as a plain colour field. The app paints the title over this
            // gradient, but here the caption alongside already carries the
            // title — printing it twice on one card just reads as a mistake.
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: '100%',
                alignItems: 'flex-end',
                padding: 44,
              }}
            >
              <div style={{ display: 'flex', width: 64, height: 3, background: theme.accent }} />
            </div>
          )}
        </div>

        {/* Caption. Deliberately small and kept in one flowing stack — this is a
            caption on a poster, not a headline with a picture next to it. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            position: 'absolute',
            left: TEXT_X,
            top: 0,
            width: TEXT_W,
            height: '100%',
            justifyContent: 'center',
          }}
        >
          {date ? (
            <div
              style={{
                fontFamily: 'Instrument',
                fontSize: 17,
                letterSpacing: '0.2em',
                color: TEAL,
                marginBottom: 14,
              }}
            >
              {date}
            </div>
          ) : null}

          <div
            style={{
              fontFamily: 'Instrument',
              fontStyle: 'italic',
              fontSize: title.length > 28 ? 32 : 38,
              lineHeight: 1.08,
              letterSpacing: '-0.01em',
              color: INK,
              // The wrap IS the editorial look — clamp rather than truncate.
              display: 'flex',
              lineClamp: 3,
            }}
          >
            {title}
          </div>

          {place ? (
            <div
              style={{
                fontFamily: 'Instrument',
                fontSize: 20,
                lineHeight: 1.3,
                color: MUTED,
                marginTop: 18,
                display: 'flex',
                lineClamp: 2,
              }}
            >
              {place}
            </div>
          ) : null}

          <div
            style={{
              fontFamily: 'Instrument',
              fontSize: 18,
              letterSpacing: '0.06em',
              color: FAINT,
              marginTop: 8,
            }}
          >
            {priceLabel}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', marginTop: 40 }}>
            <div style={{ fontFamily: 'Instrument', fontSize: 17, color: FAINT }}>
              Tickets on
            </div>
            <div
              style={{
                fontFamily: 'Instrument',
                fontStyle: 'italic',
                fontSize: 26,
                color: MUTED,
                lineHeight: 1.1,
                marginLeft: 9,
              }}
            >
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
                marginBottom: 10,
              }}
            />
          </div>
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
