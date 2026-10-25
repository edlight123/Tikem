import { renderEmail, title, eyebrow, meta, p, gap, facts, quote, textLink, appUrl } from '@/lib/email-kit/layout'
import { pickLang, type EmailLang } from '@/lib/email-kit/i18n'

/**
 * Support request emails (POST /api/support/request):
 *  - the ticket that lands in support@tikem.co (always English; Reply goes to the requester), and
 *  - the short "we got it" copy sent back to the requester in their language.
 */

export const SUPPORT_TOPICS = [
  'ticket_purchase',
  'payment',
  'refund',
  'event_access',
  'account',
  'event_creation',
  'payout',
  'check_in',
  'verification',
  'other',
] as const
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]

export const SUPPORT_INBOX = 'support@tikem.co'

const TOPIC_LABELS: Record<EmailLang, Record<SupportTopic, string>> = {
  en: {
    ticket_purchase: 'Buying a ticket',
    payment: 'Payment',
    refund: 'Refund',
    event_access: 'Getting into an event',
    account: 'My account',
    event_creation: 'Creating an event',
    payout: 'Payouts',
    check_in: 'Door check-in',
    verification: 'Verification',
    other: 'Something else',
  },
  fr: {
    ticket_purchase: "Achat d'un billet",
    payment: 'Paiement',
    refund: 'Remboursement',
    event_access: "Accès à l'événement",
    account: 'Mon compte',
    event_creation: "Création d'un événement",
    payout: 'Versements',
    check_in: "Contrôle à l'entrée",
    verification: 'Vérification',
    other: 'Autre chose',
  },
  ht: {
    ticket_purchase: 'Achte yon tikè',
    payment: 'Peman',
    refund: 'Ranbousman',
    event_access: 'Antre nan yon evènman',
    account: 'Kont mwen',
    event_creation: 'Kreye yon evènman',
    payout: 'Peman òganizatè',
    check_in: 'Kontwòl nan pòt la',
    verification: 'Verifikasyon',
    other: 'Yon lòt bagay',
  },
}

export function supportTopicLabel(topic: SupportTopic, lang: EmailLang = 'en'): string {
  return TOPIC_LABELS[pickLang(lang)][topic] || TOPIC_LABELS.en.other
}

/** One line, no control characters: safe for a subject header. */
function oneLine(s: string, max = 140): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function supportInboxEmail(params: {
  name: string
  email: string
  topic: SupportTopic
  subject: string
  message: string
  userType: 'attendee' | 'organizer'
  lang: EmailLang
  uid?: string | null
  reference: string
}): { subject: string; html: string } {
  const topic = supportTopicLabel(params.topic, 'en')
  const subject = `[Support ${params.reference}] ${topic}: ${oneLine(params.subject, 120)}`
  const html = renderEmail({
    lang: 'en',
    title: oneLine(params.subject),
    preheader: `${oneLine(params.name, 60)} (${params.userType}) wrote about ${topic.toLowerCase()}.`,
    status: { label: params.userType === 'organizer' ? 'Organizer' : 'Attendee', tone: 'teal' },
    footer: 'account',
    blocks: [
      eyebrow('Support request', 'teal'),
      title(oneLine(params.subject), 30),
      meta(`${oneLine(params.name, 80)} · ${params.email}`),
      gap(24),
      facts([
        { label: 'Reference', value: params.reference },
        { label: 'Topic', value: topic },
        { label: 'Language', value: params.lang.toUpperCase() },
        { label: 'Account', value: params.uid ? params.uid : 'Not signed in' },
      ]),
      gap(12),
      quote('Message', params.message),
      gap(18),
      p('Reply to this email to answer them directly: Reply-To is set to their address.', '#6B6B6B'),
    ],
  })
  return { subject, html }
}

/** A short human reference like TK-4F7Q2M, quoted in both emails. */
export function newSupportReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  return `TK-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`
}

/**
 * The requester's copy is a FIXED template: the address is unverified, so it
 * must never carry text the requester typed (name, subject, message), or our
 * trusted sender becomes a relay for whatever a stranger writes to a victim.
 * Only the topic label (from a fixed list) and the reference go in.
 */
const CONFIRM_COPY = {
  en: {
    subject: (r: string) => `We got your message (${r})`,
    preheader: 'Your request reached the Tikèm team.',
    eyebrow: 'Support',
    headline: 'We got your message',
    body: 'Thanks for writing. A person on the Tikèm team will read it and reply to this email address.',
    reference: 'Reference',
    keep: 'Quote this reference if you write to us about the same request.',
    topic: 'Topic',
    help: 'Browse the help center',
  },
  fr: {
    subject: (r: string) => `Nous avons bien reçu votre message (${r})`,
    preheader: "Votre demande est bien arrivée chez l'équipe Tikèm.",
    eyebrow: 'Support',
    headline: 'Message bien reçu',
    body: "Merci de nous avoir écrit. Une personne de l'équipe Tikèm va le lire et vous répondre à cette adresse e-mail.",
    reference: 'Référence',
    keep: 'Indiquez cette référence si vous nous écrivez au sujet de la même demande.',
    topic: 'Sujet',
    help: "Parcourir le centre d'aide",
  },
  ht: {
    subject: (r: string) => `Nou resevwa mesaj ou (${r})`,
    preheader: 'Demann ou an rive nan men ekip Tikèm nan.',
    eyebrow: 'Sipò',
    headline: 'Nou resevwa mesaj ou',
    body: 'Mèsi paske w ekri nou. Yon moun nan ekip Tikèm nan ap li l epi l ap reponn ou nan adrès imèl sa a.',
    reference: 'Referans',
    keep: 'Mete referans sa a si w ekri nou pou menm demann lan.',
    topic: 'Sijè',
    help: 'Gade sant èd la',
  },
} as const

export function supportConfirmationEmail(params: {
  lang: EmailLang
  topic: SupportTopic
  reference: string
}): { subject: string; html: string } {
  const lang = pickLang(params.lang)
  const t = CONFIRM_COPY[lang]
  const html = renderEmail({
    lang,
    title: t.headline,
    preheader: t.preheader,
    footer: 'account',
    blocks: [
      eyebrow(t.eyebrow, 'teal'),
      title(t.headline, 34),
      gap(20),
      p(t.body),
      gap(20),
      facts([
        { label: t.reference, value: params.reference },
        { label: t.topic, value: supportTopicLabel(params.topic, lang) },
      ]),
      gap(12),
      p(t.keep, '#6B6B6B'),
      gap(8),
      textLink(t.help, `${appUrl()}/support`),
    ],
  })
  return { subject: t.subject(params.reference), html }
}
