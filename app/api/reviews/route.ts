import { createClient } from '@/lib/firebase-db/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId, ticketId, rating, comment, organizerRating, wouldRecommend } = await request.json()

    if (!eventId || !rating || rating < 1 || rating > 5) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Verify user attended the event
    const { data: ticket } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('attendee_id', user.id)
      .eq('event_id', eventId)
      .single()

    if (!ticket) {
      return Response.json({ error: 'You must have attended this event to leave a review' }, { status: 403 })
    }

    // The shim has no joins (`events(*)` came back undefined and every review
    // 500'd), so the event is read on its own.
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    // Check if event has ended
    if (!event || new Date(event.start_datetime) > new Date()) {
      return Response.json({ error: 'You can only review events that have already occurred' }, { status: 400 })
    }

    // Check if user already reviewed
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .single()

    if (existingReview) {
      // Update existing review
      const { data, error } = await supabase
        .from('reviews')
        .update({
          rating,
          comment: comment || null,
          organizer_rating: organizerRating || null,
          would_recommend: wouldRecommend || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingReview.id)
        .select()
        .single()

      if (error) {
        return Response.json({ error: error.message }, { status: 500 })
      }

      return Response.json({ success: true, review: data })
    }

    // Create new review
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        event_id: eventId,
        user_id: user.id,
        ticket_id: ticketId,
        rating,
        comment: comment || null,
        organizer_rating: organizerRating || null,
        would_recommend: wouldRecommend || null,
        // Verified = the ticket was scanned at the door ('used' is not a status).
        is_verified: ticket.checked_in === true || !!ticket.checked_in_at,
        is_approved: true // Auto-approve for now, can add moderation later
      })
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, review: data }, { status: 201 })
  } catch (error) {
    console.error('Review creation error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Get reviews for an event
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')

    if (!eventId) {
      return Response.json({ error: 'Event ID required' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select(`
        *,
        users:user_id (
          full_name,
          email
        )
      `)
      .eq('event_id', eventId)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    // Calculate statistics
    const totalReviews = reviews?.length || 0
    const avgRating = totalReviews > 0
      ? (reviews!.reduce((sum: any, r: any) => sum + r.rating, 0) / totalReviews).toFixed(1)
      : '0'
    
    const ratingDistribution = reviews?.reduce((acc: any, r: any) => {
      acc[r.rating] = (acc[r.rating] || 0) + 1
      return acc
    }, {})

    const recommendCount = reviews?.filter((r: any) => r.would_recommend).length || 0
    const recommendationRate = totalReviews > 0
      ? ((recommendCount / totalReviews) * 100).toFixed(0)
      : '0'

    return Response.json({
      reviews: reviews || [],
      stats: {
        totalReviews,
        avgRating,
        ratingDistribution,
        recommendationRate
      }
    })
  } catch (error) {
    console.error('Reviews fetch error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
