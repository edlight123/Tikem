import { adminDb } from '@/lib/firebase/admin'
import { decryptJson, encryptJson } from '@/lib/security/encryption'

export type PayoutDestinationType = 'bank'

export type BankDestinationMeta = {
  id: string
  type: 'bank'
  bankName: string
  accountName: string
  accountNumberLast4: string
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export type BankDestinationDetails = {
  accountNumber: string
  bankName: string
  accountHolder: string
  swiftCode?: string
  routingNumber?: string
  iban?: string
}

type StoredBankDestination = {
  type: 'bank'
  bankName: string
  accountName: string
  accountNumberLast4: string
  isPrimary?: boolean
  encrypted: {
    v: 1
    iv: string
    tag: string
    ciphertext: string
  }
  /** ISO. A secondary destination cannot be paid before this (new-destination hold). */
  holdUntil?: string
  createdAt: string
  updatedAt: string
}

const destinationsCollection = (organizerId: string) =>
  adminDb.collection('organizers').doc(organizerId).collection('payoutDestinations')

export async function listBankDestinations(organizerId: string): Promise<BankDestinationMeta[]> {
  const snap = await destinationsCollection(organizerId).where('type', '==', 'bank').get()

  const items: BankDestinationMeta[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as any
    items.push({
      id: doc.id,
      type: 'bank',
      bankName: String(data.bankName || ''),
      accountName: String(data.accountName || ''),
      accountNumberLast4: String(data.accountNumberLast4 || ''),
      isPrimary: Boolean(data.isPrimary),
      createdAt: String(data.createdAt || ''),
      updatedAt: String(data.updatedAt || ''),
    })
  }

  // Primary first, then stable sort.
  items.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return a.createdAt.localeCompare(b.createdAt)
  })

  return items
}

export async function upsertPrimaryBankDestinationFromPayoutSettings(params: {
  organizerId: string
  bankDetails: BankDestinationDetails
}): Promise<{ id: string }> {
  const { organizerId, bankDetails } = params

  const now = new Date().toISOString()
  const id = 'bank_primary'

  const accountNumber = String(bankDetails.accountNumber)
  const last4 = accountNumber.slice(-4)

  const encrypted = encryptJson({
    accountNumber,
    bankName: String(bankDetails.bankName),
    accountHolder: String(bankDetails.accountHolder),
    swiftCode: bankDetails.swiftCode ? String(bankDetails.swiftCode) : undefined,
    routingNumber: bankDetails.routingNumber ? String(bankDetails.routingNumber) : undefined,
    iban: bankDetails.iban ? String(bankDetails.iban) : undefined,
  })

  const docRef = destinationsCollection(organizerId).doc(id)
  const existing = await docRef.get()
  const createdAt = existing.exists ? String((existing.data() as any)?.createdAt || now) : now

  const toStore: StoredBankDestination = {
    type: 'bank',
    bankName: String(bankDetails.bankName),
    accountName: String(bankDetails.accountHolder),
    accountNumberLast4: last4,
    isPrimary: true,
    encrypted,
    createdAt,
    updatedAt: now,
  }

  await docRef.set(toStore, { merge: true })

  return { id }
}

const DEFAULT_NEW_DESTINATION_HOLD_MS = 24 * 60 * 60 * 1000

/**
 * Add a non-primary bank destination. It is ALWAYS created on the
 * new-destination hold (NEW_PAYOUT_DESTINATION_HOLD_MS): a stolen session plus
 * an emailed code must not be able to add an account and drain to it at once.
 * withdraw-bank refuses a destination whose holdUntil is in the future.
 */
export async function addSecondaryBankDestination(params: {
  organizerId: string
  bankDetails: BankDestinationDetails
  addedVia?: string
  /** NEW_PAYOUT_DESTINATION_HOLD_MS; defaults to the same 24h. */
  holdMs?: number
  now?: Date
}): Promise<{ id: string; holdUntil: string }> {
  const { organizerId, bankDetails } = params

  const nowDate = params.now || new Date()
  const now = nowDate.toISOString()
  // Callers pass NEW_PAYOUT_DESTINATION_HOLD_MS (lib/firestore/payout); it is
  // not imported here because payout.ts imports this module (import cycle).
  const holdMs = Number(params.holdMs) > 0 ? Number(params.holdMs) : DEFAULT_NEW_DESTINATION_HOLD_MS
  const holdUntil = new Date(nowDate.getTime() + holdMs).toISOString()

  const accountNumber = String(bankDetails.accountNumber)
  const last4 = accountNumber.slice(-4)

  const encrypted = encryptJson({
    accountNumber,
    bankName: String(bankDetails.bankName),
    accountHolder: String(bankDetails.accountHolder),
    swiftCode: bankDetails.swiftCode ? String(bankDetails.swiftCode) : undefined,
    routingNumber: bankDetails.routingNumber ? String(bankDetails.routingNumber) : undefined,
    iban: bankDetails.iban ? String(bankDetails.iban) : undefined,
  })

  const docRef = destinationsCollection(organizerId).doc()
  const toStore: StoredBankDestination = {
    type: 'bank',
    bankName: String(bankDetails.bankName),
    accountName: String(bankDetails.accountHolder),
    accountNumberLast4: last4,
    isPrimary: false,
    encrypted,
    holdUntil,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set({ ...toStore, ...(params.addedVia ? { addedVia: params.addedVia } : {}) })
  return { id: docRef.id, holdUntil }
}

export async function getDecryptedBankDestination(params: {
  organizerId: string
  destinationId: string
}): Promise<BankDestinationDetails | null> {
  const { organizerId, destinationId } = params

  const doc = await destinationsCollection(organizerId).doc(destinationId).get()
  if (!doc.exists) return null

  const data = doc.data() as any
  if (String(data?.type || '') !== 'bank') return null

  const encrypted = data?.encrypted
  if (!encrypted) return null

  const decoded = decryptJson<BankDestinationDetails>(encrypted)
  return decoded
}
