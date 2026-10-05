import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { createMonCashPayment } from '@/lib/moncash'
import { checkEventPurchasable, invalidQuantityRefusal, parseTicketQuantity } from '@/lib/tickets/purchasable'

export async function POST(request: Request) {
  try {
    // Legacy MerchantApi flow is deprecated in favor of MonCash Button (middleware/hosted checkout).
    // Keep it behind an explicit flag to avoid accidental production use.
    if ((process.env.MONCASH_MERCHANT_API_ENABLED || '').toLowerCase() !== 'true') {
      return NextResponse.json(
        {
          error:
            'MonCash MerchantApi is disabled. Please refresh/update the app and use MonCash Button checkout instead.',
          recommendedEndpoint: '/api/moncash-button/initiate',
        },
        { status: 410 }
      )
    }

    const user = await getCurrentUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId, quantity: rawQuantity = 1, phoneNumber } = await request.json()

    const quantity = parseTicketQuantity(rawQuantity)
    if (quantity === null) {
      const refusal = invalidQuantityRefusal()
      return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status })
    }

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    if (!phoneNumber) {
      return NextResponse.json({ error: 'MonCash phone number is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Fetch event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const purchasable = checkEventPurchasable(event)
    if (!purchasable.ok) {
      return NextResponse.json({ error: purchasable.error, code: purchasable.code }, { status: purchasable.status })
    }

    // Calculate total amount
    const totalAmount = event.ticket_price * quantity

    // Create reference ID (order ID)
    const reference = `${eventId}-${user.id}-${Date.now()}`

    console.log('[API] Creating MonCash payment:', { eventId, quantity, totalAmount, phoneNumber: phoneNumber.substring(0, 5) + '...' })

    // Create MonCash payment using MerchantApi
    // This will send a payment request to the customer's MonCash app
    const { transactionId, status } = await createMonCashPayment({
      amount: totalAmount,
      reference,
      account: phoneNumber, // Customer's MonCash phone number
    })

    console.log('[API] MonCash payment response:', { transactionId, status })

    // Store pending transaction
    await supabase.from('pending_transactions').insert({
      transaction_id: transactionId,
      order_id: reference,
      user_id: user.id,
      event_id: eventId,
      quantity,
      amount: totalAmount,
      payment_method: 'moncash',
      // Always pending: tickets are issued only by the verified callback through the
      // shared fulfillment pipeline. A row born 'completed' had no tickets at all.
      status: 'pending',
    })

    return NextResponse.json({ 
      transactionId,
      reference,
      status,
      message: status === 'successful' 
        ? 'Payment completed successfully' 
        : 'Payment request sent to your MonCash app. Please approve to complete.',
    })
  } catch (error: any) {
    console.error('MonCash initiate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to initiate MonCash payment' },
      { status: 500 }
    )
  }
}
