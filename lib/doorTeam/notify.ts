/**
 * Door team notifications. Transactional (about the organizer's own request),
 * so never subject to quiet hours or marketing opt-outs.
 *
 * In-app rows go through `createNotification` in lib/notifications/helpers and
 * push DIRECTLY through `sendPushNotification` (never the same-named wrappers
 * in lib/notification-triggers: they write a second in-app row). The quote
 * also goes out by email to whoever made the request, since it asks them to pay.
 *
 * Recipients on the org side: orgRecipients 'event_ops' (owner, admin, manager).
 * Every send is best effort: a notification failure never fails the action.
 */

import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { resolveOrgRecipients } from '@/lib/notifications/orgRecipients'
import { normalizeLang, type EmailLang } from '@/lib/email-kit/i18n'
import { appUrl, button, C, eyebrow, facts, gap, p, renderEmail, title } from '@/lib/email-kit/layout'

type Copy = { title: string; body: string }

const nf = (n: number) => new Intl.NumberFormat('en-US').format(n)

async function userLang(uid: string): Promise<EmailLang> {
  try {
    const snap = await adminDb.collection('users').doc(uid).get()
    return normalizeLang(snap.exists ? snap.data()?.language : null) || 'en'
  } catch {
    return 'en'
  }
}

async function deliver(uid: string, type: any, copy: Copy, url: string, metadata: Record<string, any>) {
  try {
    await createNotification(uid, type, copy.title, copy.body, url, metadata)
  } catch (error) {
    console.error('[door-team] in-app notification failed', (error as any)?.message)
  }
  try {
    const { sendPushNotification } = await import('@/lib/notification-triggers')
    await sendPushNotification(uid, copy.title, copy.body, url, { type, ...metadata })
  } catch (error) {
    console.error('[door-team] push failed', (error as any)?.message)
  }
}

export const doorTeamPagePath = (eventId: string) => `/organizer/events/${encodeURIComponent(eventId)}/door-team`

export function quotedCopy(lang: EmailLang, eventTitle: string, priceHtg: number): Copy {
  const price = nf(priceHtg)
  return {
    en: { title: `Door team quote: ${eventTitle}`, body: `Tikèm can staff your door for ${price} HTG. Pay to confirm the crew.` },
    fr: { title: `Devis équipe d'accueil : ${eventTitle}`, body: `Tikèm peut gérer votre entrée pour ${price} HTG. Payez pour confirmer l'équipe.` },
    ht: { title: `Pri ekip pòt la: ${eventTitle}`, body: `Tikèm ka jere pòt ou a pou ${price} HTG. Peye pou konfime ekip la.` },
  }[lang]
}

export function declinedCopy(lang: EmailLang, eventTitle: string): Copy {
  return {
    en: { title: `Door team not available: ${eventTitle}`, body: 'Tikèm cannot staff this event. Open the request to see why.' },
    fr: { title: `Équipe d'accueil indisponible : ${eventTitle}`, body: 'Tikèm ne peut pas couvrir cet événement. Ouvrez la demande pour voir pourquoi.' },
    ht: { title: `Ekip pòt la pa disponib: ${eventTitle}`, body: 'Tikèm pa ka kouvri evènman sa a. Louvri demann lan pou w wè poukisa.' },
  }[lang]
}

export function confirmedCopy(lang: EmailLang, eventTitle: string, names: string): Copy {
  return {
    en: { title: `Door team confirmed: ${eventTitle}`, body: names ? `Your crew: ${names}.` : 'Your crew is confirmed.' },
    fr: { title: `Équipe d'accueil confirmée : ${eventTitle}`, body: names ? `Votre équipe : ${names}.` : 'Votre équipe est confirmée.' },
    ht: { title: `Ekip pòt la konfime: ${eventTitle}`, body: names ? `Ekip ou: ${names}.` : 'Ekip ou a konfime.' },
  }[lang]
}

export function crewCopy(lang: EmailLang, eventTitle: string, when: string, contact: string): Copy {
  return {
    en: { title: `Door shift: ${eventTitle}`, body: `Arrive ${when}. On-site contact: ${contact}.` },
    fr: { title: `Service à l'entrée : ${eventTitle}`, body: `Arrivée ${when}. Contact sur place : ${contact}.` },
    ht: { title: `Sèvis nan pòt: ${eventTitle}`, body: `Rive ${when}. Kontak sou plas: ${contact}.` },
  }[lang]
}

const EMAIL = {
  en: {
    status: 'Quote',
    eyebrow: 'Door team',
    headline: (e: string) => `Your door team quote for ${e}`,
    body: 'Tikèm will send its own crew to scan tickets at your door. Pay the quote to confirm; we then assign the crew and share their names.',
    staff: 'Crew',
    hours: 'Hours',
    price: 'Price',
    note: 'Note from Tikèm',
    cta: 'Review and pay',
    expires: (d: string) => `This quote is open until ${d}.`,
    subject: (e: string) => `Door team quote: ${e}`,
  },
  fr: {
    status: 'Devis',
    eyebrow: "Équipe d'accueil",
    headline: (e: string) => `Votre devis d'équipe d'accueil pour ${e}`,
    body: "Tikèm envoie sa propre équipe pour scanner les billets à l'entrée. Payez le devis pour confirmer ; nous affectons ensuite l'équipe et vous donnons leurs noms.",
    staff: 'Équipe',
    hours: 'Heures',
    price: 'Prix',
    note: 'Note de Tikèm',
    cta: 'Voir et payer',
    expires: (d: string) => `Ce devis est valable jusqu'au ${d}.`,
    subject: (e: string) => `Devis équipe d'accueil : ${e}`,
  },
  ht: {
    status: 'Pri',
    eyebrow: 'Ekip pòt',
    headline: (e: string) => `Pri ekip pòt pou ${e}`,
    body: 'Tikèm ap voye pwòp ekip li pou eskane tikè nan pòt ou. Peye pri a pou konfime; apre sa nou mete ekip la epi ba ou non yo.',
    staff: 'Ekip',
    hours: 'Èdtan',
    price: 'Pri',
    note: 'Nòt Tikèm',
    cta: 'Gade epi peye',
    expires: (d: string) => `Pri sa a valab jiska ${d}.`,
    subject: (e: string) => `Pri ekip pòt: ${e}`,
  },
} as const

export function quoteEmail(params: {
  lang: EmailLang
  eventTitle: string
  staff: number
  hours: number
  priceHtg: number
  note: string
  expiresAt: string | null
  url: string
}): { subject: string; html: string } {
  const t = EMAIL[params.lang] || EMAIL.en
  const ev = params.eventTitle.replace(/[\r\n]+/g, ' ').trim() || 'Tikèm'
  const expires = params.expiresAt
    ? new Date(params.expiresAt).toLocaleString(params.lang === 'en' ? 'en-US' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Port-au-Prince' })
    : ''
  const html = renderEmail({
    lang: params.lang,
    title: t.headline(ev),
    preheader: t.body,
    status: { label: t.status, tone: 'teal' },
    footer: 'organizer',
    blocks: [
      eyebrow(t.eyebrow),
      title(t.headline(ev), 30),
      gap(16),
      p(t.body),
      gap(16),
      facts([
        { label: t.staff, value: String(params.staff) },
        { label: t.hours, value: String(params.hours) },
        { label: t.price, value: `${nf(params.priceHtg)} HTG` },
      ]),
      params.note ? gap(16) : '',
      params.note ? p(`${t.note}: ${params.note}`) : '',
      gap(12),
      button(t.cta, params.url),
      expires ? gap(16) : '',
      expires ? p(t.expires(expires), C.text3) : '',
    ],
  })
  return { subject: t.subject(ev), html }
}

interface ReqLike {
  id: string
  event_id: string
  organizer_id: string
  event_title?: string
  staff_count?: number
  hours?: number
  price_htg?: number | null
  quote_note?: string
  quote_expires_at?: string | null
  created_by?: string
  arrival_at?: string
  contact_name?: string
  contact_phone?: string
  crew?: Array<{ uid: string; first_name: string }>
}

async function orgSide(r: ReqLike): Promise<string[]> {
  const ids = await resolveOrgRecipients({ orgId: r.organizer_id, kind: 'event_ops', eventId: r.event_id }).catch(() => [r.organizer_id])
  return Array.from(new Set([...ids, ...(r.created_by ? [r.created_by] : [])].filter(Boolean)))
}

export async function notifyQuoted(r: ReqLike): Promise<void> {
  const url = doorTeamPagePath(r.event_id)
  const title = String(r.event_title || '')
  const recipients = await orgSide(r)
  await Promise.all(
    recipients.map(async (uid) => {
      const lang = await userLang(uid)
      await deliver(uid, 'door_team_update', quotedCopy(lang, title, Number(r.price_htg) || 0), url, { eventId: r.event_id, requestId: r.id })
    })
  )
  // The email asks for money, so it goes to the person who asked for the crew.
  if (r.created_by) {
    try {
      const [user, lang] = await Promise.all([adminDb.collection('users').doc(r.created_by).get(), userLang(r.created_by)])
      const email = String(user.data()?.email || '').trim()
      if (email) {
        const { sendEmail } = await import('@/lib/email')
        const mail = quoteEmail({
          lang,
          eventTitle: title,
          staff: Number(r.staff_count) || 0,
          hours: Number(r.hours) || 0,
          priceHtg: Number(r.price_htg) || 0,
          note: String(r.quote_note || ''),
          expiresAt: r.quote_expires_at || null,
          url: `${appUrl()}${url}`,
        })
        await sendEmail({ to: email, subject: mail.subject, html: mail.html })
      }
    } catch (error) {
      console.error('[door-team] quote email failed', (error as any)?.message)
    }
  }
}

export async function notifyDeclined(r: ReqLike): Promise<void> {
  const url = doorTeamPagePath(r.event_id)
  const recipients = await orgSide(r)
  await Promise.all(
    recipients.map(async (uid) => {
      const lang = await userLang(uid)
      await deliver(uid, 'door_team_update', declinedCopy(lang, String(r.event_title || '')), url, { eventId: r.event_id, requestId: r.id })
    })
  )
}

/** Confirmed: the organizer side learns the crew's first names; each crew member gets the shift. */
export async function notifyConfirmed(r: ReqLike): Promise<void> {
  const url = doorTeamPagePath(r.event_id)
  const names = (r.crew || []).map((c) => c.first_name).filter(Boolean).join(', ')
  const recipients = await orgSide(r)
  await Promise.all(
    recipients.map(async (uid) => {
      const lang = await userLang(uid)
      await deliver(uid, 'door_team_update', confirmedCopy(lang, String(r.event_title || ''), names), url, { eventId: r.event_id, requestId: r.id })
    })
  )
  const contact = [r.contact_name, r.contact_phone].filter(Boolean).join(' ')
  await Promise.all(
    (r.crew || []).map(async (c) => {
      const lang = await userLang(c.uid)
      const when = r.arrival_at
        ? new Date(r.arrival_at).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Port-au-Prince' })
        : ''
      await deliver(c.uid, 'door_team_crew', crewCopy(lang, String(r.event_title || ''), when, contact), `/organizer/scan/${encodeURIComponent(r.event_id)}`, {
        eventId: r.event_id,
        requestId: r.id,
      })
    })
  )
}

/** Platform admins: a new request, a payment, or a cancellation that needs a refund. */
export async function notifyAdmins(r: ReqLike, what: 'requested' | 'paid' | 'refund_due'): Promise<void> {
  try {
    const admins = await adminDb.collection('users').where('role', 'in', ['admin', 'super_admin']).get()
    const title = {
      requested: `Door team request: ${r.event_title || r.event_id}`,
      paid: `Door team paid: ${r.event_title || r.event_id}`,
      refund_due: `Door team refund due: ${r.event_title || r.event_id}`,
    }[what]
    const body = {
      requested: `${r.staff_count} staff for ${r.hours}h. Quote or decline it.`,
      paid: `${nf(Number(r.price_htg) || 0)} HTG paid. Assign the crew.`,
      refund_due: 'Cancelled in time: refund it to the original payment method.',
    }[what]
    await Promise.all(
      admins.docs.map((d: any) =>
        createNotification(d.id, 'door_team_request' as any, title, body, '/admin/system/door-team', { requestId: r.id, eventId: r.event_id }).catch(() => null)
      )
    )
  } catch (error) {
    console.error('[door-team] admin notification failed', (error as any)?.message)
  }
}
