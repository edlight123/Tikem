import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  addSecondaryBankDestination,
  listBankDestinations,
  type BankDestinationDetails,
} from '@/lib/firestore/payout-destinations'
import {
  consumePayoutDetailsChangeVerification,
  NEW_PAYOUT_DESTINATION_HOLD_MS,
  requireRecentPayoutDetailsChangeVerification,
} from '@/lib/firestore/payout'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { holderMatchesKyc, loadKycLegalNames } from '@/lib/payouts/payee-identity'

export async function GET(_req: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const haitiProfile = await getPayoutProfile(user.id, 'haiti')
    if (!haitiProfile) {
      return NextResponse.json(
        {
          error: 'Haiti payout profile required',
          message: 'Bank destinations are only available for organizers with a Haiti payout profile.',
        },
        { status: 400 }
      )
    }

    const destinations = await listBankDestinations(user.id)

    // Attach per-destination verification status.
    const verificationSnap = await adminDb
      .collection('organizers')
      .doc(user.id)
      .collection('verificationDocuments')
      .where('type', '==', 'bank')
      .get()

    type BankVerificationMeta = {
      status: 'pending' | 'verified' | 'failed'
      submittedAt?: string | null
    }

    const verificationByDestinationId = new Map<string, BankVerificationMeta>()
    let legacyPrimary: BankVerificationMeta | null = null

    for (const doc of verificationSnap.docs) {
      const data = doc.data() as any
      const docId = String(doc.id || '')
      const status = (data?.status || 'pending') as 'pending' | 'verified' | 'failed'
      const submittedAt = data?.submittedAt ? String(data.submittedAt) : null

      if (docId === 'bank') {
        legacyPrimary = { status, submittedAt }
        continue
      }

      if (docId.startsWith('bank_')) {
        const destinationId = String(data?.destinationId || docId.slice('bank_'.length) || '')
        if (destinationId) verificationByDestinationId.set(destinationId, { status, submittedAt })
      }
    }

    const enriched = destinations.map((d) => {
      const meta = verificationByDestinationId.get(d.id) || (d.id === 'bank_primary' ? legacyPrimary : null)
      // IMPORTANT: Do not default to "pending" when no verification exists.
      // "pending" should mean a verification has been submitted and is awaiting review.
      const verificationStatus = meta?.status
      const verificationSubmittedAt = meta?.submittedAt || null
      return { ...d, verificationStatus, verificationSubmittedAt }
    })

    return NextResponse.json({ destinations: enriched })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to load bank destinations', message: e?.message || String(e) },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const haitiProfile = await getPayoutProfile(user.id, 'haiti')
    if (!haitiProfile) {
      return NextResponse.json(
        {
          error: 'Haiti payout profile required',
          message: 'Bank destinations are only available for organizers with a Haiti payout profile.',
        },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const bankDetails = body?.bankDetails as BankDestinationDetails | undefined

    if (!bankDetails?.accountNumber || !bankDetails?.bankName || !bankDetails?.accountHolder) {
      return NextResponse.json({ error: 'Incomplete bank details' }, { status: 400 })
    }

    // Require OTP step-up when adding a new bank destination.
    try {
      await requireRecentPayoutDetailsChangeVerification(user.id)
    } catch (e: any) {
      const message = String(e?.message || '')
      if (message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
        return NextResponse.json(
          {
            error: 'Verification required',
            code: 'PAYOUT_CHANGE_VERIFICATION_REQUIRED',
            requiresVerification: true,
            message:
              'For your security, confirm this new bank account with the code we email you before using it for withdrawals.',
          },
          { status: 403 }
        )
      }
      throw e
    }

    // The account must be in the organizer's KYC-verified legal (or
    // organization) name, read server-side from the APPROVED verification
    // request — exact token match. The old rule matched a substring of the
    // editable users.full_name, so "Jean" covered anyone's "Jean …" account.
    const kyc = await loadKycLegalNames(user.id)
    if (!kyc.verified || (!kyc.legalName && !kyc.organizationName)) {
      return NextResponse.json(
        {
          error: 'Identity verification required',
          code: 'IDENTITY_REQUIRED',
          message: 'Complete identity verification before adding a bank account for withdrawals.',
        },
        { status: 403 }
      )
    }
    if (!holderMatchesKyc(bankDetails.accountHolder, kyc)) {
      return NextResponse.json(
        {
          error: 'Bank account name mismatch',
          code: 'PAYOUT_HOLDER_NAME_MISMATCH',
          message:
            'For security, the bank account holder name must exactly match the legal name (or organization name) on your approved identity verification.',
        },
        { status: 400 }
      )
    }

    // Held: payable only after NEW_PAYOUT_DESTINATION_HOLD_MS (withdraw-bank refuses before).
    const created = await addSecondaryBankDestination({
      organizerId: user.id,
      bankDetails,
      addedVia: 'payout_destinations',
      holdMs: NEW_PAYOUT_DESTINATION_HOLD_MS,
    })
    await consumePayoutDetailsChangeVerification(user.id)

    return NextResponse.json({ success: true, destinationId: created.id, holdUntil: created.holdUntil })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to add bank destination', message: e?.message || String(e) },
      { status: 500 }
    )
  }
}
