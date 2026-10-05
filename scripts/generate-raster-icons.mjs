// Rasterize the Tikèm mark into the PNG/ICO files browsers and iOS still ask
// for by fixed name: /favicon.ico (16/32/48, PNG-in-ICO) and a 180x180
// /apple-touch-icon.png (iOS ignores SVG touch icons). Source: the opaque
// tile, public/tikem-mark.svg. Re-run after changing the mark:
//   node scripts/generate-raster-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const svg = readFileSync(path.join(pub, 'tikem-mark.svg'))
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()

writeFileSync(path.join(pub, 'apple-touch-icon.png'), await png(180))

// ICO container holding PNG images (supported by every browser since IE Vista).
const sizes = [16, 32, 48]
const images = await Promise.all(sizes.map(png))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
const dir = Buffer.alloc(16 * sizes.length)
let offset = header.length + dir.length
sizes.forEach((size, i) => {
  const o = i * 16
  dir.writeUInt8(size, o) // width
  dir.writeUInt8(size, o + 1) // height
  dir.writeUInt8(0, o + 2) // palette
  dir.writeUInt8(0, o + 3) // reserved
  dir.writeUInt16LE(1, o + 4) // color planes
  dir.writeUInt16LE(32, o + 6) // bits per pixel
  dir.writeUInt32LE(images[i].length, o + 8)
  dir.writeUInt32LE(offset, o + 12)
  offset += images[i].length
})
writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([header, dir, ...images]))
console.log('Wrote public/apple-touch-icon.png and public/favicon.ico')
