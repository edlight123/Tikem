import 'server-only'
/**
 * The "Tikèm Community" organizer account: community-shared events
 * (lib/community/submissions) belong to it until their organizer claims them.
 * It has no login (no Firebase Auth user); it only gives those events a host,
 * so they are never shown as posted by the real organizer. Created on first
 * use, with its public_profiles mirror (lib/firestore/public-profile).
 */
import { adminDb } from '@/lib/firebase/admin'
import { syncPublicProfileAdmin } from '@/lib/firestore/public-profile'
import { COMMUNITY_ORG_ID, COMMUNITY_ORG_NAME } from './submissions'

export async function ensureCommunityOrg(now: string = new Date().toISOString()): Promise<string> {
  const ref = adminDb.collection('users').doc(COMMUNITY_ORG_ID)
  const snap = await ref.get()
  if (!snap.exists) {
    const profile = {
      role: 'organizer',
      full_name: COMMUNITY_ORG_NAME,
      organization_name: COMMUNITY_ORG_NAME,
      bio: 'Events shared by the community and credited to their organizers. Organizers can claim their events.',
      is_community_account: true,
      created_at: now,
      updated_at: now,
    }
    await ref.set(profile)
    await syncPublicProfileAdmin(COMMUNITY_ORG_ID, profile)
  }
  return COMMUNITY_ORG_ID
}
