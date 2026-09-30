/**
 * Event Earnings & Payout Types
 * 
 * Tracks organizer revenue, fees, and withdrawal status per event
 */

export type SettlementStatus = 'pending' | 'ready' | 'locked'

export interface EventEarnings {
  id: string
  eventId: string
  organizerId: string

  // Metadata
  // Indicates where the earnings values were sourced from (stored record vs derived from tickets).
  dataSource?: 'event_earnings' | 'tickets_derived' | 'unknown'
  
  // Revenue tracking (all in cents)
  grossSales: number             // Total ticket revenue
  ticketsSold: number            // Number of tickets sold
  
  // Fee breakdown (all in cents)
  platformFee: number            // Tikèm's commission (typically 10%)
  processingFees: number         // Stripe/payment processor fees
  /**
   * Promoter commission WITHHELD from this organizer's earnings (funded
   * promoter_sales only — the pre-wallet informational tallies never touched
   * the organizer's balance and are settled directly).
   */
  promoterCommission?: number
  /**
   * Rail fees Tikèm pays OUT OF its platformFee (MonCash's 2% on collections).
   * The platform fee is all-in for the organizer, so this never touches
   * netAmount — it exists so platform margin = platformFee - absorbedProcessingFees.
   */
  absorbedProcessingFees?: number
  netAmount: number              // grossSales - platformFee - processingFees - promoterCommission
  
  // Withdrawal tracking (all in cents)
  availableToWithdraw: number    // Funds not yet withdrawn
  withdrawnAmount: number        // Total already paid out
  
  // Settlement logic
  settlementStatus: SettlementStatus
  settlementReadyDate?: string | null  // When funds become available
  
  // Currency
  currency: 'HTG' | 'USD' | 'CAD' | 'EUR'
  
  // Timestamps
  lastCalculatedAt: string       // Last time earnings were recalculated
  createdAt: string
  updatedAt: string
}

/**
 * Firestore collection structure:
 * /event_earnings/{earningsId}
 * 
 * Indexes needed:
 * - organizerId + settlementStatus + createdAt (desc)
 * - eventId (asc) - should be unique per event
 * - organizerId + availableToWithdraw (desc) - for finding withdrawable events
 */

/**
 * Links a payout to specific events and amounts
 * Stored as subcollection under payouts
 */
export interface PayoutEventLink {
  id: string
  payoutId: string
  eventId: string
  eventTitle: string
  amount: number                 // Amount withdrawn from this event (cents)
  currency: string
  ticketIds: string[]            // Specific tickets included
  createdAt: string
}

/**
 * Firestore collection structure:
 * /organizers/{organizerId}/payouts/{payoutId}/event_links/{linkId}
 */

/**
 * Extended payout type with event breakdown
 * Combines data from payout.ts with event links
 */
export interface PayoutWithEvents {
  id: string
  organizerId: string
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  method: 'bank_transfer' | 'mobile_money'
  currency: string
  
  // Event breakdown
  events: {
    eventId: string
    eventTitle: string
    amount: number
    ticketCount: number
  }[]
  
  // Dates
  requestedAt: string
  scheduledDate: string
  completedAt?: string | null
  
  // Approval workflow
  approvedBy?: string | null
  approvedAt?: string | null
  declinedBy?: string | null
  declinedAt?: string | null
  declineReason?: string | null
}

/**
 * Earnings summary for organizer dashboard
 */
export interface EarningsSummary {
  totalGrossSales: number
  totalNetAmount: number
  totalAvailableToWithdraw: number
  totalWithdrawn: number
  totalPlatformFees: number
  totalProcessingFees: number
  // When an organizer has earnings in more than one currency, this is set to 'mixed'.
  currency: 'HTG' | 'USD' | 'mixed' | string

  // Optional: totals split by currency for mixed-currency organizers.
  totalsByCurrency?: Partial<Record<'HTG' | 'USD' | 'CAD' | 'EUR', {
    totalGrossSales: number
    totalNetAmount: number
    totalAvailableToWithdraw: number
    totalWithdrawn: number
    totalPlatformFees: number
    totalProcessingFees: number
  }>>
  
  // Breakdown by event
  events: Array<{
    eventId: string
    eventTitle: string
    eventDate: string
    grossSales: number
    netAmount: number
    availableToWithdraw: number
    settlementStatus: SettlementStatus
    currency?: 'HTG' | 'USD' | 'CAD' | 'EUR'
  }>
}

/**
 * Fee calculation utilities
 */
export interface FeeCalculation {
  grossAmount: number
  platformFee: number
  processingFee: number
  netAmount: number
}

/**
 * Configuration for fee calculations
 */
export const FEE_CONFIG = {
  // Platform commission
  PLATFORM_FEE_PERCENTAGE: 0.10,      // 10%
  PLATFORM_FEE_MIN: 50,                // 50 cents minimum
  
  // Stripe fees (standard US rates)
  STRIPE_FEE_PERCENTAGE: 0.029,        // 2.9%
  STRIPE_FEE_FIXED: 30,                // 30 cents per transaction
  
  // Payout minimums
  MINIMUM_PAYOUT_AMOUNT: 5000,         // $50.00 in cents
  
  // Settlement timing
  SETTLEMENT_HOLD_DAYS: 0,             // Days after event before funds are available
} as const

/**
 * Withdrawal request for manual processing (Haiti - MonCash/Bank)
 */
export interface WithdrawalRequest {
  id?: string
  organizerId: string
  eventId: string
  amount: number                       // Amount in cents (deducted from event earnings)
  currency?: 'HTG' | 'USD' | 'CAD' | 'EUR'
  method: 'moncash' | 'bank'
  status: 'pending' | 'processing' | 'completed' | 'failed'

  // Fees (all in cents)
  feeCents?: number
  payoutAmountCents?: number
  // MonCash payouts are executed in HTG (even if event earnings are USD).
  payoutCurrency?: 'HTG'
  payoutAmountHtgCents?: number
  usdToHtgRateUsed?: number
  prefundingUsed?: boolean
  prefundingFeePercent?: number
  prefundingTransferRaw?: any
  // Digicel's own fee on the transfer (3% of the amount SENT, taken from the
  // prefunded pool). A cost to Tikèm — kept apart from feeCents, which is what
  // the payee paid Tikèm.
  prefundingProviderFeeHtgCents?: number
  // Pool debit for this transfer: payoutAmountHtgCents + provider fee.
  prefundingPoolDebitHtgCents?: number
  // Tikèm's fee in HTG minus Digicel's fee: the instant rail's actual margin.
  prefundingPlatformNetHtgCents?: number
  // Ambiguous transfer outcome (timeout / 5xx / unparseable): the reservation
  // is KEPT and an admin must confirm in MonCash before completing or failing.
  needsReconciliation?: boolean
  reconciliationReason?: string
  reconciliationStatusCheck?: string
  confirmedVia?: 'transfer' | 'status_check'

  // Reservation metadata (used for instant prefunded payouts)
  reservedAt?: Date
  reservedCents?: number
  reservationRolledBackAt?: Date

  // Bank destination selection
  bankDestinationId?: string
  
  // Method-specific details
  moncashNumber?: string
  moncashTransactionId?: string
  bankDetails?: {
    accountNumber: string
    bankName: string
    accountHolder: string
    swiftCode?: string
    routingNumber?: string
  }
  
  // Processing
  processedBy?: string                 // Admin user ID
  processedAt?: Date
  failureReason?: string
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}

/**
 * Firestore collection structure:
 * /withdrawal_requests/{requestId}
 * 
 * Indexes needed:
 * - status + createdAt (desc) - for admin queue
 * - organizerId + status + createdAt (desc) - for organizer history
 * - eventId + createdAt (desc) - for per-event history
 */
