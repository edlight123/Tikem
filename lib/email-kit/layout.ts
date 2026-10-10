// The Tikèm email look (Stitch "Tikèm POSH Dark", Oct 2026): a 600px column on a
// black canvas, the app icon + serif wordmark on top, the event poster as the hero,
// one white primary button, serif-italic lowercase section heads, a text-only footer.
//
// Email clients are not browsers: everything here is tables + inline styles,
// `bgcolor` attributes for Outlook, no flexbox, no CSS variables, no SVG, no
// data: images (Gmail strips them; the QR travels as an inline `cid:` attachment).

import { escapeHtml } from '@/lib/html'
import { COMMON, type EmailLang } from './i18n'

export const C = {
  canvas: '#000000',
  surface: '#161616',
  raised: '#1F1F1F',
  line: '#262626',
  text: '#FFFFFF',
  text2: '#A3A3A3',
  text3: '#6B6B6B',
  teal: '#14B8A6',
  amber: '#E8A33D',
  red: '#FF6B52',
  paper: '#FFFFFF',
  ink: '#0A0A0A',
  inkMuted: '#6B6B6B',
}

export const FONT = {
  sans: "'Hanken Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.tikem.co').replace(/\/+$/, '')
}

export const SOCIALS = [
  { label: 'Instagram', url: 'https://www.instagram.com/tikem.co/' },
  { label: 'Facebook', url: 'https://www.facebook.com/tikem.co' },
  { label: 'TikTok', url: 'https://www.tiktok.com/@tikem.co' },
]

const esc = (v: unknown) => escapeHtml(String(v ?? ''))

export type Tone = 'teal' | 'amber' | 'red' | 'grey'
const TONE: Record<Tone, string> = { teal: C.teal, amber: C.amber, red: C.red, grey: C.text3 }

/** A small colored dot + uppercase label. Never a filled pill. */
export function statusLabel(label: string, tone: Tone = 'teal'): string {
  return `<span style="font-family:${FONT.sans};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${TONE[tone]};white-space:nowrap;"><span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:${TONE[tone]};vertical-align:1px;margin-right:7px;"></span>${esc(label)}</span>`
}

export function eyebrow(label: string, tone?: Tone): string {
  const dot = tone
    ? `<span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:${TONE[tone]};vertical-align:1px;margin-right:8px;"></span>`
    : ''
  return `<div style="font-family:${FONT.sans};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.text2};margin:0 0 12px;">${dot}${esc(label)}</div>`
}

export function title(text: string, size = 40): string {
  return `<h1 style="margin:0;font-family:${FONT.sans};font-size:${size}px;line-height:1.08;font-weight:800;letter-spacing:-0.8px;color:${C.text};">${esc(text)}</h1>`
}

export function meta(text: string): string {
  return `<div style="margin:10px 0 0;font-family:${FONT.sans};font-size:15px;line-height:1.5;color:${C.text2};">${esc(text)}</div>`
}

export function serifHeading(text: string): string {
  return `<div style="margin:0 0 14px;font-family:${FONT.serif};font-style:italic;font-size:24px;line-height:1.2;color:${C.text};">${esc(String(text).toLowerCase())}</div>`
}

export function serifEyebrow(text: string): string {
  return `<div style="margin:0 0 6px;font-family:${FONT.serif};font-style:italic;font-size:22px;line-height:1.2;color:${C.text2};">${esc(String(text).toLowerCase())}</div>`
}

/** Plain paragraph. `html` must already be escaped by the caller (use `p()` for text). */
export function paragraphHtml(html: string, color = C.text2): string {
  return `<p style="margin:0 0 16px;font-family:${FONT.sans};font-size:15px;line-height:1.65;color:${color};">${html}</p>`
}

export function p(text: string, color = C.text2): string {
  return paragraphHtml(esc(text), color)
}

export function strong(text: string): string {
  return `<strong style="color:${C.text};font-weight:700;">${esc(text)}</strong>`
}

/** Vertical space. */
export function gap(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</div>`
}

/** The event flyer, 4:5, radius 20. Width is the column (536) unless smaller. */
export function poster(url: string | null | undefined, alt: string, width = 536): string {
  if (!url || !/^https:\/\//i.test(String(url))) return ''
  const h = Math.round((width * 5) / 4)
  return `<img src="${esc(url)}" width="${width}" height="${h}" alt="${esc(alt)}" style="display:block;width:${width}px;max-width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;border-radius:20px;border:0;outline:none;background:${C.surface};">`
}

export function button(label: string, url: string, variant: 'primary' | 'secondary' = 'primary'): string {
  const bg = variant === 'primary' ? C.paper : C.raised
  const fg = variant === 'primary' ? C.ink : C.text
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" bgcolor="${bg}" style="background:${bg};border-radius:14px;">
<a href="${esc(url)}" target="_blank" style="display:block;padding:18px 24px;font-family:${FONT.sans};font-size:16px;font-weight:700;line-height:20px;color:${fg};text-decoration:none;border-radius:14px;">${esc(label)}</a>
</td></tr></table>`
}

export function textLink(label: string, url: string): string {
  return `<div style="text-align:center;margin:16px 0 0;"><a href="${esc(url)}" target="_blank" style="font-family:${FONT.sans};font-size:14px;color:${C.text2};text-decoration:underline;text-underline-offset:3px;">${esc(label)}</a></div>`
}

/** Label/value rows on a filled #161616 block (receipts, details). */
export function rowsBlock(
  rows: Array<{ label: string; value: string; strong?: boolean; mono?: boolean; muted?: boolean }>,
  note?: string
): string {
  const tr = rows
    .map((r, i) => {
      const sep = r.strong && i > 0 ? `border-top:1px solid ${C.line};padding-top:14px;` : ''
      const valFont = r.mono ? FONT.mono : FONT.sans
      return `<tr>
<td style="padding:7px 0;${sep}font-family:${FONT.sans};font-size:15px;color:${r.strong ? C.text : C.text2};font-weight:${r.strong ? 700 : 400};">${esc(r.label)}</td>
<td align="right" style="padding:7px 0;${sep}font-family:${valFont};font-size:${r.mono ? 13 : 15}px;color:${r.muted ? C.text2 : C.text};font-weight:${r.strong ? 800 : 500};white-space:nowrap;">${esc(r.value)}</td>
</tr>`
    })
    .join('')
  const n = note
    ? `<tr><td colspan="2" style="padding:12px 0 0;font-family:${FONT.sans};font-size:13px;color:${C.text3};">${esc(note)}</td></tr>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:20px;border-collapse:separate;"><tr><td style="padding:20px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tr}${n}</table>
</td></tr></table>`
}

/** Facts in tiles: "LÈ 7:00 PM" / "POTAY 6:30 PM" / "KOTE Ritz Kinam". */
export function facts(items: Array<{ label: string; value: string }>): string {
  const list = items.filter((i) => i.value)
  if (!list.length) return ''
  const w = Math.floor(100 / list.length)
  const tds = list
    .map(
      (it, i) => `<td width="${w}%" valign="top" style="padding:${i === 0 ? '0 6px 0 0' : i === list.length - 1 ? '0 0 0 6px' : '0 6px'};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:14px;border-collapse:separate;"><tr><td style="padding:14px 14px 16px;">
<div style="font-family:${FONT.sans};font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.text3};">${esc(it.label)}</div>
<div style="margin-top:6px;font-family:${FONT.sans};font-size:16px;font-weight:700;color:${C.text};line-height:1.3;">${esc(it.value)}</div>
</td></tr></table></td>`
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tds}</tr></table>`
}

/** Metrics on the canvas: tiny grey label over a big white numeral. */
export function metric(label: string, value: string, unit?: string): string {
  return `<div style="margin:0 0 22px;"><div style="font-family:${FONT.sans};font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:${C.text3};">${esc(label)}</div>
<div style="margin-top:4px;font-family:${FONT.sans};font-size:32px;font-weight:800;color:${C.text};line-height:1.1;">${esc(value)}${unit ? `<span style="font-size:15px;font-weight:600;color:${C.text2};"> ${esc(unit)}</span>` : ''}</div></div>`
}

/** A huge figure (refund amount, payout). */
export function bigFigure(value: string, unit?: string, caption?: string): string {
  return `<div style="font-family:${FONT.sans};font-size:60px;line-height:1;font-weight:800;letter-spacing:-1.5px;color:${C.text};">${esc(value)}${unit ? `<span style="font-size:28px;font-weight:700;letter-spacing:0;color:${C.text2};"> ${esc(unit)}</span>` : ''}</div>${caption ? `<div style="margin-top:10px;font-family:${FONT.sans};font-size:15px;color:${C.text2};">${esc(caption)}</div>` : ''}`
}

/** A real numbered sequence. */
export function steps(items: string[]): string {
  return items
    .map(
      (s, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr>
<td width="26" valign="top" style="font-family:${FONT.sans};font-size:15px;font-weight:800;color:${C.text};">${i + 1}.</td>
<td valign="top" style="font-family:${FONT.sans};font-size:15px;line-height:1.55;color:${C.text2};">${esc(s)}</td></tr></table>`
    )
    .join('')
}

/** Unordered plain lines (tips). */
export function lines(items: string[]): string {
  return items
    .map((s) => `<div style="margin:0 0 10px;font-family:${FONT.sans};font-size:15px;line-height:1.55;color:${C.text2};">${esc(s)}</div>`)
    .join('')
}

/** Progress timeline: done steps get a teal dot, upcoming a grey one. */
export function timeline(items: Array<{ label: string; detail?: string; done?: boolean }>): string {
  return items
    .map((it, i) => {
      const last = i === items.length - 1
      const dot = it.done ? C.teal : C.raised
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="22" valign="top" style="padding-top:5px;"><div style="width:10px;height:10px;border-radius:10px;background:${dot};"></div>${last ? '' : `<div style="width:2px;height:30px;margin:4px 0 0 4px;background:${C.raised};"></div>`}</td>
<td valign="top" style="padding:0 0 ${last ? 0 : 10}px;font-family:${FONT.sans};font-size:15px;line-height:1.5;"><span style="color:${it.done ? C.text : C.text2};font-weight:${it.done ? 700 : 500};">${esc(it.label)}</span>${it.detail ? `<span style="color:${C.text3};"> · ${esc(it.detail)}</span>` : ''}</td>
</tr></table>`
    })
    .join('')
}

/** Small poster thumbnail + title + subline, on the canvas. */
export function eventRow(posterUrl: string | null | undefined, name: string, sub?: string): string {
  const img =
    posterUrl && /^https:\/\//i.test(posterUrl)
      ? `<td width="76" valign="middle" style="padding-right:16px;"><img src="${esc(posterUrl)}" width="64" height="80" alt="" style="display:block;width:64px;height:80px;object-fit:cover;border-radius:8px;border:0;background:${C.surface};"></td>`
      : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${img}<td valign="middle">
<div style="font-family:${FONT.sans};font-size:17px;font-weight:700;color:${C.text};line-height:1.3;">${esc(name)}</div>
${sub ? `<div style="margin-top:4px;font-family:${FONT.sans};font-size:14px;color:${C.text2};">${esc(sub)}</div>` : ''}
</td></tr></table>`
}

/** A quoted message (organizer reply, transfer note). */
export function quote(label: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:20px;border-collapse:separate;"><tr><td style="padding:18px 22px;">
<div style="font-family:${FONT.sans};font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:${C.text3};margin-bottom:8px;">${esc(label)}</div>
<div style="font-family:${FONT.sans};font-size:15px;line-height:1.65;color:${C.text};white-space:pre-wrap;">${esc(text)}</div>
</td></tr></table>`
}

/** A one-time code, huge and letter-spaced. */
export function codeBlock(code: string, note?: string): string {
  const spaced = String(code).replace(/\s+/g, '').replace(/^(\d{3})(\d{3})$/, '$1 $2')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:20px;border-collapse:separate;"><tr><td align="center" style="padding:34px 20px 30px;">
<div style="font-family:${FONT.mono};font-size:52px;line-height:1;font-weight:700;letter-spacing:10px;color:${C.text};">${esc(spaced)}</div>
${note ? `<div style="margin-top:14px;font-family:${FONT.sans};font-size:13px;color:${C.text2};">${esc(note)}</div>` : ''}
</td></tr></table>`
}

/** A monospace link to copy (event URL). */
export function linkBlock(url: string): string {
  const shown = url.replace(/^https?:\/\/(www\.)?/, '')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:14px;border-collapse:separate;"><tr><td style="padding:16px 18px;font-family:${FONT.mono};font-size:14px;color:${C.text};word-break:break-all;"><a href="${esc(url)}" target="_blank" style="color:${C.text};text-decoration:none;">${esc(shown)}</a></td></tr></table>`
}

/** The white ticket stub with side notches, holder/tier, QR and code. */
export function ticketStub(opts: {
  holderLabel: string
  holder: string
  ticketLabel: string
  ticket: string
  qrSrc?: string | null
  code: string
  codeNote: string
}): string {
  const qr = opts.qrSrc
    ? `<img src="${esc(opts.qrSrc)}" width="190" height="190" alt="QR" style="display:block;width:190px;height:190px;margin:0 auto;border:0;">`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper};border-radius:20px;border-collapse:separate;">
<tr><td style="padding:22px 24px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top"><div style="font-family:${FONT.sans};font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.inkMuted};">${esc(opts.holderLabel)}</div>
<div style="margin-top:5px;font-family:${FONT.sans};font-size:17px;font-weight:700;color:${C.ink};">${esc(opts.holder)}</div></td>
<td valign="top" align="right"><div style="font-family:${FONT.sans};font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.inkMuted};">${esc(opts.ticketLabel)}</div>
<div style="margin-top:5px;font-family:${FONT.sans};font-size:17px;font-weight:700;color:${C.ink};">${esc(opts.ticket)}</div></td>
</tr></table></td></tr>
<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="12" style="padding:0;"><div style="width:12px;height:24px;background:${C.canvas};border-radius:0 12px 12px 0;"></div></td>
<td style="padding:0 6px;"><div style="border-top:2px dashed #E5E5E5;height:0;line-height:0;font-size:0;">&nbsp;</div></td>
<td width="12" style="padding:0;"><div style="width:12px;height:24px;background:${C.canvas};border-radius:12px 0 0 12px;"></div></td>
</tr></table></td></tr>
<tr><td align="center" style="padding:18px 24px 26px;">
${qr}
<div style="margin-top:16px;font-family:${FONT.mono};font-size:17px;font-weight:700;letter-spacing:3px;color:${C.ink};">${esc(opts.code)}</div>
<div style="margin-top:6px;font-family:${FONT.sans};font-size:13px;color:${C.inkMuted};">${esc(opts.codeNote)}</div>
</td></tr></table>`
}

export type FooterKind = 'attendee' | 'organizer' | 'account'

function footer(lang: EmailLang, kind: FooterKind): string {
  const t = COMMON[lang]
  const base = appUrl()
  const nav =
    kind === 'organizer'
      ? [
          [t.dashboard, `${base}/organizer`],
          [t.payouts, `${base}/organizer/payouts`],
          [t.help, `${base}/support`],
        ]
      : [
          [t.discover, `${base}/discover`],
          [t.myTickets, `${base}/tickets`],
          [t.help, `${base}/support`],
        ]
  const link = (label: string, url: string, color = C.text3) =>
    `<a href="${esc(url)}" target="_blank" style="color:${color};text-decoration:none;">${esc(label)}</a>`
  const dot = `<span style="color:${C.raised};">&nbsp;·&nbsp;</span>`
  const why = kind === 'organizer' ? t.whyOrganizer : kind === 'account' ? t.whyAccount : t.whyAttendee
  return `<tr><td style="padding:40px 32px 8px;"><div style="border-top:1px solid ${C.line};height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:22px 32px 48px;font-family:${FONT.sans};font-size:13px;line-height:2;color:${C.text3};">
<div>${nav.map(([l, u]) => link(l, u, C.text2)).join(dot)}</div>
<div>${SOCIALS.map((s) => link(s.label, s.url)).join(dot)}&nbsp;&nbsp;<span style="color:${C.text2};">@tikem.co</span></div>
<div>© ${new Date().getFullYear()} ${esc(t.rights)}${dot}${link(t.privacy, `${base}/legal/privacy`)}${dot}${link(t.terms, `${base}/legal/terms`)}</div>
<div style="margin-top:6px;font-size:12px;line-height:1.6;color:${C.text3};">${esc(why)}</div>
</td></tr>`
}

/**
 * Wrap a body in the full document. `body` is a list of already-rendered blocks;
 * each is placed in its own padded row so spacing stays consistent.
 */
export function renderEmail(opts: {
  lang: EmailLang
  title: string
  preheader: string
  status?: { label: string; tone?: Tone }
  /** Already-rendered blocks, top to bottom. Use `gap()` between groups. */
  blocks: string[]
  footer?: FooterKind
}): string {
  const base = appUrl()
  const icon = `${base}/email/icon-144.png`
  const head = `<tr><td style="padding:40px 32px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${esc(base)}" target="_blank" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px;"><img src="${icon}" width="36" height="36" alt="Tikèm" style="display:block;width:36px;height:36px;border-radius:9px;border:0;"></td>
<td valign="middle" style="font-family:${FONT.serif};font-style:italic;font-size:26px;line-height:1;color:${C.text};">tikèm</td>
</tr></table></a></td>
<td valign="middle" align="right">${opts.status ? statusLabel(opts.status.label, opts.status.tone || 'teal') : ''}</td>
</tr></table></td></tr>`
  const body = opts.blocks
    .filter(Boolean)
    .map((b) => `<tr><td style="padding:0 32px;">${b}</td></tr>`)
    .join('')
  return `<!DOCTYPE html>
<html lang="${opts.lang === 'ht' ? 'ht' : opts.lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(opts.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Instrument+Serif:ital@1&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;supported-color-schemes:dark}
body{margin:0;padding:0;background:${C.canvas};}
a{color:inherit}
@media (max-width:620px){.tk-col{width:100%!important}.tk-pad{padding-left:20px!important;padding-right:20px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};">${esc(opts.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};">
<tr><td align="center">
<table role="presentation" class="tk-col" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="width:600px;max-width:600px;background:${C.canvas};">
${head}
${body}
${footer(opts.lang, opts.footer || 'attendee')}
</table>
</td></tr></table>
</body>
</html>`
}
