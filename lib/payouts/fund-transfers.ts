/**
 * The fund_transfers ledger: an admin's record of money moving between
 * Tikèm's accounts, or out to a Haitian organizer by international wire.
 *
 * Append-only. Server-only (Admin SDK); firestore.rules denies clients. A
 * mistake is corrected by recording the opposite movement, never by editing,
 * so the ledger always explains the balance it produces.
 *
 * Amounts arrive in MAJOR units from the form and are stored in minor units.
 */

import { z } from 'zod'
import {
  ORGANIZER_PAYEE,
  TRANSFER_ACCOUNTS,
  TRANSFER_KINDS,
  type FundTransfer,
  type TransferAccount,
} from '@/lib/payouts/money-map'

export const FUND_TRANSFERS_COLLECTION = 'fund_transfers'

const CURRENCIES = ['HTG', 'USD', 'CAD', 'EUR'] as const

const money = z.number().finite().positive().max(1_000_000_000)

export const FundTransferInputSchema = z
  .object({
    kind: z.enum(TRANSFER_KINDS),
    fromAccount: z.enum(TRANSFER_ACCOUNTS),
    toAccount: z.union([z.enum(TRANSFER_ACCOUNTS), z.literal(ORGANIZER_PAYEE)]),
    amount: money,
    currency: z.enum(CURRENCIES),
    /** What arrived (or the organizer's HTG equivalent). Defaults to amount × fxRate, or amount. */
    toAmount: money.optional().nullable(),
    toCurrency: z.enum(CURRENCIES).optional().nullable(),
    /** toCurrency per 1 unit of currency. */
    fxRate: z.number().finite().positive().max(100_000).optional().nullable(),
    /** Wire / transfer fee the sending account paid, in `currency`. */
    fee: z.number().finite().min(0).max(1_000_000).optional().nullable(),
    reference: z.string().trim().max(120).optional().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    note: z.string().trim().max(500).optional().nullable(),
    organizerId: z.string().trim().max(128).optional().nullable(),
    withdrawalId: z.string().trim().max(128).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'organizer_payout') {
      if (v.toAccount !== ORGANIZER_PAYEE) {
        ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'An organizer payout goes to the organizer.' })
      }
      if (!v.organizerId && !v.withdrawalId) {
        ctx.addIssue({ code: 'custom', path: ['organizerId'], message: 'Name the organizer or the withdrawal it pays.' })
      }
    } else {
      if (v.toAccount === ORGANIZER_PAYEE) {
        ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'Use an organizer payout to pay an organizer.' })
      }
      if (v.toAccount === v.fromAccount && (v.toCurrency || v.currency) === v.currency) {
        ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'From and to are the same account.' })
      }
    }
    const toCurrency = v.toCurrency || v.currency
    if (toCurrency !== v.currency && !v.toAmount && !v.fxRate) {
      ctx.addIssue({ code: 'custom', path: ['fxRate'], message: 'Give the FX rate or the amount received.' })
    }
  })

export type FundTransferInput = z.infer<typeof FundTransferInputSchema>

const toMinor = (major: number) => Math.round(major * 100)

/** The stored document for a validated input (no audit fields). */
export function buildFundTransferDoc(v: FundTransferInput): Omit<
  FundTransfer,
  'id' | 'createdAt' | 'createdBy' | 'createdByEmail' | 'withdrawal'
> {
  const toCurrency = v.toCurrency || v.currency
  const same = toCurrency === v.currency
  const fxRate = same ? null : v.fxRate ?? (v.toAmount ? Math.round((v.toAmount / v.amount) * 1e6) / 1e6 : null)
  const toAmount = v.toAmount ?? (same ? v.amount : v.amount * Number(fxRate))
  return {
    kind: v.kind,
    fromAccount: v.fromAccount as TransferAccount,
    toAccount: v.toAccount,
    amountMinor: toMinor(v.amount),
    currency: v.currency,
    toAmountMinor: toMinor(toAmount),
    toCurrency,
    fxRate,
    feeMinor: toMinor(v.fee || 0),
    reference: v.reference || null,
    date: v.date,
    note: v.note || null,
    organizerId: v.organizerId || null,
    withdrawalId: v.withdrawalId || null,
  }
}

/** A stored doc → FundTransfer, tolerant of missing fields. */
export function fundTransferFromDoc(id: string, d: Record<string, any>): FundTransfer {
  const num = (x: unknown) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0)
  return {
    id,
    kind: d.kind === 'organizer_payout' ? 'organizer_payout' : 'movement',
    fromAccount: d.fromAccount,
    toAccount: d.toAccount,
    amountMinor: num(d.amountMinor),
    currency: String(d.currency || 'USD').toUpperCase(),
    toAmountMinor: num(d.toAmountMinor ?? d.amountMinor),
    toCurrency: String(d.toCurrency || d.currency || 'USD').toUpperCase(),
    fxRate: Number(d.fxRate) > 0 ? Number(d.fxRate) : null,
    feeMinor: num(d.feeMinor),
    reference: d.reference ? String(d.reference) : null,
    date: String(d.date || ''),
    note: d.note ? String(d.note) : null,
    createdAt: d.createdAt ? String(d.createdAt) : null,
    createdBy: d.createdBy ? String(d.createdBy) : null,
    createdByEmail: d.createdByEmail ? String(d.createdByEmail) : null,
    organizerId: d.organizerId ? String(d.organizerId) : null,
    withdrawalId: d.withdrawalId ? String(d.withdrawalId) : null,
    withdrawal:
      d.withdrawal && typeof d.withdrawal === 'object'
        ? {
            amountMinor: num(d.withdrawal.amountMinor),
            currency: String(d.withdrawal.currency || 'HTG').toUpperCase(),
            status: String(d.withdrawal.status || ''),
            eventId: d.withdrawal.eventId ? String(d.withdrawal.eventId) : null,
          }
        : null,
  }
}
