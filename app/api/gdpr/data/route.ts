import { handleAccountDeletionRequest } from '@/lib/account/deletion'
import { createClient } from '@/lib/firebase-db/server'

// Export user data (GDPR Article 15 - Right to access)
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Gather all user data
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    const { data: tickets } = await supabase
      .from('tickets')
      .select('*, events(title, start_datetime)')
      .eq('attendee_id', user.id)

    const { data: events } = await supabase
      .from('events')
      .select('*')
      .eq('organizer_id', user.id)

    const { data: favorites } = await supabase
      .from('favorites')
      .select('*, events(title)')
      .eq('user_id', user.id)

    const { data: reviews } = await supabase
      .from('reviews')
      .select('*, events(title)')
      .eq('user_id', user.id)

    const { data: preferences } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()

    const userData = {
      profile,
      tickets,
      events,
      favorites,
      reviews,
      preferences,
      exportDate: new Date().toISOString(),
      gdprCompliance: {
        rightToAccess: 'Article 15 GDPR',
        dataPortability: 'Article 20 GDPR'
      }
    }

    // Return as JSON download
    return new Response(JSON.stringify(userData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="tikem_data_export_${user.id}.json"`
      }
    })
  } catch (error) {
    console.error('Data export error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Delete user account and data (GDPR Article 17 - Right to erasure).
// One implementation for every entry point: see lib/account/deletion.ts. The
// old body here ran against the Supabase-style shim, never deleted the Firebase
// Auth user (the person could still sign in), and left tickets and orders
// carrying their name and email.
export async function DELETE(request: Request) {
  return handleAccountDeletionRequest(request)
}
