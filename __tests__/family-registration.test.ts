import { familyMax, freeClaimCapFor, FAMILY_MAX_LIMIT } from '@/lib/events/family'
import { eventAllowedPlusOnes, parseAttendInput } from '@/lib/events/approval'

describe('family registration', () => {
  it('is off unless the organizer turns it on', () => {
    expect(familyMax({})).toBe(0)
    expect(familyMax({ family_max: 6 })).toBe(0)
    expect(freeClaimCapFor({})).toBe(2)
  })

  it('covers 2 to 8 people, 6 by default', () => {
    expect(familyMax({ family_registration: true })).toBe(6)
    expect(familyMax({ family_registration: true, family_max: 4 })).toBe(4)
    expect(familyMax({ family_registration: true, family_max: 1 })).toBe(2)
    expect(familyMax({ family_registration: true, family_max: 50 })).toBe(FAMILY_MAX_LIMIT)
    expect(freeClaimCapFor({ family_registration: true, family_max: 5 })).toBe(5)
  })

  it('lets the registrant name everyone else in the family', () => {
    expect(eventAllowedPlusOnes({ family_registration: true, family_max: 5 })).toBe(4)
    // Without it, the usual plus-one rule (capped by the 2-per-person limit).
    expect(eventAllowedPlusOnes({ plus_ones_max: 3 })).toBe(1)
  })

  it('records which members are children', () => {
    const r = parseAttendInput({ plusOnes: [{ firstName: 'Yusuf', child: true }, { firstName: 'Maryam' }] }, 4) as any
    expect(r.ok).toBe(true)
    expect(r.plusOnes).toEqual([
      { first_name: 'Yusuf', phone: null, child: true },
      { first_name: 'Maryam', phone: null },
    ])
  })
})
