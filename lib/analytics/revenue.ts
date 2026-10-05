/**
 * Revenue Analytics
 * 
 * Provides detailed revenue breakdowns by payment method, currency, and time period
 */

import { adminDb } from '@/lib/firebase/admin'
import { convertCurrency } from '@/lib/currency'
import { isLiveTicketStatus, liveTicketStatusesForQuery } from '@/lib/tickets/status'

export interface PaymentMethodRevenue {
  method: string
  count: number
  revenue: number
  revenueUSD: number
  currency: string
}

export interface RevenueBreakdown {
  totalRevenue: number
  totalRevenueUSD: number
  totalTickets: number
  byPaymentMethod: {
    stripe: PaymentMethodRevenue
    moncash: PaymentMethodRevenue
    natcash?: PaymentMethodRevenue
  }
  byCurrency: {
    [currency: string]: {
      revenue: number
      count: number
      revenueUSD: number
    }
  }
}

/**
 * Get revenue breakdown for an organizer with payment method segregation
 */
export async function getOrganizerRevenueBreakdown(
  organizerId: string,
  options?: {
    eventId?: string
    startDate?: Date
    endDate?: Date
  }
): Promise<RevenueBreakdown> {
  try {
    // Get all tickets for organizer's events
    let eventsQuery = adminDb.collection('events')
      .where('organizer_id', '==', organizerId)
      .where('status', '==', 'published')
    
    const eventsSnap = await eventsQuery.get()
    const eventIds = eventsSnap.docs.map((doc: any) => doc.id)
    
    if (eventIds.length === 0) {
      return getEmptyBreakdown()
    }
    
    // Filter by specific event if provided
    const targetEventIds = options?.eventId ? [options.eventId] : eventIds
    
    // Get all live tickets for these events. Live is valid | confirmed | active
    // (lib/tickets/status.ts); filtering on 'valid' alone hid every MonCash and
    // SogePay sale. Event ids are chunked to stay inside Firestore's 30-value
    // `in` limit, and status is filtered in memory so the query keeps a single
    // disjunction.
    const ticketDocs: any[] = []
    for (let i = 0; i < targetEventIds.length; i += 30) {
      const chunk = targetEventIds.slice(i, i + 30)
      const snap = await adminDb.collection('tickets').where('event_id', 'in', chunk).get()
      for (const doc of snap.docs) {
        if (isLiveTicketStatus(doc.data()?.status)) ticketDocs.push(doc)
      }
    }
    const ticketsSnap = { docs: ticketDocs }
    
    // Initialize breakdown structure
    const breakdown: RevenueBreakdown = {
      totalRevenue: 0,
      totalRevenueUSD: 0,
      totalTickets: 0,
      byPaymentMethod: {
        stripe: { method: 'stripe', count: 0, revenue: 0, revenueUSD: 0, currency: 'USD' },
        moncash: { method: 'moncash', count: 0, revenue: 0, revenueUSD: 0, currency: 'HTG' },
      },
      byCurrency: {}
    }
    
    // Process each ticket
    ticketsSnap.docs.forEach((doc: any) => {
      const ticket = doc.data()
      
      // Apply date filters
      if (options?.startDate || options?.endDate) {
        const purchasedAt = ticket.purchased_at?.toDate?.() || new Date(ticket.purchased_at)
        if (options.startDate && purchasedAt < options.startDate) return
        if (options.endDate && purchasedAt > options.endDate) return
      }
      
      const price = ticket.price_paid || 0
      const currency = (ticket.currency || ticket.original_currency || 'USD').toUpperCase()
      const paymentMethod = ticket.payment_method || 'stripe'
      
      // Convert to USD for unified reporting
      let priceUSD = price
      if (currency === 'HTG') {
        try {
          priceUSD = convertCurrency(price, 'HTG', 'USD')
        } catch (error) {
          // Use stored exchange rate if available
          if (ticket.exchange_rate_used) {
            priceUSD = price * ticket.exchange_rate_used
          } else {
            priceUSD = price * 0.0076 // fallback rate
          }
        }
      }
      
      breakdown.totalTickets++
      breakdown.totalRevenue += price
      breakdown.totalRevenueUSD += priceUSD
      
      // By payment method
      if (paymentMethod === 'stripe') {
        breakdown.byPaymentMethod.stripe.count++
        breakdown.byPaymentMethod.stripe.revenue += price
        breakdown.byPaymentMethod.stripe.revenueUSD += priceUSD
      } else if (paymentMethod === 'moncash') {
        breakdown.byPaymentMethod.moncash.count++
        breakdown.byPaymentMethod.moncash.revenue += price
        breakdown.byPaymentMethod.moncash.revenueUSD += priceUSD
      } else if (paymentMethod === 'natcash') {
        if (!breakdown.byPaymentMethod.natcash) {
          breakdown.byPaymentMethod.natcash = { 
            method: 'natcash', 
            count: 0, 
            revenue: 0, 
            revenueUSD: 0, 
            currency: 'HTG' 
          }
        }
        breakdown.byPaymentMethod.natcash.count++
        breakdown.byPaymentMethod.natcash.revenue += price
        breakdown.byPaymentMethod.natcash.revenueUSD += priceUSD
      }
      
      // By currency
      if (!breakdown.byCurrency[currency]) {
        breakdown.byCurrency[currency] = { revenue: 0, count: 0, revenueUSD: 0 }
      }
      breakdown.byCurrency[currency].revenue += price
      breakdown.byCurrency[currency].count++
      breakdown.byCurrency[currency].revenueUSD += priceUSD
    })
    
    return breakdown
  } catch (error) {
    console.error('Error getting revenue breakdown:', error)
    return getEmptyBreakdown()
  }
}

/**
 * Get revenue breakdown for a specific event
 */
export async function getEventRevenueBreakdown(
  eventId: string
): Promise<RevenueBreakdown> {
  try {
    const ticketsSnap = await adminDb.collection('tickets')
      .where('event_id', '==', eventId)
      .where('status', 'in', liveTicketStatusesForQuery())
      .get()
    
    const breakdown: RevenueBreakdown = {
      totalRevenue: 0,
      totalRevenueUSD: 0,
      totalTickets: 0,
      byPaymentMethod: {
        stripe: { method: 'stripe', count: 0, revenue: 0, revenueUSD: 0, currency: 'USD' },
        moncash: { method: 'moncash', count: 0, revenue: 0, revenueUSD: 0, currency: 'HTG' },
      },
      byCurrency: {}
    }
    
    ticketsSnap.docs.forEach((doc: any) => {
      const ticket = doc.data()
      const price = ticket.price_paid || 0
      const currency = (ticket.currency || ticket.original_currency || 'USD').toUpperCase()
      const paymentMethod = ticket.payment_method || 'stripe'
      
      let priceUSD = price
      if (currency === 'HTG') {
        try {
          priceUSD = convertCurrency(price, 'HTG', 'USD')
        } catch (error) {
          priceUSD = ticket.exchange_rate_used ? price * ticket.exchange_rate_used : price * 0.0076
        }
      }
      
      breakdown.totalTickets++
      breakdown.totalRevenue += price
      breakdown.totalRevenueUSD += priceUSD
      
      // By payment method
      if (paymentMethod === 'stripe') {
        breakdown.byPaymentMethod.stripe.count++
        breakdown.byPaymentMethod.stripe.revenue += price
        breakdown.byPaymentMethod.stripe.revenueUSD += priceUSD
      } else if (paymentMethod === 'moncash') {
        breakdown.byPaymentMethod.moncash.count++
        breakdown.byPaymentMethod.moncash.revenue += price
        breakdown.byPaymentMethod.moncash.revenueUSD += priceUSD
      } else if (paymentMethod === 'natcash') {
        if (!breakdown.byPaymentMethod.natcash) {
          breakdown.byPaymentMethod.natcash = {
            method: 'natcash',
            count: 0,
            revenue: 0,
            revenueUSD: 0,
            currency: 'HTG'
          }
        }
        breakdown.byPaymentMethod.natcash.count++
        breakdown.byPaymentMethod.natcash.revenue += price
        breakdown.byPaymentMethod.natcash.revenueUSD += priceUSD
      }
      
      // By currency
      if (!breakdown.byCurrency[currency]) {
        breakdown.byCurrency[currency] = { revenue: 0, count: 0, revenueUSD: 0 }
      }
      breakdown.byCurrency[currency].revenue += price
      breakdown.byCurrency[currency].count++
      breakdown.byCurrency[currency].revenueUSD += priceUSD
    })
    
    return breakdown
  } catch (error) {
    console.error('Error getting event revenue breakdown:', error)
    return getEmptyBreakdown()
  }
}

function getEmptyBreakdown(): RevenueBreakdown {
  return {
    totalRevenue: 0,
    totalRevenueUSD: 0,
    totalTickets: 0,
    byPaymentMethod: {
      stripe: { method: 'stripe', count: 0, revenue: 0, revenueUSD: 0, currency: 'USD' },
      moncash: { method: 'moncash', count: 0, revenue: 0, revenueUSD: 0, currency: 'HTG' },
    },
    byCurrency: {}
  }
}
