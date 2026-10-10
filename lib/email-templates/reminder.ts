// Event reminder ("it's tomorrow") and organizer update emails, shared by the
// hourly reminder cron (app/api/cron/event-reminders), its older duplicate
// (app/api/email/send-event-reminders) and app/api/email/send-event-update.
//
// Built on the Tikèm email kit (lib/email-kit): poster hero, facts tiles, one white
// primary button. Every string a user or organizer typed goes through a kit block
// that escapes it; nothing here interpolates raw text into HTML.

import {
  renderEmail,
  appUrl,
  poster,
  title,
  meta,
  serifEyebrow,
  serifHeading,
  p,
  gap,
  button,
  facts,
  lines,
  quote,
  eventRow,
} from '@/lib/email-kit/layout'
import { formatEventWhen, pickLang, type EmailLang } from '@/lib/email-kit/i18n'
import { eventZone } from '@/lib/home/feed'

export type ReminderEvent = {
  id?: string
  title?: string | null
  start_datetime?: unknown
  doors_open_time?: unknown
  venue_name?: string | null
  venue_address?: string | null
  city?: string | null
  country?: string | null
  timezone?: string | null
  banner_image_url?: string | null
}

const oneLine = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()

/** `start_datetime` is an ISO string from the composer but a Firestore Timestamp from older writes. */
export function eventInstantIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  const v = value as any
  if (typeof v?.toDate === 'function') {
    try {
      return v.toDate().toISOString()
    } catch {
      return null
    }
  }
  if (typeof v?._seconds === 'number') return new Date(v._seconds * 1000).toISOString()
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString()
  return null
}

/** Google Maps search for the venue; null when there is nothing to search for. */
export function directionsUrl(event: ReminderEvent): string | null {
  const q = [event.venue_name, event.venue_address, event.city].map(oneLine).filter(Boolean)
  // An address often already contains the city: don't repeat it.
  const unique = q.filter((part, i) => q.findIndex((o) => o.toLowerCase() === part.toLowerCase()) === i)
  if (!unique.length) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(unique.join(', '))}`
}

function venueLine(event: ReminderEvent): string {
  return [oneLine(event.venue_name), oneLine(event.city)].filter(Boolean).join(', ')
}

/** Doors time: an ISO instant is formatted in the event's zone, a plain "18:30" is shown as typed. */
function doorsLabel(event: ReminderEvent, lang: EmailLang): string {
  const raw = oneLine(event.doors_open_time)
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return formatEventWhen(raw, lang, event)?.time || ''
  // "18:30" / "18h30": shown in the same clock style formatEventWhen uses.
  const m = raw.match(/^(\d{1,2})\s*[:h]\s*(\d{2})$/i)
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
    const hour = Number(m[1])
    const mm = m[2]
    if (lang === 'fr') return mm === '00' ? `${hour}h` : `${hour}h${mm}`
    return `${hour % 12 === 0 ? 12 : hour % 12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`
  }
  return raw
}

function isEvening(iso: string | null, event: ReminderEvent): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const hour =
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: eventZone(event), hour: 'numeric', hour12: false }).format(d)
    ) % 24
  return hour >= 17 || hour < 4
}

// ---------------------------------------------------------------------------
// Reminder: the event is tomorrow
// ---------------------------------------------------------------------------

const REMINDER = {
  en: {
    status: 'Tomorrow',
    eyebrowNight: 'tomorrow night',
    eyebrowDay: 'tomorrow',
    subject: (e: string) => `${e} is tomorrow`,
    preheader: (e: string, when: string) => (when ? `${e}, ${when}. Your ticket is ready.` : `${e} is tomorrow. Your ticket is ready.`),
    time: 'Time',
    doors: 'Doors',
    venue: 'Venue',
    tickets: (n: number) => `${n} tickets`,
    view: 'View my ticket',
    viewMany: 'View my tickets',
    directions: 'Directions',
    goodToKnow: 'good to know',
    tips: [
      'Have your ticket open on your phone, with the screen brightness up.',
      'Plan your ride there ahead of time.',
      'Arrive a little early to skip the line at the door.',
    ],
    fallbackTitle: 'Your event',
  },
  fr: {
    status: 'Demain',
    eyebrowNight: 'demain soir',
    eyebrowDay: 'demain',
    subject: (e: string) => `${e}, c'est demain`,
    preheader: (e: string, when: string) => (when ? `${e}, ${when}. Votre billet est prêt.` : `${e}, c'est demain. Votre billet est prêt.`),
    time: 'Heure',
    doors: 'Portes',
    venue: 'Lieu',
    tickets: (n: number) => `${n} billets`,
    view: 'Voir mon billet',
    viewMany: 'Voir mes billets',
    directions: 'Itinéraire',
    goodToKnow: 'bon à savoir',
    tips: [
      "Ouvrez votre billet sur votre téléphone, luminosité de l'écran au maximum.",
      'Prévoyez votre trajet à l’avance.',
      "Arrivez un peu en avance pour éviter la file à l'entrée.",
    ],
    fallbackTitle: 'Votre événement',
  },
  ht: {
    status: 'Demen',
    eyebrowNight: 'demen swa',
    eyebrowDay: 'demen',
    subject: (e: string) => `${e} se demen`,
    preheader: (e: string, when: string) => (when ? `${e}, ${when}. Tikè ou pare.` : `${e} se demen. Tikè ou pare.`),
    time: 'Lè',
    doors: 'Pòtay',
    venue: 'Kote',
    tickets: (n: number) => `${n} tikè`,
    view: 'Wè tikè m',
    viewMany: 'Wè tikè m yo',
    directions: 'Direksyon',
    goodToKnow: 'bon pou konnen',
    tips: [
      'Louvri tikè ou sou telefòn ou, ak limyè ekran an byen wo.',
      'Planifye transpò ou davans.',
      'Rive yon ti jan bonè pou w pa fè liy nan pòtay la.',
    ],
    fallbackTitle: 'Evènman ou',
  },
} satisfies Record<EmailLang, unknown>

export function getEventReminderEmail(params: {
  lang?: EmailLang
  event: ReminderEvent
  /** Where the primary button goes: one ticket, or the tickets page. */
  ticketUrl: string
  /** How many tickets this person holds, when the email covers several. */
  ticketCount?: number
}): { subject: string; html: string } {
  const lang = pickLang(params.lang)
  const t = REMINDER[lang]
  const event = params.event
  const eventTitle = oneLine(event.title) || t.fallbackTitle
  const iso = eventInstantIso(event.start_datetime)
  const when = formatEventWhen(iso, lang, event)
  const count = Math.max(1, Number(params.ticketCount || 1))
  const maps = directionsUrl(event)
  const metaLine = [when?.long, count > 1 ? t.tickets(count) : ''].filter(Boolean).join(' · ')

  const html = renderEmail({
    lang,
    title: eventTitle,
    preheader: t.preheader(eventTitle, when?.line || ''),
    status: { label: t.status, tone: 'teal' },
    footer: 'attendee',
    blocks: [
      poster(event.banner_image_url, eventTitle),
      event.banner_image_url ? gap(28) : '',
      serifEyebrow(isEvening(iso, event) ? t.eyebrowNight : t.eyebrowDay),
      title(eventTitle),
      metaLine ? meta(metaLine) : '',
      gap(24),
      facts([
        { label: t.time, value: when?.time || '' },
        { label: t.doors, value: doorsLabel(event, lang) },
        { label: t.venue, value: venueLine(event) },
      ]),
      gap(24),
      button(count > 1 ? t.viewMany : t.view, params.ticketUrl),
      maps ? gap(10) : '',
      maps ? button(t.directions, maps, 'secondary') : '',
      gap(40),
      serifHeading(t.goodToKnow),
      lines(t.tips),
    ],
  })
  return { subject: t.subject(eventTitle), html }
}

// ---------------------------------------------------------------------------
// Organizer update to every ticket holder (time, place, cancellation…)
// ---------------------------------------------------------------------------

export type EventUpdateType = 'time' | 'location' | 'cancellation' | 'postponement' | 'important' | string

const UPDATE = {
  en: {
    kinds: {
      time: 'Time change',
      location: 'Location change',
      cancellation: 'Event cancelled',
      postponement: 'Event postponed',
      important: 'Important update',
      default: 'Event update',
    } as Record<string, string>,
    statusUpdate: 'Update',
    statusCancelled: 'Cancelled',
    subject: (kind: string, e: string) => `${kind}: ${e}`,
    preheader: (e: string) => `The organizer posted an update about ${e}.`,
    intro: 'The organizer posted an update about your event.',
    message: 'Message from the organizer',
    refund: 'Questions about a refund? Write to us from the Help page and we will sort it out.',
    view: 'View the event',
    fallbackTitle: 'Your event',
  },
  fr: {
    kinds: {
      time: "Changement d'horaire",
      location: 'Changement de lieu',
      cancellation: 'Événement annulé',
      postponement: 'Événement reporté',
      important: 'Information importante',
      default: "Nouvelles de l'événement",
    } as Record<string, string>,
    statusUpdate: 'Nouvelles',
    statusCancelled: 'Annulé',
    subject: (kind: string, e: string) => `${kind} : ${e}`,
    preheader: (e: string) => `L'organisateur a publié une mise à jour sur ${e}.`,
    intro: "L'organisateur a publié une mise à jour sur votre événement.",
    message: "Message de l'organisateur",
    refund: "Une question sur un remboursement ? Écrivez-nous depuis la page Aide, on s'en occupe.",
    view: "Voir l'événement",
    fallbackTitle: 'Votre événement',
  },
  ht: {
    kinds: {
      time: 'Lè a chanje',
      location: 'Kote a chanje',
      cancellation: 'Evènman an anile',
      postponement: 'Evènman an ranvwaye',
      important: 'Nouvèl enpòtan',
      default: 'Nouvèl evènman an',
    } as Record<string, string>,
    statusUpdate: 'Nouvèl',
    statusCancelled: 'Anile',
    subject: (kind: string, e: string) => `${kind}: ${e}`,
    preheader: (e: string) => `Òganizatè a pibliye yon nouvèl sou ${e}.`,
    intro: 'Òganizatè a pibliye yon nouvèl sou evènman ou an.',
    message: 'Mesaj òganizatè a',
    refund: 'Ou gen kesyon sou yon ranbousman? Ekri nou sou paj Èd la, n ap regle sa.',
    view: 'Wè evènman an',
    fallbackTitle: 'Evènman ou',
  },
} satisfies Record<EmailLang, unknown>

export function getEventUpdateNoticeEmail(params: {
  lang?: EmailLang
  event: ReminderEvent
  updateType?: EventUpdateType | null
  updateMessage: string
}): { subject: string; html: string } {
  const lang = pickLang(params.lang)
  const t = UPDATE[lang]
  const event = params.event
  const eventTitle = oneLine(event.title) || t.fallbackTitle
  const type = String(params.updateType || '')
  const kind = t.kinds[type] || t.kinds.default
  const cancelled = type === 'cancellation'
  const when = formatEventWhen(eventInstantIso(event.start_datetime), lang, event)
  const sub = [when?.line, venueLine(event)].filter(Boolean).join(' · ')
  const eventUrl = `${appUrl()}/events/${encodeURIComponent(String(event.id || ''))}`

  const html = renderEmail({
    lang,
    title: kind,
    preheader: t.preheader(eventTitle),
    status: cancelled ? { label: t.statusCancelled, tone: 'red' } : { label: t.statusUpdate, tone: 'amber' },
    footer: 'attendee',
    blocks: [
      eventRow(event.banner_image_url, eventTitle, sub),
      gap(28),
      title(kind, 34),
      gap(14),
      p(t.intro),
      gap(4),
      quote(t.message, String(params.updateMessage || '')),
      gap(24),
      cancelled ? p(t.refund) : '',
      cancelled ? gap(4) : '',
      button(t.view, eventUrl),
    ],
  })
  return { subject: t.subject(kind, eventTitle), html }
}
