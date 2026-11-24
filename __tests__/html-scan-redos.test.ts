/**
 * Untrusted HTML (organizer imports) is read with linear scans
 * (lib/html-scan). The old regexes backtracked quadratically on inputs such as
 * "<script<script…", so a big crafted page could stall the server.
 */
import { parseImportedEvents } from '@/lib/import/event-page'
import { ldJsonBlocks, metaContent, stripTagsLinear, scanTags } from '@/lib/html-scan'

const SIZE = 500 * 1024
const adversarial = [
  '<script'.repeat(Math.ceil(SIZE / 7)).slice(0, SIZE),
  '<'.repeat(SIZE),
  '<meta property="og:image" '.repeat(Math.ceil(SIZE / 26)).slice(0, SIZE),
  'href="https://' + 'a'.repeat(SIZE),
  '<script type="application/ld+json">' + '<script'.repeat(Math.ceil(SIZE / 7)),
  '<a' + ' x'.repeat(SIZE / 2),
]

describe('lib/html-scan is linear on adversarial input', () => {
  // The faster of two runs, so a GC pause or a busy test worker is not
  // mistaken for backtracking (which takes many seconds at this size); 1s leaves room for a loaded CI box.
  const time = (fn: () => unknown) => {
    let best = Infinity
    for (let k = 0; k < 2; k++) {
      const t0 = performance.now()
      fn()
      best = Math.min(best, performance.now() - t0)
    }
    return best
  }
  it.each(adversarial.map((s, i) => [i, s] as const))('input #%i parses in < 1s', (_i, html) => {
    expect(time(() => parseImportedEvents(html, 'https://example.com/e'))).toBeLessThan(1000)
    expect(time(() => stripTagsLinear(html))).toBeLessThan(1000)
  })
})

describe('lib/html-scan extracts what the regexes did', () => {
  const page = `<html><head>
    <meta property="og:image" content="https://cdn.example.com/p.jpg">
    <link rel="alternate" type="text/calendar" href="/cal.ics">
    <SCRIPT type='application/ld+json'>{"@type":"Event","name":"Konpa <b>Night</b>","startDate":"2027-01-10T18:00:00Z"}</SCRIPT>
    <script>var x = "<script>"</script>
  </head></html>`

  it('reads ld+json blocks, og:image and links', () => {
    expect(ldJsonBlocks(page)).toHaveLength(1)
    expect(metaContent(page, 'og:image')).toBe('https://cdn.example.com/p.jpg')
    expect(scanTags(page, ['link'])[0].attrs.href).toBe('/cal.ics')
    const [e] = parseImportedEvents(page, 'https://example.com/events')
    expect(e.title).toBe('Konpa Night')
    expect(e.image).toBe('https://cdn.example.com/p.jpg')
  })

  it('strips tags in one pass', () => {
    expect(stripTagsLinear('a<b>c</b>d', '')).toBe('acd')
    expect(stripTagsLinear('1 < 2 and no close', '')).toBe('1 < 2 and no close')
  })
})
