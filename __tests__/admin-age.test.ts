import { describe, it, expect } from '@jest/globals'
import { formatAge, ageTier, ageClass } from '../lib/admin/age'

const NOW = new Date('2026-08-14T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

describe('formatAge', () => {
  it('renders minutes under an hour', () => {
    expect(formatAge(ago(5 * MIN), NOW)).toBe('5m')
  })
  it('renders hours under a day', () => {
    expect(formatAge(ago(19 * HOUR), NOW)).toBe('19h')
  })
  it('renders days beyond a day', () => {
    expect(formatAge(ago(6 * DAY), NOW)).toBe('6d')
  })
  it('floors rather than rounds, so nothing reads older than it is', () => {
    expect(formatAge(ago(47 * HOUR), NOW)).toBe('1d')
  })
  it('renders a just-created item as 0m, not empty', () => {
    expect(formatAge(ago(10), NOW)).toBe('0m')
  })
  it('returns an em dash for missing or unparseable input', () => {
    expect(formatAge(null, NOW)).toBe('—')
    expect(formatAge(undefined, NOW)).toBe('—')
    expect(formatAge('not-a-date', NOW)).toBe('—')
  })
  it('does not render a negative age for a future timestamp', () => {
    expect(formatAge(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe('0m')
  })
})

describe('ageTier', () => {
  it('is fresh under 24h', () => {
    expect(ageTier(ago(23 * HOUR), NOW)).toBe('fresh')
  })
  it('is waiting from 24h to 3d', () => {
    expect(ageTier(ago(25 * HOUR), NOW)).toBe('waiting')
    expect(ageTier(ago(3 * DAY - MIN), NOW)).toBe('waiting')
  })
  it('is overdue beyond 3d', () => {
    expect(ageTier(ago(3 * DAY + MIN), NOW)).toBe('overdue')
  })
  it('is none when there is no timestamp', () => {
    expect(ageTier(null, NOW)).toBe('none')
  })
})

describe('ageClass', () => {
  it('maps each tier to its one colour', () => {
    expect(ageClass(ago(1 * HOUR), NOW)).toBe('text-fg-subtle')
    expect(ageClass(ago(2 * DAY), NOW)).toBe('text-warning-strong')
    expect(ageClass(ago(9 * DAY), NOW)).toBe('text-danger-strong')
    expect(ageClass(null, NOW)).toBe('text-fg-subtle')
  })
})
