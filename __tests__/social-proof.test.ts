import { shouldShowGoingCount } from '@/lib/socialProof'

describe('shouldShowGoingCount', () => {
  it('hides a small count', () => expect(shouldShowGoingCount(2, 100)).toBe(false))
  it('shows from half the capacity', () => {
    expect(shouldShowGoingCount(50, 100)).toBe(true)
    expect(shouldShowGoingCount(49, 100)).toBe(false)
  })
  it('hides when there is no capacity', () => {
    expect(shouldShowGoingCount(300, 0)).toBe(false)
    expect(shouldShowGoingCount(300, undefined)).toBe(false)
  })
})
