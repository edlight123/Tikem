/**
 * Pure helpers behind the 2026-10 payout hardening: exact KYC name matching,
 * the SMS-verified MonCash check, the real "why can't I withdraw" reason, the
 * instant-rail policy, the ban freeze, and organizer debt netting per currency.
 */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { exactNameMatch, holderMatchesKyc, kycNamesFromRequest, moncashOtpVerifiedFrom } from '@/lib/payouts/payee-identity'
import { payoutProfileInactiveReason } from '@/lib/payouts/profile-readiness'
import { capsFromConfig, dailyCapAllows, decideInstantMoncash } from '@/lib/payouts/instant-moncash-policy'
import { payoutFreezeFromDocs } from '@/lib/moderation/ban'
import { netDebtAgainstWithdrawal, outstandingDebtByCurrency, outstandingDebtMinor } from '@/lib/payouts/organizer-debt'

describe('exact KYC name matching', () => {
  it('ignores case, accents, punctuation and word order — nothing else', () => {
    expect(exactNameMatch('Jean-Baptiste Pierre', 'pierre jean baptiste')).toBe(true)
    expect(exactNameMatch('Érica  Désir', 'erica desir')).toBe(true)
    expect(exactNameMatch("O'Neil Joseph", 'ONeil Joseph')).toBe(true)
  })
  it('refuses substrings, missing or extra words, and empty sides', () => {
    expect(exactNameMatch('Jean', 'Jean Pierre')).toBe(false)
    expect(exactNameMatch('Jean Pierre Enterprises', 'Jean Pierre')).toBe(false)
    expect(exactNameMatch('Jean Michel Pierre', 'Jean Pierre')).toBe(false)
    expect(exactNameMatch('', '')).toBe(false)
  })
  it('KYC names come only from an APPROVED request', () => {
    const fields = { full_name: 'Marie Joseph', organization_name: 'Konpa Events SA' }
    expect(kycNamesFromRequest({ status: 'pending', steps: { organizerInfo: { fields } } }).verified).toBe(false)
    const kyc = kycNamesFromRequest({ status: 'approved', steps: { organizerInfo: { fields } } })
    expect(kyc).toEqual({ verified: true, legalName: 'Marie Joseph', organizationName: 'Konpa Events SA' })
    expect(holderMatchesKyc('Joseph Marie', kyc)).toBe(true)
    expect(holderMatchesKyc('KONPA EVENTS S.A.', kyc)).toBe(false) // "S.A." → "s a", not "sa"
    expect(holderMatchesKyc('Konpa Events SA', kyc)).toBe(true)
    expect(holderMatchesKyc('Marie', kyc)).toBe(false)
  })
})

describe('MonCash number confirmed by SMS code', () => {
  const profile = (setAt?: string) => ({ mobileMoneyDetails: { phoneNumber: '****7294', phoneNumberFingerprintSetAt: setAt } })
  it('needs a verified phone doc for the same number, not older than the number', () => {
    const doc = { status: 'verified', phoneNumber: '****7294', verifiedAt: '2026-10-02T00:00:00Z' }
    expect(moncashOtpVerifiedFrom(profile('2026-10-01T00:00:00Z'), doc)).toBe(true)
    expect(moncashOtpVerifiedFrom(profile('2026-10-03T00:00:00Z'), doc)).toBe(false) // number changed after the code
    expect(moncashOtpVerifiedFrom(profile(), { ...doc, phoneNumber: '****1111' })).toBe(false)
    expect(moncashOtpVerifiedFrom(profile(), { ...doc, status: 'pending' })).toBe(false)
    expect(moncashOtpVerifiedFrom(profile(), null)).toBe(false)
  })
})

describe('the real reason a profile cannot withdraw (L4)', () => {
  it('distinguishes not set up, identity pending/rejected, on hold until <time>', () => {
    expect(payoutProfileInactiveReason(null)?.code).toBe('payout_not_set_up')
    expect(payoutProfileInactiveReason({ status: 'not_setup' } as any)?.code).toBe('payout_not_set_up')
    expect(
      payoutProfileInactiveReason({ status: 'pending_verification', verificationStatus: { identity: 'pending' } } as any)?.code
    ).toBe('identity_pending')
    expect(
      payoutProfileInactiveReason({ status: 'pending_verification', verificationStatus: { identity: 'failed' } } as any)?.code
    ).toBe('identity_rejected')
    const held = payoutProfileInactiveReason({ status: 'on_hold', payoutHoldUntil: '2026-10-11T12:00:00.000Z' } as any)
    expect(held).toMatchObject({ code: 'payout_on_hold', availableAt: '2026-10-11T12:00:00.000Z' })
    expect(held?.message).toContain('2026-10-11T12:00:00.000Z')
    expect(payoutProfileInactiveReason({ status: 'active' } as any)).toBeNull()
  })
})

describe('instant MonCash policy (M4)', () => {
  const caps = capsFromConfig(null)
  const noKyc = { verified: false, legalName: null, organizationName: null }
  it('defaults to the admin transfer caps and reads overrides', () => {
    expect(caps).toEqual({ perCall: 25_000_000, daily: 100_000_000 })
    expect(capsFromConfig({ adminTransferCaps: { perCallHtgCents: 5, dailyHtgCents: 10 } })).toEqual({ perCall: 5, daily: 10 })
  })
  it('falls back to manual without an SMS-verified number, on a KYC name mismatch, or above the cap', () => {
    const base = { otpVerified: true, kyc: noKyc, walletHolderName: 'X', poolDebitHtgCents: 1_000, caps }
    expect(decideInstantMoncash(base)).toEqual({ instant: true })
    expect(decideInstantMoncash({ ...base, otpVerified: false })).toEqual({ instant: false, reason: 'moncash_number_not_otp_verified' })
    const kyc = { verified: true, legalName: 'Marie Joseph', organizationName: null }
    expect(decideInstantMoncash({ ...base, kyc, walletHolderName: 'Marie Josephine' })).toEqual({
      instant: false,
      reason: 'wallet_name_mismatch',
    })
    expect(decideInstantMoncash({ ...base, kyc, walletHolderName: 'joseph marie' })).toEqual({ instant: true })
    expect(decideInstantMoncash({ ...base, poolDebitHtgCents: caps.perCall + 1 })).toEqual({
      instant: false,
      reason: 'above_per_transfer_cap',
    })
  })
  it('daily cap', () => {
    expect(dailyCapAllows(90, 10, { perCall: 100, daily: 100 })).toBe(true)
    expect(dailyCapAllows(91, 10, { perCall: 100, daily: 100 })).toBe(false)
  })
})

describe('ban freeze (M3)', () => {
  it('banned users and the explicit organizers flag both freeze', () => {
    expect(payoutFreezeFromDocs({ status: 'banned' }, null)).toMatchObject({ frozen: true, cause: 'banned' })
    expect(payoutFreezeFromDocs({ status: 'active' }, { payoutsFrozen: true })).toMatchObject({ frozen: true, cause: 'payouts_frozen' })
    expect(payoutFreezeFromDocs({ status: 'active' }, { payoutsFrozen: false })).toEqual({ frozen: false })
    expect(payoutFreezeFromDocs(null, null)).toEqual({ frozen: false })
  })
})

describe('organizer debt netting (M9)', () => {
  const debt = {
    byCurrency: {
      HTG: { eventDeficits: { a: 30_000, b: 5_000 }, entries: { cb1: 1_000 }, repaidMinor: 6_000 },
      USD: { eventDeficits: { c: 2_000 } },
    },
  }
  it('is per currency: deficits + entries − repaid, floored at 0', () => {
    expect(outstandingDebtMinor(debt, 'HTG')).toBe(30_000)
    expect(outstandingDebtMinor(debt, 'usd')).toBe(2_000)
    expect(outstandingDebtMinor(debt, 'CAD')).toBe(0)
    expect(outstandingDebtMinor({ byCurrency: { HTG: { eventDeficits: { a: 1 }, repaidMinor: 5 } } }, 'HTG')).toBe(0)
    expect(outstandingDebtByCurrency(debt)).toEqual({ HTG: 30_000, USD: 2_000 })
  })
  it('repays the debt first, then allows what is left', () => {
    expect(netDebtAgainstWithdrawal({ debt, currency: 'HTG', availableMinor: 100_000, amountMinor: 70_000 })).toEqual({
      ok: true,
      appliedMinor: 30_000,
      outstandingMinor: 30_000,
    })
    const refused = netDebtAgainstWithdrawal({ debt, currency: 'HTG', availableMinor: 100_000, amountMinor: 70_001 })
    expect(refused).toMatchObject({ ok: false, code: 'organizer_debt_outstanding', withdrawableMinor: 70_000 })
    // A balance smaller than the debt: all of it repays, nothing withdrawable.
    expect(netDebtAgainstWithdrawal({ debt, currency: 'HTG', availableMinor: 20_000, amountMinor: 1 })).toMatchObject({
      ok: false,
      withdrawableMinor: 0,
    })
  })
  it('never mixes HTG and USD', () => {
    expect(netDebtAgainstWithdrawal({ debt: { byCurrency: { USD: { eventDeficits: { c: 9_999 } } } }, currency: 'HTG', availableMinor: 10, amountMinor: 10 })).toEqual({
      ok: true,
      appliedMinor: 0,
      outstandingMinor: 0,
    })
  })
})
