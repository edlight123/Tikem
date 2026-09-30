#!/usr/bin/env node
/**
 * Regenerates the Play Store graphics from mobile/assets:
 *   store/google-play/icon-512.png                (512x512, 32-bit PNG)
 *   store/google-play/feature-graphic-1024x500.png (1024x500, 24-bit PNG, no alpha)
 *
 *   node store/google-play/make-graphics.mjs
 *
 * POSH direction: black frame, the posters are the only colour, teal as a single accent.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const A = (p) => path.join(ROOT, 'mobile', 'assets', p)
const OUT = (p) => path.join(ROOT, 'store', 'google-play', p)
const CANVAS = '#0A0A0A'

// ---- icon: the app icon, resized. Play composites its own mask, so keep it square. ----
await sharp(A('icon.png')).resize(512, 512, { kernel: 'lanczos3' }).png().toFile(OUT('icon-512.png'))

// ---- feature graphic ----
const W = 1024
const H = 500

// Wordmark: crop the serif "tikèm" out of the splash art (1456x560, black background).
const wordmark = await sharp(A('splash-icon.png'))
  .extract({ left: 395, top: 90, width: 670, height: 260 })
  .resize({ width: 420 })
  .png()
  .toBuffer()
const wm = await sharp(wordmark).metadata()

// Poster rail: portrait 2:3 cards with a 20px-radius mask, like the in-app rails.
const CARD_W = 168
const CARD_H = 252
const R = 18
const mask = Buffer.from(
  `<svg width="${CARD_W}" height="${CARD_H}"><rect width="${CARD_W}" height="${CARD_H}" rx="${R}" ry="${R}" fill="#fff"/></svg>`,
)
async function card(file) {
  const img = await sharp(A(`art/${file}`)).resize(CARD_W, CARD_H, { fit: 'cover', position: 'attention' }).png().toBuffer()
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}
const files = ['art1.jpg', 'art3.jpg', 'art5.jpg', 'art2.jpg']
const cards = await Promise.all(files.map(card))

// Staggered rail on the right half; the last card bleeds off the edge to imply more.
const railX = 488
const gap = 14
const tops = [150, 96, 124, 70]
const composites = cards.map((input, i) => ({ input, left: railX + i * (CARD_W + gap), top: tops[i] }))

// Copy block on the left. Bold grotesk (Helvetica Neue on macOS), white + grey tiers.
const copy = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${CANVAS}" stop-opacity="0"/>
      <stop offset="1" stop-color="${CANVAS}" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="fadeLeft" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${CANVAS}" stop-opacity="1"/>
      <stop offset="1" stop-color="${CANVAS}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="${W - 90}" y="0" width="90" height="${H}" fill="url(#fade)"/>
  <rect x="${railX - 6}" y="0" width="40" height="${H}" fill="url(#fadeLeft)"/>
  <text x="72" y="300" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="34" fill="#FFFFFF" letter-spacing="-0.5">Haiti &amp; the diaspora, live.</text>
  <text x="72" y="342" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="500" font-size="21" fill="#8A8A8A">Concerts · konpa · festivals · culture</text>
  <circle cx="80" cy="386" r="6" fill="#2FD6C1"/>
  <text x="96" y="393" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="500" font-size="18" fill="#8A8A8A">Tickets in the app, QR at the door</text>
</svg>`)

await sharp({ create: { width: W, height: H, channels: 3, background: CANVAS } })
  .composite([
    ...composites,
    { input: copy, left: 0, top: 0 },
    { input: wordmark, left: 56, top: 250 - wm.height - 18 },
  ])
  .removeAlpha()
  .png()
  .toFile(OUT('feature-graphic-1024x500.png'))

console.log('wrote', OUT('icon-512.png'), 'and', OUT('feature-graphic-1024x500.png'))
