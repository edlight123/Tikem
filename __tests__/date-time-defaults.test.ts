/**
 * The start/end rules the event pickers and the add-on sales window share
 * (lib/events/dateTimeDefaults, app copy in mobile/lib/dateTimeDefaults).
 */
import * as web from '@/lib/events/dateTimeDefaults'
import * as mobile from '../mobile/lib/dateTimeDefaults'

const at = (s: string) => new Date(s)

describe('dateTimeDefaults', () => {
  it('a new end is the start + 2 hours, across midnight too', () => {
    expect(web.defaultEndFor(at('2027-03-01T19:00:00')).getTime()).toBe(at('2027-03-01T21:00:00').getTime())
    expect(web.defaultEndFor(at('2027-03-01T23:30:00')).getTime()).toBe(at('2027-03-02T01:30:00').getTime())
  })

  it('moving the start keeps the length of a valid end', () => {
    const e = web.nextEndOnStartChange(at('2027-03-01T19:00:00'), at('2027-03-02T20:00:00'), at('2027-03-01T23:00:00'))
    expect(e.getTime()).toBe(at('2027-03-03T00:00:00').getTime())
  })

  it('a missing end, or one not after the old start, becomes start + 2h', () => {
    expect(web.nextEndOnStartChange(null, at('2027-03-01T19:00:00'), null).getTime()).toBe(at('2027-03-01T21:00:00').getTime())
    expect(
      web.nextEndOnStartChange(at('2027-03-01T19:00:00'), at('2027-03-01T20:00:00'), at('2027-03-01T18:00:00')).getTime(),
    ).toBe(at('2027-03-01T22:00:00').getTime())
    // No previous start: a later end the organizer already set is kept.
    expect(web.nextEndOnStartChange(null, at('2027-03-01T19:00:00'), at('2027-03-01T23:00:00')).getTime()).toBe(
      at('2027-03-01T23:00:00').getTime(),
    )
  })

  it('the end must be after the start', () => {
    expect(web.endNotAfterStart(at('2027-03-01T19:00:00'), at('2027-03-01T19:00:00'))).toBe(true)
    expect(web.endNotAfterStart(at('2027-03-01T19:00:00'), at('2027-03-01T18:00:00'))).toBe(true)
    expect(web.endNotAfterStart(at('2027-03-01T19:00:00'), at('2027-03-01T20:00:00'))).toBe(false)
    expect(web.endNotAfterStart(null, at('2027-03-01T20:00:00'))).toBe(false)
  })

  it('round-trips the pickers’ local parts', () => {
    const d = web.fromLocalParts('2027-03-01', '07:05')!
    expect(web.toLocalParts(d)).toEqual({ date: '2027-03-01', time: '07:05' })
    expect(web.fromLocalParts('2027-03-01')!.getHours()).toBe(0)
    expect(web.fromLocalParts('', '07:00')).toBeNull()
    expect(web.fromLocalParts('nope')).toBeNull()
  })

  it('the app copy agrees', () => {
    const s = at('2027-03-01T19:00:00')
    const n = at('2027-03-04T10:15:00')
    const e = at('2027-03-01T22:30:00')
    expect(mobile.nextEndOnStartChange(s, n, e).getTime()).toBe(web.nextEndOnStartChange(s, n, e).getTime())
    expect(mobile.nextEndOnStartChange(null, n, null).getTime()).toBe(web.nextEndOnStartChange(null, n, null).getTime())
    expect(mobile.endNotAfterStart(e, s)).toBe(web.endNotAfterStart(e, s))
    expect(mobile.toLocalParts(n)).toEqual(web.toLocalParts(n))
    expect(mobile.DEFAULT_EVENT_HOURS).toBe(web.DEFAULT_EVENT_HOURS)
  })
})
