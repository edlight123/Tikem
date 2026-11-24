/**
 * Event descriptions carry a tiny, safe markdown subset so organizers can
 * format without HTML: **bold**, *italic*, "- " bullets and "1. " numbered
 * lines. The text stays a plain string in Firestore, so old descriptions
 * render exactly as before (a stray "*" with no partner is just a "*").
 *
 * Nothing here produces HTML. parseRichText returns a tree of plain strings
 * plus flags; the web renders it as React elements (components/RichText) and
 * the app as nested <Text> (mobile/components/RichText). stripRichText gives
 * the plain-text form for calendar files, metadata and search snippets.
 *
 * KEEP IN SYNC with lib/richText.ts (web) (__tests__/rich-text.test.ts checks
 * the two copies agree).
 */

export type RichSpan = { text: string; bold?: boolean; italic?: boolean }

export type RichBlock =
  | { type: 'paragraph'; lines: RichSpan[][] }
  | { type: 'bullets'; items: RichSpan[][] }
  | { type: 'numbers'; start: number; items: RichSpan[][] }

const BULLET_RE = /^[ \t]*[-•*][ \t]+(.*)$/
const NUMBER_RE = /^[ \t]*(\d{1,3})[.)][ \t]+(.*)$/

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

/** The closing marker for an opener at `from`, or -1. Closers need a non-space before them. */
function findCloser(s: string, from: number, marker: string): number {
  let i = from
  while (i < s.length) {
    const at = s.indexOf(marker, i)
    if (at < 0) return -1
    if (s[at - 1] === '\\') {
      i = at + 1
      continue
    }
    // A single "*" must not be half of a "**".
    if (marker === '*' && (s[at + 1] === '*' || s[at - 1] === '*')) {
      i = at + 1
      continue
    }
    if (at > from && !isSpace(s[at - 1])) {
      // A closing "***" closes the inner italic first, then the bold.
      if (marker === '**' && s[at + 2] === '*') return at + 1
      return at
    }
    i = at + 1
  }
  return -1
}

function pushText(out: RichSpan[], text: string, bold: boolean, italic: boolean) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && !!last.bold === bold && !!last.italic === italic) {
    last.text += text
    return
  }
  const span: RichSpan = { text }
  if (bold) span.bold = true
  if (italic) span.italic = true
  out.push(span)
}

function parseInlineInto(s: string, out: RichSpan[], bold: boolean, italic: boolean) {
  let buf = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '*') {
      buf += '*'
      i += 2
      continue
    }
    if (c === '*') {
      const double = s[i + 1] === '*'
      const marker = double ? '**' : '*'
      const open = i + marker.length
      // Opener needs a non-space after it ("2 * 3" stays text).
      if (!isSpace(s[open]) && !(double && bold) && !(!double && italic)) {
        const close = findCloser(s, open, marker)
        if (close > open) {
          pushText(out, buf, bold, italic)
          buf = ''
          parseInlineInto(s.slice(open, close), out, bold || double, italic || !double)
          i = close + marker.length
          continue
        }
      }
      // No partner: the run of stars is literal text.
      let j = i
      while (s[j] === '*') j++
      buf += s.slice(i, j)
      i = j
      continue
    }
    buf += c
    i++
  }
  pushText(out, buf, bold, italic)
}

/** One line's inline formatting. */
export function parseInline(line: string): RichSpan[] {
  const out: RichSpan[] = []
  parseInlineInto(line, out, false, false)
  return out
}

/** The description as blocks: paragraphs (blank-line separated), bullet and numbered lists. */
export function parseRichText(input: unknown): RichBlock[] {
  const text = typeof input === 'string' ? input.replace(/\r\n?/g, '\n') : ''
  const blocks: RichBlock[] = []
  let cur: RichBlock | null = null
  const flush = () => {
    if (cur) blocks.push(cur)
    cur = null
  }
  for (const raw of text.split('\n')) {
    const bullet = BULLET_RE.exec(raw)
    const num = bullet ? null : NUMBER_RE.exec(raw)
    if (bullet) {
      if (!cur || cur.type !== 'bullets') {
        flush()
        cur = { type: 'bullets', items: [] }
      }
      cur.items.push(parseInline(bullet[1]))
    } else if (num) {
      if (!cur || cur.type !== 'numbers') {
        flush()
        cur = { type: 'numbers', start: Number(num[1]) || 1, items: [] }
      }
      cur.items.push(parseInline(num[2]))
    } else if (!raw.trim()) {
      flush()
    } else {
      if (!cur || cur.type !== 'paragraph') {
        flush()
        cur = { type: 'paragraph', lines: [] }
      }
      cur.lines.push(parseInline(raw))
    }
  }
  flush()
  return blocks
}

const spansText = (spans: RichSpan[]) => spans.map((s) => s.text).join('')

/**
 * Plain text with the markers removed: bullets become "• ", numbers stay
 * ("1. "), paragraphs keep their line breaks and a blank line between them.
 */
export function stripRichText(input: unknown): string {
  const parts: string[] = []
  for (const b of parseRichText(input)) {
    if (b.type === 'paragraph') parts.push(b.lines.map(spansText).join('\n'))
    else if (b.type === 'bullets') parts.push(b.items.map((it) => `• ${spansText(it)}`).join('\n'))
    else parts.push(b.items.map((it, i) => `${b.start + i}. ${spansText(it)}`).join('\n'))
  }
  return parts.join('\n\n')
}

/** True when the text uses any formatting (so callers can skip the rich renderer). */
export function hasRichFormatting(input: unknown): boolean {
  return parseRichText(input).some(
    (b) => b.type !== 'paragraph' || b.lines.some((l) => l.some((s) => s.bold || s.italic)),
  )
}

// ── Editor helpers (the formatting toolbar) ──

export type Selection = { start: number; end: number }
export type EditResult = { text: string; selection: Selection }

/**
 * Wrap the selection in a marker ("**" bold, "*" italic), or unwrap it when it
 * is already wrapped. With nothing selected, inserts an empty pair and puts the
 * cursor between them.
 */
export function toggleWrap(text: string, sel: Selection, marker: '**' | '*'): EditResult {
  let start = Math.max(0, Math.min(sel.start, sel.end, text.length))
  let end = Math.min(text.length, Math.max(sel.start, sel.end))
  const m = marker.length
  // Leave surrounding spaces outside the markers ("**word** " not "**word **").
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  const inner = text.slice(start, end)
  const before = text.slice(0, start)
  const after = text.slice(end)
  // Already wrapped just outside the selection: unwrap.
  const wrappedOutside =
    before.endsWith(marker) &&
    after.startsWith(marker) &&
    (marker === '**' || (!before.endsWith('**') && !after.startsWith('**')) || (before.endsWith('***') && after.startsWith('***')))
  if (wrappedOutside) {
    return {
      text: before.slice(0, -m) + inner + after.slice(m),
      selection: { start: start - m, end: end - m },
    }
  }
  // The selection itself includes the markers: unwrap.
  if (inner.length >= 2 * m && inner.startsWith(marker) && inner.endsWith(marker) && (marker === '**' || !inner.startsWith('**') || inner.startsWith('***'))) {
    const stripped = inner.slice(m, -m)
    return { text: before + stripped + after, selection: { start, end: start + stripped.length } }
  }
  return {
    text: before + marker + inner + marker + after,
    selection: { start: start + m, end: end + m },
  }
}

/**
 * Toggle a bullet ("- ") or number ("1. ") on every line the selection
 * touches. If every touched line already has that kind, it is removed;
 * otherwise each line gets it (replacing the other kind).
 */
export function toggleList(text: string, sel: Selection, kind: 'bullet' | 'number'): EditResult {
  const a = Math.max(0, Math.min(sel.start, sel.end, text.length))
  const b = Math.min(text.length, Math.max(sel.start, sel.end))
  const lineStart = text.lastIndexOf('\n', a - 1) + 1
  let lineEnd = text.indexOf('\n', b)
  if (lineEnd < 0) lineEnd = text.length
  const lines = text.slice(lineStart, lineEnd).split('\n')
  const own = kind === 'bullet' ? BULLET_RE : NUMBER_RE
  const allOn = lines.every((l) => !l.trim() || own.test(l)) && lines.some((l) => own.test(l))
  const bare = (l: string) => {
    const bm = BULLET_RE.exec(l)
    if (bm) return bm[1]
    const nm = NUMBER_RE.exec(l)
    return nm ? nm[2] : l
  }
  let n = 0
  const next = lines.map((l) => {
    if (allOn) return bare(l)
    if (!l.trim() && lines.length > 1) return l
    n++
    return (kind === 'bullet' ? '- ' : `${n}. `) + bare(l)
  })
  const replaced = next.join('\n')
  const out = text.slice(0, lineStart) + replaced + text.slice(lineEnd)
  const delta = replaced.length - (lineEnd - lineStart)
  // One line, nothing selected: keep the cursor at the same spot in the line's text.
  if (lines.length === 1 && a === b) {
    const prefixOld = lines[0].length - bare(lines[0]).length
    const prefixNew = next[0].length - bare(next[0]).length
    const pos = Math.max(lineStart + prefixNew, a + (prefixNew - prefixOld))
    return { text: out, selection: { start: pos, end: pos } }
  }
  return { text: out, selection: { start: lineStart, end: lineEnd + delta } }
}

/**
 * After a newline is typed at the end of a list line, continue the list
 * ("- " or the next number). An empty list line followed by Enter ends the
 * list instead. Returns null when nothing should change.
 */
export function continueList(prev: string, next: string): EditResult | null {
  if (next.length !== prev.length + 1) return null
  // Find the inserted character.
  let i = 0
  while (i < prev.length && prev[i] === next[i]) i++
  if (next[i] !== '\n') return null
  const lineStart = prev.lastIndexOf('\n', i - 1) + 1
  const line = prev.slice(lineStart, i)
  const bullet = /^([ \t]*)([-•*])[ \t]+(.*)$/.exec(line)
  const num = bullet ? null : /^([ \t]*)(\d{1,3})([.)])[ \t]+(.*)$/.exec(line)
  if (!bullet && !num) return null
  const content = bullet ? bullet[3] : num![4]
  if (!content.trim()) {
    // Enter on an empty item: drop the marker and end the list.
    const text = prev.slice(0, lineStart) + prev.slice(i)
    return { text, selection: { start: lineStart, end: lineStart } }
  }
  const prefix = bullet ? `${bullet[1]}${bullet[2]} ` : `${num![1]}${Number(num![2]) + 1}${num![3]} `
  const text = next.slice(0, i + 1) + prefix + next.slice(i + 1)
  const pos = i + 1 + prefix.length
  return { text, selection: { start: pos, end: pos } }
}
