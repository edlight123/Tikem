jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { buildOrgCard, buildPublicProfileDetails } from '@/lib/profile/public-details'

describe('org card for guests (public-details)', () => {
  it('carries the safe display fields from public_profiles', () => {
    const card = buildOrgCard(
      {
        organization_name: 'Kompa Nights',
        organization_logo: 'https://firebasestorage.googleapis.com/v0/b/x/o/logo.png?alt=media',
        is_verified: true,
        coverTemplate: 'konpa',
        gallery: Array.from({ length: 20 }, (_, i) => ({ url: `u${i}` })),
        city: 'Pétion-Ville',
        country: 'HT',
        email: 'private@example.com',
        phone: '+509',
      },
      null
    )
    expect(card.organization_name).toBe('Kompa Nights')
    expect(card.organization_logo).toMatch(/^https:/)
    expect(card.is_verified).toBe(true)
    expect(card.coverTemplate).toBe('konpa')
    expect(card.gallery).toHaveLength(12)
    expect(JSON.stringify(card)).not.toMatch(/private@example|\+509/)
  })

  it('drops unsafe logo links and falls back to the organizers doc name', () => {
    const card = buildOrgCard({ organization_logo: 'javascript:alert(1)' }, { organization_name: 'Org' })
    expect(card.organization_logo).toBe('')
    expect(card.organization_name).toBe('Org')
    expect(card.is_verified).toBe(false)
  })

  it('is attached to org details only', () => {
    const org = buildPublicProfileDetails({
      userDoc: { is_organizer: true, organization_name: 'Org' },
      orgDoc: { organization_name: 'Org' },
      publicDoc: { organization_name: 'Org' },
      hasPublishedEvents: true,
      friendship: 'none',
    })
    if (org.kind === 'org') expect(org.card?.organization_name).toBe('Org')
    const person = buildPublicProfileDetails({
      userDoc: { full_name: 'Ana' },
      orgDoc: null,
      publicDoc: { full_name: 'Ana' },
      hasPublishedEvents: false,
      friendship: 'none',
    })
    expect(person.card).toBeUndefined()
  })
})
