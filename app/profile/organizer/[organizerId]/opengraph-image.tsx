/* eslint-disable @next/next/no-img-element */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { adminDb } from '@/lib/firebase/admin'
import { readOrgBrandAdmin } from '@/lib/firestore/org-brand-server'
import { fetchOwnPoster } from '@/lib/posters/hosts'
import { coverTemplatePath, resolveOrgCover } from '@/lib/organizer/cover'

/**
 * An organizer's share card (1200x630, the size chat apps show wide): their
 * banner (or newest poster) as the light behind, the logo, the name in the
 * serif, "on tikèm". Same approach as the event card
 * (app/events/[id]/opengraph-image.tsx): images are fetched HERE, only OUR
 * posters (lib/posters/hosts fetchOwnPoster: our bucket or a flyer-library
 * photo, redirects refused, size and time capped), then re-encoded by sharp
 * with a pixel limit. A template banner is read off disk. Anything that
 * fails falls back to the plain black card.
 */
export const runtime = 'nodejs'
export const revalidate = 3600
export const size = { width: 1200, height: 630 }
export const contentType = 'image/jpeg'
export const alt = 'An organizer on Tikèm'

const CANVAS = '#0a0a0a'
const INK = '#f5f4f1'
const MUTED = '#a3a3a3'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

async function toDataUrl(bytes: Buffer | null, width: number, opts: { square?: boolean } = {}): Promise<string | null> {
  if (!bytes) return null
  try {
    const { default: sharp } = await import('sharp')
    let img = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
    img = opts.square
      ? img.resize({ width, height: width, fit: 'cover' })
      : img.resize({ width, withoutEnlargement: true })
    const data = await img.flatten({ background: CANVAS }).jpeg({ quality: 84 }).toBuffer()
    return `data:image/jpeg;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

async function ownImage(url: string | null | undefined, width: number, opts: { square?: boolean } = {}) {
  try {
    return await toDataUrl(await fetchOwnPoster(url, { timeoutMs: 6000 }), width, opts)
  } catch {
    return null
  }
}

export default async function Image({ params }: { params: Promise<{ organizerId: string }> }) {
  const { organizerId } = await params
  const valid = /^[A-Za-z0-9_-]{1,128}$/.test(organizerId)

  const [pubSnap, userSnap, brand, newest] = valid
    ? await Promise.all([
        adminDb.collection('public_profiles').doc(organizerId).get().catch(() => null),
        adminDb.collection('users').doc(organizerId).get().catch(() => null),
        readOrgBrandAdmin(organizerId).catch(() => null),
        adminDb
          .collection('events')
          .where('organizer_id', '==', organizerId)
          .where('is_published', '==', true)
          .limit(12)
          .get()
          .catch(() => null),
      ])
    : [null, null, null, null]

  const pub: any = pubSnap?.exists ? pubSnap.data() : null
  const user: any = userSnap?.exists ? userSnap.data() : null
  const name =
    str(brand?.organization_name) || str(pub?.organization_name) || str(user?.organization_name) || str(pub?.full_name) || str(user?.full_name) || 'Tikèm'
  const verified = Boolean(pub?.is_verified ?? user?.is_verified)
  const eventCount = newest?.size ?? 0

  // The light behind: their banner, else their most recent poster.
  const cover = valid ? resolveOrgCover(organizerId, pub) : null
  let backdrop: string | null = null
  if (cover?.kind === 'template') {
    const file = path.join(process.cwd(), 'public', coverTemplatePath(cover.key))
    backdrop = await toDataUrl(await readFile(file).catch(() => null), size.width)
  } else if (cover?.kind === 'upload') {
    backdrop = await ownImage(cover.src, size.width)
  }
  if (!backdrop && newest && !newest.empty) {
    const posters = newest.docs
      .map((d: any) => d.data() || {})
      .sort((a: any, b: any) => String(b.start_datetime || '').localeCompare(String(a.start_datetime || '')))
      .map((e: any) => str(e.banner_image_url))
      .filter(Boolean)
    if (posters[0]) backdrop = await ownImage(posters[0], size.width)
  }
  const logo = await ownImage(str(brand?.organization_logo) || str(pub?.organization_logo), 220, { square: true })

  const fontDir = path.join(process.cwd(), 'assets', 'fonts')
  const [italic, regular] = await Promise.all([
    readFile(path.join(fontDir, 'InstrumentSerif-Italic.ttf')),
    readFile(path.join(fontDir, 'InstrumentSerif-Regular.ttf')),
  ])
  const fonts = [
    { name: 'Instrument', data: italic, style: 'italic' as const, weight: 400 as const },
    { name: 'Instrument', data: regular, style: 'normal' as const, weight: 400 as const },
  ]

  const titleSize = name.length > 34 ? 76 : name.length > 20 ? 92 : 112
  const line = [verified ? 'Verified organizer' : 'Organizer', eventCount > 0 ? `${eventCount}${eventCount >= 12 ? '+' : ''} events` : '']
    .filter(Boolean)
    .join('  ·  ')

  const png = new ImageResponse(
    (
      <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: CANVAS }}>
        {backdrop && (
          <img
            src={backdrop}
            width={size.width}
            height={size.height}
            style={{ position: 'absolute', top: 0, left: 0, width: size.width, height: size.height, objectFit: 'cover', opacity: 0.55 }}
            alt=""
          />
        )}
        {/* Bottom-weighted veil: the name always sits on near-black. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundImage: 'linear-gradient(180deg, rgba(10,10,10,0.15) 0%, rgba(10,10,10,0.7) 55%, rgba(10,10,10,0.96) 100%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            position: 'relative',
            width: '100%',
            height: '100%',
            padding: '64px 72px',
          }}
        >
          {logo && (
            <img
              src={logo}
              width={128}
              height={128}
              style={{ width: 128, height: 128, borderRadius: 4, border: `4px solid ${CANVAS}`, marginBottom: 28 }}
              alt=""
            />
          )}
          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument',
              fontSize: titleSize,
              lineHeight: 1.02,
              color: INK,
              lineClamp: 2,
            }}
          >
            {name}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22 }}>
            <div style={{ display: 'flex', fontSize: 28, color: MUTED, letterSpacing: 0.5 }}>{line}</div>
            <div style={{ display: 'flex', fontFamily: 'Instrument', fontStyle: 'italic', fontSize: 44, color: INK }}>tikèm</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  )

  try {
    const { default: sharp } = await import('sharp')
    const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
      .jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer()
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('organizer opengraph-image: JPEG re-encode failed, serving PNG', err)
    return png
  }
}
