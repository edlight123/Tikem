/**
 * Crop math for the 4:5 poster cropper (and the 1:1 logo cropper).
 *
 * Ported from Tikra (efdf8259). Shared by the web crop dialog
 * (components/ImageCropDialog.tsx) and the app's crop screen
 * (mobile/components/ImageCropModal.tsx). The app cannot import
 * from here (separate bundle), so mobile/lib/imageCrop.ts is a byte-identical
 * copy; __tests__/image-crop.test.ts fails if they drift. This file is the
 * source of truth: edit it, then copy it over the mobile one.
 *
 * Every function is pure and carries a 'worklet' directive so the app can call
 * it on the UI thread from a gesture (Reanimated). The directive is a plain
 * string statement everywhere else.
 *
 * Model. The frame is a fixed box (the crop window, in screen pixels). The image
 * is centred in it and scaled by `cover * zoom`, where `cover` is the smallest
 * scale at which the image covers the whole frame and `zoom` >= 1. It is then
 * moved by (x, y): the offset of the image centre from the frame centre, in
 * screen pixels. Clamping zoom and offset keeps the image always covering the
 * frame, so no empty band can ever reach the output.
 */

export interface Size {
  width: number
  height: number
}

export interface CropState {
  /** 1 = the image just covers the frame; MAX_ZOOM = closest. */
  zoom: number
  /** Image centre minus frame centre, in frame (screen) pixels. */
  x: number
  y: number
}

export interface CropRect {
  /** In source-image pixels. */
  originX: number
  originY: number
  width: number
  height: number
}

/** Posters are 4:5 portrait (width / height). */
export const POSTER_ASPECT = 4 / 5
/** Logos are square. */
export const SQUARE_ASPECT = 1
/** Closest zoom, relative to "just covers the frame". */
export const MAX_ZOOM = 5
/** Longest output side for a flyer: 1280x1600 at 4:5. */
export const POSTER_LONG_SIDE = 1600
/** Longest output side for a logo or profile photo: 800x800. */
export const LOGO_LONG_SIDE = 800

export const INITIAL_CROP: CropState = { zoom: 1, x: 0, y: 0 }

/** The smallest scale at which the image covers the frame on both axes. */
export function coverScale(image: Size, frame: Size): number {
  'worklet'
  if (!(image.width > 0) || !(image.height > 0)) return 1
  return Math.max(frame.width / image.width, frame.height / image.height)
}

/** Zoom kept within [1, MAX_ZOOM]; anything not a number resets to 1. */
export function clampZoom(zoom: number, max: number = MAX_ZOOM): number {
  'worklet'
  if (!Number.isFinite(zoom)) return 1
  return Math.min(Math.max(zoom, 1), Math.max(max, 1))
}

/** How far the image centre may move from the frame centre at this zoom, per axis. */
export function maxOffset(image: Size, frame: Size, zoom: number): { x: number; y: number } {
  'worklet'
  const k = coverScale(image, frame) * clampZoom(zoom)
  return {
    x: Math.max(0, (image.width * k - frame.width) / 2),
    y: Math.max(0, (image.height * k - frame.height) / 2),
  }
}

/** One offset kept within +/- limit (a non-number collapses to 0). */
export function clampAxis(value: number, limit: number): number {
  'worklet'
  if (!Number.isFinite(value)) return 0
  // `+ 0` turns -0 into 0.
  return Math.min(Math.max(value, -limit), limit) + 0
}

/** Zoom and offset clamped so the image always covers the frame. */
export function clampCrop(image: Size, frame: Size, state: CropState): CropState {
  'worklet'
  const zoom = clampZoom(state.zoom)
  const lim = maxOffset(image, frame, zoom)
  return { zoom, x: clampAxis(state.x, lim.x), y: clampAxis(state.y, lim.y) }
}

/**
 * Zoom to `nextZoom` keeping the image point under `focal` still (a pinch
 * centre, the cursor under a wheel, or the frame centre for the buttons).
 * `focal` is relative to the frame centre, in frame pixels. Clamped.
 */
export function zoomAt(
  image: Size,
  frame: Size,
  state: CropState,
  nextZoom: number,
  focal: { x: number; y: number } = { x: 0, y: 0 }
): CropState {
  'worklet'
  const from = clampZoom(state.zoom)
  const to = clampZoom(nextZoom)
  const r = to / from
  return clampCrop(image, frame, {
    zoom: to,
    x: focal.x - (focal.x - state.x) * r,
    y: focal.y - (focal.y - state.y) * r,
  })
}

/**
 * The part of the source image inside the frame, in source pixels. Rounded to
 * whole pixels and kept inside the image, with the frame's aspect preserved to
 * within a pixel.
 */
export function cropRect(image: Size, frame: Size, state: CropState): CropRect {
  'worklet'
  const s = clampCrop(image, frame, state)
  const k = coverScale(image, frame) * s.zoom
  const w = Math.min(image.width, frame.width / k)
  const h = Math.min(image.height, frame.height / k)
  // Frame centre, in image pixels.
  const cx = image.width / 2 - s.x / k
  const cy = image.height / 2 - s.y / k
  const width = Math.max(1, Math.round(w))
  const height = Math.max(1, Math.round(h))
  const originX = Math.min(Math.max(0, Math.round(cx - w / 2)), Math.max(0, image.width - width))
  const originY = Math.min(Math.max(0, Math.round(cy - h / 2)), Math.max(0, image.height - height))
  return { originX, originY, width, height }
}

/** The default longest output side for an aspect: 1600 for a flyer, 800 for a square logo. */
export function defaultLongSide(aspect: number): number {
  'worklet'
  return aspect === SQUARE_ASPECT ? LOGO_LONG_SIDE : POSTER_LONG_SIDE
}

/**
 * Output size for an aspect (width / height): the longest side is `longSide`
 * (1600 for a flyer, 800 for a logo), never more than the slice actually cut
 * from the source (`source`, from cropRect), so a small photo is not blown up
 * into a bigger, blurrier file. The aspect is kept exactly.
 */
export function outputSize(aspect: number, source?: Size | null, longSide?: number): Size {
  'worklet'
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : POSTER_ASPECT
  let long = longSide && longSide > 0 ? longSide : defaultLongSide(a)
  if (source && source.width > 0 && source.height > 0) {
    long = Math.min(long, Math.max(source.width, source.height))
  }
  long = Math.max(1, Math.round(long))
  if (a <= 1) return { width: Math.max(1, Math.round(long * a)), height: long }
  return { width: long, height: Math.max(1, Math.round(long / a)) }
}

/**
 * The largest frame of this aspect that fits a box (the screen area left for
 * the crop window), for laying the frame out.
 */
export function fitFrame(aspect: number, box: Size): Size {
  'worklet'
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : POSTER_ASPECT
  const width = Math.min(box.width, box.height * a)
  return { width, height: width / a }
}
