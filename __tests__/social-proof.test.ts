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

describe('shouldShowGoingCount with the organizer override', () => {
  it('prints any count when the organizer asked for it', () => {
    expect(shouldShowGoingCount(88, 1_000_000, true)).toBe(true)
    expect(shouldShowGoingCount(3, null, true)).toBe(true)
  })
  it('still prints nothing for zero', () => expect(shouldShowGoingCount(0, 10, true)).toBe(false))
  it('keeps the half-capacity rule when off', () => expect(shouldShowGoingCount(88, 1_000_000, false)).toBe(false))
})
