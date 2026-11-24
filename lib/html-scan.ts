/**
 * Linear-time helpers for reading a few things out of untrusted HTML (event
 * import, feed detection). Regexes such as /<script[^>]+…>([\s\S]*?)<\/script>/
 * or /<[^>]+>/ backtrack quadratically on adversarial input ("<script<script…",
 * "<<<<…"), and a 2MB page could block the event loop for minutes. Everything
 * here walks the string with indexOf and never revisits a character more than
 * a constant number of times.
 */

/** The most HTML any parser here looks at. Real event pages fit easily. */
export const MAX_HTML_CHARS = 512 * 1024

export function capHtml(html: string): string {
  const s = String(html ?? '')
  return s.length > MAX_HTML_CHARS ? s.slice(0, MAX_HTML_CHARS) : s
}

/** Attributes of one opening tag's inner text (`a href="x" type='y' async`). */
export function parseAttributes(tagInner: string): Record<string, string> {
  const out: Record<string, string> = {}
  const s = tagInner
  const n = s.length
  let i = 0
  const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '/'
  while (i < n) {
    while (i < n && isSpace(s[i])) i++
    const nameStart = i
    while (i < n && !isSpace(s[i]) && s[i] !== '=') i++
    const name = s.slice(nameStart, i).toLowerCase()
    while (i < n && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++
    let value = ''
    if (s[i] === '=') {
      i++
      while (i < n && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++
      const q = s[i]
      if (q === '"' || q === "'") {
        const end = s.indexOf(q, i + 1)
        const stop = end === -1 ? n : end
        value = s.slice(i + 1, stop)
        i = stop + 1
      } else {
        const vs = i
        while (i < n && !isSpace(s[i])) i++
        value = s.slice(vs, i)
      }
    }
    if (name && !(name in out)) out[name] = value
    if (i === nameStart) i++ // never stall
  }
  return out
}

export interface ScannedTag {
  /** Lower-case tag name. */
  name: string
  attrs: Record<string, string>
  /** Index just past the tag's closing '>'. */
  end: number
}

/**
 * Every opening tag named one of `names` (lower-case), in order. A '<' with no
 * '>' after it ends the scan (nothing after it can be a complete tag).
 */
export function scanTags(html: string, names: string[]): ScannedTag[] {
  const lower = html.toLowerCase()
  const wanted = new Set(names)
  const out: ScannedTag[] = []
  let i = 0
  for (;;) {
    const lt = lower.indexOf('<', i)
    if (lt === -1) break
    let j = lt + 1
    while (j < lower.length && /[a-z0-9]/.test(lower[j])) j++
    const name = lower.slice(lt + 1, j)
    if (!name) {
      i = lt + 1
      continue
    }
    const gt = lower.indexOf('>', j)
    if (gt === -1) break
    if (wanted.has(name)) out.push({ name, attrs: parseAttributes(html.slice(j, gt)), end: gt + 1 })
    i = gt + 1
  }
  return out
}

/** The text of every <script type="application/ld+json"> block. */
export function ldJsonBlocks(html: string): string[] {
  const lower = html.toLowerCase()
  const out: string[] = []
  let i = 0
  for (;;) {
    const open = lower.indexOf('<script', i)
    if (open === -1) break
    const gt = lower.indexOf('>', open + 7)
    if (gt === -1) break
    const attrs = parseAttributes(html.slice(open + 7, gt))
    const close = lower.indexOf('</script', gt + 1)
    if (close === -1) break
    if (String(attrs.type || '').toLowerCase().includes('application/ld+json')) out.push(html.slice(gt + 1, close))
    i = close + 8
  }
  return out
}

/** content="" of the first <meta property|name="…"> with that key. */
export function metaContent(html: string, key: string): string | null {
  const k = key.toLowerCase()
  for (const t of scanTags(html, ['meta'])) {
    const p = String(t.attrs.property || t.attrs.name || '').toLowerCase()
    if (p === k && t.attrs.content) return t.attrs.content
  }
  return null
}

/** Remove tags in one pass (each "<…>" becomes `replacement`). */
export function stripTagsLinear(s: string, replacement = ' '): string {
  const str = String(s ?? '')
  let out = ''
  let i = 0
  for (;;) {
    const lt = str.indexOf('<', i)
    if (lt === -1) {
      out += str.slice(i)
      break
    }
    const gt = str.indexOf('>', lt + 1)
    if (gt === -1) {
      out += str.slice(i)
      break
    }
    out += str.slice(i, lt)
    // "<>" is not a tag (the old /<[^>]+>/ kept it).
    out += gt === lt + 1 ? '<>' : replacement
    i = gt + 1
  }
  return out
}
