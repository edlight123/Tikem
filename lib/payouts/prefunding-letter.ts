/**
 * The formal letter PANTHEON SERVICES sends Digicel to top up its MonCash
 * PREFUNDED account, and the short cover email it goes out with.
 *
 * Two kinds, both worded after Digicel's own template
 * ("Renflouement Compte MonCash PANTHEON SERVICES PREFUNDED.docx"):
 *
 *  - merchant_transfer: ask MonCash to debit the MonCash merchant (collections)
 *    account and credit the prefunded account (the arrangement Digicel agreed
 *    to by email);
 *  - bank_transfer: the template as written: money was wired to one of
 *    Digicel's bank accounts, please credit the prefunded account. The receipt
 *    goes with it, and the wire's description must end with
 *    "<COMPANY> Prefunded" (Digicel notice of 1 March 2024).
 *
 * Pure (no Firestore, no PDF library): the PDF renderer is
 * lib/payouts/prefunding-letter-pdf.ts. Nothing here sends anything.
 */

import type { DigicelPrefundingContacts } from '@/lib/payouts/prefunding-config'
import {
  frenchLongDate,
  formatHtgFigures,
  gmailComposeUrl,
  mailtoUrl,
  numberToFrenchWords,
} from '@/lib/payouts/prefunding-email'
import { HAITI_TZ } from '@/lib/payouts/haiti-business-time'

export type PrefundingLetterKind = 'merchant_transfer' | 'bank_transfer'

export const PREFUNDING_LETTER_KINDS: Record<PrefundingLetterKind, { label: string; short: string }> = {
  merchant_transfer: { label: 'Transfert compte marchand → Prefunded', short: 'Merchant → Prefunded' },
  bank_transfer: { label: 'Renflouement par virement', short: 'Bank transfer' },
}

/** Digicel's (Unigestion Holding) bank accounts: 2023 process notice and contract §3.2. */
export const DIGICEL_BANK_ACCOUNTS = [
  { id: 'sogebank', bank: 'Sogebank', domicile: 'à la Sogebank', accountName: 'MFS-PAIEMENTDIGICEL/SERVICEPAIMENTCLIENT', accountNumber: '7-0610-776-0' },
  { id: 'capital_bank', bank: 'Capital Bank', domicile: 'à la Capital Bank', accountName: 'Unigestion Holding SA/MFS', accountNumber: '1884836' },
  { id: 'unibank', bank: 'Unibank', domicile: 'à l’Unibank', accountName: 'Unigestion Holding SA/MFS', accountNumber: '250-1021-1776024' },
  { id: 'bnc', bank: 'BNC', domicile: 'à la BNC', accountName: 'Unigestion Holding SA/MFS', accountNumber: '1660021480' },
] as const

export type DigicelBankAccount = (typeof DIGICEL_BANK_ACCOUNTS)[number]
export type DigicelBankId = DigicelBankAccount['id']

export function findDigicelBank(id: unknown): DigicelBankAccount | null {
  return DIGICEL_BANK_ACCOUNTS.find((b) => b.id === id) || null
}

/** What the wire's description must END with, e.g. "PANTHEON SERVICES Prefunded". */
export function bankTransferDescription(companyName: string): string {
  return `${companyName} Prefunded`
}

/** A bank transaction / reference number as typed on a receipt. */
export function isValidTransactionNumber(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z .\-/#]{1,38}[0-9A-Za-z]$/.test(value.trim())
}

/** Printed where the merchant account number goes until it is configured. */
export const BLANK_LINE = '______________________'

const NBSP = ' '

/** "HTG 50 000,00" with no-break spaces, so a line never splits the amount. */
export function htgFiguresForLetter(amountHtg: number): string {
  return `HTG${NBSP}${formatHtgFigures(amountHtg).replace(/ /g, NBSP)},00`
}

export type PrefundingLetterInput = {
  kind: PrefundingLetterKind
  amountHtg: number
  /** The letter's date (its Haiti calendar day). */
  at: Date
  /** Tikèm's own reference, TKM-PF-…; printed as "N/Réf". */
  reference: string
  contacts: DigicelPrefundingContacts
  /** bank_transfer only. */
  bankId?: string | null
  transactionNumber?: string | null
}

export type PrefundingLetter = {
  kind: PrefundingLetterKind
  letterhead: { companyName: string; addressLine: string; idsLine: string; logoUrl: string }
  placeDate: string
  recipient: string[]
  refLine: string
  ourRef: string
  salutation: string
  paragraphs: string[]
  closing: string
  signature: { label: string; name: string; title: string }
  sealLabel: string
  /** Fields printed as a blank line because they are not configured yet. */
  missing: Array<'merchantAccountNumber'>
  fileName: string
}

export type LetterBuildResult = { ok: true; letter: PrefundingLetter } | { ok: false; error: string }

export function buildPrefundingLetter(input: PrefundingLetterInput): LetterBuildResult {
  const { kind, amountHtg, at, reference, contacts } = input
  if (!(Number.isInteger(amountHtg) && amountHtg > 0)) return { ok: false, error: 'The amount must be a whole number of gourdes above zero.' }
  const words = numberToFrenchWords(amountHtg)
  const figures = htgFiguresForLetter(amountHtg)
  const company = contacts.companyName
  const prefunded = `${contacts.prefundedAccountName} Account No.${NBSP}${contacts.prefundedAccountNumber}`
  const missing: PrefundingLetter['missing'] = []

  let refLine: string
  let paragraphs: string[]
  if (kind === 'merchant_transfer') {
    const merchantNo = contacts.merchantAccountNumber || BLANK_LINE
    if (!contacts.merchantAccountNumber) missing.push('merchantAccountNumber')
    refLine = 'Réf : Transfert – Compte marchand MonCash vers Compte MonCash Prefunded'
    paragraphs = [
      `Par la Présente, ${company} vous présente ses compliments et vous prie de bien vouloir débiter son compte marchand MonCash No.${NBSP}${merchantNo} pour un montant ${figures} (${words} gourdes 00/100) et de créditer le compte ${prefunded} pour le même montant.`,
    ]
  } else if (kind === 'bank_transfer') {
    // The template's "(Numéro & Domicile du compte)": the number and the bank
    // holding it. The account holder's name is on the receipt and the admin page.
    const bank = findDigicelBank(input.bankId)
    if (!bank) return { ok: false, error: 'Choose the Digicel bank account the money was wired to.' }
    const txn = String(input.transactionNumber || '').trim()
    if (!isValidTransactionNumber(txn)) return { ok: false, error: 'Enter the transaction number from the bank receipt.' }
    refLine = 'Réf : Transfert – Compte MonCash Prefunded'
    paragraphs = [
      `Par la Présente, ${company} vous présente ses compliments et vous informe d’un transfert effectué sur le compte gourde No.${NBSP}${bank.accountNumber} domicilié ${bank.domicile} pour un montant ${figures} (${words} 00/100) gourdes dont le numéro de transaction est ${txn}.`,
      `Prière de créditer le compte ${prefunded} pour le même montant. Vous trouverez en annexe le reçu de la transaction.`,
    ]
  } else {
    return { ok: false, error: 'Unknown letter type.' }
  }

  const signatory = contacts.signatories[0] || { name: '' }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: HAITI_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  const slug = company.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return {
    ok: true,
    letter: {
      kind,
      letterhead: {
        companyName: company,
        addressLine: contacts.companyAddress,
        idsLine: contacts.companyIds.length ? `Patente / Identification : ${contacts.companyIds.join(' · ')}` : '',
        logoUrl: contacts.logoUrl,
      },
      placeDate: `Port-au-Prince, le ${frenchLongDate(at)}`,
      recipient: ['A L’EQUIPE MONCASH', 'Service Financier Mobile', 'MonCash Business Services', 'En ses bureaux. -'],
      refLine,
      ourRef: `N/Réf : ${reference}`,
      salutation: 'Monsieur,',
      paragraphs,
      closing:
        'Vous remerciant à l’avance de l’attention particulière que vous accorderez à sa demande, elle vous prie de recevoir, Monsieur, ses salutations distinguées.',
      signature: { label: 'Signature Autorisée', name: signatory.name, title: signatory.title || '' },
      sealLabel: 'Cachet de l’entreprise',
      missing,
      fileName: `Renflouement-${slug}-Prefunded-${day}-${reference}.pdf`,
    },
  }
}

/** The letter as plain text (tests, previews). No-break spaces become spaces. */
export function prefundingLetterText(l: PrefundingLetter): string {
  return [
    l.letterhead.companyName,
    l.letterhead.addressLine,
    l.letterhead.idsLine,
    '',
    l.placeDate,
    '',
    ...l.recipient,
    '',
    l.refLine,
    l.ourRef,
    '',
    l.salutation,
    ...l.paragraphs,
    '',
    l.closing,
    '',
    l.signature.label,
    l.signature.name,
    l.signature.title,
  ]
    .join('\n')
    .replace(/ /g, ' ')
}

// ── The cover email ─────────────────────────────────────────────────────────

export type PrefundingCoverEmail = {
  to: string[]
  cc: string[]
  from: string
  subject: string
  body: string
  /** Files the admin must attach before sending. */
  attachments: string[]
  /** Gmail web compose, opened in the sender's account. Nothing is sent until the admin clicks Send. */
  gmailUrl: string
  mailtoUrl: string
}

export function buildPrefundingCoverEmail(args: {
  letter: PrefundingLetter
  amountHtg: number
  reference: string
  contacts: DigicelPrefundingContacts
  bankId?: string | null
  transactionNumber?: string | null
}): PrefundingCoverEmail {
  const { letter, amountHtg, reference, contacts } = args
  const amount = `HTG ${formatHtgFigures(amountHtg)},00`
  const prefunded = `${contacts.prefundedAccountName} Account No. ${contacts.prefundedAccountNumber}`
  const date = letter.placeDate.replace(/^Port-au-Prince, le /, '')
  const signatory = contacts.signatories[0] || { name: '' }

  let subject: string
  let summary: string
  const attachments = [letter.fileName]
  if (letter.kind === 'bank_transfer') {
    const bank = findDigicelBank(args.bankId)
    subject = `Renflouement Compte MonCash ${contacts.prefundedAccountName} – ${amount} – Transaction ${String(args.transactionNumber || '').trim()}`
    summary = `Veuillez trouver en pièces jointes la lettre de ${contacts.companyName} datée du ${date} (Réf. ${reference}) et le reçu du virement de ${amount} effectué sur le compte No. ${bank?.accountNumber || ''} (${bank?.bank || ''}), transaction No. ${String(args.transactionNumber || '').trim()}. Nous vous prions de créditer le compte ${prefunded} pour le même montant.`
    attachments.push('Reçu du virement bancaire')
  } else {
    subject = `Renflouement Compte MonCash ${contacts.prefundedAccountName} – Transfert du compte marchand – ${amount}`
    summary = `Veuillez trouver en pièce jointe la lettre de ${contacts.companyName} datée du ${date} (Réf. ${reference}) demandant le transfert de ${amount} du compte marchand MonCash No. ${contacts.merchantAccountNumber || '[à compléter]'} vers le compte ${prefunded}.`
  }

  const body = [
    'Bonjour,',
    '',
    summary,
    '',
    'Nous vous remercions de bien vouloir nous confirmer l’exécution de cette opération par retour de courriel.',
    '',
    'Cordialement,',
    '',
    [signatory.name, signatory.title, contacts.companyName].filter((x) => x && String(x).trim()).join('\n'),
  ].join('\n')

  return {
    to: contacts.to,
    cc: contacts.cc,
    from: contacts.fromEmail,
    subject,
    body,
    attachments,
    gmailUrl: gmailComposeUrl({ to: contacts.to, cc: contacts.cc, subject, body, from: contacts.fromEmail }),
    mailtoUrl: mailtoUrl({ to: contacts.to, cc: contacts.cc, subject, body }),
  }
}
