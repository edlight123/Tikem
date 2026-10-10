// Email service for sending notifications
// Using Resend API (direct fetch, no SDK) for production-ready email delivery.
//
// Templates use the shared Tikèm email kit (lib/email-kit): one premium dark layout
// (Stitch "Tikèm POSH Dark", Oct 2026) and every message in English, French and
// Kreyòl. Each template takes an optional `lang`; callers resolve it from the
// recipient (see lib/email-kit/recipient.ts). Subjects live next to their template
// in `emailSubjects` so the subject line and the body always share a language.
import { escapeHtml } from '@/lib/html'
import {
  renderEmail,
  appUrl,
  poster,
  title,
  meta,
  eyebrow,
  serifHeading,
  serifEyebrow,
  p,
  paragraphHtml,
  strong,
  gap,
  button,
  textLink,
  rowsBlock,
  facts,
  metric,
  bigFigure,
  steps,
  lines,
  timeline,
  eventRow,
  quote,
  linkBlock,
  ticketStub,
} from '@/lib/email-kit/layout'
import { COMMON, formatMoney, pickLang, type EmailLang } from '@/lib/email-kit/i18n'

export type { EmailLang } from '@/lib/email-kit/i18n'

export type EmailAttachment = {
  filename: string
  /** Base64 content. */
  content: string
  contentType?: string
  /** Set to reference the file inline as `<img src="cid:{contentId}">`. */
  contentId?: string
}

type EmailParams = {
  to: string | null | undefined
  subject: string
  html: string
  attachments?: EmailAttachment[]
  replyTo?: string
}

/**
 * What every caller gets back. `success: false` is ALWAYS a returned value, never a
 * throw: the Stripe webhook calls this inline, and a throw there surfaces to Stripe as
 * a failed delivery — retried forever for a problem no retry can fix.
 */
export type SendEmailResult = {
  success: boolean
  error?: string
  messageId?: string
  /** Machine-readable reason, so callers can distinguish "no address" from "Resend is down". */
  code?: 'missing_recipient' | 'no_api_key' | 'dummy_api_key' | 'provider_error'
}

/**
 * Escape text that a USER typed before it lands in an email's HTML.
 *
 * Most templates below interpolate values we generated ourselves. Free-text
 * written by one person and delivered to another (an organizer's reply, the
 * attendee's original question) is different: unescaped, a `<a href>` or a
 * `<style>` in the message body would render as live markup in the recipient's
 * mail client.
 */
export { escapeHtml }

export const EMAIL_FROM_DEFAULT = 'Tikèm <noreply@tikem.co>'

export async function sendEmail({ to, subject, html, attachments, replyTo }: EmailParams): Promise<SendEmailResult> {
  // NULL-GUARD THE RECIPIENT FIRST.
  //
  // A user document without an `email` (and a guest order whose contact resolution
  // failed) used to reach Resend as `to: undefined`. Resend answers 4xx, we threw,
  // and in the Stripe webhook that throw became a webhook FAILURE — Stripe then
  // retries an event whose tickets were already issued. There is nothing to retry:
  // the address doesn't exist. Report it and move on.
  const recipient = typeof to === 'string' ? to.trim() : ''
  if (!recipient) {
    console.warn('⚠️  sendEmail called with no recipient address — nothing sent', { subject })
    return { success: false, error: 'No recipient email address', code: 'missing_recipient' }
  }

  // Check API key configuration
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('❌ RESEND_API_KEY not configured - email will not be sent')
    console.warn('   Add RESEND_API_KEY to your environment variables')
    console.warn(`   Would send to: ${recipient}`)
    console.warn(`   Subject: ${subject}`)
    return { success: false, error: 'No API key configured', messageId: undefined, code: 'no_api_key' }
  }

  if (apiKey === 're_dummy_key_for_build') {
    console.warn('❌ RESEND_API_KEY is set to dummy value - email will not be sent')
    console.warn('   Replace with a real API key from https://resend.com')
    console.warn(`   Would send to: ${recipient}`)
    console.warn(`   Subject: ${subject}`)
    return { success: false, error: 'Dummy API key - replace with real key from Resend', messageId: undefined, code: 'dummy_api_key' }
  }

  try {
    console.log(`📧 Sending email to ${recipient}: ${subject}`)

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT,
        to: recipient,
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments?.length
          ? {
              attachments: attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { content_type: a.contentType } : {}),
                ...(a.contentId ? { content_id: a.contentId } : {}),
              })),
            }
          : {}),
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('❌ Email API error:', data)
      throw new Error(data.message || 'Failed to send email')
    }

    console.log('✅ Email sent successfully! Message ID:', data.id)
    return { success: true, messageId: data.id }
  } catch (error: any) {
    console.error('❌ Failed to send email:', error)
    return { success: false, error: error.message, code: 'provider_error' }
  }
}

/** The inline QR attachment's content id; templates reference it as `cid:ticket-qr`. */
export const TICKET_QR_CID = 'ticket-qr'

const L = <T,>(lang: EmailLang | undefined, dict: Record<EmailLang, T>): T => dict[pickLang(lang)]
const enc = (v: unknown) => encodeURIComponent(String(v ?? ''))

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export const emailSubjects = {
  ticketConfirmation: (lang: EmailLang | undefined, eventTitle: string, quantity = 1) =>
    L(lang, {
      en: quantity > 1 ? `Your ${quantity} tickets for ${eventTitle}` : `Your ticket for ${eventTitle}`,
      fr: quantity > 1 ? `Vos ${quantity} billets pour ${eventTitle}` : `Votre billet pour ${eventTitle}`,
      ht: quantity > 1 ? `${quantity} tikè ou yo pou ${eventTitle}` : `Tikè ou pou ${eventTitle}`,
    }),
  eventCreated: (lang: EmailLang | undefined, eventTitle: string) =>
    L(lang, { en: `${eventTitle} is live`, fr: `${eventTitle} est en ligne`, ht: `${eventTitle} an liy` }),
  refundRequest: (lang: EmailLang | undefined, eventTitle: string) =>
    L(lang, {
      en: `Refund request for ${eventTitle}`,
      fr: `Demande de remboursement pour ${eventTitle}`,
      ht: `Demann ranbousman pou ${eventTitle}`,
    }),
  refundProcessed: (lang: EmailLang | undefined, eventTitle: string, approved: boolean) =>
    L(lang, {
      en: approved ? `Your refund for ${eventTitle} is on its way` : `About your refund for ${eventTitle}`,
      fr: approved ? `Votre remboursement pour ${eventTitle} est en route` : `À propos de votre remboursement pour ${eventTitle}`,
      ht: approved ? `Ranbousman ou pou ${eventTitle} ap vini` : `Konsènan ranbousman ou pou ${eventTitle}`,
    }),
  waitlist: (lang: EmailLang | undefined, eventTitle: string) =>
    L(lang, {
      en: `Tickets are available for ${eventTitle}`,
      fr: `Des billets sont disponibles pour ${eventTitle}`,
      ht: `Gen tikè disponib pou ${eventTitle}`,
    }),
  transferRequest: (lang: EmailLang | undefined, senderName: string) =>
    L(lang, {
      en: `${senderName} sent you a ticket`,
      fr: `${senderName} vous a envoyé un billet`,
      ht: `${senderName} voye yon tikè ba ou`,
    }),
  transferResponse: (lang: EmailLang | undefined, eventTitle: string, accepted: boolean) =>
    L(lang, {
      en: accepted ? `Your ticket transfer for ${eventTitle} was accepted` : `Your ticket transfer for ${eventTitle} was declined`,
      fr: accepted ? `Votre transfert de billet pour ${eventTitle} a été accepté` : `Votre transfert de billet pour ${eventTitle} a été refusé`,
      ht: accepted ? `Yo aksepte tikè ou transfere pou ${eventTitle}` : `Yo refize tikè ou transfere pou ${eventTitle}`,
    }),
  transferCancelled: (lang: EmailLang | undefined, eventTitle: string) =>
    L(lang, {
      en: `Ticket transfer cancelled for ${eventTitle}`,
      fr: `Transfert de billet annulé pour ${eventTitle}`,
      ht: `Transfè tikè anile pou ${eventTitle}`,
    }),
  eventUpdate: (lang: EmailLang | undefined, eventTitle: string) =>
    L(lang, { en: `Update: ${eventTitle}`, fr: `Mise à jour : ${eventTitle}`, ht: `Nouvèl: ${eventTitle}` }),
  organizerReply: (lang: EmailLang | undefined, organizerName: string, eventTitle: string) =>
    L(lang, {
      en: `${organizerName} replied about ${eventTitle}`,
      fr: `${organizerName} a répondu à propos de ${eventTitle}`,
      ht: `${organizerName} reponn ou sou ${eventTitle}`,
    }),
  bankVerification: (lang: EmailLang | undefined, approved: boolean) =>
    L(lang, {
      en: approved ? 'Your bank account is verified' : 'We could not verify your bank account',
      fr: approved ? 'Votre compte bancaire est vérifié' : "Nous n'avons pas pu vérifier votre compte bancaire",
      ht: approved ? 'Kont labank ou verifye' : 'Nou pa t ka verifye kont labank ou',
    }),
}

// ---------------------------------------------------------------------------
// Buyer: ticket confirmation
// ---------------------------------------------------------------------------

export function getTicketConfirmationEmail(params: {
  attendeeName: string
  eventTitle: string
  eventDate: string
  eventVenue: string
  ticketId: string
  /**
   * The QR image. Pass `cid:ticket-qr` with the PNG attached (see TICKET_QR_CID):
   * Gmail strips `data:` images, so a data URL only renders in Apple Mail.
   */
  qrCodeDataURL?: string
  ticketTier?: string
  ticketPrice?: number
  currency?: string
  quantity?: number
  /** Fees and total, when known, for the receipt block. */
  serviceFee?: number
  total?: number
  paidWith?: string
  /** The event flyer (`banner_image_url`). */
  posterUrl?: string | null
  /** Doors time, already formatted. */
  doorsTime?: string
  /**
   * Where "View my ticket" points. A GUEST has no /tickets page to log into, so
   * the caller passes their signed retrieval link instead. Omitted ⇒ the normal
   * account page, exactly as before.
   */
  ticketsUrl?: string
  /** Buyer-facing note under the button (e.g. "this link is yours — keep it"). */
  ticketsUrlNote?: string
  walletUrl?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: {
      status: 'Confirmed',
      holder: 'Holder',
      ticket: 'Ticket',
      general: 'General',
      free: 'Free',
      codeNote: 'Show this at the door',
      view: 'View my ticket',
      wallet: 'Add to Apple Wallet',
      before: 'before you go',
      doors: (d: string) => `Doors open at ${d}`,
      tips: ['Turn your screen brightness up at the door', 'Your ticket is also in the Tikèm app'],
      service: 'Service fee',
      total: 'Total',
      preheader: (e: string) => `Your ticket for ${e}. Show the QR code at the door.`,
      guest: 'Guest',
    },
    fr: {
      status: 'Confirmé',
      holder: 'Titulaire',
      ticket: 'Billet',
      general: 'Général',
      free: 'Gratuit',
      codeNote: "Présentez-le à l'entrée",
      view: 'Voir mon billet',
      wallet: 'Ajouter à Apple Wallet',
      before: 'avant de partir',
      doors: (d: string) => `Ouverture des portes à ${d}`,
      tips: ["Augmentez la luminosité de l'écran à l'entrée", "Votre billet est aussi dans l'application Tikèm"],
      service: 'Frais de service',
      total: 'Total',
      preheader: (e: string) => `Votre billet pour ${e}. Présentez le QR code à l'entrée.`,
      guest: 'Invité',
    },
    ht: {
      status: 'Konfime',
      holder: 'Pòtè',
      ticket: 'Tikè',
      general: 'Jeneral',
      free: 'Gratis',
      codeNote: 'Montre sa nan pòtay la',
      view: 'Wè tikè m',
      wallet: 'Mete l nan Apple Wallet',
      before: 'anvan ou ale',
      doors: (d: string) => `Pòtay la ouvri a ${d}`,
      tips: ['Ogmante limyè ekran w nan pòtay la', 'Tikè w la nan app Tikèm tou'],
      service: 'Frè sèvis',
      total: 'Total',
      preheader: (e: string) => `Tikè ou pou ${e}. Montre QR kòd la nan pòtay la.`,
      guest: 'Envite',
    },
  })
  const base = appUrl()
  const qty = Math.max(1, Number(params.quantity || 1))
  const tier = params.ticketTier || t.general
  const code = String(params.ticketId || '').slice(0, 12).toUpperCase()
  const ticketsUrl = params.ticketsUrl || `${base}/tickets`
  const price = params.ticketPrice ? formatMoney(params.ticketPrice, params.currency, lang) : t.free
  const metaLine = [params.eventDate, params.eventVenue].filter(Boolean).join(' · ')

  const receiptRows: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }> = []
  if (params.ticketPrice) {
    receiptRows.push({ label: qty > 1 ? `${tier} × ${qty}` : tier, value: formatMoney(params.ticketPrice * qty, params.currency, lang) })
    if (params.serviceFee) receiptRows.push({ label: t.service, value: formatMoney(params.serviceFee, params.currency, lang), muted: true })
    receiptRows.push({
      label: t.total,
      value: formatMoney(params.total ?? params.ticketPrice * qty + (params.serviceFee || 0), params.currency, lang),
      strong: true,
    })
  }

  return renderEmail({
    lang,
    title: params.eventTitle,
    preheader: t.preheader(params.eventTitle),
    status: { label: t.status, tone: 'teal' },
    footer: 'attendee',
    blocks: [
      poster(params.posterUrl, params.eventTitle),
      params.posterUrl ? gap(28) : '',
      title(params.eventTitle),
      metaLine ? meta(metaLine) : '',
      gap(28),
      ticketStub({
        holderLabel: t.holder,
        holder: params.attendeeName || t.guest,
        ticketLabel: t.ticket,
        ticket: `${tier} · ${qty}`,
        qrSrc: params.qrCodeDataURL,
        code,
        codeNote: t.codeNote,
      }),
      gap(20),
      button(t.view, ticketsUrl),
      params.ticketsUrlNote ? `<div style="margin:12px 0 0;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6B6B6B;">${escapeHtml(params.ticketsUrlNote)}</div>` : '',
      params.walletUrl ? textLink(t.wallet, params.walletUrl) : '',
      gap(40),
      serifHeading(t.before),
      lines([...(params.doorsTime ? [t.doors(params.doorsTime)] : []), ...t.tips]),
      receiptRows.length ? gap(24) : '',
      receiptRows.length ? rowsBlock(receiptRows, params.paidWith) : '',
      !receiptRows.length ? gap(4) : '',
    ],
  })
}

// ---------------------------------------------------------------------------
// Organizer: event published
// ---------------------------------------------------------------------------

export function getEventCreatedEmail(params: {
  organizerName: string
  eventTitle: string
  eventDate: string
  eventId: string
  posterUrl?: string | null
  venue?: string
  /** Total capacity and lowest price, when known. */
  capacity?: number
  priceFrom?: number
  currency?: string
  eventUrl?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: {
      status: 'Live',
      eyebrow: 'For organizers',
      headline: (e: string) => `${e} is live.`,
      tickets: 'Tickets',
      from: 'Price from',
      free: 'Free',
      share: 'Share your event',
      dashboard: 'Open dashboard',
      sell: 'sell it out',
      steps: [
        'Post the link in your Instagram bio and stories',
        'Send it to your WhatsApp groups',
        'Give promoters their own links to see who sells',
      ],
      preheader: (e: string) => `${e} is published. Here is your link.`,
    },
    fr: {
      status: 'En ligne',
      eyebrow: 'Pour les organisateurs',
      headline: (e: string) => `${e} est en ligne.`,
      tickets: 'Billets',
      from: 'À partir de',
      free: 'Gratuit',
      share: 'Partager votre événement',
      dashboard: 'Ouvrir le tableau de bord',
      sell: 'faites salle comble',
      steps: [
        'Mettez le lien dans votre bio et vos stories Instagram',
        'Envoyez-le dans vos groupes WhatsApp',
        'Donnez à vos promoteurs leur propre lien pour voir qui vend',
      ],
      preheader: (e: string) => `${e} est publié. Voici votre lien.`,
    },
    ht: {
      status: 'An liy',
      eyebrow: 'Pou òganizatè',
      headline: (e: string) => `${e} an liy.`,
      tickets: 'Tikè',
      from: 'Apati',
      free: 'Gratis',
      share: 'Pataje evènman ou',
      dashboard: 'Louvri tablo a',
      sell: 'plen sal la',
      steps: [
        'Mete lyen an nan bio ak stories Instagram ou',
        'Voye l nan gwoup WhatsApp ou yo',
        'Bay pwomotè ou yo pwòp lyen pa yo pou w wè kiyès k ap vann',
      ],
      preheader: (e: string) => `${e} pibliye. Men lyen ou.`,
    },
  })
  const base = appUrl()
  const eventUrl = params.eventUrl || `${base}/events/${enc(params.eventId)}`
  const manageUrl = `${base}/organizer/events/${enc(params.eventId)}`
  const metaLine = [params.eventDate, params.venue].filter(Boolean).join(' · ')
  const metrics = [
    params.capacity ? metric(t.tickets, String(params.capacity)) : '',
    params.priceFrom !== undefined
      ? params.priceFrom > 0
        ? metric(t.from, formatMoney(params.priceFrom, params.currency, lang).split(' ')[0], String(params.currency || 'HTG').toUpperCase())
        : metric(t.from, t.free)
      : '',
  ].join('')
  const posterBlock = params.posterUrl
    ? metrics
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="352" valign="top">${poster(params.posterUrl, params.eventTitle, 352)}</td><td valign="top" style="padding-left:24px;">${metrics}</td></tr></table>`
      : poster(params.posterUrl, params.eventTitle)
    : metrics

  return renderEmail({
    lang,
    title: params.eventTitle,
    preheader: t.preheader(params.eventTitle),
    status: { label: t.status, tone: 'teal' },
    footer: 'organizer',
    blocks: [
      eyebrow(t.eyebrow),
      title(t.headline(params.eventTitle)),
      metaLine ? meta(metaLine) : '',
      gap(28),
      posterBlock,
      posterBlock ? gap(24) : '',
      linkBlock(eventUrl),
      gap(16),
      button(t.share, eventUrl),
      gap(10),
      button(t.dashboard, manageUrl, 'secondary'),
      gap(40),
      serifHeading(t.sell),
      steps(t.steps),
    ],
  })
}

// ---------------------------------------------------------------------------
// Organizer: a buyer asked for a refund
// ---------------------------------------------------------------------------

export function getRefundRequestEmail(params: {
  organizerName: string
  eventTitle: string
  attendeeEmail: string
  reason: string
  ticketId: string
  amount: number
  currency?: string
  eventId?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: {
      status: 'Action needed',
      headline: 'A buyer asked for a refund',
      body: (e: string) => `Someone with a ticket for ${e} would like their money back. Review it from your dashboard.`,
      buyer: 'Buyer',
      amount: 'Amount',
      reason: 'Their reason',
      review: 'Review the request',
      preheader: (e: string) => `A refund request for ${e} is waiting for you.`,
    },
    fr: {
      status: 'Action requise',
      headline: 'Un acheteur demande un remboursement',
      body: (e: string) => `Une personne ayant un billet pour ${e} souhaite être remboursée. Examinez la demande depuis votre tableau de bord.`,
      buyer: 'Acheteur',
      amount: 'Montant',
      reason: 'Son motif',
      review: 'Examiner la demande',
      preheader: (e: string) => `Une demande de remboursement pour ${e} vous attend.`,
    },
    ht: {
      status: 'Aksyon nesesè',
      headline: 'Yon achtè mande ranbousman',
      body: (e: string) => `Yon moun ki gen tikè pou ${e} ta renmen jwenn kòb li tounen. Gade demann lan nan tablo ou.`,
      buyer: 'Achtè',
      amount: 'Montan',
      reason: 'Rezon li',
      review: 'Gade demann lan',
      preheader: (e: string) => `Gen yon demann ranbousman pou ${e} k ap tann ou.`,
    },
  })
  const base = appUrl()
  const reviewUrl = params.eventId ? `${base}/organizer/events/${enc(params.eventId)}` : `${base}/organizer/events`
  return renderEmail({
    lang,
    title: t.headline,
    preheader: t.preheader(params.eventTitle),
    status: { label: t.status, tone: 'amber' },
    footer: 'organizer',
    blocks: [
      title(t.headline, 34),
      gap(14),
      p(t.body(params.eventTitle)),
      gap(8),
      rowsBlock([
        { label: t.buyer, value: params.attendeeEmail },
        { label: t.amount, value: formatMoney(params.amount, params.currency, lang) },
        { label: COMMON[lang].reference, value: String(params.ticketId).slice(0, 12).toUpperCase(), mono: true },
      ]),
      params.reason ? gap(14) : '',
      params.reason ? quote(t.reason, params.reason) : '',
      gap(24),
      button(t.review, reviewUrl),
    ],
  })
}

// ---------------------------------------------------------------------------
// Buyer: refund decided
// ---------------------------------------------------------------------------

export function getRefundProcessedEmail(params: {
  attendeeName: string
  eventTitle: string
  status: 'approved' | 'denied'
  refundAmount: number
  ticketId: string
  currency?: string
  /** "MonCash", "card", … where the money goes back to. */
  method?: string
  posterUrl?: string | null
  eventSub?: string
  serviceFee?: number
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const approved = params.status === 'approved'
  const t = L(lang, {
    en: {
      approvedEyebrow: 'Refund approved',
      deniedEyebrow: 'Refund not approved',
      backTo: (m: string) => `back to your ${m}`,
      originalMethod: 'original payment method',
      steps: [
        { label: 'Approved', detail: 'Today' },
        { label: 'Sent back', detail: 'within 24 hours' },
        { label: 'In your account', detail: '5 to 10 business days', moncash: '1 to 3 days' },
      ],
      fee: 'Service fee (not refunded)',
      refund: 'Refund',
      ticket: 'Ticket',
      deniedHead: 'Your refund was not approved',
      deniedBody: (e: string) => `The organizer of ${e} reviewed your request and could not approve it. Your ticket is still valid.`,
      questions: 'Questions? Write to the organizer from the event page.',
      preheaderOk: (a: string) => `${a} is on its way back to you.`,
      preheaderNo: (e: string) => `An update on your refund request for ${e}.`,
    },
    fr: {
      approvedEyebrow: 'Remboursement approuvé',
      deniedEyebrow: 'Remboursement refusé',
      backTo: (m: string) => `retour sur votre ${m}`,
      originalMethod: 'moyen de paiement initial',
      steps: [
        { label: 'Approuvé', detail: "Aujourd'hui" },
        { label: 'Renvoyé', detail: 'sous 24 heures' },
        { label: 'Sur votre compte', detail: '5 à 10 jours ouvrés', moncash: '1 à 3 jours' },
      ],
      fee: 'Frais de service (non remboursés)',
      refund: 'Remboursement',
      ticket: 'Billet',
      deniedHead: "Votre remboursement n'a pas été approuvé",
      deniedBody: (e: string) => `L'organisateur de ${e} a examiné votre demande et n'a pas pu l'approuver. Votre billet reste valable.`,
      questions: "Des questions ? Écrivez à l'organisateur depuis la page de l'événement.",
      preheaderOk: (a: string) => `${a} est en route vers vous.`,
      preheaderNo: (e: string) => `Une mise à jour sur votre demande de remboursement pour ${e}.`,
    },
    ht: {
      approvedEyebrow: 'Ranbousman apwouve',
      deniedEyebrow: 'Ranbousman pa apwouve',
      backTo: (m: string) => `ap tounen sou ${m} ou`,
      originalMethod: 'mwayen peman ou te itilize a',
      steps: [
        { label: 'Apwouve', detail: 'Jodi a' },
        { label: 'Voye tounen', detail: 'nan 24 èdtan' },
        { label: 'Sou kont ou', detail: '5 a 10 jou ouvrab', moncash: '1 a 3 jou' },
      ],
      fee: 'Frè sèvis (pa ranbouse)',
      refund: 'Ranbousman',
      ticket: 'Tikè',
      deniedHead: 'Yo pa t apwouve ranbousman ou',
      deniedBody: (e: string) => `Òganizatè ${e} gade demann ou a, men li pa t ka apwouve l. Tikè ou toujou valab.`,
      questions: 'Ou gen kesyon? Ekri òganizatè a sou paj evènman an.',
      preheaderOk: (a: string) => `${a} ap tounen ba ou.`,
      preheaderNo: (e: string) => `Nouvèl sou demann ranbousman ou pou ${e}.`,
    },
  })
  const base = appUrl()
  const amount = formatMoney(params.refundAmount, params.currency, lang)
  const [num, cur] = [amount.slice(0, amount.lastIndexOf(' ')), amount.slice(amount.lastIndexOf(' ') + 1)]

  if (!approved) {
    return renderEmail({
      lang,
      title: t.deniedHead,
      preheader: t.preheaderNo(params.eventTitle),
      footer: 'attendee',
      blocks: [
        eyebrow(t.deniedEyebrow, 'grey'),
        title(t.deniedHead, 34),
        gap(14),
        p(t.deniedBody(params.eventTitle)),
        gap(8),
        eventRow(params.posterUrl, params.eventTitle, params.eventSub),
        gap(24),
        rowsBlock([{ label: COMMON[lang].reference, value: String(params.ticketId).slice(0, 12).toUpperCase(), mono: true }]),
        gap(20),
        p(t.questions),
        gap(4),
        button(COMMON[lang].findEvents, `${base}/discover`, 'secondary'),
      ],
    })
  }

  const rows: Array<{ label: string; value: string; strong?: boolean; mono?: boolean; muted?: boolean }> = []
  if (params.serviceFee) {
    rows.push({ label: t.ticket, value: amount })
    rows.push({ label: t.fee, value: formatMoney(params.serviceFee, params.currency, lang), muted: true })
  }
  rows.push({ label: t.refund, value: amount, strong: true })
  rows.push({ label: COMMON[lang].reference, value: String(params.ticketId).slice(0, 12).toUpperCase(), mono: true })

  return renderEmail({
    lang,
    title: t.approvedEyebrow,
    preheader: t.preheaderOk(amount),
    footer: 'attendee',
    blocks: [
      eyebrow(t.approvedEyebrow, 'teal'),
      bigFigure(num, cur, t.backTo(params.method || t.originalMethod)),
      gap(32),
      eventRow(params.posterUrl, params.eventTitle, params.eventSub),
      gap(28),
      timeline(
        t.steps.map((s: { label: string; detail: string; moncash?: string }, i) => ({
          label: s.label,
          detail: s.moncash && /moncash/i.test(String(params.method || '')) ? s.moncash : s.detail,
          done: i === 0,
        }))
      ),
      gap(24),
      rowsBlock(rows),
      gap(20),
      p(t.questions),
      gap(4),
      button(COMMON[lang].findEvents, `${base}/discover`, 'secondary'),
    ],
  })
}

// ---------------------------------------------------------------------------
// Waitlist: tickets freed up
// ---------------------------------------------------------------------------

export function getWaitlistNotificationEmail(params: {
  eventTitle: string
  eventDate: string
  quantity: number
  eventId: string
  posterUrl?: string | null
  venue?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: {
      status: 'Available',
      eyebrow: "you're in luck",
      body: (q: number) => `Tickets just opened up for the event you were waiting for. You asked for ${q}. They go to whoever buys first.`,
      cta: 'Get my tickets',
      preheader: (e: string) => `Tickets just opened up for ${e}.`,
    },
    fr: {
      status: 'Disponible',
      eyebrow: 'bonne nouvelle',
      body: (q: number) => `Des billets viennent de se libérer pour l'événement que vous attendiez. Vous en vouliez ${q}. Premier arrivé, premier servi.`,
      cta: 'Prendre mes billets',
      preheader: (e: string) => `Des billets viennent de se libérer pour ${e}.`,
    },
    ht: {
      status: 'Disponib',
      eyebrow: 'bon nouvèl',
      body: (q: number) => `Gen tikè ki sot libere pou evènman ou t ap tann lan. Ou te mande ${q}. Se moun ki achte an premye ki pran yo.`,
      cta: 'Pran tikè m yo',
      preheader: (e: string) => `Gen tikè ki sot libere pou ${e}.`,
    },
  })
  const eventUrl = `${appUrl()}/events/${enc(params.eventId)}`
  const metaLine = [params.eventDate, params.venue].filter(Boolean).join(' · ')
  return renderEmail({
    lang,
    title: params.eventTitle,
    preheader: t.preheader(params.eventTitle),
    status: { label: t.status, tone: 'teal' },
    footer: 'attendee',
    blocks: [
      poster(params.posterUrl, params.eventTitle),
      params.posterUrl ? gap(28) : '',
      serifEyebrow(t.eyebrow),
      title(params.eventTitle),
      metaLine ? meta(metaLine) : '',
      gap(20),
      p(t.body(Math.max(1, Number(params.quantity || 1)))),
      gap(8),
      button(t.cta, eventUrl),
    ],
  })
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export function getTicketTransferRequestEmail(params: {
  senderName: string
  senderEmail: string
  eventTitle: string
  eventDate: string
  message: string
  transferToken: string
  expiresAt: string
  posterUrl?: string | null
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: {
      eyebrow: 'A ticket for you',
      headline: (s: string) => `${s} sent you a ticket`,
      note: 'Their note',
      accept: 'Accept the ticket',
      decline: 'Decline',
      expires: (d: string) => `If you don't accept it by ${d}, the ticket stays with ${'{s}'}.`,
      preheader: (s: string, e: string) => `${s} wants to give you a ticket for ${e}.`,
    },
    fr: {
      eyebrow: 'Un billet pour vous',
      headline: (s: string) => `${s} vous a envoyé un billet`,
      note: 'Son message',
      accept: 'Accepter le billet',
      decline: 'Refuser',
      expires: (d: string) => `Sans réponse avant le ${d}, le billet reste à ${'{s}'}.`,
      preheader: (s: string, e: string) => `${s} veut vous donner un billet pour ${e}.`,
    },
    ht: {
      eyebrow: 'Yon tikè pou ou',
      headline: (s: string) => `${s} voye yon tikè ba ou`,
      note: 'Mesaj li',
      accept: 'Aksepte tikè a',
      decline: 'Refize',
      expires: (d: string) => `Si ou pa aksepte l anvan ${d}, tikè a rete pou ${'{s}'}.`,
      preheader: (s: string, e: string) => `${s} vle ba ou yon tikè pou ${e}.`,
    },
  })
  const base = appUrl()
  const acceptUrl = `${base}/tickets/transfer/${enc(params.transferToken)}`
  const declineUrl = `${base}/tickets/transfer/${enc(params.transferToken)}?action=reject`
  return renderEmail({
    lang,
    title: t.headline(params.senderName),
    preheader: t.preheader(params.senderName, params.eventTitle),
    footer: 'attendee',
    blocks: [
      eyebrow(t.eyebrow, 'teal'),
      title(t.headline(params.senderName), 34),
      gap(24),
      eventRow(params.posterUrl, params.eventTitle, params.eventDate),
      params.message ? gap(20) : '',
      params.message ? quote(t.note, params.message) : '',
      gap(24),
      button(t.accept, acceptUrl),
      gap(10),
      button(t.decline, declineUrl, 'secondary'),
      gap(16),
      p(t.expires(params.expiresAt).replace('{s}', params.senderName), '#6B6B6B'),
    ],
  })
}

export function getTicketTransferResponseEmail(params: {
  recipientName: string
  eventTitle: string
  action: 'accepted' | 'rejected'
  ticketId: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const accepted = params.action === 'accepted'
  const t = L(lang, {
    en: {
      okEyebrow: 'Transfer complete',
      noEyebrow: 'Transfer declined',
      ok: (r: string, e: string) => `${r} accepted your ticket for ${e}. It is in their account now, with its own QR code.`,
      no: (r: string, e: string) => `${r} declined your ticket for ${e}. It is still yours, so you can keep it or send it to someone else.`,
      view: 'View my ticket',
    },
    fr: {
      okEyebrow: 'Transfert terminé',
      noEyebrow: 'Transfert refusé',
      ok: (r: string, e: string) => `${r} a accepté votre billet pour ${e}. Il est maintenant sur son compte, avec son propre QR code.`,
      no: (r: string, e: string) => `${r} a refusé votre billet pour ${e}. Il est toujours à vous : gardez-le ou envoyez-le à quelqu'un d'autre.`,
      view: 'Voir mon billet',
    },
    ht: {
      okEyebrow: 'Transfè fini',
      noEyebrow: 'Transfè refize',
      ok: (r: string, e: string) => `${r} aksepte tikè ou pou ${e}. Li sou kont li kounye a, ak pwòp QR kòd pa l.`,
      no: (r: string, e: string) => `${r} refize tikè ou pou ${e}. Li toujou pou ou: kenbe l oswa voye l bay yon lòt moun.`,
      view: 'Wè tikè m',
    },
  })
  return renderEmail({
    lang,
    title: accepted ? t.okEyebrow : t.noEyebrow,
    preheader: accepted ? t.ok(params.recipientName, params.eventTitle) : t.no(params.recipientName, params.eventTitle),
    footer: 'attendee',
    blocks: [
      eyebrow(accepted ? t.okEyebrow : t.noEyebrow, accepted ? 'teal' : 'grey'),
      title(params.eventTitle, 34),
      gap(14),
      p(accepted ? t.ok(params.recipientName, params.eventTitle) : t.no(params.recipientName, params.eventTitle)),
      accepted ? '' : gap(8),
      accepted ? '' : button(t.view, `${appUrl()}/tickets/${enc(params.ticketId)}`),
    ],
  })
}

export function getTicketTransferCancelledEmail(params: {
  eventTitle: string
  senderName: string
  eventId?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: {
      eyebrow: 'Transfer cancelled',
      body: (s: string, e: string) => `${s} cancelled the ticket they were sending you for ${e}. You don't need to do anything.`,
      still: 'Still want to go? Tickets may be available on the event page.',
    },
    fr: {
      eyebrow: 'Transfert annulé',
      body: (s: string, e: string) => `${s} a annulé le billet qu'il vous envoyait pour ${e}. Vous n'avez rien à faire.`,
      still: "Vous voulez toujours y aller ? Des billets sont peut-être disponibles sur la page de l'événement.",
    },
    ht: {
      eyebrow: 'Transfè anile',
      body: (s: string, e: string) => `${s} anile tikè li t ap voye ba ou pou ${e}. Ou pa bezwen fè anyen.`,
      still: 'Ou toujou vle ale? Ka gen tikè sou paj evènman an.',
    },
  })
  const base = appUrl()
  return renderEmail({
    lang,
    title: t.eyebrow,
    preheader: t.body(params.senderName, params.eventTitle),
    footer: 'attendee',
    blocks: [
      eyebrow(t.eyebrow, 'grey'),
      title(params.eventTitle, 34),
      gap(14),
      p(t.body(params.senderName, params.eventTitle)),
      p(t.still),
      gap(4),
      button(COMMON[lang].viewEvent, params.eventId ? `${base}/events/${enc(params.eventId)}` : `${base}/discover`, 'secondary'),
    ],
  })
}

// ---------------------------------------------------------------------------
// Organizer → ticket holders: update / reply
// ---------------------------------------------------------------------------

export function getEventUpdateEmail(params: {
  attendeeName: string
  eventTitle: string
  updateTitle: string
  updateMessage: string
  eventId: string
  posterUrl?: string | null
  organizerName?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: { status: 'Update', from: (o: string) => `from ${o}`, generic: 'from the organizer', why: 'Sent by the organizer to everyone with a ticket.' },
    fr: { status: 'Nouvelles', from: (o: string) => `de ${o}`, generic: "de l'organisateur", why: "Envoyé par l'organisateur à toutes les personnes ayant un billet." },
    ht: { status: 'Nouvèl', from: (o: string) => `soti nan ${o}`, generic: 'soti nan òganizatè a', why: 'Òganizatè a voye sa bay tout moun ki gen tikè.' },
  })
  return renderEmail({
    lang,
    title: params.updateTitle,
    preheader: `${params.eventTitle}: ${params.updateTitle}`,
    status: { label: t.status, tone: 'amber' },
    footer: 'attendee',
    blocks: [
      eventRow(params.posterUrl, params.eventTitle, params.organizerName ? t.from(params.organizerName) : t.generic),
      gap(28),
      title(params.updateTitle, 34),
      gap(16),
      `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#E5E5E5;white-space:pre-wrap;">${escapeHtml(params.updateMessage)}</div>`,
      gap(28),
      button(COMMON[lang].viewEvent, `${appUrl()}/events/${enc(params.eventId)}`),
      gap(14),
      p(t.why, '#6B6B6B'),
    ],
  })
}

export function getOrganizerReplyEmail(params: {
  attendeeName: string
  organizerName: string
  eventTitle: string
  eventId: string
  question: string
  reply: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const t = L(lang, {
    en: { eyebrow: 'The organizer replied', asked: 'You asked', replied: (o: string) => `${o} replied`, private: 'Reply from the event page. Your email address stays private.' },
    fr: { eyebrow: "L'organisateur a répondu", asked: 'Votre question', replied: (o: string) => `Réponse de ${o}`, private: "Répondez depuis la page de l'événement. Votre adresse e-mail reste privée." },
    ht: { eyebrow: 'Òganizatè a reponn', asked: 'Kesyon ou', replied: (o: string) => `${o} reponn`, private: 'Reponn sou paj evènman an. Adrès imèl ou rete prive.' },
  })
  return renderEmail({
    lang,
    title: params.eventTitle,
    preheader: params.reply.slice(0, 120),
    footer: 'attendee',
    blocks: [
      eyebrow(t.eyebrow, 'teal'),
      title(params.eventTitle, 34),
      gap(24),
      quote(t.asked, params.question),
      gap(12),
      quote(t.replied(params.organizerName), params.reply),
      gap(24),
      button(COMMON[lang].viewEvent, `${appUrl()}/events/${enc(params.eventId)}`),
      gap(14),
      p(t.private, '#6B6B6B'),
    ],
  })
}

// ---------------------------------------------------------------------------
// Organizer: bank verification
// ---------------------------------------------------------------------------

export function getBankVerificationDecisionEmail(params: {
  organizerName: string
  decision: 'approve' | 'reject'
  reason?: string
  lang?: EmailLang
}) {
  const lang = pickLang(params.lang)
  const ok = params.decision === 'approve'
  const t = L(lang, {
    en: {
      okEyebrow: 'Verified',
      okHead: 'Your bank account is verified',
      okBody: 'Payouts for your ticket sales can now go straight to this account.',
      okSteps: ['Request a payout from your dashboard', 'Money usually settles in 2 to 5 business days'],
      okCta: 'Go to payouts',
      noEyebrow: 'Action needed',
      noHead: 'We could not verify your bank account',
      noBody: 'Please check the details below and submit your bank account again.',
      reason: 'Reason',
      noCta: 'Update bank details',
    },
    fr: {
      okEyebrow: 'Vérifié',
      okHead: 'Votre compte bancaire est vérifié',
      okBody: 'Les paiements de vos ventes de billets peuvent maintenant arriver directement sur ce compte.',
      okSteps: ['Demandez un paiement depuis votre tableau de bord', "L'argent arrive généralement en 2 à 5 jours ouvrés"],
      okCta: 'Aller aux paiements',
      noEyebrow: 'Action requise',
      noHead: "Nous n'avons pas pu vérifier votre compte bancaire",
      noBody: 'Vérifiez les informations ci-dessous et soumettez à nouveau votre compte bancaire.',
      reason: 'Motif',
      noCta: 'Mettre à jour mes coordonnées',
    },
    ht: {
      okEyebrow: 'Verifye',
      okHead: 'Kont labank ou verifye',
      okBody: 'Kòb tikè ou vann yo ka ale dirèk sou kont sa a kounye a.',
      okSteps: ['Mande yon peman nan tablo ou', 'Kòb la konn rive nan 2 a 5 jou ouvrab'],
      okCta: 'Ale nan peman',
      noEyebrow: 'Aksyon nesesè',
      noHead: 'Nou pa t ka verifye kont labank ou',
      noBody: 'Tanpri gade enfòmasyon ki anba yo epi soumèt kont labank ou ankò.',
      reason: 'Rezon',
      noCta: 'Mete enfòmasyon labank yo ajou',
    },
  })
  const payoutUrl = `${appUrl()}/organizer/payouts`
  return renderEmail({
    lang,
    title: ok ? t.okHead : t.noHead,
    preheader: ok ? t.okBody : t.noBody,
    footer: 'organizer',
    blocks: ok
      ? [eyebrow(t.okEyebrow, 'teal'), title(t.okHead, 34), gap(14), p(t.okBody), gap(4), steps(t.okSteps), gap(20), button(t.okCta, payoutUrl)]
      : [
          eyebrow(t.noEyebrow, 'amber'),
          title(t.noHead, 34),
          gap(14),
          p(t.noBody),
          params.reason ? gap(4) : '',
          params.reason ? quote(t.reason, params.reason) : '',
          gap(24),
          button(t.noCta, payoutUrl),
        ],
  })
}

// Building blocks for the one-off emails written inside routes, so they share the look.
export * as emailKit from '@/lib/email-kit/layout'
export { paragraphHtml, strong }
