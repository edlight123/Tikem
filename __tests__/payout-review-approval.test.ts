/**
 * @jest-environment node
 *
 * An admin's 'released' payout review covers the amount they saw, in that
 * currency, for 14 days — nothing bigger, nothing later (payment audit, 2026-11-17).
 */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
import { PAYOUT_REVIEW_APPROVAL_TTL_MS, reviewApprovalCovers } from '@/lib/stripe-payout-releases'

const now = new Date('2026-11-17T12:00:00Z')
const approved = {
  status: 'released',
  approvedAmountMinor: 50_000,
  approvedCurrency: 'USD',
  approvedUntil: new Date(now.getTime() + 1000).toISOString(),
}

it('covers the approved amount or less, in the approved currency', () => {
  expect(reviewApprovalCovers(approved, 50_000, 'usd', now)).toBe(true)
  expect(reviewApprovalCovers(approved, 10_000, 'USD', now)).toBe(true)
  expect(reviewApprovalCovers(approved, 50_001, 'USD', now)).toBe(false)
  expect(reviewApprovalCovers(approved, 100, 'EUR', now)).toBe(false)
})

it('expires; an approval from before amounts were recorded expires TTL after it was resolved', () => {
  expect(reviewApprovalCovers(approved, 100, 'USD', new Date(now.getTime() + 2000))).toBe(false)
  const legacy = { status: 'released', amountMinor: 900, currency: 'USD', resolvedAt: now.toISOString() }
  expect(reviewApprovalCovers(legacy, 900, 'USD', now)).toBe(true)
  expect(reviewApprovalCovers(legacy, 900, 'USD', new Date(now.getTime() + PAYOUT_REVIEW_APPROVAL_TTL_MS + 1))).toBe(false)
})

it('only a released review approves anything', () => {
  expect(reviewApprovalCovers({ ...approved, status: 'pending' }, 1, 'USD', now)).toBe(false)
  expect(reviewApprovalCovers(null, 1, 'USD', now)).toBe(false)
})

it('an approval a payout already used covers nothing more', () => {
  expect(reviewApprovalCovers({ ...approved, consumedAt: now.toISOString() }, 1, 'USD', now)).toBe(false)
})
