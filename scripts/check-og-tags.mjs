// Inspect the Open Graph / Twitter card a URL actually serves, the way a social
// scraper sees it — then fetch the image and report what the scraper would get.
//
//   node scripts/check-og-tags.mjs https://www.tikem.co/events/<id>
//
// Exists because "the link preview has no picture" has several unrelated causes
// and they are indistinguishable by eye: a missing tag, undeclared dimensions
// (WhatsApp will not download an image to measure it), an image too large, an
// image the crawler cannot reach, or a portrait image that a landscape card
// crops to nothing. This prints all of them at once.

const url = process.argv[2]
if (!url) {
  console.error('usage: node scripts/check-og-tags.mjs <url>')
  process.exit(1)
}

const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
const html = await res.text()
console.log(`page: ${res.status} ${res.redirected ? `(followed redirect → ${res.url})` : ''}`)

const tags = {}
for (const m of html.matchAll(/<meta[^>]+(?:property|name)="((?:og|twitter):[^"]+)"[^>]*content="([^"]*)"[^>]*>/g)) {
  tags[m[1]] = m[2].replace(/&amp;/g, '&')
}
// Some renderers emit content= before property=.
for (const m of html.matchAll(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="((?:og|twitter):[^"]+)"[^>]*>/g)) {
  if (!tags[m[2]]) tags[m[2]] = m[1].replace(/&amp;/g, '&')
}

const REQUIRED = ['og:title', 'og:description', 'og:image', 'og:image:width', 'og:image:height', 'og:url', 'og:type']
const NICE = ['og:image:alt', 'og:site_name', 'twitter:card', 'twitter:image']

console.log('\n-- required --')
let missing = 0
for (const k of REQUIRED) {
  const v = tags[k]
  if (!v) missing++
  console.log(`${v ? 'ok  ' : 'MISS'} ${k.padEnd(20)} ${v ? v.slice(0, 90) : ''}`)
}
console.log('\n-- optional --')
for (const k of NICE) {
  const v = tags[k]
  console.log(`${v ? 'ok  ' : '--  '} ${k.padEnd(20)} ${v ? v.slice(0, 90) : ''}`)
}

const img = tags['og:image']
if (!img) {
  console.log('\nNo og:image — nothing else to check.')
  process.exit(missing ? 1 : 0)
}

console.log('\n-- image as a scraper fetches it --')
const ir = await fetch(img, { headers: { 'User-Agent': UA } })
const buf = Buffer.from(await ir.arrayBuffer())
const kb = buf.length / 1024
console.log(`status      ${ir.status}`)
console.log(`type        ${ir.headers.get('content-type')}`)
console.log(`size        ${kb.toFixed(0)} KB${kb > 300 ? '   <-- over 300KB, WhatsApp may skip it' : ''}`)

const dims = readDimensions(buf)
if (dims) {
  const ratio = dims.w / dims.h
  console.log(`dimensions  ${dims.w}x${dims.h}  (aspect ${ratio.toFixed(2)}:1)`)
  if (ratio < 1) console.log('            <-- PORTRAIT: summary_large_image will crop this hard')
  else if (Math.abs(ratio - 1.91) > 0.25) console.log('            <-- not ~1.91:1, expect cropping')
  const dw = Number(tags['og:image:width']), dh = Number(tags['og:image:height'])
  if (dw && dh && (dw !== dims.w || dh !== dims.h)) {
    console.log(`            <-- DECLARED ${dw}x${dh} does not match the real image`)
  }
}

console.log(missing ? `\n${missing} required tag(s) missing` : '\nAll required tags present.')
process.exit(missing ? 1 : 0)

function readDimensions(b) {
  // PNG
  if (b.length > 24 && b.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  }
  // JPEG: walk the segment chain to the SOF marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}
