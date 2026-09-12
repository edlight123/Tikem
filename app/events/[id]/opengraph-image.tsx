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
export const contentType = 'image/png'
export const alt = 'Event on Tikèm'

// Posters are portrait (~4:5), social cards are landscape. Pairing a full-bleed
// portrait crop on the left with the billing on the right keeps the artwork
// uncropped and still fills 1200x630 — which is the whole reason this route
// exists: handing a raw 1080x1350 poster to a summary_large_image card made
// every platform centre-crop the art to nothing.
const POSTER_W = 504 // 630 * 4/5

const CANVAS = '#0a0a0a'
const INK = '#f5f4f1'
const MUTED = '#a8a39a'
const FAINT = '#6f6a61'
const TEAL = '#2dd4bf'

// Satori renders only png/apng/jpeg/gif/svg, and it THROWS on webp/avif rather
// than skipping — which would fail the whole route and leave the share with no
// image at all. A HEAD first is cheaper than that outcome. Anything unreadable
// falls through to the gradient, exactly like the in-app poster fallback.
async function usablePoster(url: string | undefined): Promise<string | null> {
  if (!url || !/^https?:\/\//.test(url)) return null
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').toLowerCase()
    return /^image\/(png|apng|jpeg|jpg|gif|svg\+xml)/.test(type) ? url : null
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

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: CANVAS }}>
        {/* Poster column — the art, uncropped vertically. */}
        <div
          style={{
            display: 'flex',
            position: 'relative',
            width: POSTER_W,
            height: '100%',
            backgroundImage: theme.bg,
          }}
        >
          {poster ? (
            <img src={poster} width={POSTER_W} height={size.height} style={{ objectFit: 'cover' }} alt="" />
          ) : (
            // No poster: the deterministic gradient stands in for the artwork,
            // as a plain colour field. The app paints the title over this
            // gradient, but here the billing column alongside already carries
            // the title — printing it twice on one card just reads as a mistake.
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

        {/* Billing column. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            height: '100%',
            position: 'relative',
            padding: '64px',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {date ? (
              <div
                style={{
                  fontFamily: 'Instrument',
                  fontSize: 22,
                  letterSpacing: '0.18em',
                  color: TEAL,
                  marginBottom: 20,
                }}
              >
                {date}
              </div>
            ) : null}

            <div
              style={{
                fontFamily: 'Instrument',
                fontStyle: 'italic',
                fontSize: title.length > 28 ? 60 : 76,
                lineHeight: 1.0,
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
                  fontSize: 30,
                  lineHeight: 1.25,
                  color: MUTED,
                  marginTop: 26,
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
                fontSize: 26,
                letterSpacing: '0.06em',
                color: FAINT,
                marginTop: 14,
              }}
            >
              {priceLabel}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              position: 'absolute',
              left: 64,
              bottom: 52,
              alignItems: 'flex-end',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: 'Instrument', fontSize: 26, color: MUTED }}>
                Tickets on
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    fontFamily: 'Instrument',
                    fontStyle: 'italic',
                    fontSize: 46,
                    color: INK,
                    lineHeight: 1.1,
                  }}
                >
                  tikèm
                </div>
                <div
                  style={{
                    display: 'flex',
                    width: 9,
                    height: 9,
                    borderRadius: 9,
                    background: TEAL,
                    marginLeft: 8,
                    marginBottom: 18,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  )
}
