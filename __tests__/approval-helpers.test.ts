/**
 * Approval lists and plus-ones: the pure rules (lib/events/approval.ts).
 * Spec: docs/specs/approval-lists-and-plus-ones.md.
 *
 * @jest-environment node
 */

import {
  allowedPlusOnes,
  approvalBlockedByPrice,
  approvalFreeLinesRefusal,
  attendRequestId,
  eventAllowedPlusOnes,
  eventRequiresApproval,
  parseAttendInput,
  plusOnesSetting,
  sortAttendRequests,
} from '@/lib/events/approval'
import { MAX_FREE_TICKETS_PER_PERSON } from '@/lib/ticketPricing'

describe('allowedPlusOnes: the plus-one cap helper', () => {
  it('is min(organizer setting, free cap - 1)', () => {
    expect(allowedPlusOnes(3, 2)).toBe(1)
    expect(allowedPlusOnes(2, 2)).toBe(1)
    expect(allowedPlusOnes(1, 2)).toBe(1)
    expect(allowedPlusOnes(0, 2)).toBe(0)
  })

  it('opens up when the cap is raised, but never past the setting or 3', () => {
    expect(allowedPlusOnes(2, 4)).toBe(2)
    expect(allowedPlusOnes(3, 10)).toBe(3)
    expect(allowedPlusOnes(9, 10)).toBe(3)
  })

  it('gives nothing when the cap leaves no room', () => {
    expect(allowedPlusOnes(3, 1)).toBe(0)
    expect(allowedPlusOnes(3, 0)).toBe(0)
  })

  it('defaults to the live free cap (2 today, so 1 plus-one)', () => {
    expect(MAX_FREE_TICKETS_PER_PERSON).toBe(2)
    expect(allowedPlusOnes(3)).toBe(1)
    expect(eventAllowedPlusOnes({ plus_ones_max: 3 })).toBe(1)
    expect(eventAllowedPlusOnes({})).toBe(0)
    expect(eventAllowedPlusOnes(null)).toBe(0)
  })

  it('sanitises junk settings', () => {
    expect(plusOnesSetting({ plus_ones_max: '2' })).toBe(2)
    expect(plusOnesSetting({ plus_ones_max: -1 })).toBe(0)
    expect(plusOnesSetting({ plus_ones_max: 'abc' })).toBe(0)
    expect(plusOnesSetting({ plus_ones_max: 2.7 })).toBe(2)
    expect(allowedPlusOnes('nope', 4)).toBe(0)
  })
})

describe('approval flags', () => {
  it('only a literal true requires approval', () => {
    expect(eventRequiresApproval({ requires_approval: true })).toBe(true)
    expect(eventRequiresApproval({ requires_approval: 'true' })).toBe(false)
    expect(eventRequiresApproval({})).toBe(false)
  })

  it('blocks approval on paid events, by flag or by any paid tier', () => {
    expect(approvalBlockedByPrice({}, [{ price: 0 }])).toBe(false)
    expect(approvalBlockedByPrice({ has_paid_tiers: true }, [])).toBe(true)
    expect(approvalBlockedByPrice({}, [{ price: 0 }, { price: 500 }])).toBe(true)
  })

  it('refuses free lines on paid rails for approval events only', () => {
    expect(approvalFreeLinesRefusal({ requires_approval: true }, 1)).toMatchObject({ status: 403, code: 'approval_required' })
    expect(approvalFreeLinesRefusal({ requires_approval: true }, 0)).toBeNull()
    expect(approvalFreeLinesRefusal({}, 2)).toBeNull()
  })

  it('keys one request per person per event', () => {
    expect(attendRequestId('evt', 'u1')).toBe('evt__u1')
  })
})

describe('parseAttendInput', () => {
  it('accepts named plus-ones and normalises phones', () => {
    const r = parseAttendInput({ plusOnes: [{ firstName: ' Nadia ', phone: '3412 3456' }], note: ' hi ' }, 1, (p) => `+509${p.replace(/\D/g, '')}`)
    expect(r).toEqual({ ok: true, plusOnes: [{ first_name: 'Nadia', phone: '+50934123456' }], note: 'hi' })
  })

  it('keeps phone optional', () => {
    const r = parseAttendInput({ plusOnes: [{ firstName: 'Marc' }] }, 1)
    expect(r).toEqual({ ok: true, plusOnes: [{ first_name: 'Marc', phone: null }], note: '' })
  })

  it('refuses more plus-ones than allowed', () => {
    expect(parseAttendInput({ plusOnes: [{ firstName: 'a' }, { firstName: 'b' }] }, 1)).toMatchObject({ ok: false, code: 'too_many_plus_ones' })
    expect(parseAttendInput({ plusOnes: [{ firstName: 'a' }] }, 0)).toMatchObject({ ok: false, code: 'too_many_plus_ones' })
  })

  it('requires a first name', () => {
    expect(parseAttendInput({ plusOnes: [{ firstName: '  ', phone: '1' }] }, 1)).toMatchObject({ ok: false, code: 'plus_one_name_required' })
  })

  it('caps the note at 280 characters', () => {
    expect(parseAttendInput({ note: 'x'.repeat(280) }, 0).ok).toBe(true)
    expect(parseAttendInput({ note: 'x'.repeat(281) }, 0)).toMatchObject({ ok: false, code: 'note_too_long' })
  })

  it('refuses a non-list', () => {
    expect(parseAttendInput({ plusOnes: 'Nadia' }, 1)).toMatchObject({ ok: false, code: 'invalid_plus_ones' })
  })
})

describe('sortAttendRequests', () => {
  it('puts pending first (oldest first), then decided newest first', () => {
    const rows = [
      { id: 'a', status: 'approved', created_at: '2026-10-01T00:00:00Z' },
      { id: 'b', status: 'pending', created_at: '2026-10-03T00:00:00Z' },
      { id: 'c', status: 'declined', created_at: '2026-10-02T00:00:00Z' },
      { id: 'd', status: 'pending', created_at: '2026-10-02T00:00:00Z' },
      { id: 'e', status: 'approved', created_at: '2026-10-05T00:00:00Z' },
    ]
    expect(sortAttendRequests(rows).map((r) => r.id)).toEqual(['d', 'b', 'e', 'a', 'c'])
  })
})
