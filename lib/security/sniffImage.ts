/**
 * Identify a raster image from its magic bytes. The browser-declared MIME and
 * the file name are attacker-chosen; the bytes are what a viewer will actually
 * render, so the stored content type and extension come from here.
 *
 * SVG is deliberately absent: it is a document that can carry script.
 */
export type SniffedImage = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; ext: string }

export function sniffRasterImage(buf: Buffer): SniffedImage | null {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return { mime: 'image/gif', ext: 'gif' }
  return null
}
