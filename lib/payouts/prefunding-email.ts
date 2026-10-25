/**
 * The French transfer request Tikèm emails Digicel to move money from the
 * MonCash merchant account into the PREFUNDED pool.
 *
 * Built here, shown to an admin, and NEVER sent by the server: the admin copies
 * it or opens it in Gmail (compose link) and sends it from the configured
 * mailbox themselves. Pure, so the wording is unit-tested.
 */

import { HAITI_TZ } from '@/lib/payouts/haiti-business-time'
import type { DigicelPrefundingContacts } from '@/lib/payouts/prefunding-config'

// ── Amount in French words ──────────────────────────────────────────────────

const UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
]
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' }

/** 0..99, traditional spelling (hyphens below 100, "et" for 21..71). */
function below100(n: number, final: boolean): string {
  if (n < 17) return UNITS[n]
  if (n < 20) return `dix-${UNITS[n - 10]}`
  const t = Math.floor(n / 10)
  const u = n % 10
  if (t === 7 || t === 9) {
    const base = t === 7 ? 'soixante' : 'quatre-vingt'
    const rest = 10 + u
    if (t === 7 && u === 1) return 'soixante et onze'
    return `${base}-${below100(rest, false)}`
  }
  if (t === 8) return u === 0 ? (final ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITS[u]}`
  if (u === 0) return TENS[t]
  if (u === 1) return `${TENS[t]} et un`
  return `${TENS[t]}-${UNITS[u]}`
}

/**
 * 0..999. `final` = nothing but a noun (million, milliard) or the end follows,
 * which is when "cents" / "quatre-vingts" take their plural s; before "mille"
 * (an invariable adjective) they do not.
 */
function below1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h === 0) return below100(r, final)
  const hundred = h === 1 ? 'cent' : `${UNITS[h]} ${r === 0 && final ? 'cents' : 'cent'}`
  return r === 0 ? hundred : `${hundred} ${below100(r, final)}`
}

/** A non-negative integer in French words, e.g. 50000 → "cinquante mille". */
export function numberToFrenchWords(value: number): string {
  const n = Math.floor(Math.abs(Number(value) || 0))
  if (n === 0) return 'zéro'
  const parts: string[] = []
  const milliards = Math.floor(n / 1_000_000_000)
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1000)
  const rest = n % 1000
  if (milliards) parts.push(`${below1000(milliards, true)} ${milliards > 1 ? 'milliards' : 'milliard'}`)
  if (millions) parts.push(`${below1000(millions, true)} ${millions > 1 ? 'millions' : 'million'}`)
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${below1000(thousands, false)} mille`)
  if (rest) parts.push(below1000(rest, true))
  return parts.join(' ')
}

/** "50 000" — French digit grouping with plain spaces (safe in every mail client). */
export function formatHtgFigures(amountHtg: number): string {
  return Math.round(amountHtg)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** "24 octobre 2026", the Haiti calendar day of `at`. */
export function frenchLongDate(at: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: HAITI_TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(at)
}

// ── The letter ──────────────────────────────────────────────────────────────

export type DigicelRequestEmail = {
  to: string[]
  cc: string[]
  from: string
  subject: string
  body: string
  /** Gmail web compose, opened in the sender's account. Nothing is sent until the admin clicks Send. */
  gmailUrl: string
  mailtoUrl: string
}

const MISSING = '[à compléter]'

export function buildDigicelRequestEmail(args: {
  amountHtg: number
  at: Date
  reference: string
  contacts: DigicelPrefundingContacts
}): DigicelRequestEmail {
  const { amountHtg, at, reference, contacts } = args
  const figures = `${formatHtgFigures(amountHtg)} HTG`
  const words = `${numberToFrenchWords(amountHtg)} gourdes`
  const date = frenchLongDate(at)
  const merchantNo = contacts.merchantAccountNumber || MISSING
  const prefundedNo = contacts.prefundedAccountNumber || MISSING

  const subject = `Demande de transfert – Compte marchand MonCash vers ${contacts.prefundedAccountName} – ${figures}`

  const signatureBlocks = contacts.signatories.map((s) =>
    [s.name, s.title, contacts.companyName, s.email].filter((x) => x && String(x).trim()).join('\n')
  )
  const signatoryNames = contacts.signatories.map((s) => s.name).join(', ')

  const body = [
    `Port-au-Prince, le ${date}`,
    '',
    "À l’attention de l’équipe Digicel MonCash – Services financiers mobiles",
    '',
    `Objet : Demande de transfert de fonds du compte marchand MonCash vers le compte prépayé « ${contacts.prefundedAccountName} »`,
    '',
    'Madame, Monsieur,',
    '',
    `Par la présente, ${contacts.companyName} vous prie de bien vouloir procéder au transfert de la somme de ${figures} (${words}) de son compte marchand MonCash vers son compte prépayé (prefunded), selon les références ci-dessous :`,
    '',
    `- Compte à débiter (compte marchand MonCash) : ${contacts.merchantAccountName} – n° ${merchantNo}`,
    `- Compte à créditer (compte prépayé) : ${contacts.prefundedAccountName} – n° ${prefundedNo}`,
    `- Montant : ${figures} (${words})`,
    `- Date de la demande : ${date}`,
    `- Référence : ${reference}`,
    `- Signataire${contacts.signatories.length > 1 ? 's' : ''} autorisé${contacts.signatories.length > 1 ? 's' : ''} : ${signatoryNames}`,
    '',
    "Ces fonds sont destinés au paiement des organisateurs d’événements par MonCash via la plateforme Tikèm.",
    '',
    'Nous vous remercions de bien vouloir nous confirmer l’exécution de ce transfert par retour de courriel.',
    '',
    'Veuillez agréer, Madame, Monsieur, l’expression de nos salutations distinguées.',
    '',
    signatureBlocks.join('\n\n'),
  ].join('\n')

  return {
    to: contacts.to,
    cc: contacts.cc,
    from: contacts.fromEmail,
    subject,
    body,
    gmailUrl: gmailComposeUrl({ to: contacts.to, cc: contacts.cc, subject, body, from: contacts.fromEmail }),
    mailtoUrl: mailtoUrl({ to: contacts.to, cc: contacts.cc, subject, body }),
  }
}

export function gmailComposeUrl(m: { to: string[]; cc: string[]; subject: string; body: string; from?: string }): string {
  const params = new URLSearchParams()
  if (m.from) params.set('authuser', m.from)
  params.set('view', 'cm')
  params.set('fs', '1')
  params.set('to', m.to.join(','))
  if (m.cc.length) params.set('cc', m.cc.join(','))
  params.set('su', m.subject)
  params.set('body', m.body)
  return `https://mail.google.com/mail/?${params.toString().replace(/\+/g, '%20')}`
}

export function mailtoUrl(m: { to: string[]; cc: string[]; subject: string; body: string }): string {
  const q = [
    m.cc.length ? `cc=${encodeURIComponent(m.cc.join(','))}` : '',
    `subject=${encodeURIComponent(m.subject)}`,
    `body=${encodeURIComponent(m.body)}`,
  ].filter(Boolean)
  return `mailto:${m.to.map(encodeURIComponent).join(',')}?${q.join('&')}`
}

/** TKM-PF-20261024-AB12: the day (Haiti) plus 4 characters of the log doc id. */
export function prefundingRequestReference(at: Date, docId: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: HAITI_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at)
    .replace(/-/g, '')
  const tail = String(docId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || '0000'
  return `TKM-PF-${day}-${tail}`
}
