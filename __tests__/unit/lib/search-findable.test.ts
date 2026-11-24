import { isFindableInSearch } from '@/lib/social/suggestions'

describe('isFindableInSearch (person search privacy)', () => {
  it('finds public, discoverable people (missing fields mean yes)', () => {
    expect(isFindableInSearch({}, false)).toBe(true)
    expect(isFindableInSearch({ privacy: { profile_visibility: 'public' } }, false)).toBe(true)
  })
  it('hides private profiles and people who opted out from strangers', () => {
    expect(isFindableInSearch({ privacy: { profile_visibility: 'private' } }, false)).toBe(false)
    expect(isFindableInSearch({ discoverable: false }, false)).toBe(false)
  })
  it('an existing connection still finds them', () => {
    expect(isFindableInSearch({ privacy: { profile_visibility: 'private' } }, true)).toBe(true)
    expect(isFindableInSearch({ discoverable: false }, true)).toBe(true)
  })
})
