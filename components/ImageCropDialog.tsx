'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useDialogFocus } from '@/lib/a11y/useDialogFocus'
import { color } from '@/lib/design/tokens'
import {
  clampCrop,
  coverScale,
  cropRect,
  fitFrame,
  INITIAL_CROP,
  MAX_ZOOM,
  outputSize,
  POSTER_ASPECT,
  SQUARE_ASPECT,
  zoomAt,
  type CropState,
  type Size,
} from '@/lib/imageCrop'

/**
 * Frame an uploaded image before it goes up: a fixed 4:5 window for a flyer
 * (1:1 for a logo or a profile photo). Drag to move; zoom with the - / +
 * buttons, the slider, the mouse wheel or a trackpad pinch (two fingers on a
 * touch screen too). The image always covers the frame (lib/imageCrop clamps
 * zoom and pan), so the export can never carry an empty band.
 *
 * Keyboard: the frame is focusable; arrows move the image (Shift for bigger
 * steps), + / - zoom, 0 resets. Escape cancels (useDialogFocus).
 *
 * Done draws the framed slice onto a canvas (1280x1600 at most for a flyer,
 * 800x800 for a logo or photo, never upscaled past the source slice) and hands
 * back a JPEG File; the caller uploads it exactly as before. If the browser
 * cannot decode the file (HEIC outside Safari), `onUnsupported` fires so the
 * caller can upload the original as it always has.
 *
 * Ported from Tikra (efdf8259), restyled to the Tikèm tokens: 4px corners,
 * 40px controls, the text ladder.
 */

const PAN_STEP = 12
const PAN_STEP_BIG = 60
const ZOOM_STEP = 1.2

export default function ImageCropDialog({
  file,
  aspect = POSTER_ASPECT,
  onCancel,
  onDone,
  onUnsupported,
}: {
  file: File
  /** width / height: 4/5 for a flyer, 1 for a logo or photo. */
  aspect?: number
  onCancel: () => void
  onDone: (cropped: File) => void
  onUnsupported: () => void
}) {
  const { t } = useTranslation('common')
  const dialogRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameElRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const [src, setSrc] = useState<string | null>(null)
  const [image, setImage] = useState<Size | null>(null)
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 })
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)

  useDialogFocus(dialogRef, true, { onEscape: onCancel, initialFocus: frameElRef })

  // The page behind stays put while the dialog is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Decode the picked file. A format the browser can't draw falls back.
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    let live = true
    img.onload = () => {
      if (!live) return
      if (!img.naturalWidth || !img.naturalHeight) return onUnsupported()
      imgRef.current = img
      setImage({ width: img.naturalWidth, height: img.naturalHeight })
      setSrc(url)
    }
    img.onerror = () => live && onUnsupported()
    img.src = url
    return () => {
      live = false
      URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // The frame is the largest box of the aspect that fits the stage, with a
  // margin so the dimmed rest of the photo shows around it.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frame = fitFrame(aspect, {
    width: Math.max(0, stage.width - 48),
    height: Math.max(0, stage.height - 48),
  })
  const ready = !!image && frame.width > 0

  // The frame only mounts once the photo has decoded, after useDialogFocus has
  // already placed focus (on the close button): move it to the frame so the
  // arrow keys work straight away.
  useEffect(() => {
    if (ready) frameElRef.current?.focus({ preventScroll: true })
  }, [ready])

  // Keep the latest values for the native listeners below.
  const live = useRef({ image, frame, crop })
  live.current = { image, frame, crop }

  const apply = useCallback((next: (s: CropState, img: Size, fr: Size) => CropState) => {
    const { image: img, frame: fr } = live.current
    if (!img || !fr.width) return
    setCrop((s) => next(s, img, fr))
  }, [])

  const zoomTo = useCallback(
    (z: number, focal?: { x: number; y: number }) => apply((s, img, fr) => zoomAt(img, fr, s, z, focal)),
    [apply]
  )

  // Re-clamp when the frame changes size (window resize, rotation).
  useEffect(() => {
    if (image && frame.width) setCrop((s) => clampCrop(image, frame, s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, frame.width, frame.height])

  /** A client point, relative to the frame centre. */
  const toFocal = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
  }

  // ── Pointer: one pointer pans, two pinch (touch screens) ──
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; zoom: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready || saving) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: live.current.crop.zoom }
    }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (gesture.current.dist > 0) {
        zoomTo(gesture.current.zoom * (dist / gesture.current.dist), toFocal((a.x + b.x) / 2, (a.y + b.y) / 2))
      }
      return
    }
    const dx = cur.x - prev.x
    const dy = cur.y - prev.y
    apply((s, img, fr) => clampCrop(img, fr, { ...s, x: s.x + dx, y: s.y + dy }))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) gesture.current = null
    if (pointers.current.size === 0) setDragging(false)
  }

  // ── Wheel and trackpad pinch (non-passive, so the page doesn't scroll) ──
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { crop: s } = live.current
      // A trackpad pinch arrives as a ctrl+wheel with small deltas.
      const k = e.ctrlKey ? 0.01 : 0.0025
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomTo(s.zoom * Math.exp(-delta * k), toFocal(e.clientX, e.clientY))
    }
    // Safari reports a trackpad pinch as gesture events instead.
    let startZoom = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      startZoom = live.current.crop.zoom
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number }
      if (typeof g.scale === 'number') {
        zoomTo(startZoom * g.scale, g.clientX != null ? toFocal(g.clientX, g.clientY!) : undefined)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [zoomTo])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? PAN_STEP_BIG : PAN_STEP
    const pan = (dx: number, dy: number) =>
      apply((s, img, fr) => clampCrop(img, fr, { ...s, x: s.x + dx, y: s.y + dy }))
    switch (e.key) {
      case 'ArrowLeft':
        pan(-step, 0)
        break
      case 'ArrowRight':
        pan(step, 0)
        break
      case 'ArrowUp':
        pan(0, -step)
        break
      case 'ArrowDown':
        pan(0, step)
        break
      case '+':
      case '=':
        zoomTo(crop.zoom * ZOOM_STEP)
        break
      case '-':
      case '_':
        zoomTo(crop.zoom / ZOOM_STEP)
        break
      case '0':
        setCrop(INITIAL_CROP)
        break
      default:
        return
    }
    e.preventDefault()
  }

  async function confirm() {
    const img = imgRef.current
    if (!img || !image || !frame.width || saving) return
    setSaving(true)
    try {
      const r = cropRect(image, frame, crop)
      const out = outputSize(aspect, r)
      const canvas = document.createElement('canvas')
      canvas.width = out.width
      canvas.height = out.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      // JPEG has no alpha: a transparent PNG logo sits on white, not black.
      ctx.fillStyle = color.inverse.DEFAULT
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, r.originX, r.originY, r.width, r.height, 0, 0, out.width, out.height)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
      if (!blob) throw new Error('export failed')
      const base = (file.name || 'image').replace(/\.[^.]+$/, '')
      onDone(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }))
    } catch {
      setSaving(false)
      onUnsupported()
    }
  }

  // Where the image sits: centred on the frame (= the stage centre), moved by
  // the offset, scaled by cover * zoom.
  const k = image && frame.width ? coverScale(image, frame) * crop.zoom : 1
  const imgStyle: React.CSSProperties | undefined = image
    ? {
        width: image.width,
        height: image.height,
        transform: `translate(${stage.width / 2 - image.width / 2 + crop.x}px, ${stage.height / 2 - image.height / 2 + crop.y}px) scale(${k})`,
        transformOrigin: 'center center',
        transition: dragging ? 'none' : 'transform 90ms ease-out',
      }
    : undefined

  const title =
    aspect === SQUARE_ASPECT
      ? t('upload.crop.titleSquare', { defaultValue: 'Frame your image' })
      : t('upload.crop.titlePoster', { defaultValue: 'Frame your flyer' })
  const zoomPct = Math.round(((crop.zoom - 1) / (MAX_ZOOM - 1)) * 100)

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-scrim-strong backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-crop-title"
        className="flex max-h-[100svh] w-full max-w-lg flex-col overflow-hidden rounded-t bg-canvas text-fg shadow-2xl sm:rounded"
      >
        <div className="flex items-center justify-between gap-3 py-1 pl-4 pr-1">
          <h2 id="image-crop-title" className="text-body font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('upload.crop.cancel', { defaultValue: 'Cancel' })}
            className="grid h-10 w-10 place-items-center rounded text-fg-muted transition-colors hover:bg-surface hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Stage: the photo, dimmed outside the frame, clipped to the stage. */}
        <div
          ref={stageRef}
          className={`relative h-[min(58svh,520px)] w-full touch-none select-none overflow-hidden ${ready ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && imgStyle && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={imgStyle}
            />
          )}
          {!ready && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-fg" />
            </div>
          )}
          {ready && (
            <div
              ref={frameElRef}
              tabIndex={0}
              role="group"
              aria-label={t('upload.crop.frameLabel', {
                defaultValue: 'Crop area. Arrow keys move the image; plus and minus zoom.',
              })}
              aria-describedby="image-crop-hint"
              onKeyDown={onKeyDown}
              // Its own white ring when focused: the site's teal outline would
              // fight the photo and box the frame twice.
              className="absolute left-1/2 top-1/2 rounded ring-1 ring-fg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg"
              style={{
                width: frame.width,
                height: frame.height,
                transform: 'translate(-50%, -50%)',
                // Everything outside the frame is dimmed.
                boxShadow: `0 0 0 9999px ${color.scrim.DEFAULT}`,
              }}
            >
              {/* Thirds grid, only while moving. */}
              <div
                aria-hidden
                className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${dragging ? 'opacity-100' : 'opacity-0'}`}
              >
                <div className="absolute inset-y-0 left-1/3 w-px bg-fg/35" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-fg/35" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-fg/35" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-fg/35" />
              </div>
            </div>
          )}
        </div>

        <p id="image-crop-hint" className="px-4 pt-3 text-center text-caption text-fg-subtle">
          {t('upload.crop.hint', { defaultValue: 'Drag to move · scroll, pinch or use the slider to zoom' })}
        </p>

        {/* Zoom: - / slider / + and reset. */}
        <div className="flex items-center gap-2 px-3 pt-1">
          <button
            type="button"
            onClick={() => zoomTo(crop.zoom / ZOOM_STEP)}
            disabled={!ready || crop.zoom <= 1}
            aria-label={t('upload.crop.zoomOut', { defaultValue: 'Zoom out' })}
            className="grid h-10 w-10 shrink-0 place-items-center rounded text-fg-soft transition-colors hover:bg-surface hover:text-fg disabled:opacity-35"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={!ready}
            onChange={(e) => zoomTo(parseFloat(e.target.value))}
            aria-label={t('upload.crop.zoom', { defaultValue: 'Zoom' })}
            aria-valuetext={`${zoomPct}%`}
            className="h-1 w-full cursor-pointer accent-fg"
          />
          <button
            type="button"
            onClick={() => zoomTo(crop.zoom * ZOOM_STEP)}
            disabled={!ready || crop.zoom >= MAX_ZOOM}
            aria-label={t('upload.crop.zoomIn', { defaultValue: 'Zoom in' })}
            className="grid h-10 w-10 shrink-0 place-items-center rounded text-fg-soft transition-colors hover:bg-surface hover:text-fg disabled:opacity-35"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setCrop(INITIAL_CROP)}
            disabled={!ready || (crop.zoom === 1 && crop.x === 0 && crop.y === 0)}
            aria-label={t('upload.crop.reset', { defaultValue: 'Reset' })}
            title={t('upload.crop.reset', { defaultValue: 'Reset' })}
            className="grid h-10 w-10 shrink-0 place-items-center rounded text-fg-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-35"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 flex-1 rounded bg-surface text-sm font-semibold text-fg-soft transition-colors hover:bg-surface-raised hover:text-fg"
          >
            {t('upload.crop.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready || saving}
            className="h-10 flex-1 rounded bg-inverse text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-50"
          >
            {saving
              ? t('upload.crop.preparing', { defaultValue: 'Preparing…' })
              : t('upload.crop.done', { defaultValue: 'Done' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * A photo straight off a phone is often over the 5MB upload cap, but the crop
 * exports a small JPEG well under it, so a larger original is fine when it is
 * going through the cropper.
 */
export const CROP_SOURCE_MAX_BYTES = 25 * 1024 * 1024

/**
 * Worth framing: a still image the canvas can redraw, small enough to decode.
 * A GIF is left alone (the canvas would flatten its animation).
 */
export function isFrameable(file: File): boolean {
  return (
    /^image\//.test(file.type) &&
    file.type !== 'image/gif' &&
    file.type !== 'image/svg+xml' &&
    file.size <= CROP_SOURCE_MAX_BYTES
  )
}

/**
 * Frame a picked file before an existing upload handler sees it. For forms
 * that own their own <input type="file"> (organization logo, profile photo):
 *
 *   const framer = useImageFramer(SQUARE_ASPECT, uploadLogo)
 *   <input onChange={framer.onInputChange} ... />
 *   {framer.dialog}
 *
 * `onFile` receives the cropped JPEG, or the original when the file is not
 * framed (a GIF, not an image, too big to decode, or a format the browser
 * can't draw) so the handler's own checks still run on it. Cancel uploads
 * nothing.
 */
export function useImageFramer(
  aspect: number,
  onFile: (file: File, info: { cropped: boolean }) => void | Promise<void>
): {
  open: (file: File) => void
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  dialog: ReactNode
} {
  const [file, setFile] = useState<File | null>(null)
  const onFileRef = useRef(onFile)
  onFileRef.current = onFile

  const open = useCallback((f: File) => {
    if (!isFrameable(f)) {
      void onFileRef.current(f, { cropped: false })
      return
    }
    setFile(f)
  }, [])

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      // Picking the same file again after a cancel must fire onChange again.
      e.target.value = ''
      if (f) open(f)
    },
    [open]
  )

  const dialog = file ? (
    <ImageCropDialog
      file={file}
      aspect={aspect}
      onCancel={() => setFile(null)}
      onUnsupported={() => {
        setFile(null)
        void onFileRef.current(file, { cropped: false })
      }}
      onDone={(cropped) => {
        setFile(null)
        void onFileRef.current(cropped, { cropped: true })
      }}
    />
  ) : null

  return { open, onInputChange, dialog }
}
