import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { upsertPrimaryBankDestinationFromPayoutSettings } from '@/lib/firestore/payout-destinations'
import { normalizeMoncashReceiver } from '@/lib/payouts/moncash-prefunded'

export type PayoutStatus = 'not_setup' | 'pending_verification' | 'active' | 'on_hold'
export type PayoutMethod = 'bank_transfer' | 'mobile_money'
export type PayoutProvider = 'stripe_connect' | 'moncash' | 'natcash' | 'bank_transfer'
export type PayoutProfileId = 'haiti' | 'stripe_connect'

export interface PayoutConfig {
  status: PayoutStatus
  accountLocation?: string
  payoutProvider?: PayoutProvider
  stripeAccountId?: string
  allowInstantMoncash?: boolean
  method?: PayoutMethod
  // When payout details are changed, we can place payouts temporarily on hold.
  // If this is set and in the future, `status` will remain `on_hold`.
  // If in the past, status is recomputed normally.
  payoutHoldUntil?: string
  bankDetails?: {
    accountLocation?: string
    accountName: string
    accountNumber: string // masked after save
    bankName: string
    routingNumber?: string
    swift?: string
    iban?: string
  }
  mobileMoneyDetails?: {
    provider: string // 'moncash' | 'natcash' | etc
    phoneNumber: string // masked after save
    accountName: string
    phoneNumberLast4?: string
    /**
     * Server-computed fingerprint of the FULL normalized number
     * (mobileMoneyFingerprint). Withdrawals pay only a number whose fingerprint
     * equals this one; never accepted from a client.
     */
    phoneNumberFingerprint?: string | null
    phoneNumberFingerprintSetAt?: string
  }
  verificationStatus?: {
    identity: 'pending' | 'verified' | 'failed'
    bank: 'pending' | 'verified' | 'failed'
    phone: 'pending' | 'verified' | 'failed'
  }
  createdAt: string
  updatedAt: string
}

const PAYOUT_CHANGE_VERIFICATION_DOC_ID = 'payoutDetailsChangeVerification'
const PAYOUT_CHANGE_VERIFICATION_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const PAYOUT_DETAILS_CHANGE_HOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

const getPayoutChangeVerificationRef = (organizerId: string) =>
  adminDb
    .collection('organizers')
    .doc(organizerId)
    .collection('security')
    .doc(PAYOUT_CHANGE_VERIFICATION_DOC_ID)

/**
 * Fields of a payout config/profile that only the server may decide.
 *
 * updatePayoutConfig / updatePayoutProfileConfig are reachable from the
 * organizer's own browser through the server actions in
 * app/organizer/settings/payouts/actions.ts, which forward the client's object
 * as-is. Spreading it unfiltered let an organizer write
 * verificationStatus.identity = 'verified' (activating payouts without KYC),
 * clear the 24h `on_hold` that follows a destination change by sending
 * status / payoutHoldUntil, or backdate createdAt. These are computed here
 * (status, hold) or derived from verification records (verificationStatus),
 * so callers never need to pass them.
 */
const SERVER_OWNED_PAYOUT_FIELDS = ['status', 'payoutHoldUntil', 'verificationStatus', 'createdAt', 'updatedAt'] as const

function stripServerOwnedPayoutFields(updates: Partial<PayoutConfig> | null | undefined): Partial<PayoutConfig> {
  const out: Record<string, unknown> = { ...(updates || {}) }
  for (const key of SERVER_OWNED_PAYOUT_FIELDS) delete out[key]
  // The destination fingerprint/last4 are derived from the full number on the
  // server. A client-sent value would let a browser declare "this is my saved
  // number" for a number it never saved.
  if (out.mobileMoneyDetails && typeof out.mobileMoneyDetails === 'object') {
    const mm: Record<string, unknown> = { ...(out.mobileMoneyDetails as any) }
    delete mm.phoneNumberFingerprint
    delete mm.phoneNumberFingerprintSetAt
    delete mm.phoneNumberLast4
    out.mobileMoneyDetails = mm
  }
  return out as Partial<PayoutConfig>
}

/**
 * Fingerprint of a Haitian mobile-money number over its FULL normalized form
 * (509XXXXXXXX). Payout profiles store only a masked number + last 4, and
 * last-4 equality let a withdrawal go to any wallet sharing those digits; this
 * is what withdrawals compare instead. Null for anything that is not a valid
 * Haitian number.
 */
export function mobileMoneyFingerprint(raw: unknown): string | null {
  const normalized = normalizeMoncashReceiver(raw)
  if (!normalized) return null
  return crypto.createHash('sha256').update(`tikem-mobile-money-v1:${normalized}`).digest('hex')
}

/**
 * The profile a sensitive-update decision must be judged against: the profile
 * doc when it exists, else the legacy payoutConfig/main that getPayoutProfile
 * falls back to. Judging only the profile doc let an organizer whose live
 * destination came from payoutConfig/main write a NEW destination into a
 * not-yet-existing profile doc with no step-up and no hold.
 */
async function resolveCurrentPayoutProfileForStepUp(
  organizerId: string,
  profileId: PayoutProfileId,
  profileSnap: any
): Promise<PayoutConfig | null> {
  if (profileSnap?.exists) return profileSnap.data() as PayoutConfig
  const legacySnap = await adminDb
    .collection('organizers')
    .doc(organizerId)
    .collection('payoutConfig')
    .doc('main')
    .get()
  if (!legacySnap.exists) return null
  const legacy = legacySnap.data() as any
  const provider = String(legacy?.payoutProvider || '').toLowerCase()
  const location = String(legacy?.accountLocation || legacy?.bankDetails?.accountLocation || '').toLowerCase()
  const legacyIsStripeConnect = provider === 'stripe_connect' || location === 'united_states' || location === 'canada'
  // Same split getPayoutProfile uses.
  if (profileId === 'stripe_connect') return legacyIsStripeConnect ? (legacy as PayoutConfig) : null
  return legacyIsStripeConnect ? null : (legacy as PayoutConfig)
}

const isSensitivePayoutDetailsUpdate = (updates: Partial<PayoutConfig>): boolean => {
  if (!updates) return false

  // Anything that materially changes where money is sent.
  if (updates.method) return true
  if (updates.accountLocation) return true
  if (updates.payoutProvider) return true

  if (updates.bankDetails) {
    const bd = updates.bankDetails
    if (bd.accountName) return true
    if (bd.accountNumber) return true
    if (bd.bankName) return true
    if (bd.routingNumber) return true
    if (bd.swift) return true
    if (bd.iban) return true
    return true
  }

  if (updates.mobileMoneyDetails) {
    const mm = updates.mobileMoneyDetails
    if (mm.provider) return true
    if (mm.phoneNumber) return true
    if (mm.accountName) return true
    return true
  }

  return false
}

export async function requireRecentPayoutDetailsChangeVerification(organizerId: string) {
  const ref = getPayoutChangeVerificationRef(organizerId)
  const snap = await ref.get()
  const data = snap.exists ? (snap.data() as any) : null

  const verifiedUntilRaw = data?.verifiedUntil
  const verifiedUntil =
    verifiedUntilRaw?.toDate && typeof verifiedUntilRaw?.toDate === 'function'
      ? verifiedUntilRaw.toDate().toISOString()
      : typeof verifiedUntilRaw === 'string'
        ? verifiedUntilRaw
        : null

  if (!verifiedUntil) {
    throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  }

  const nowMs = Date.now()
  const verifiedUntilMs = new Date(verifiedUntil).getTime()
  if (!Number.isFinite(verifiedUntilMs) || verifiedUntilMs < nowMs) {
    throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  }

  // Also cap the window server-side, in case a stale doc is left behind.
  const capMs = nowMs + PAYOUT_CHANGE_VERIFICATION_WINDOW_MS
  if (verifiedUntilMs > capMs) {
    // If it is set too far in the future, treat as invalid.
    throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  }
}

export async function consumePayoutDetailsChangeVerification(organizerId: string) {
  try {
    await getPayoutChangeVerificationRef(organizerId).set(
      {
        consumedAt: new Date().toISOString(),
        verifiedUntil: null,
        codeHash: null,
        salt: null,
      },
      { merge: true }
    )
  } catch (e) {
    // Best-effort; don't fail a successful update because cleanup failed.
    console.warn('Failed to consume payout change verification token:', e)
  }
}

export async function getOrganizerIdentityVerificationStatus(
  organizerId: string
): Promise<NonNullable<PayoutConfig['verificationStatus']>['identity']> {
  // Determine organizer identity verification status (approved/pending/failed)
  const [userDoc, organizerDoc] = await Promise.all([
    adminDb.collection('users').doc(organizerId).get(),
    adminDb.collection('organizers').doc(organizerId).get(),
  ])

  const userData = userDoc.exists ? userDoc.data() : null
  const organizerData = organizerDoc.exists ? organizerDoc.data() : null

  const userSaysApproved =
    userData?.verification_status === 'approved' ||
    userData?.is_verified === true ||
    organizerData?.verification_status === 'approved' ||
    organizerData?.is_verified === true

  // Primary lookup: doc id == organizerId
  let verificationData: any | null = null
  const organizerVerificationDoc = await adminDb
    .collection('verification_requests')
    .doc(organizerId)
    .get()

  if (organizerVerificationDoc.exists) {
    verificationData = organizerVerificationDoc.data()
  } else {
    // Fallback for older/migrated data where docId != organizerId
    const [byUserId, byUser_id] = await Promise.all([
      adminDb
        .collection('verification_requests')
        .where('userId', '==', organizerId)
        .limit(1)
        .get(),
      adminDb
        .collection('verification_requests')
        .where('user_id', '==', organizerId)
        .limit(1)
        .get(),
    ])

    const hit =
      (!byUserId.empty && byUserId.docs[0]) ||
      (!byUser_id.empty && byUser_id.docs[0]) ||
      null

    verificationData = hit ? hit.data() : null
  }

  const requestStatus = String(verificationData?.status || '').trim().toLowerCase()
  if (userSaysApproved || requestStatus === 'approved') return 'verified'
  if (requestStatus === 'rejected') return 'failed'
  if (
    requestStatus === 'pending' ||
    requestStatus === 'pending_review' ||
    requestStatus === 'in_review' ||
    requestStatus === 'changes_requested'
  ) {
    return 'pending'
  }

  return 'pending'
}

export interface Payout {
  id: string
  organizerId: string
  amount: number // in cents
  currency?: string // HTG (default), USD, etc.
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  method: PayoutMethod
  failureReason?: string
  scheduledDate: string
  processedDate?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
  
  // NEW: Idempotency & admin workflow fields
  requestedBy: string           // organizerId (for audit)
  approvedBy?: string           // admin userId
  approvedAt?: string
  declinedBy?: string           // admin userId  
  declinedAt?: string
  declineReason?: string
  
  // NEW: Ticket tracking (prevent double-counting)
  ticketIds: string[]           // List of ticket IDs included in this payout
  periodStart: string           // Earliest ticket purchased_at
  periodEnd: string             // Latest ticket purchased_at
  
  // NEW: Manual payment tracking
  paymentReferenceId?: string   // Admin enters after bank/MonCash transfer
  paymentMethod?: 'moncash' | 'natcash' | 'bank_transfer'  // Actual method used
  paymentNotes?: string         // Admin notes
  
  // NEW: Receipt confirmation (required for completed payouts)
  receiptUrl?: string | null    // LEGACY public URL; new uploads store receiptPath (private, signed on read)
  receiptPath?: string | null   // Storage path of the private receipt (payout-receipts/...)
  receiptUploadedBy?: string    // Admin userId who uploaded receipt
  receiptUploadedAt?: string    // Timestamp of receipt upload
}

const hasBankMethod = (config?: PayoutConfig | null) =>
  Boolean(config && config.method === 'bank_transfer' && config.bankDetails)

const hasMobileMoneyMethod = (config?: PayoutConfig | null) =>
  Boolean(config && config.method === 'mobile_money' && config.mobileMoneyDetails)

export const hasPayoutMethod = (config?: PayoutConfig | null): boolean =>
  hasBankMethod(config) || hasMobileMoneyMethod(config)

const identityVerified = (config?: PayoutConfig | null) =>
  config?.verificationStatus?.identity === 'verified'

// Only Stripe/US-CA managed accounts require profile-level bank verification to
// activate. The Haiti manual bank rail activates on IDENTITY alone (consistent
// with the identity-only payout decision) — an admin verifies the destination
// and releases every payout by hand, so pre-verification isn't the gate here.
const bankVerified = (config?: PayoutConfig | null) => {
  if (config?.method !== 'bank_transfer') return true
  const provider = String(config?.payoutProvider || '').toLowerCase()
  const loc = String(config?.accountLocation || '').toLowerCase()
  const isManagedStripe =
    provider === 'stripe_connect' || loc === 'united_states' || loc === 'canada'
  if (isManagedStripe) return config?.verificationStatus?.bank === 'verified'
  return true // Haiti manual bank rail — identity is the gate
}

// Haiti payouts are processed MANUALLY by an admin who reviews and releases each
// request, so IDENTITY verification is the meaningful activation gate. Phone
// (MonCash) verification is NO LONGER required to activate the mobile_money rail:
// an unverified phone cannot misdirect funds because a human confirms every
// payout. Bank and Stripe/US-CA logic are unaffected (phoneVerified only ever
// gated the mobile_money method, which returned true for all other methods).
const phoneVerified = (_config?: PayoutConfig | null) => true

export function determinePayoutStatus(config: PayoutConfig | null): PayoutStatus {
  if (!config || !hasPayoutMethod(config)) {
    return 'not_setup'
  }

  if (config.status === 'on_hold') {
    const holdUntil = config.payoutHoldUntil ? new Date(config.payoutHoldUntil).getTime() : NaN
    const now = Date.now()
    // If the hold has expired, allow the status to recompute normally.
    if (Number.isFinite(holdUntil) && holdUntil <= now) {
      // fallthrough
    } else {
      return 'on_hold'
    }
  }

  // Payouts are reviewed and released manually by an admin, so identity
  // verification is the activation gate. For the Haiti mobile_money (MonCash)
  // rail, identity alone activates the profile (phoneVerified is now always
  // true). Bank transfers additionally require bank-destination verification,
  // and Stripe/US-CA accounts follow their existing bank/identity checks.
  if (identityVerified(config) && bankVerified(config) && phoneVerified(config)) {
    return 'active'
  }

  return 'pending_verification'
}

export async function recomputePayoutStatus(
  organizerId: string
): Promise<PayoutStatus | null> {
  try {
    const configRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payoutConfig')
      .doc('main')

    const configSnapshot = await configRef.get()

    if (!configSnapshot.exists) {
      return null
    }

    const current = configSnapshot.data() as PayoutConfig
    const nextStatus = determinePayoutStatus(current)

    if (current.status !== nextStatus) {
      await configRef.set(
        {
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
    }

    return nextStatus
  } catch (error) {
    console.error('Error recomputing payout status:', error)
    return null
  }
}

/**
 * Get payout configuration for an organizer
 */
export async function getPayoutConfig(organizerId: string): Promise<PayoutConfig | null> {
  try {
    const configDoc = await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payoutConfig')
      .doc('main')
      .get()

    const data = configDoc.exists ? configDoc.data()! : null
    
    // Helper function to convert timestamps
    const convertTimestamp = (value: any, fallback: string = new Date().toISOString()): string => {
      if (!value) return fallback
      if (value.toDate && typeof value.toDate === 'function') {
        return value.toDate().toISOString()
      }
      if (typeof value === 'string') return value
      if (value instanceof Date) return value.toISOString()
      try {
        return new Date(value).toISOString()
      } catch {
        return fallback
      }
    }

    const organizerIdentityStatus = await getOrganizerIdentityVerificationStatus(organizerId)

    // Get payout-specific verification documents
    const verificationDocs = await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')
      .get()

    const verificationStatus: PayoutConfig['verificationStatus'] = {
      // Organizer verification controls identity status
      identity: organizerIdentityStatus,
      bank: 'pending',
      phone: 'pending',
    }

    verificationDocs.docs.forEach((doc: any) => {
      const docData = doc.data()
      const type = doc.id as 'identity' | 'bank' | 'phone'
      if (type in verificationStatus) {
        // Keep organizer-approved identity as verified
        if (type === 'identity' && organizerIdentityStatus === 'verified') return
        verificationStatus[type] = docData.status || 'pending'
      }
    })

    // Merge with data from config, prioritizing computed verification status (especially for identity)
    const finalVerificationStatus = {
      // For identity: prioritize organizer verification check, then payout-specific verification, then config data
      identity: verificationStatus.identity,
      // For bank/phone: verification docs only. payoutConfig/main was
      // client-writable until the rules were locked, and nothing on the server
      // ever writes its verificationStatus, so a stored value there is a
      // self-asserted claim, not a verification.
      bank: verificationStatus.bank,
      phone: verificationStatus.phone,
    }

    const baseConfig: PayoutConfig = {
      status: data?.status || 'not_setup',
      accountLocation: data?.accountLocation || data?.bankDetails?.accountLocation || undefined,
      payoutProvider: data?.payoutProvider,
      stripeAccountId: data?.stripeAccountId,
      allowInstantMoncash: typeof data?.allowInstantMoncash === 'boolean' ? data.allowInstantMoncash : undefined,
      method: data?.method,
      payoutHoldUntil: data?.payoutHoldUntil ? convertTimestamp(data.payoutHoldUntil) : undefined,
      bankDetails: data?.bankDetails,
      mobileMoneyDetails: data?.mobileMoneyDetails,
      verificationStatus: finalVerificationStatus,
      createdAt: convertTimestamp(data?.createdAt),
      updatedAt: convertTimestamp(data?.updatedAt)
    }

    return {
      ...baseConfig,
      status: determinePayoutStatus(baseConfig)
    }
  } catch (error) {
    console.error('Error fetching payout config:', error)
    return null
  }
}

/**
 * Update payout configuration
 */
export async function updatePayoutConfig(
  organizerId: string,
  updates: Partial<PayoutConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    const configRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payoutConfig')
      .doc('main')

    const now = new Date().toISOString()

    const configDoc = await configRef.get()
    const current = configDoc.exists ? (configDoc.data() as PayoutConfig) : null

    const normalizedLocation = String(
      updates.accountLocation ?? current?.accountLocation ?? current?.bankDetails?.accountLocation ?? ''
    ).toLowerCase()
    const effectiveProvider = String(updates.payoutProvider ?? current?.payoutProvider ?? '').toLowerCase()
    const isStripeConnectAccount =
      effectiveProvider === 'stripe_connect' ||
      normalizedLocation === 'united_states' ||
      normalizedLocation === 'canada'

    // US/CA payouts are handled via Stripe Connect, so we should not store bank/mobile-money details.
    const sanitizedUpdates: Partial<PayoutConfig> = stripServerOwnedPayoutFields(updates)
    if (isStripeConnectAccount) {
      delete (sanitizedUpdates as any).bankDetails
      delete (sanitizedUpdates as any).mobileMoneyDetails
      // This setting is only meaningful for Haiti MonCash prefunding.
      delete (sanitizedUpdates as any).allowInstantMoncash
      if (sanitizedUpdates.method === 'mobile_money') {
        sanitizedUpdates.method = 'bank_transfer'
      }
    }

    const sensitiveUpdate = isSensitivePayoutDetailsUpdate(sanitizedUpdates)
    const existingHasMethod = hasPayoutMethod(current)
    const shouldRequireStepUp = Boolean(configDoc.exists && existingHasMethod && sensitiveUpdate)

    if (shouldRequireStepUp) {
      await requireRecentPayoutDetailsChangeVerification(organizerId)
    }
    
    // Mask sensitive data before saving
    const updateData: any = {
      ...sanitizedUpdates,
      updatedAt: now,
    }

    // If payout destination details are changed after initial setup, place payouts on hold briefly.
    if (shouldRequireStepUp) {
      updateData.status = 'on_hold'
      updateData.payoutHoldUntil = new Date(Date.now() + PAYOUT_DETAILS_CHANGE_HOLD_MS).toISOString()
    }

    // If bank details are being updated, mask the account number
    if (!isStripeConnectAccount && sanitizedUpdates.bankDetails?.accountNumber) {
      const accountNumber = sanitizedUpdates.bankDetails.accountNumber

      // Best-effort: store encrypted full details for future withdrawals.
      try {
        if (process.env.PAYOUT_DETAILS_ENCRYPTION_KEY) {
          await upsertPrimaryBankDestinationFromPayoutSettings({
            organizerId,
            bankDetails: {
              accountNumber,
              bankName: sanitizedUpdates.bankDetails.bankName,
              accountHolder: sanitizedUpdates.bankDetails.accountName,
              routingNumber: sanitizedUpdates.bankDetails.routingNumber,
              swiftCode: sanitizedUpdates.bankDetails.swift,
              iban: sanitizedUpdates.bankDetails.iban,
            },
          })
        } else {
          console.warn('PAYOUT_DETAILS_ENCRYPTION_KEY not set; bank on-file withdrawals will be disabled.')
        }
      } catch (e) {
        console.warn('Failed to persist encrypted bank destination:', e)
      }

      updateData.bankDetails = {
        ...sanitizedUpdates.bankDetails,
        accountNumber: maskAccountNumber(accountNumber),
        accountNumberLast4: accountNumber.slice(-4)
      }
    }

    // If mobile money details are being updated, mask the phone number
    if (!isStripeConnectAccount && sanitizedUpdates.mobileMoneyDetails?.phoneNumber) {
      const phoneNumber = sanitizedUpdates.mobileMoneyDetails.phoneNumber
      // A client re-saving the profile sends back the MASKED number it was
      // shown, which has no fingerprint. Writing that null would erase the
      // stored fingerprint of the real number (merge keeps it when omitted).
      const fingerprint = mobileMoneyFingerprint(phoneNumber)
      updateData.mobileMoneyDetails = {
        ...sanitizedUpdates.mobileMoneyDetails,
        phoneNumber: maskPhoneNumber(phoneNumber),
        phoneNumberLast4: phoneNumber.slice(-4),
        ...(fingerprint ? { phoneNumberFingerprint: fingerprint, phoneNumberFingerprintSetAt: now } : {}),
      }
    }

    if (!configDoc.exists) {
      updateData.createdAt = now
    }

    await configRef.set(updateData, { merge: true })

    if (shouldRequireStepUp) {
      await consumePayoutDetailsChangeVerification(organizerId)
    }

    await recomputePayoutStatus(organizerId)

    return { success: true }
  } catch (error: any) {
    const message = String(error?.message || '')
    // Expected sentinel for step-up verification.
    if (!message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
      console.error('Error updating payout config:', error)
    }
    return { success: false, error: error.message }
  }
}

/**
 * Update payout configuration for a specific payout profile.
 *
 * Profiles:
 * - 'haiti': stores bank/mobile-money details and internal verification checklist.
 * - 'stripe_connect': stores Stripe Connect metadata (accountLocation, stripeAccountId).
 *
 * Backward compatibility: this does not remove or migrate legacy payoutConfig/main automatically.
 */
export async function updatePayoutProfileConfig(
  organizerId: string,
  profileId: PayoutProfileId,
  updates: Partial<PayoutConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    const configRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payoutProfiles')
      .doc(profileId)

    const now = new Date().toISOString()

    const configDoc = await configRef.get()
    // The RESOLVED profile (profile doc, else the legacy payoutConfig/main
    // getPayoutProfile falls back to), so a destination that lives only in the
    // legacy doc still makes a change sensitive.
    const current = await resolveCurrentPayoutProfileForStepUp(organizerId, profileId, configDoc)

    const normalizedLocation = String(
      updates.accountLocation ?? current?.accountLocation ?? current?.bankDetails?.accountLocation ?? ''
    ).toLowerCase()
    const effectiveProvider = String(updates.payoutProvider ?? current?.payoutProvider ?? '').toLowerCase()
    const isStripeConnectAccount =
      profileId === 'stripe_connect' ||
      effectiveProvider === 'stripe_connect' ||
      normalizedLocation === 'united_states' ||
      normalizedLocation === 'canada'

    // Stripe Connect profile should never store bank/mobile money details.
    const sanitizedUpdates: Partial<PayoutConfig> = stripServerOwnedPayoutFields(updates)
    if (isStripeConnectAccount) {
      delete (sanitizedUpdates as any).bankDetails
      delete (sanitizedUpdates as any).mobileMoneyDetails
      delete (sanitizedUpdates as any).allowInstantMoncash
      if (sanitizedUpdates.method === 'mobile_money') {
        sanitizedUpdates.method = 'bank_transfer'
      }
    }

    const sensitiveUpdate = isSensitivePayoutDetailsUpdate(sanitizedUpdates)
    const existingHasMethod = hasPayoutMethod(current)
    const shouldRequireStepUp = Boolean(current && existingHasMethod && sensitiveUpdate)

    if (shouldRequireStepUp) {
      await requireRecentPayoutDetailsChangeVerification(organizerId)
    }

    const updateData: any = {
      ...sanitizedUpdates,
      updatedAt: now,
    }

    if (shouldRequireStepUp) {
      updateData.status = 'on_hold'
      updateData.payoutHoldUntil = new Date(Date.now() + PAYOUT_DETAILS_CHANGE_HOLD_MS).toISOString()
    }

    // Mask sensitive data before saving (Haiti profile only).
    if (!isStripeConnectAccount && sanitizedUpdates.bankDetails?.accountNumber) {
      const accountNumber = sanitizedUpdates.bankDetails.accountNumber

      // Best-effort: store encrypted full details for future withdrawals.
      try {
        if (process.env.PAYOUT_DETAILS_ENCRYPTION_KEY) {
          await upsertPrimaryBankDestinationFromPayoutSettings({
            organizerId,
            bankDetails: {
              accountNumber,
              bankName: sanitizedUpdates.bankDetails.bankName,
              accountHolder: sanitizedUpdates.bankDetails.accountName,
              routingNumber: sanitizedUpdates.bankDetails.routingNumber,
              swiftCode: sanitizedUpdates.bankDetails.swift,
              iban: sanitizedUpdates.bankDetails.iban,
            },
          })
        } else {
          console.warn('PAYOUT_DETAILS_ENCRYPTION_KEY not set; bank on-file withdrawals will be disabled.')
        }
      } catch (e) {
        console.warn('Failed to persist encrypted bank destination:', e)
      }

      updateData.bankDetails = {
        ...sanitizedUpdates.bankDetails,
        accountNumber: maskAccountNumber(accountNumber),
        accountNumberLast4: accountNumber.slice(-4),
      }
    }

    if (!isStripeConnectAccount && sanitizedUpdates.mobileMoneyDetails?.phoneNumber) {
      const phoneNumber = sanitizedUpdates.mobileMoneyDetails.phoneNumber
      // A client re-saving the profile sends back the MASKED number it was
      // shown, which has no fingerprint. Writing that null would erase the
      // stored fingerprint of the real number (merge keeps it when omitted).
      const fingerprint = mobileMoneyFingerprint(phoneNumber)
      updateData.mobileMoneyDetails = {
        ...sanitizedUpdates.mobileMoneyDetails,
        phoneNumber: maskPhoneNumber(phoneNumber),
        phoneNumberLast4: phoneNumber.slice(-4),
        ...(fingerprint ? { phoneNumberFingerprint: fingerprint, phoneNumberFingerprintSetAt: now } : {}),
      }
    }

    if (!configDoc.exists) {
      updateData.createdAt = now
    }

    await configRef.set(updateData, { merge: true })

    if (shouldRequireStepUp) {
      await consumePayoutDetailsChangeVerification(organizerId)
    }

    return { success: true }
  } catch (error: any) {
    const message = String(error?.message || '')
    if (!message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
      console.error('Error updating payout profile config:', error)
    }
    return { success: false, error: error.message }
  }
}

/**
 * Get payout history for an organizer
 */
export async function getPayoutHistory(organizerId: string, limit: number = 10): Promise<Payout[]> {
  try {
    // Withdrawals are written to the top-level `withdrawal_requests` collection by
    // the withdraw-moncash / withdraw-bank routes. The legacy
    // organizers/{id}/payouts subcollection is never written by the live flow, so
    // reading it always returned an empty history. We read the collection that
    // actually receives records. Ordering is done in-memory to avoid requiring a
    // composite index (organizerId + createdAt desc).
    const snapshot = await adminDb
      .collection('withdrawal_requests')
      .where('organizerId', '==', organizerId)
      .get()

    const convertTimestamp = (value: any, fallback: string = new Date().toISOString()): string => {
      if (!value) return fallback
      if (value.toDate && typeof value.toDate === 'function') {
        return value.toDate().toISOString()
      }
      if (typeof value === 'string') return value
      if (value instanceof Date) return value.toISOString()
      try {
        return new Date(value).toISOString()
      } catch {
        return fallback
      }
    }

    // withdrawal_requests store method as 'moncash' | 'bank'; map onto PayoutMethod.
    const normalizeMethod = (m: any): PayoutMethod =>
      String(m || '').toLowerCase() === 'bank' ? 'bank_transfer' : 'mobile_money'

    const normalizeStatus = (s: any): Payout['status'] => {
      const v = String(s || 'pending').toLowerCase()
      if (v === 'completed' || v === 'processing' || v === 'failed' || v === 'cancelled') return v
      return 'pending'
    }

    const payouts: Payout[] = snapshot.docs.map((doc: any) => {
      const data = doc.data()
      const createdAt = convertTimestamp(data.createdAt)

      return {
        id: doc.id,
        organizerId: data.organizerId,
        amount: data.amount || 0, // cents
        currency: data.currency || 'HTG',
        status: normalizeStatus(data.status),
        method: normalizeMethod(data.method),
        failureReason: data.failureReason,
        scheduledDate: createdAt,
        processedDate: data.processedAt ? convertTimestamp(data.processedAt) : undefined,
        completedAt: data.completedAt ? convertTimestamp(data.completedAt) : undefined,
        createdAt,
        updatedAt: convertTimestamp(data.updatedAt, createdAt),
        // Fields below are part of the Payout shape but not tracked on
        // withdrawal_requests; default them so downstream consumers don't crash.
        requestedBy: data.organizerId,
        ticketIds: [],
        periodStart: createdAt,
        periodEnd: createdAt,
      }
    })

    // Sort by created date descending and limit
    payouts.sort((a: Payout, b: Payout) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return payouts.slice(0, limit)
  } catch (error) {
    console.error('Error fetching payout history:', error)
    return []
  }
}

/*
 * getOrganizerBalance / getAvailableTicketsForPayout lived here: a second
 * balance engine (flat uncapped 10%, hard-coded 7-day delay, `new Date()` on
 * Firestore Timestamps, `approved` payouts not treated as paid, currencies
 * summed). Removed so nothing can read it again — the single definition of
 * what may be withdrawn is lib/payouts/availability.ts, loaded by
 * lib/payouts/availability-server.ts.
 */

// Helper functions
function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber
  return '*'.repeat(accountNumber.length - 4) + accountNumber.slice(-4)
}

function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 4) return phoneNumber
  return '*'.repeat(phoneNumber.length - 4) + phoneNumber.slice(-4)
}

// ── Mobile-money payout destination binding ──────────────────────────────────

export const PAYOUT_DESTINATION_MISMATCH_CODE = 'PAYOUT_DESTINATION_MISMATCH'

export type MobileMoneyDestinationCheck =
  | {
      ok: true
      fingerprint: string
      /**
       * 'profile': the number equals the profile's stored full-number fingerprint.
       * 'legacy_last4': the profile predates fingerprints and only its last 4
       * matched; the caller must require the email step-up and then enroll the
       * fingerprint (enrollLegacyMobileMoneyFingerprint).
       */
      via: 'profile' | 'legacy_last4'
    }
  | { ok: false; code: typeof PAYOUT_DESTINATION_MISMATCH_CODE; message: string }

const DESTINATION_MISMATCH_MESSAGE =
  'Withdrawals can only go to the MonCash number saved on your payout profile. To use another number, change it in Payout settings (it is confirmed by an emailed code and held for 24 hours).'

/**
 * Is `receiver` the mobile-money destination on this payout profile? Compared
 * on the FULL normalized number, never on its last 4 digits.
 */
export function checkMobileMoneyDestination(
  profile: Pick<PayoutConfig, 'mobileMoneyDetails'> | null | undefined,
  receiver: unknown
): MobileMoneyDestinationCheck {
  const fingerprint = mobileMoneyFingerprint(receiver)
  if (!fingerprint) {
    return { ok: false, code: PAYOUT_DESTINATION_MISMATCH_CODE, message: DESTINATION_MISMATCH_MESSAGE }
  }
  const mm: any = profile?.mobileMoneyDetails || {}
  const stored = typeof mm.phoneNumberFingerprint === 'string' ? mm.phoneNumberFingerprint : ''
  if (stored) {
    return stored === fingerprint
      ? { ok: true, fingerprint, via: 'profile' }
      : { ok: false, code: PAYOUT_DESTINATION_MISMATCH_CODE, message: DESTINATION_MISMATCH_MESSAGE }
  }
  const last4 = String(mm.phoneNumberLast4 ?? '').replace(/\D/g, '')
  const digits = String(normalizeMoncashReceiver(receiver) || '')
  if (last4.length === 4 && digits.endsWith(last4)) return { ok: true, fingerprint, via: 'legacy_last4' }
  return { ok: false, code: PAYOUT_DESTINATION_MISMATCH_CODE, message: DESTINATION_MISMATCH_MESSAGE }
}

/**
 * Record the full-number fingerprint on a profile saved before fingerprints
 * existed, once the organizer has passed the email step-up for a number whose
 * last 4 match. Written to the doc getPayoutProfile reads (the haiti profile,
 * else legacy payoutConfig/main), and only if no fingerprint is there yet.
 */
export async function enrollLegacyMobileMoneyFingerprint(organizerId: string, fingerprint: string): Promise<void> {
  const organizerRef = adminDb.collection('organizers').doc(organizerId)
  const profileRef = organizerRef.collection('payoutProfiles').doc('haiti')
  const legacyRef = organizerRef.collection('payoutConfig').doc('main')
  await adminDb.runTransaction(async (tx: any) => {
    const profileSnap = await tx.get(profileRef)
    const target = profileSnap.exists ? profileRef : legacyRef
    const snap = profileSnap.exists ? profileSnap : await tx.get(legacyRef)
    if (!snap.exists) return
    const existing = (snap.data() as any)?.mobileMoneyDetails?.phoneNumberFingerprint
    if (existing) return
    tx.set(
      target,
      {
        mobileMoneyDetails: {
          phoneNumberFingerprint: fingerprint,
          phoneNumberFingerprintSetAt: new Date().toISOString(),
          phoneNumberFingerprintSource: 'legacy_last4_step_up',
        },
      },
      { merge: true }
    )
  })
}

/** A destination added outside payout settings waits this long before it can be paid. */
export const NEW_PAYOUT_DESTINATION_HOLD_MS = PAYOUT_DETAILS_CHANGE_HOLD_MS

function holderNameTokens(raw: unknown): string[] {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * Same account holder? Case, accents, punctuation and word order are ignored,
 * and a middle name present on only one side is tolerated (every word of the
 * shorter name, at least two words, appears in the longer one). An empty side
 * never matches.
 */
export function sameAccountHolderName(a: unknown, b: unknown): boolean {
  const ta = holderNameTokens(a)
  const tb = holderNameTokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (shorter.join(' ') === longer.join(' ')) return true
  if ([...shorter].sort().join(' ') === [...longer].sort().join(' ')) return true
  if (shorter.length < 2) return false
  const pool = [...longer]
  for (const word of shorter) {
    const i = pool.indexOf(word)
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

export type PayeeDestinationReview = 'match' | 'mismatch' | 'unverified' | 'not_applicable'

/**
 * For the admin queue: is a MonCash withdrawal row's number the payee's CURRENT
 * saved destination? Organizers: the haiti payout profile (else legacy
 * payoutConfig/main). Promoters: promoter_wallets/{uid}.moncash_phone_fingerprint.
 * 'unverified' = the payee has no full-number fingerprint on file yet.
 */
export async function reviewWithdrawalDestination(row: Record<string, any>): Promise<PayeeDestinationReview> {
  if (String(row?.method || '') !== 'moncash') return 'not_applicable'
  const rowFingerprint = mobileMoneyFingerprint(row?.moncashNumber)
  if (!rowFingerprint) return 'mismatch'
  try {
    let stored: string | null = null
    if (row?.payee_type === 'promoter') {
      const uid = String(row?.promoter_uid || row?.organizerId || '')
      if (!uid) return 'unverified'
      const snap = await adminDb.collection('promoter_wallets').doc(uid).get()
      stored = snap.exists ? ((snap.data() as any)?.moncash_phone_fingerprint ?? null) : null
    } else {
      const organizerId = String(row?.organizerId || '')
      if (!organizerId) return 'unverified'
      const organizerRef = adminDb.collection('organizers').doc(organizerId)
      const profileSnap = await organizerRef.collection('payoutProfiles').doc('haiti').get()
      const snap = profileSnap.exists ? profileSnap : await organizerRef.collection('payoutConfig').doc('main').get()
      stored = snap.exists ? ((snap.data() as any)?.mobileMoneyDetails?.phoneNumberFingerprint ?? null) : null
    }
    if (!stored) return 'unverified'
    return stored === rowFingerprint ? 'match' : 'mismatch'
  } catch (e: any) {
    console.error('[payout] destination review failed', { message: e?.message })
    return 'unverified'
  }
}
