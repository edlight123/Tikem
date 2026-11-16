// The organizer's post-event recap email: sent the morning after, with the push
// (lib/postEvent/server runPostEventFollowups), to the owner, admins and managers.
//
// Built on the Tikèm email kit (lib/email-kit): poster hero, serif title, one big
// turnout figure, an arrivals chart made of table cells (no images, no SVG), the
// ratings as proportional bars and the latest comments as quotes. Every string a
// person typed (event title, attendee names, comments) is escaped here or by a kit
// block. Ticket sales only render when the caller says this recipient may see
// finances (`includeRevenue`).

import { renderEmail, poster, gap, button, C, FONT } from '@/lib/email-kit/layout'
import { formatEventWhen, formatMoney, pickLang, type EmailLang } from '@/lib/email-kit/i18n'
import { escapeHtml } from '@/lib/html'
import type { EventRecap } from '@/lib/postEvent/server'

export type RecapEmailEvent = {
  id?: string
  title?: string | null
  start_datetime?: unknown
  timezone?: string | null
  city?: string | null
  country?: string | null
  banner_image_url?: string | null
  cover_image_url?: string | null
}

export type RecapEmailData = Pick<
  EventRecap,
  'sold' | 'checkedIn' | 'revenue' | 'currency' | 'arrivals' | 'newFollowers' | 'feedback'
>

const esc = (v: unknown) => escapeHtml(String(v ?? ''))
const oneLine = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const pct = (came: number, sold: number) => (sold > 0 ? Math.min(100, Math.round((came / sold) * 100)) : 0)

const COPY = {
  en: {
    status: 'Recap',
    fallbackTitle: 'Your event',
    subject: (e: string, c: number, s: number) => (c > 0 && s > 0 ? `${c} of ${s} came to ${e}` : `Your recap for ${e}`),
    of: 'of',
    came: 'came in',
    turnout: (n: number) => `${n}% turnout`,
    soldOnly: (n: number) => (n === 1 ? 'ticket sold' : 'tickets sold'),
    noCheckins: 'No check-ins were recorded at the door.',
    followers: 'New followers',
    sales: 'Ticket sales',
    arrivals: 'arrivals',
    peak: (time: string, n: number) => `Busiest at ${time}, when ${n} ${n === 1 ? 'person' : 'people'} came in.`,
    ratingsHead: 'how it felt',
    ratingsCount: (n: number) => (n === 1 ? '1 rating from people who came' : `${n} ratings from people who came`),
    faces: { 3: 'Loved it', 2: 'Good', 1: 'Meh' } as Record<number, string>,
    cta: 'See the full recap',
    preheader: {
      turnout: (n: number) => `${n}% turnout`,
      ratings: (n: number) => (n === 1 ? '1 rating' : `${n} ratings`),
      followers: (n: number) => (n === 1 ? '1 new follower' : `${n} new followers`),
      fallback: (e: string) => `How ${e} went, in numbers.`,
    },
  },
  fr: {
    status: 'Bilan',
    fallbackTitle: 'Votre événement',
    subject: (e: string, c: number, s: number) => (c > 0 && s > 0 ? `${c} sur ${s} sont venus à ${e}` : `Votre bilan : ${e}`),
    of: 'sur',
    came: 'sont venus',
    turnout: (n: number) => `${n} % de présence`,
    soldOnly: (n: number) => (n === 1 ? 'billet vendu' : 'billets vendus'),
    noCheckins: "Aucune entrée n'a été enregistrée à la porte.",
    followers: 'Nouveaux abonnés',
    sales: 'Ventes de billets',
    arrivals: 'arrivées',
    peak: (time: string, n: number) => `Pic à ${time} : ${n} ${n === 1 ? 'entrée' : 'entrées'}.`,
    ratingsHead: 'leur avis',
    ratingsCount: (n: number) => (n === 1 ? '1 avis de personnes venues' : `${n} avis de personnes venues`),
    faces: { 3: 'Génial', 2: 'Bien', 1: 'Bof' } as Record<number, string>,
    cta: 'Voir le bilan complet',
    preheader: {
      turnout: (n: number) => `${n} % de présence`,
      ratings: (n: number) => `${n} avis`,
      followers: (n: number) => (n === 1 ? '1 nouvel abonné' : `${n} nouveaux abonnés`),
      fallback: (e: string) => `${e}, en chiffres.`,
    },
  },
  ht: {
    status: 'Rezime',
    fallbackTitle: 'Evènman ou',
    subject: (e: string, c: number, s: number) => (c > 0 && s > 0 ? `${c} sou ${s} te vini nan ${e}` : `Rezime ${e}`),
    of: 'sou',
    came: 'te antre',
    turnout: (n: number) => `${n}% prezans`,
    soldOnly: () => 'tikè vann',
    noCheckins: 'Pa gen okenn antre ki te anrejistre nan pòtay la.',
    followers: 'Nouvo abòne',
    sales: 'Lavant tikè',
    arrivals: 'arive',
    peak: (time: string, n: number) => `Se a ${time} plis moun te antre: ${n} moun.`,
    ratingsHead: 'sa yo te panse',
    ratingsCount: (n: number) => `${n} nòt moun ki te vini bay`,
    faces: { 3: 'Te renmen l', 2: 'Bon', 1: 'Konsa konsa' } as Record<number, string>,
    cta: 'Wè tout rezime a',
    preheader: {
      turnout: (n: number) => `${n}% prezans`,
      ratings: (n: number) => `${n} nòt`,
      followers: (n: number) => `${n} nouvo abòne`,
      fallback: (e: string) => `${e}, an chif.`,
    },
  },
} satisfies Record<EmailLang, unknown>

type Copy = (typeof COPY)[EmailLang]

/** A row of label text, small caps. */
const label = (text: string, color = C.text3) =>
  `<div style="font-family:${FONT.sans};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};">${esc(text)}</div>`

/** A solid bar of `height`px. Outlook honours td height + bgcolor, not div height. */
function bar(height: number, color: string, radius = '2px'): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td height="${height}" bgcolor="${color}" style="height:${height}px;background:${color};border-radius:${radius};font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>`
}

/** A horizontal meter: `share` (0..1) filled in `color`, the rest a dim track. */
function meter(share: number, color: string, height = 6): string {
  const w = Math.max(0, Math.min(100, Math.round(share * 100)))
  const cell = (width: number, c: string) =>
    `<td width="${width}%" height="${height}" bgcolor="${c}" style="width:${width}%;height:${height}px;background:${c};font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>`
  const cells = w <= 0 ? cell(100, C.raised) : w >= 100 ? cell(100, color) : cell(w, color) + cell(100 - w, C.raised)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-radius:${height / 2}px;overflow:hidden;"><tr>${cells}</tr></table>`
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function heroTitle(text: string): string {
  return `<h1 style="margin:0;font-family:${FONT.serif};font-style:italic;font-weight:400;font-size:46px;line-height:1.04;letter-spacing:-0.5px;color:${C.text};">${esc(text)}</h1>`
}

function dateLine(text: string): string {
  return `<div style="margin:0 0 14px;font-family:${FONT.sans};font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.text2};">${esc(text)}</div>`
}

/** "38 of 41 / came in · 93% turnout" with the turnout meter under it. */
function turnoutBlock(r: RecapEmailData, t: Copy): string {
  if (r.checkedIn <= 0) {
    return `<div style="font-family:${FONT.sans};font-size:76px;line-height:0.95;font-weight:800;letter-spacing:-3px;color:${C.text};">${esc(r.sold)}</div>
<div style="margin-top:12px;font-family:${FONT.sans};font-size:17px;line-height:1.45;font-weight:600;color:${C.text};">${esc(t.soldOnly(r.sold))}</div>
<div style="margin-top:4px;font-family:${FONT.sans};font-size:15px;line-height:1.55;color:${C.text2};">${esc(t.noCheckins)}</div>`
  }
  const share = pct(r.checkedIn, r.sold)
  const of =
    r.sold > 0
      ? `<span style="font-size:34px;font-weight:700;letter-spacing:-0.5px;color:${C.text3};">&nbsp;${esc(t.of)}&nbsp;${esc(r.sold)}</span>`
      : ''
  const caption = [esc(t.came), r.sold > 0 ? `<span style="color:${C.teal};">${esc(t.turnout(share))}</span>` : '']
    .filter(Boolean)
    .join(`<span style="color:${C.text3};">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`)
  return `<div style="font-family:${FONT.sans};font-size:76px;line-height:0.95;font-weight:800;letter-spacing:-3px;color:${C.text};white-space:nowrap;">${esc(r.checkedIn)}${of}</div>
<div style="margin-top:12px;font-family:${FONT.sans};font-size:17px;line-height:1.45;font-weight:600;color:${C.text};">${caption}</div>
${r.sold > 0 ? `<div style="height:18px;line-height:18px;font-size:1px;">&nbsp;</div>${meter(share / 100, C.teal)}` : ''}`
}

/** Side-by-side figures on filled tiles: new followers, ticket sales. */
function figures(items: Array<{ label: string; value: string; unit?: string }>): string {
  if (!items.length) return ''
  // One figure alone: a single row, label left and value right, not a half-empty tile.
  if (items.length === 1) {
    const it = items[0]
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr>
<td valign="middle" style="padding:18px 20px;">${label(it.label)}</td>
<td valign="middle" align="right" style="padding:18px 20px;font-family:${FONT.sans};font-size:24px;line-height:1.1;font-weight:800;letter-spacing:-0.5px;color:${C.text};white-space:nowrap;">${esc(it.value)}${it.unit ? `<span style="font-size:13px;font-weight:700;letter-spacing:0.5px;color:${C.text2};">&nbsp;${esc(it.unit)}</span>` : ''}</td>
</tr></table>`
  }
  const w = Math.floor(100 / items.length)
  const tds = items
    .map(
      (it, i) => `<td width="${w}%" valign="top" style="padding:${items.length === 1 ? '0' : i === 0 ? '0 6px 0 0' : '0 0 0 6px'};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:18px 16px 20px;">
${label(it.label)}
<div style="margin-top:10px;font-family:${FONT.sans};font-size:26px;line-height:1.1;font-weight:800;letter-spacing:-0.5px;color:${C.text};white-space:nowrap;">${esc(it.value)}${it.unit ? `<span style="font-size:13px;font-weight:700;letter-spacing:0.5px;color:${C.text2};">&nbsp;${esc(it.unit)}</span>` : ''}</div>
</td></tr></table></td>`
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${tds}</tr></table>`
}

function sectionHead(text: string, aside?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom" style="font-family:${FONT.serif};font-style:italic;font-size:28px;line-height:1.1;color:${C.text};">${esc(text.toLowerCase())}</td>
${aside ? `<td valign="bottom" align="right" style="padding-bottom:3px;font-family:${FONT.sans};font-size:13px;color:${C.text3};white-space:nowrap;">${esc(aside)}</td>` : ''}
</tr></table>
<div style="height:18px;line-height:18px;font-size:1px;">&nbsp;</div>`
}

/** Merge neighbouring half-hours until the chart has at most `max` bars. */
export function chartBuckets(arrivals: Array<{ at: string; count: number }>, max = 12): Array<{ at: string; count: number }> {
  let list = arrivals.map((a) => ({ at: a.at, count: Math.max(0, Number(a.count) || 0) }))
  while (list.length > max) {
    const merged: typeof list = []
    for (let i = 0; i < list.length; i += 2) {
      merged.push({ at: list[i].at, count: list[i].count + (list[i + 1]?.count || 0) })
    }
    list = merged
  }
  return list
}

const CHART_H = 132

/** Vertical bars from table cells, the busiest slot in teal with its count on top. */
function arrivalsChart(r: RecapEmailData, t: Copy, lang: EmailLang, event: RecapEmailEvent): string {
  const buckets = chartBuckets(r.arrivals || [])
  const total = buckets.reduce((s, b) => s + b.count, 0)
  if (buckets.length < 2 || total <= 0) return ''
  const peakIdx = buckets.reduce((m, b, i) => (b.count > buckets[m].count ? i : m), 0)
  const max = buckets[peakIdx].count
  const timeOf = (iso: string) => formatEventWhen(iso, lang, event)?.time || ''
  const n = buckets.length
  const colW = Math.floor(100 / n)
  const pad = n > 8 ? 2 : 4

  const cols = buckets
    .map((b, i) => {
      const peak = i === peakIdx
      const h = b.count > 0 ? Math.max(6, Math.round((b.count / max) * CHART_H)) : 2
      const color = peak ? C.teal : b.count > 0 ? '#3A3A3A' : C.line
      const top = peak
        ? `<div style="margin:0 0 8px;font-family:${FONT.sans};font-size:15px;font-weight:800;line-height:1;color:${C.teal};text-align:center;">${esc(b.count)}</div>`
        : ''
      return `<td width="${colW}%" valign="bottom" style="padding:0 ${pad}px;">${top}${bar(h, color, '3px 3px 0 0')}</td>`
    })
    .join('')

  // Time labels under the bars, without AM/PM so they fit a phone (the caption
  // below gives the busiest slot in full). Six bars or fewer: every one;
  // more: every third, so neighbours never collide.
  const short = (iso: string) => timeOf(iso).replace(/\s?[AP]M$/i, '')
  const labels = buckets
    .map((b, i) => {
      const show = n <= 6 || i % 3 === 0
      const peak = i === peakIdx
      return `<td width="${colW}%" align="center" valign="top" style="padding:10px 0 0;font-family:${FONT.sans};font-size:11px;line-height:1.3;font-weight:${peak ? 700 : 500};color:${peak ? C.text : C.text3};white-space:nowrap;">${show ? esc(short(b.at)) : '&nbsp;'}</td>`
    })
    .join('')

  return `${sectionHead(t.arrivals)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:24px 18px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${cols}</tr>
<tr><td colspan="${n}" style="padding:0 ${pad}px;"><div style="height:1px;line-height:1px;font-size:0;background:${C.line};">&nbsp;</div></td></tr>
<tr>${labels}</tr></table>
</td></tr></table>
<div style="margin:14px 0 0;font-family:${FONT.sans};font-size:15px;line-height:1.55;color:${C.text2};">${esc(t.peak(timeOf(buckets[peakIdx].at), max))}</div>`
}

/** Loved it / Good / Meh with a count and a bar proportional to the total. */
function ratingsBlock(r: RecapEmailData, t: Copy): string {
  const total = r.feedback?.total || 0
  if (total <= 0) return ''
  const counts = r.feedback.counts
  const top = Math.max(counts[1], counts[2], counts[3])
  const rows = ([3, 2, 1] as const)
    .map((k, i) => {
      const c = counts[k] || 0
      const lead = c === top && c > 0
      return `<tr>
<td width="34%" valign="middle" style="padding:${i === 0 ? 0 : 14}px 12px 0 0;font-family:${FONT.sans};font-size:15px;font-weight:${lead ? 700 : 500};color:${lead ? C.text : C.text2};white-space:nowrap;">${esc(t.faces[k])}</td>
<td valign="middle" style="padding:${i === 0 ? 0 : 14}px 0 0;">${meter(c / total, lead ? C.teal : '#4A4A4A', 8)}</td>
<td width="44" align="right" valign="middle" style="padding:${i === 0 ? 0 : 14}px 0 0 12px;font-family:${FONT.sans};font-size:15px;font-weight:800;color:${lead ? C.text : C.text2};">${esc(c)}</td>
</tr>`
    })
    .join('')
  return `${sectionHead(t.ratingsHead)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:22px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr></table>
<div style="margin:14px 0 0;font-family:${FONT.sans};font-size:15px;line-height:1.55;color:${C.text2};">${esc(t.ratingsCount(total))}</div>`
}

const firstName = (name: string) => oneLine(name).split(' ')[0] || ''

/** The latest comments, as pull quotes: serif text, a thin teal rule, name and rating. */
function commentsBlock(r: RecapEmailData, t: Copy): string {
  const list = (r.feedback?.comments || []).filter((c) => oneLine(c.text)).slice(0, 3)
  if (!list.length) return ''
  return list
    .map((c, i) => {
      const who = [firstName(c.name), t.faces[c.rating] || ''].filter(Boolean).join(' · ')
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${i === 0 ? 0 : 24}px;"><tr>
<td width="2" bgcolor="${C.teal}" style="width:2px;background:${C.teal};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:2px 0 2px 18px;">
<div style="font-family:${FONT.serif};font-style:italic;font-size:21px;line-height:1.35;color:${C.text};">&ldquo;${esc(oneLine(c.text))}&rdquo;</div>
${who ? `<div style="margin-top:8px;font-family:${FONT.sans};font-size:13px;line-height:1.4;color:${C.text3};">${esc(who)}</div>` : ''}
</td></tr></table>`
    })
    .join('')
}

// ---------------------------------------------------------------------------

export function getEventRecapEmail(params: {
  lang?: EmailLang
  event: RecapEmailEvent
  recap: RecapEmailData
  /** Ticket sales are finance data: only the owner and admins with the finance grant. */
  includeRevenue: boolean
  recapUrl: string
}): { subject: string; html: string } {
  const lang = pickLang(params.lang)
  const t = COPY[lang]
  const { event, recap } = params
  const eventTitle = oneLine(event.title) || t.fallbackTitle
  const posterUrl = event.banner_image_url || event.cover_image_url || null
  const when = formatEventWhen(event.start_datetime, lang, event)
  const share = pct(recap.checkedIn, recap.sold)

  const tiles: Array<{ label: string; value: string; unit?: string }> = []
  if (recap.newFollowers > 0) tiles.push({ label: t.followers, value: String(recap.newFollowers) })
  if (params.includeRevenue && typeof recap.revenue === 'number' && recap.revenue > 0) {
    // "152,000 HTG": the figure big, the currency small, so it fits a phone-width tile.
    const money = formatMoney(recap.revenue, recap.currency, lang)
    const cut = money.lastIndexOf(' ')
    tiles.push({ label: t.sales, value: cut > 0 ? money.slice(0, cut) : money, unit: cut > 0 ? money.slice(cut + 1) : undefined })
  }

  const chart = arrivalsChart(recap, t, lang, event)
  const ratings = ratingsBlock(recap, t)
  const comments = commentsBlock(recap, t)

  const pre = [
    recap.checkedIn > 0 && recap.sold > 0 ? t.preheader.turnout(share) : '',
    recap.feedback?.total > 0 ? t.preheader.ratings(recap.feedback.total) : '',
    recap.newFollowers > 0 ? t.preheader.followers(recap.newFollowers) : '',
  ].filter(Boolean)

  const hasPoster = !!posterUrl && /^https:\/\//i.test(posterUrl)

  const html = renderEmail({
    lang,
    title: t.subject(eventTitle, recap.checkedIn, recap.sold),
    preheader: pre.length ? pre.join(' · ') : t.preheader.fallback(eventTitle),
    status: { label: t.status, tone: 'teal' },
    footer: 'organizer',
    blocks: [
      hasPoster ? poster(posterUrl, eventTitle) : '',
      hasPoster ? gap(32) : gap(8),
      when ? dateLine(when.long) : '',
      heroTitle(eventTitle),
      gap(36),
      turnoutBlock(recap, t),
      tiles.length ? gap(28) : '',
      figures(tiles),
      chart ? gap(52) : '',
      chart,
      ratings ? gap(52) : '',
      ratings,
      comments ? gap(28) : '',
      comments,
      gap(44),
      button(t.cta, params.recapUrl),
    ],
  })
  return { subject: t.subject(eventTitle, recap.checkedIn, recap.sold), html }
}
