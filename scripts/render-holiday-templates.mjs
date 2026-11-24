#!/usr/bin/env node
// Dev only: draws every holiday poster template (lib/holidayTemplates) through
// the real poster pipeline and writes one JPEG per template plus a contact
// sheet per occasion, for a design review.
//
//   NEXT_PUBLIC_DEMO_MODE=true npx next dev -p 3108          (in another shell)
//   node scripts/render-holiday-templates.mjs <outDir> [baseUrl] [occasion]
//
// Reads the template list from GET /api/posters/holidays, so it draws exactly
// what the composers show. Sample facts stand in for an event's own.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const OUT = process.argv[2]
const BASE = process.argv[3] || 'http://localhost:3108'
const ONLY = process.argv[4] || ''
if (!OUT) {
  console.error('usage: node scripts/render-holiday-templates.mjs <outDir> [baseUrl] [occasion]')
  process.exit(1)
}
fs.mkdirSync(OUT, { recursive: true })

// A plausible date inside each occasion, so the date blocks read naturally.
const DATES = {
  kanaval: '2027-02-07', rara: '2027-03-27', 'fet-endepandans': '2027-01-01', 'fet-drapo': '2027-05-18',
  'fet-manman': '2027-05-30', 'fet-papa': '2027-06-27', 'fet-gede': '2026-11-01', vertieres: '2026-11-18',
  nwel: '2026-12-24', 'fen-ane': '2026-12-31', 'heritage-month': '2027-05-15', 'fet-chanpet': '2027-07-24',
}

const res = await fetch(`${BASE}/api/posters/holidays`)
if (!res.ok) throw new Error(`catalog ${res.status}`)
const { templates } = await res.json()
const list = templates.filter((t) => !ONLY || t.occasion === ONLY)

async function draw(t) {
  const q = new URLSearchParams({
    template: t.layout,
    palette: String(t.palette),
    treatment: t.treatment,
    title: t.title.ht,
    start: `${DATES[t.occasion]}T${t.time}`,
    venue: 'Hotel Montana',
    city: 'Pétion-Ville',
    locale: 'ht',
    photo: t.photoUrl,
  })
  const r = await fetch(`${BASE}/api/posters/preview?${q}`)
  if (!r.ok) throw new Error(`${t.id}: ${r.status} ${await r.text()}`)
  const file = path.join(OUT, `${t.occasion}--${t.id}.jpg`)
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  return file
}

const files = []
for (let i = 0; i < list.length; i += 2) {
  const batch = await Promise.all(list.slice(i, i + 2).map(async (t) => ({ t, file: await draw(t) })))
  files.push(...batch)
  process.stdout.write(`${files.length}/${list.length}\r`)
}
console.log(`\ndrew ${files.length}`)

// One sheet per occasion: 6 across, labelled with the template id.
const TW = 270, TH = 338, COLS = 6
const byOcc = new Map()
for (const f of files) byOcc.set(f.t.occasion, [...(byOcc.get(f.t.occasion) || []), f])
for (const [occ, items] of byOcc) {
  const rows = Math.ceil(items.length / COLS)
  const comp = []
  for (const [k, { t, file }] of items.entries()) {
    const x = (k % COLS) * TW, y = Math.floor(k / COLS) * (TH + 24)
    comp.push({ input: await sharp(file).resize(TW, TH).toBuffer(), left: x, top: y })
    const label = `<svg width="${TW}" height="24"><rect width="100%" height="100%" fill="#000"/><text x="6" y="17" font-size="14" fill="#fff" font-family="Helvetica">${k + 1}. ${t.id}</text></svg>`
    comp.push({ input: Buffer.from(label), left: x, top: y + TH })
  }
  const out = path.join(OUT, `sheet-${occ}.png`)
  await sharp({ create: { width: COLS * TW, height: rows * (TH + 24), channels: 3, background: '#111' } }).composite(comp).png().toFile(out)
  console.log('sheet', out)
}
