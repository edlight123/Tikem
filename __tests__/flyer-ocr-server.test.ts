/**
 * @jest-environment node
 *
 * The real reader end to end: render a Kreyòl flyer with sharp, read it with
 * Tesseract (lib/flyer/ocr-server, the code the route runs), parse it. Slow
 * (a few seconds) but it is the only test that proves the models load from
 * node_modules and the worker thread starts outside the bundler.
 */
import sharp from 'sharp'
import { ocrFlyer } from '@/lib/flyer/ocr-server'
import { parseFlyerText } from '@/lib/flyer/parse'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
<rect width="1080" height="1350" fill="#2a0845"/>
<text x="540" y="140" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#ffd400" text-anchor="middle">DJ MAKY PREZANTE</text>
<text x="540" y="330" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="140" fill="#fff" text-anchor="middle">KONPA LAKAY</text>
<text x="540" y="470" font-family="Arial, Helvetica, sans-serif" font-size="56" fill="#fff" text-anchor="middle">Samdi 12 Desanm 2026</text>
<text x="540" y="560" font-family="Arial, Helvetica, sans-serif" font-size="48" fill="#ffd400" text-anchor="middle">a 9è diswa</text>
<text x="540" y="700" font-family="Arial, Helvetica, sans-serif" font-size="52" fill="#fff" text-anchor="middle">Hotel Montana</text>
<text x="540" y="950" font-family="Arial, Helvetica, sans-serif" font-size="50" fill="#fff" text-anchor="middle">Prevant 1,500 HTG</text>
</svg>`

it('reads a rendered Kreyòl flyer', async () => {
  const image = await sharp(Buffer.from(SVG)).jpeg().toBuffer()
  const lines = await ocrFlyer(image)
  const r = parseFlyerText(lines, new Date(2026, 10, 23))
  expect(r.title).toBe('Konpa Lakay')
  expect(r.date).toBe('2026-12-12')
  expect(r.start_time).toBe('21:00')
  expect(r.venue_name).toBe('Hotel Montana')
  expect(r).toMatchObject({ price: 1500, currency: 'HTG' })
}, 60_000)

afterAll(async () => {
  // The worker thread would otherwise keep jest open.
  const mod = await import('@/lib/flyer/ocr-server')
  await mod.terminateFlyerReader()
})
