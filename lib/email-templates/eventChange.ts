// "Your event changed": sent to everyone holding a live ticket when the
// organizer moves the date, time, venue or online link of a published event
// (lib/events/change-notices). Transactional (policy.ts `event_change`): every
// holder gets the email; push follows the person's event-updates switch.
//
// Every string a user or organizer typed goes through a kit block or
// escapeHtml; nothing here interpolates raw text into HTML.

import { escapeHtml } from '@/lib/html'
import { renderEmail, appUrl, eventRow, title, p, gap, button, C, FONT } from '@/lib/email-kit/layout'
import { formatEventWhen, pickLang, type EmailLang } from '@/lib/email-kit/i18n'
import type { MaterialSnapshot } from '@/lib/events/change-detect'

const oneLine = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()

export const EVENT_CHANGE_TEXT = {
  en: {
    status: 'Changed',
    subject: (e: string) => `Change to ${e}`,
    headline: 'Your event has changed',
    intro: 'The organizer changed some details. Your ticket stays valid.',
    when: 'Date and time',
    where: 'Place',
    link: 'Online link',
    was: 'Was',
    now: 'Now',
    online: 'Online',
    addToCalendar: 'Add to calendar',
    viewTicket: 'View my ticket',
    findTicket: 'Find my ticket',
    cantMakeIt: 'Can’t make it anymore? You can ask for a refund from your ticket.',
    pushTitle: (e: string) => `${e}: details changed`,
    fallbackTitle: 'Your event',
  },
  fr: {
    status: 'Modifié',
    subject: (e: string) => `Changement : ${e}`,
    headline: 'Votre événement a changé',
    intro: "L'organisateur a modifié certains détails. Votre billet reste valable.",
    when: 'Date et heure',
    where: 'Lieu',
    link: 'Lien en ligne',
    was: 'Avant',
    now: 'Maintenant',
    online: 'En ligne',
    addToCalendar: 'Ajouter au calendrier',
    viewTicket: 'Voir mon billet',
    findTicket: 'Retrouver mon billet',
    cantMakeIt: 'Vous ne pouvez plus venir ? Vous pouvez demander un remboursement depuis votre billet.',
    pushTitle: (e: string) => `${e} : détails modifiés`,
    fallbackTitle: 'Votre événement',
  },
  ht: {
    status: 'Chanje',
    subject: (e: string) => `Chanjman: ${e}`,
    headline: 'Evènman ou an chanje',
    intro: 'Òganizatè a chanje kèk detay. Tikè ou toujou bon.',
    when: 'Dat ak lè',
    where: 'Kote',
    link: 'Lyen sou entènèt',
    was: 'Anvan',
    now: 'Kounye a',
    online: 'Sou entènèt',
    addToCalendar: 'Mete nan kalandriye',
    viewTicket: 'Wè tikè m',
    findTicket: 'Jwenn tikè m',
    cantMakeIt: 'Ou pa ka vini ankò? Ou ka mande yon ranbousman nan tikè ou.',
    pushTitle: (e: string) => `${e}: detay yo chanje`,
    fallbackTitle: 'Evènman ou',
  },
} satisfies Record<EmailLang, unknown>

function whenLine(s: MaterialSnapshot, lang: EmailLang, event: Record<string, any>): string {
  const start = formatEventWhen(s.start, lang, event)
  if (!start) return ''
  const end = formatEventWhen(s.end, lang, event)
  if (!end) return start.line
  // Same day: "Sat 21 Nov · 7:00 PM – 10:00 PM"; otherwise both lines.
  return end.short === start.short ? `${start.line} – ${end.time}` : `${start.line} – ${end.line}`
}

function whereLine(s: MaterialSnapshot, lang: EmailLang): string {
  if (s.online) return EVENT_CHANGE_TEXT[lang].online
  const parts = [s.venue, s.address, s.commune, s.city].map(oneLine).filter(Boolean)
  // An address often already holds the commune and city: don't repeat them.
  return parts
    .filter((part, i) => parts.findIndex((o) => o.toLowerCase() === part.toLowerCase()) === i)
    .filter((part, i, all) => !all.some((o, j) => j !== i && j < i && o.toLowerCase().includes(part.toLowerCase())))
    .join(', ')
}

export type EventChangeRow = { label: string; before: string; after: string }

/** The rows that differ, as text, in the recipient's language. */
export function eventChangeRows(
  before: MaterialSnapshot,
  after: MaterialSnapshot,
  lang: EmailLang,
  event: Record<string, any>
): EventChangeRow[] {
  const t = EVENT_CHANGE_TEXT[lang]
  const rows: EventChangeRow[] = []
  const wb = whenLine(before, lang, event)
  const wa = whenLine(after, lang, event)
  if (wb !== wa) rows.push({ label: t.when, before: wb || '-', after: wa || '-' })
  const pb = whereLine(before, lang)
  const pa = whereLine(after, lang)
  if (pb !== pa) rows.push({ label: t.where, before: pb || '-', after: pa || '-' })
  if ((before.link || '') !== (after.link || '') && after.link) {
    rows.push({ label: t.link, before: before.link || '-', after: after.link })
  }
  return rows
}

/** One change: small label, the old value struck through, the new one in white. Wraps (long venues). */
function changeBlock(row: EventChangeRow, t: (typeof EVENT_CHANGE_TEXT)[EmailLang]): string {
  const label = `<div style="font-family:${FONT.sans};font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:${C.text3};margin-bottom:10px;">${escapeHtml(row.label)}</div>`
  const line = (k: string, v: string, now: boolean) =>
    `<div style="font-family:${FONT.sans};font-size:15px;line-height:1.5;color:${now ? C.text : C.text2};${now ? 'font-weight:700;' : ''}"><span style="font-weight:400;color:${C.text3};">${escapeHtml(k)}</span>&nbsp; <span style="${now ? '' : 'text-decoration:line-through;'}">${escapeHtml(v)}</span></div>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:18px 22px;">
${label}${line(t.was, row.before, false)}${line(t.now, row.after, true)}
</td></tr></table>`
}

export function getEventChangeEmail(params: {
  lang?: EmailLang
  event: Record<string, any> & { id: string }
  before: MaterialSnapshot
  after: MaterialSnapshot
  /** Where the holder sees the ticket: /tickets/event/{id} for an account, the finder for a guest. */
  ticketUrl: string
  /** Account holder (true) or a guest checkout (false): picks the button label. */
  hasAccount: boolean
}): { subject: string; html: string; rows: EventChangeRow[] } {
  const lang = pickLang(params.lang)
  const t = EVENT_CHANGE_TEXT[lang]
  const event = params.event
  const eventTitle = oneLine(event.title) || t.fallbackTitle
  const rows = eventChangeRows(params.before, params.after, lang, event)
  const base = appUrl()
  const posterUrl = oneLine(event.banner_image_url) || null
  const blocks: string[] = [
    eventRow(posterUrl, eventTitle, whereLine(params.after, lang)),
    gap(28),
    title(t.headline, 34),
    gap(14),
    p(t.intro),
    gap(4),
  ]
  for (const r of rows) blocks.push(changeBlock(r, t), gap(12))
  blocks.push(
    gap(12),
    button(params.hasAccount ? t.viewTicket : t.findTicket, params.ticketUrl),
    gap(10),
    button(t.addToCalendar, `${base}/api/events/${encodeURIComponent(event.id)}/calendar`, 'secondary'),
    gap(24),
    p(t.cantMakeIt)
  )
  const html = renderEmail({
    lang,
    title: t.headline,
    preheader: rows.map((r) => `${r.label}: ${r.after}`).join(' · ') || t.intro,
    status: { label: t.status, tone: 'amber' },
    footer: 'attendee',
    blocks,
  })
  return { subject: t.subject(eventTitle), html, rows }
}
