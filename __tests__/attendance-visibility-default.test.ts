/**
 * Owner decision (2026-10): an UNSET privacy.attendance_visibility reads as
 * 'friends' everywhere (types/social.ts is the one reading). An explicit
 * 'nobody' still wins; 'everyone' is unchanged.
 */

import {
  DEFAULT_PRIVACY,
  attendanceVisibilityUnset,
  normalizeAttendanceVisibility,
  sanitizePrivacy,
} from '@/types/social'
import { DEFAULT_PRIVACY as MOBILE_DEFAULT_PRIVACY, attendanceVisibilityUnset as mobileUnset } from '../mobile/types/social'

describe('attendance visibility default', () => {
  it('the default is everyone on web and mobile (public by default, PR #55)', () => {
    expect(DEFAULT_PRIVACY.attendance_visibility).toBe('everyone')
    expect(MOBILE_DEFAULT_PRIVACY.attendance_visibility).toBe('everyone')
  })

  it('unset reads as everyone; explicit values are kept; junk is nobody', () => {
    expect(normalizeAttendanceVisibility(undefined)).toBe('everyone')
    expect(normalizeAttendanceVisibility(null)).toBe('everyone')
    expect(normalizeAttendanceVisibility('')).toBe('everyone')
    expect(normalizeAttendanceVisibility('nobody')).toBe('nobody')
    expect(normalizeAttendanceVisibility('everyone')).toBe('everyone')
    expect(normalizeAttendanceVisibility('friends')).toBe('friends')
    expect(normalizeAttendanceVisibility('all')).toBe('nobody')
  })

  it('sanitizePrivacy keeps an explicit nobody and fills an unset value with everyone', () => {
    expect(sanitizePrivacy({}).attendance_visibility).toBe('everyone')
    expect(sanitizePrivacy({ attendance_visibility: 'nobody' }).attendance_visibility).toBe('nobody')
    expect(sanitizePrivacy({ profile_visibility: 'public' }, { attendance_visibility: 'nobody' }).attendance_visibility).toBe('nobody')
    expect(sanitizePrivacy({ attendance_visibility: 'everyone' }).attendance_visibility).toBe('everyone')
  })

  it('"unset" (who sees the one-time notice) is only a missing value', () => {
    expect(attendanceVisibilityUnset(undefined)).toBe(true)
    expect(attendanceVisibilityUnset({})).toBe(true)
    expect(attendanceVisibilityUnset({ attendance_visibility: 'friends' })).toBe(false)
    expect(attendanceVisibilityUnset({ attendance_visibility: 'nobody' })).toBe(false)
    expect(mobileUnset({})).toBe(true)
    expect(mobileUnset({ attendance_visibility: 'everyone' })).toBe(false)
  })
})
