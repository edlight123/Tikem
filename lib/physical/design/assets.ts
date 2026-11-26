/**
 * The organizer's art for a printed batch: fetched from where the design says
 * (our own bucket, or the event's poster), then toned per template with sharp:
 *
 *   halftone  coloured card: a 45° dot screen in black ink with alpha, so the
 *             card stock shows through (black-only print)
 *   ink       kraft: a sepia-brown ink with alpha (multiplies into the kraft)
 *   scrim     poster photo: full colour under a dark gradient for the type
 *
 * Logos come out as ink (black-only templates) or as they are.
 *
 * Server only. Never fetches an arbitrary URL: an object of our bucket, or
 * the event's own poster on an allow-listed image host.
 */

import { adminStorage } from '@/lib/firebase/admin'
import { storagePathFromUrl } from '@/lib/firebase/downloadUrl'
import type { PainterImage } from './painter'
import { PT_PER_UNIT } from './painter'
import type { BatchDesign, TemplateId } from './registry'
import { PHOTO_SPECS, logoMode, type PreparedLogo } from './templates'

const MAX_BYTES = 12 * 1024 * 1024
const POSTER_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com', 'images.unsplash.com'])

/** Uploads for printed tickets live here (public read, server write: storage.rules event-photos). */
export const printedUploadPrefix = (eventId: string) => `event-photos/${eventId}/printed/`

export function bucketName(): string {
  try {
    return String(adminStorage.bucket().name || '')
  } catch {
    return ''
  }
}

/** Is `url` a download link of an object under this event's printed-ticket folder? */
export function isOwnPrintedUpload(url: string, eventId: string, bucket = bucketName()): boolean {
  if (!url || !bucket || !eventId) return false
  const path = storagePathFromUrl(url, bucket)
  return !!path && path.startsWith(printedUploadPrefix(eventId)) && !path.includes('..')
}

const bytesCache = new Map<string, Buffer>()

/** The bytes behind a design image link; null when it cannot be read (the ticket prints without it). */
export async function loadImageBytes(url: string): Promise<Buffer | null> {
  if (!url) return null
  const hit = bytesCache.get(url)
  if (hit) return hit
  let buf: Buffer | null = null
  try {
    const bucket = bucketName()
    const path = bucket ? storagePathFromUrl(url, bucket) : null
    if (path) {
      const [data] = await adminStorage.bucket().file(path).download()
      buf = data
    } else {
      const u = new URL(url)
      if (u.protocol !== 'https:' || !POSTER_HOSTS.has(u.hostname)) return null
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      try {
        const res = await fetch(u.toString(), { signal: ctl.signal, redirect: 'error' })
        if (!res.ok) return null
        const ab = await res.arrayBuffer()
        if (ab.byteLength > MAX_BYTES) return null
        buf = Buffer.from(ab)
      } finally {
        clearTimeout(timer)
      }
    }
  } catch (err: any) {
    console.warn('[physical/design] image unavailable', { message: err?.message })
    return null
  }
  if (buf && buf.length <= MAX_BYTES) {
    if (bytesCache.size > 24) bytesCache.clear()
    bytesCache.set(url, buf)
    return buf
  }
  return null
}

const hexRgb = (hex: string) => {
  const p = parseInt(hex.slice(1), 16)
  return [(p >> 16) & 255, (p >> 8) & 255, p & 255]
}

/** sharp, lazily (it is native; only the routes that draw need it). */
async function loadSharp(): Promise<any> {
  const mod: any = await import('sharp')
  return mod.default || mod
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** Pixels per artboard unit at a print resolution. */
const pxPerUnit = (dpi: number) => (dpi / 72) * PT_PER_UNIT

/** Tone a photo for one template's box. */
export async function preparePhoto(buf: Buffer, template: TemplateId, dpi: number, key: string): Promise<PainterImage | null> {
  const spec = PHOTO_SPECS[template]
  if (!spec) return null
  const sharp = await loadSharp()
  const k = pxPerUnit(dpi)
  const w = Math.max(16, Math.round(spec.w * k))
  const h = Math.max(16, Math.round(spec.h * k))
  const base = sharp(buf, { failOn: 'none' })
    .rotate()
    .resize(w, h, { fit: 'cover', position: spec.focus === 'top' ? sharp.strategy.attention : 'centre' })

  if (spec.mode === 'scrim') {
    const scrim = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>` +
        `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#111111" stop-opacity="0.55"/>` +
        `<stop offset="0.16" stop-color="#111111" stop-opacity="0"/>` +
        `<stop offset="0.5" stop-color="#111111" stop-opacity="0.05"/>` +
        `<stop offset="0.82" stop-color="#111111" stop-opacity="0.85"/>` +
        `<stop offset="1" stop-color="#111111" stop-opacity="1"/>` +
        `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
    )
    const data = await base.composite([{ input: scrim }]).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
    return { key: `${key}:scrim:${dpi}`, data: new Uint8Array(data), format: 'JPEG' }
  }

  // Grey, more contrast (the approved designs: grayscale(1) contrast(1.3–1.35)).
  const gray = await base.clone().grayscale().normalise().linear(1.35, -0.35 * 128 + 8).raw().toBuffer({ resolveWithObject: true })
  const px = gray.data
  const ch = gray.info.channels
  const [r, g, b] = hexRgb(spec.ink || '#141414')
  const out = Buffer.alloc(w * h * 4)

  if (spec.mode === 'ink') {
    for (let i = 0; i < w * h; i++) {
      const d = 1 - px[i * ch] / 255
      out[i * 4] = r
      out[i * 4 + 1] = g
      out[i * 4 + 2] = b
      out[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, d * 0.95)) * 255)
    }
  } else {
    // 45° AM halftone, 6-unit pitch (the design's dot screen), dot area ∝ darkness,
    // plus a light continuous tone so faces keep their detail.
    const blurred = await base.clone().grayscale().normalise().linear(1.35, -0.35 * 128 + 8).blur(Math.max(0.6, 2 * k)).raw().toBuffer()
    const pitch = 6 * k
    const cos = Math.SQRT1_2
    const sin = Math.SQRT1_2
    const sample = (x: number, y: number) => {
      const xi = Math.min(w - 1, Math.max(0, Math.round(x)))
      const yi = Math.min(h - 1, Math.max(0, Math.round(y)))
      return 1 - blurred[(yi * w + xi) * ch] / 255
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Rotate into the screen grid, find the cell centre, rotate back.
        const u = x * cos + y * sin
        const v = -x * sin + y * cos
        const cu = (Math.floor(u / pitch) + 0.5) * pitch
        const cv = (Math.floor(v / pitch) + 0.5) * pitch
        const cx = cu * cos - cv * sin
        const cy = cu * sin + cv * cos
        const d = sample(cx, cy)
        // Never solid: a dark stage photo would print as a black slab on a
        // cybercafé laser. The darkest dot leaves the card showing between.
        const radius = pitch * 0.62 * Math.sqrt(Math.min(0.9, d))
        const dist = Math.hypot(u - cu, v - cv)
        const dot = Math.min(1, Math.max(0, radius - dist + 0.5))
        const tone = 1 - px[(y * w + x) * ch] / 255
        // The headline sits on the photo's foot (the approved design): fade
        // the screen out there so black type reads on the card.
        const yy = y / h
        const fade = yy < 0.5 ? 1 : 1 - 0.88 * smooth((yy - 0.5) / 0.5)
        const a = (1 - (1 - dot) * (1 - tone * 0.18)) * fade
        const i = (y * w + x) * 4
        out[i] = r
        out[i + 1] = g
        out[i + 2] = b
        out[i + 3] = Math.round(a * 255)
      }
    }
  }
  const data = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
  return { key: `${key}:${spec.mode}:${dpi}`, data: new Uint8Array(data), format: 'PNG' }
}

/** A logo sized for the sponsor strip (44 units high), as ink or as it is. */
export async function prepareLogo(buf: Buffer, mode: 'ink' | 'color', dpi: number, key: string): Promise<PreparedLogo | null> {
  try {
    const sharp = await loadSharp()
    const k = pxPerUnit(dpi)
    const resized = await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize({ height: Math.round(44 * k), width: Math.round(140 * k), fit: 'inside', withoutEnlargement: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const { width, height } = resized.info
    const src = resized.data
    let data: Buffer
    if (mode === 'ink') {
      const out = Buffer.alloc(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        const lum = (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255
        const a = (src[i * 4 + 3] / 255) * Math.min(1, (1 - lum) * 1.25)
        out[i * 4] = 20
        out[i * 4 + 1] = 20
        out[i * 4 + 2] = 20
        out[i * 4 + 3] = Math.round(a * 255)
      }
      data = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
    } else {
      data = await sharp(src, { raw: { width, height, channels: 4 } }).png().toBuffer()
    }
    return { img: { key: `${key}:logo:${mode}:${dpi}`, data: new Uint8Array(data), format: 'PNG' }, ratio: width / height }
  } catch (err: any) {
    console.warn('[physical/design] logo unusable', { message: err?.message })
    return null
  }
}

export interface DesignAssets {
  photo: PainterImage | null
  logos: PreparedLogo[]
}

/**
 * Everything a design draws besides text, for ONE template at `dpi`.
 * Unreadable images are skipped (logged): a broken logo must never stop a print.
 */
export async function prepareDesignAssets(design: Pick<BatchDesign, 'template' | 'photo_url' | 'logos'>, dpi: number): Promise<DesignAssets> {
  const photoBuf = design.photo_url && PHOTO_SPECS[design.template] ? await loadImageBytes(design.photo_url) : null
  const photo = photoBuf ? await preparePhoto(photoBuf, design.template, dpi, design.photo_url!).catch(() => null) : null
  const logos: PreparedLogo[] = []
  for (const url of design.logos || []) {
    const buf = await loadImageBytes(url)
    const l = buf ? await prepareLogo(buf, logoMode(design.template), dpi, url) : null
    if (l) logos.push(l)
  }
  return { photo, logos }
}
