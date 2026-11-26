/**
 * The 4:5 poster cropper's math (lib/imageCrop.ts, copied byte for byte to
 * mobile/lib/imageCrop.ts for the app's crop screen).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  clampCrop,
  clampZoom,
  defaultLongSide,
  LOGO_LONG_SIDE,
  POSTER_LONG_SIDE,
  SQUARE_ASPECT,
  coverScale,
  cropRect,
  fitFrame,
  maxOffset,
  MAX_ZOOM,
  outputSize,
  POSTER_ASPECT,
  zoomAt,
} from '@/lib/imageCrop'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

// A landscape phone photo in a 4:5 frame 400x500 on screen.
const photo = { width: 4000, height: 3000 }
const frame = { width: 400, height: 500 }

describe('image crop math', () => {
  it('ships the same source to the app', () => {
    expect(read('mobile/lib/imageCrop.ts')).toBe(read('lib/imageCrop.ts'))
  })

  it('covers the frame at zoom 1 on the tighter axis', () => {
    // 500/3000 > 400/4000: height decides.
    expect(coverScale(photo, frame)).toBeCloseTo(500 / 3000)
    expect(coverScale({ width: 0, height: 10 }, frame)).toBe(1)
  })

  it('clamps zoom to [1, MAX_ZOOM]', () => {
    expect(clampZoom(0.2)).toBe(1)
    expect(clampZoom(3)).toBe(3)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(NaN)).toBe(1)
  })

  it('allows panning only along the overflowing axis at zoom 1', () => {
    const lim = maxOffset(photo, frame, 1)
    // Displayed 666.67 x 500 in a 400 x 500 frame.
    expect(lim.x).toBeCloseTo((4000 * (500 / 3000) - 400) / 2)
    expect(lim.y).toBe(0)
  })

  it('clamps the pan so the image always covers the frame', () => {
    const s = clampCrop(photo, frame, { zoom: 1, x: 10_000, y: -50 })
    expect(s.x).toBeCloseTo(maxOffset(photo, frame, 1).x)
    expect(s.y).toBe(0)
    expect(clampCrop(photo, frame, { zoom: 0.5, x: NaN, y: 0 })).toEqual({ zoom: 1, x: 0, y: 0 })
  })

  it('crops the centred 4:5 slice at rest', () => {
    const r = cropRect(photo, frame, { zoom: 1, x: 0, y: 0 })
    expect(r).toEqual({ originX: 800, originY: 0, width: 2400, height: 3000 })
    expect(r.width / r.height).toBeCloseTo(POSTER_ASPECT)
  })

  it('follows a pan to the far edge', () => {
    // Image moved right as far as it goes: the photo's left edge shows.
    expect(cropRect(photo, frame, { zoom: 1, x: 10_000, y: 0 }).originX).toBe(0)
    const l = cropRect(photo, frame, { zoom: 1, x: -10_000, y: 0 })
    expect(l.originX + l.width).toBe(photo.width)
  })

  it('narrows the slice as you zoom in, staying inside the image', () => {
    expect(cropRect(photo, frame, { zoom: 2, x: 0, y: 0 })).toEqual({
      originX: 1400,
      originY: 750,
      width: 1200,
      height: 1500,
    })
    for (const z of [1, 1.37, 2.5, MAX_ZOOM]) {
      for (const x of [-9999, -40, 0, 33, 9999]) {
        for (const y of [-9999, 0, 9999]) {
          const c = cropRect(photo, frame, { zoom: z, x, y })
          expect(c.originX).toBeGreaterThanOrEqual(0)
          expect(c.originY).toBeGreaterThanOrEqual(0)
          expect(c.originX + c.width).toBeLessThanOrEqual(photo.width)
          expect(c.originY + c.height).toBeLessThanOrEqual(photo.height)
          expect(Math.abs(c.width / c.height - POSTER_ASPECT)).toBeLessThan(0.01)
        }
      }
    }
  })

  it('handles a tall image (pan on y only)', () => {
    const tall = { width: 1000, height: 3000 }
    const lim = maxOffset(tall, frame, 1)
    expect(lim.x).toBe(0)
    expect(lim.y).toBeGreaterThan(0)
    expect(cropRect(tall, frame, { zoom: 1, x: 0, y: 0 })).toEqual({
      originX: 0,
      originY: 875,
      width: 1000,
      height: 1250,
    })
  })

  it('keeps the point under the pinch still when zooming', () => {
    const start = { zoom: 1, x: 0, y: 0 }
    const focal = { x: 100, y: 50 }
    const next = zoomAt(photo, frame, start, 2, focal)
    expect(next.zoom).toBe(2)
    // The image pixel under the focal point, before and after.
    const k1 = coverScale(photo, frame)
    const k2 = coverScale(photo, frame) * 2
    expect((focal.x - next.x) / k2).toBeCloseTo((focal.x - start.x) / k1)
    expect((focal.y - next.y) / k2).toBeCloseTo((focal.y - start.y) / k1)
  })

  it('re-clamps the pan when zooming back out', () => {
    const out = zoomAt(photo, frame, { zoom: 3, x: 500, y: 400 }, 1)
    expect(out.zoom).toBe(1)
    expect(Math.abs(out.x)).toBeLessThanOrEqual(maxOffset(photo, frame, 1).x + 1e-9)
    expect(out.y).toBe(0)
  })

  it('outputs 1280x1600 for a flyer and 800x800 for a logo', () => {
    expect(outputSize(POSTER_ASPECT)).toEqual({ width: 1280, height: 1600 })
    expect(outputSize(SQUARE_ASPECT)).toEqual({ width: 800, height: 800 })
    expect(outputSize(0)).toEqual({ width: 1280, height: 1600 })
    expect(defaultLongSide(POSTER_ASPECT)).toBe(POSTER_LONG_SIDE)
    expect(defaultLongSide(SQUARE_ASPECT)).toBe(LOGO_LONG_SIDE)
  })

  it('never upscales past the slice cut from the source', () => {
    // A 600x750 slice of a small photo stays 600x750, not 1280x1600.
    expect(outputSize(POSTER_ASPECT, { width: 600, height: 750 })).toEqual({ width: 600, height: 750 })
    // A big slice is capped at the long side.
    expect(outputSize(POSTER_ASPECT, { width: 2400, height: 3000 })).toEqual({ width: 1280, height: 1600 })
    expect(outputSize(SQUARE_ASPECT, { width: 3000, height: 3000 })).toEqual({ width: 800, height: 800 })
    expect(outputSize(SQUARE_ASPECT, { width: 320, height: 320 })).toEqual({ width: 320, height: 320 })
    // A landscape aspect puts the long side on the width.
    expect(outputSize(16 / 9, null, 1600)).toEqual({ width: 1600, height: 900 })
  })

  it('sizes the real crop of a phone photo end to end', () => {
    const r = cropRect(photo, frame, { zoom: 1, x: 0, y: 0 })
    expect(outputSize(POSTER_ASPECT, r)).toEqual({ width: 1280, height: 1600 })
    // Zoomed right in, the slice is 480x600 source pixels: kept at that size.
    const close = cropRect(photo, frame, { zoom: MAX_ZOOM, x: 0, y: 0 })
    expect(outputSize(POSTER_ASPECT, close)).toEqual({ width: close.width, height: close.height })
  })

  it('fits the largest frame of the aspect in a box', () => {
    expect(fitFrame(POSTER_ASPECT, { width: 390, height: 600 })).toEqual({ width: 390, height: 487.5 })
    expect(fitFrame(POSTER_ASPECT, { width: 800, height: 500 })).toEqual({ width: 400, height: 500 })
  })
})
