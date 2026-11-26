/**
 * Receipt labels (en / fr / ht). The receipt is a server-rendered HTML
 * document (lib/receipts/receipt.ts), so it cannot use the client i18n
 * runtime. A Haiti event's receipt is always French (owner, 2026-11-25:
 * Haiti tickets are in French), see receiptLangFor.
 */
import { isHaitiEvent, type ClockEvent } from '@/lib/datetime/eventClock'

export type ReceiptLang = 'en' | 'fr' | 'ht'

export interface ReceiptLabels {
  receipt: string
  order: string
  date: string
  name: string
  organizer: string
  event: string
  item: string
  qty: string
  amount: string
  subtotal: string
  fee: string
  total: string
  paidWith: string
  refunded: string
  soldBy: string
  print: string
  questions: string
  rails: Record<'moncash' | 'natcash' | 'sogepay' | 'card' | 'paypal' | 'cash' | 'other', string>
}

export const RECEIPT_LABELS: Record<ReceiptLang, ReceiptLabels> = {
  en: {
    receipt: 'Receipt',
    order: 'Order',
    date: 'Date',
    name: 'Name',
    organizer: 'Organizer',
    event: 'Event',
    item: 'Item',
    qty: 'Qty',
    amount: 'Amount',
    subtotal: 'Subtotal',
    fee: 'Tikèm service fee',
    total: 'Total paid',
    paidWith: 'Paid with',
    refunded: 'Refunded',
    soldBy: 'Tickets are sold by the organizer. Tikèm collected this payment on their behalf.',
    print: 'Print or save as PDF',
    questions: 'Questions?',
    rails: { moncash: 'MonCash', natcash: 'NatCash', sogepay: 'SogePay', card: 'Card', paypal: 'PayPal', cash: 'Cash', other: 'Online payment' },
  },
  fr: {
    receipt: 'Reçu',
    order: 'Commande',
    date: 'Date',
    name: 'Nom',
    organizer: 'Organisateur',
    event: 'Événement',
    item: 'Article',
    qty: 'Qté',
    amount: 'Montant',
    subtotal: 'Sous-total',
    fee: 'Frais de service Tikèm',
    total: 'Total payé',
    paidWith: 'Payé avec',
    refunded: 'Remboursé',
    soldBy: "Les billets sont vendus par l'organisateur. Tikèm a encaissé ce paiement pour son compte.",
    print: 'Imprimer ou enregistrer en PDF',
    questions: 'Des questions ?',
    rails: { moncash: 'MonCash', natcash: 'NatCash', sogepay: 'SogePay', card: 'Carte', paypal: 'PayPal', cash: 'Espèces', other: 'Paiement en ligne' },
  },
  ht: {
    receipt: 'Resi',
    order: 'Kòmand',
    date: 'Dat',
    name: 'Non',
    organizer: 'Òganizatè',
    event: 'Evènman',
    item: 'Atik',
    qty: 'Kantite',
    amount: 'Montan',
    subtotal: 'Sou-total',
    fee: 'Frè sèvis Tikèm',
    total: 'Total ou peye',
    paidWith: 'Peye ak',
    refunded: 'Ranbouse',
    soldBy: 'Se òganizatè a ki vann tikè yo. Tikèm resevwa peman sa a pou li.',
    print: 'Enprime oswa sove an PDF',
    questions: 'Ou gen kesyon?',
    rails: { moncash: 'MonCash', natcash: 'NatCash', sogepay: 'SogePay', card: 'Kat', paypal: 'PayPal', cash: 'Kach', other: 'Peman sou entènèt' },
  },
}

export function receiptLang(value: unknown): ReceiptLang {
  const code = typeof value === 'string' ? value.slice(0, 2).toLowerCase() : ''
  return code === 'fr' || code === 'ht' ? code : 'en'
}

/** The language a receipt prints in: French for a Haiti event, else the reader's. */
export function receiptLangFor(event: ClockEvent, requested: unknown): ReceiptLang {
  return isHaitiEvent(event) ? 'fr' : receiptLang(requested)
}
