import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getEventSocialAttendance } from '@/lib/firestore/social'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Event id is required' }, { status: 400 })
    }

    // Viewer is optional — anonymous users still see public attendees + count.
    const user = await getCurrentUser().catch(() => null)

    // ?full=1 is the guest list behind "View". It is for signed-in guests who
    // show their own face (the Posh rule: see theirs by showing yours); anyone
    // else gets the ordinary pile plus `needsPhoto`, which opens the
    // add-a-photo step instead of the list.
    const wantsFull = new URL(request.url).searchParams.get('full') === '1'
    const hasPhoto = Boolean((user as any)?.photo_url || (user as any)?.photoURL)
    const full = wantsFull && !!user && hasPhoto

    const social = await getEventSocialAttendance(id, user?.id || null, { full })
    return NextResponse.json(wantsFull && !full ? { ...social, needsPhoto: true } : social)
  } catch (error: any) {
    console.error('Error fetching event social attendance:', error)
    return NextResponse.json(
      { totalGoing: 0, viewerIsGoing: false, friendsGoing: [], publicGoing: [] },
      { status: 200 }
    )
  }
}
