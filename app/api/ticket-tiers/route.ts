import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/firebase-db/server'
import { adminDb } from '@/lib/firebase/admin'
import { isBelowMinPaidPrice, MIN_PAID_PRICE_ERROR_CODE, minPaidPriceFor } from '@/lib/min-paid-price'
import { canOnEvent } from '@/lib/organizer/context'

/**
 * Create ticket tier for an event
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId, name, description, price, quantity, salesStart, salesEnd, sortOrder } = await req.json()

    if (!eventId || !name || price === undefined || quantity === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify the caller may run this event (its org team) using direct Firestore
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    
    if (!eventDoc.exists || !(await canOnEvent(user, eventDoc.data(), 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Event not found or unauthorized' },
        { status: 404 }
      )
    }

    // Create ticket tier
    const tierId = `tier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Convert price from cents to dollars for DECIMAL storage
    const priceInDollars = price / 100

    // Minimum paid price (US/CA 2.00, FR 1.00 EUR); free and Haiti pass.
    const eventCountry = eventDoc.data()?.country
    if (isBelowMinPaidPrice(priceInDollars, eventCountry)) {
      const minimum = minPaidPriceFor(eventCountry) as number
      return NextResponse.json(
        {
          error: `A paid ticket must cost at least ${minimum.toFixed(2)}. Raise the price or make the ticket free.`,
          code: MIN_PAID_PRICE_ERROR_CODE,
          minimum,
        },
        { status: 400 }
      )
    }

    const tierData = {
      id: tierId,
      event_id: eventId,
      name,
      description,
      price: priceInDollars,
      total_quantity: quantity,
      sold_quantity: 0,
      sales_start: salesStart || null,
      sales_end: salesEnd || null,
      sort_order: sortOrder || 0,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    console.log('Creating ticket tier:', tierData)

    await adminDb.collection('ticket_tiers').doc(tierId).set(tierData)

    console.log('Ticket tier created successfully:', tierId)
    return NextResponse.json({ success: true, tierId })
  } catch (error) {
    console.error('Error in POST /api/ticket-tiers:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Get ticket tiers for an event
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')

    console.log('=== GET /api/ticket-tiers called ===')
    console.log('eventId:', eventId)

    if (!eventId) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      )
    }

    console.log('Fetching ticket tiers for eventId:', eventId)

    // Prefer Supabase as the source of truth (purchase flows read tiers from Supabase).
    try {
      const supabase = await createClient()
      const { data: tiers, error } = await supabase
        .from('ticket_tiers')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true })

      if (!error && Array.isArray(tiers) && tiers.length > 0) {
        return NextResponse.json({ tiers })
      }
    } catch (e: any) {
      console.warn('Supabase ticket_tiers fetch failed; falling back to Firestore', { message: e?.message })
    }

    // Use direct Firestore access instead of wrapper to avoid query issues
    let snapshot
    try {
      snapshot = await adminDb
        .collection('ticket_tiers')
        .where('event_id', '==', eventId)
        .orderBy('sort_order', 'asc')
        .get()
    } catch (orderError: any) {
      // If orderBy fails (index not created), try without ordering
      console.warn('OrderBy failed, trying without ordering:', orderError.message)
      snapshot = await adminDb
        .collection('ticket_tiers')
        .where('event_id', '==', eventId)
        .get()
    }

    console.log('Query completed, found:', snapshot.docs.length, 'tiers')

    const tiers = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }))

    // Sort in memory if we couldn't order in query
    tiers.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))

    console.log('Returning tiers:', tiers)
    return NextResponse.json({ tiers })
  } catch (error: any) {
    console.error('Error in GET /api/ticket-tiers:', error)
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

/**
 * Update or delete ticket tier
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { tierId, name, description, price, quantity, salesStart, salesEnd, sortOrder } = await req.json()

    if (!tierId) {
      return NextResponse.json(
        { error: 'Tier ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify tier belongs to user's event
    const { data: tier } = await supabase
      .from('ticket_tiers')
      .select('*, events(organizer_id)')
      .eq('id', tierId)
      .single()

    if (!tier || !(await canOnEvent(user, tier.events, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Ticket tier not found or unauthorized' },
        { status: 404 }
      )
    }

    // Update tier
    const priceInDollars = price !== undefined ? price / 100 : tier.price

    // Minimum paid price (US/CA 2.00, FR 1.00 EUR); free and Haiti pass.
    if (price !== undefined && tier.event_id) {
      const eventSnap = await adminDb.collection('events').doc(String(tier.event_id)).get()
      const eventCountry = eventSnap.exists ? eventSnap.data()?.country : null
      if (isBelowMinPaidPrice(priceInDollars, eventCountry)) {
        const minimum = minPaidPriceFor(eventCountry) as number
        return NextResponse.json(
          {
            error: `A paid ticket must cost at least ${minimum.toFixed(2)}. Raise the price or make the ticket free.`,
            code: MIN_PAID_PRICE_ERROR_CODE,
            minimum,
          },
          { status: 400 }
        )
      }
    }
    
    const { error: updateError } = await supabase
      .from('ticket_tiers')
      .update({
        name: name !== undefined ? name : tier.name,
        description: description !== undefined ? description : tier.description,
        price: priceInDollars,
        total_quantity: quantity !== undefined ? quantity : tier.total_quantity,
        sales_start: salesStart !== undefined ? salesStart : tier.sales_start,
        sales_end: salesEnd !== undefined ? salesEnd : tier.sales_end,
        sort_order: sortOrder !== undefined ? sortOrder : tier.sort_order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tierId)

    if (updateError) {
      console.error('Error updating ticket tier:', updateError)
      return NextResponse.json(
        { error: 'Failed to update ticket tier' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/ticket-tiers:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Delete ticket tier
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const tierId = searchParams.get('tierId')

    if (!tierId) {
      return NextResponse.json(
        { error: 'Tier ID is required' },
        { status: 400 }
      )
    }

    // Get tier and verify ownership
    const tierDoc = await adminDb.collection('ticket_tiers').doc(tierId).get()
    
    if (!tierDoc.exists) {
      return NextResponse.json(
        { error: 'Ticket tier not found' },
        { status: 404 }
      )
    }

    const tierData = tierDoc.data()
    const eventDoc = await adminDb.collection('events').doc(tierData?.event_id).get()
    
    if (!eventDoc.exists || !(await canOnEvent(user, eventDoc.data(), 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Delete tier
    await adminDb.collection('ticket_tiers').doc(tierId).delete()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/ticket-tiers:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
