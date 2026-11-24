/**
 * The person view (lib/profile/public-details.ts buildPersonView): an
 * organization's owner, seen in attendee contexts, shows their PERSONAL name
 * and photo, never the brand, plus "Also runs {org}".
 */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/firestore/connections', () => ({ getFriendshipState: async () => 'none' }))

import { buildPersonView } from '@/lib/profile/public-details'

const ownerUser = {
  role: 'organizer',
  full_name: 'Marie Joseph',
  photo_url: 'https://firebasestorage.googleapis.com/v0/b/b/o/me.jpg',
  organization_name: 'Kompa Nights',
  bio: 'Dancer',
  privacy: { profile_visibility: 'public' },
}
const ownerPublic = {
  full_name: 'Marie Joseph',
  photo_url: 'https://firebasestorage.googleapis.com/v0/b/b/o/me.jpg',
  organization_name: 'Kompa Nights',
  organization_logo: 'https://firebasestorage.googleapis.com/v0/b/b/o/logo.png',
  is_verified: true,
  created_at: '2026-03-01T00:00:00.000Z',
}

describe('buildPersonView', () => {
  it('an org owner: personal name and photo, and the org they run', () => {
    const d = buildPersonView({ userDoc: ownerUser, orgDoc: { organization_description: 'Konpa' }, publicDoc: ownerPublic, hasPublishedEvents: true, friendship: 'none' })
    expect(d.kind).toBe('person')
    expect(d.view).toBe('person')
    expect(d.identity).toEqual({
      full_name: 'Marie Joseph',
      photo_url: ownerPublic.photo_url,
      is_verified: true,
      joined_at: '2026-03-01T00:00:00.000Z',
    })
    expect(d.also_runs).toEqual({ name: 'Kompa Nights', logo: ownerPublic.organization_logo })
    // The org's own description never appears on the personal page.
    expect(d.org).toBeUndefined()
    expect(d.person?.bio).toBe('Dancer')
  })

  it('a private person: name and photo, but no bio for a stranger', () => {
    const d = buildPersonView({
      userDoc: { ...ownerUser, privacy: { profile_visibility: 'friends' } },
      orgDoc: null,
      publicDoc: ownerPublic,
      hasPublishedEvents: false,
      friendship: 'none',
    })
    expect(d.identity?.full_name).toBe('Marie Joseph')
    expect(d.person).toBeNull()
    const friend = buildPersonView({
      userDoc: { ...ownerUser, privacy: { profile_visibility: 'friends' } },
      orgDoc: null,
      publicDoc: ownerPublic,
      hasPublishedEvents: false,
      friendship: 'friends',
    })
    expect(friend.person?.bio).toBe('Dancer')
  })

  it('someone who runs nothing has no also_runs; an unsafe photo is dropped', () => {
    const d = buildPersonView({
      userDoc: { full_name: 'Jean', photo_url: 'javascript:alert(1)' },
      orgDoc: null,
      publicDoc: { full_name: 'Jean', photo_url: 'http://insecure.example/p.jpg' },
      hasPublishedEvents: false,
      friendship: 'none',
    })
    expect(d.also_runs).toBeNull()
    expect(d.identity?.photo_url).toBe('')
  })
})
