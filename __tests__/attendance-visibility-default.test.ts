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
  it('the default is friends on web and mobile', () => {
    expect(DEFAULT_PRIVACY.attendance_visibility).toBe('friends')
    expect(MOBILE_DEFAULT_PRIVACY.attendance_visibility).toBe('friends')
  })

  it('unset reads as friends; explicit values are kept; junk is nobody', () => {
    expect(normalizeAttendanceVisibility(undefined)).toBe('friends')
    expect(normalizeAttendanceVisibility(null)).toBe('friends')
    expect(normalizeAttendanceVisibility('')).toBe('friends')
    expect(normalizeAttendanceVisibility('nobody')).toBe('nobody')
    expect(normalizeAttendanceVisibility('everyone')).toBe('everyone')
    expect(normalizeAttendanceVisibility('friends')).toBe('friends')
    expect(normalizeAttendanceVisibility('all')).toBe('nobody')
  })

  it('sanitizePrivacy keeps an explicit nobody and fills an unset value with friends', () => {
    expect(sanitizePrivacy({}).attendance_visibility).toBe('friends')
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
