import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent } from '@/lib/organizer/context'

/**
 * Create group discount for an event
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId, minQuantity, discountPercentage } = await req.json()

    if (!eventId || !minQuantity || !discountPercentage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify the caller may run this event (its org team)
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    
    if (!eventDoc.exists || !(await canOnEvent(user, eventDoc.data(), 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Event not found or unauthorized' },
        { status: 404 }
      )
    }

    // Create group discount
    const discountId = `discount_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const discountData = {
      id: discountId,
      event_id: eventId,
      min_quantity: minQuantity,
      discount_percentage: discountPercentage,
      is_active: true,
      created_at: new Date().toISOString(),
    }

    console.log('Creating group discount:', discountData)

    await adminDb.collection('group_discounts').doc(discountId).set(discountData)

    console.log('Group discount created successfully:', discountId)
    return NextResponse.json({ success: true, discountId })
  } catch (error: any) {
    console.error('Error in POST /api/group-discounts:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

/**
 * Get group discounts for an event
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')

    console.log('=== GET /api/group-discounts called ===')
    console.log('eventId:', eventId)

    if (!eventId) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      )
    }

    console.log('Fetching group discounts for eventId:', eventId)

    const snapshot = await adminDb
      .collection('group_discounts')
      .where('event_id', '==', eventId)
      .where('is_active', '==', true)
      .get()

    console.log('Query completed, found:', snapshot.docs.length, 'discounts')

    const discounts = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }))

    console.log('Returning discounts:', discounts)
    return NextResponse.json({ discounts })
  } catch (error: any) {
    console.error('Error in GET /api/group-discounts:', error)
    console.error('Error stack:', error.stack)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

/**
 * Delete group discount
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const discountId = searchParams.get('discountId')

    if (!discountId) {
      return NextResponse.json(
        { error: 'Discount ID is required' },
        { status: 400 }
      )
    }

    // Get discount and verify ownership
    const discountDoc = await adminDb.collection('group_discounts').doc(discountId).get()
    
    if (!discountDoc.exists) {
      return NextResponse.json(
        { error: 'Group discount not found' },
        { status: 404 }
      )
    }

    const discountData = discountDoc.data()
    const eventDoc = await adminDb.collection('events').doc(discountData?.event_id).get()
    
    if (!eventDoc.exists || !(await canOnEvent(user, eventDoc.data(), 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Delete discount
    await adminDb.collection('group_discounts').doc(discountId).delete()

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in DELETE /api/group-discounts:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
