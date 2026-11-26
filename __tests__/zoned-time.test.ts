/**
 * Event times are entered and shown in the EVENT's zone, never the device's
 * (lib/events/zonedTime, app copy mobile/lib/zonedTime).
 *
 * None of these helpers read the device zone, so the results below hold on any
 * machine; run with TZ=America/Toronto to see a Toronto organizer's view.
 */
import * as web from '@/lib/events/zonedTime'
import * as mobile from '../mobile/lib/zonedTime'
import fs from 'fs'
import path from 'path'

const VIC = 'America/Vancouver'
const TOR = 'America/Toronto'

describe.each([
  ['web', web],
  ['mobile', mobile],
])('zonedTime (%s)', (_name, z) => {
  it('a Victoria event entered at 7:00 PM from a Toronto device stores 7:00 PM Pacific', () => {
    // Winter: Pacific is UTC-8.
    expect(z.zonedPartsToIso('2027-01-15', '19:00', VIC)).toBe('2027-01-16T03:00:00.000Z')
    // Summer: Pacific is UTC-7.
    expect(z.zonedPartsToIso('2027-07-15', '19:00', VIC)).toBe('2027-07-16T02:00:00.000Z')
    // Read back in Victoria it is still 7:00 PM, not Toronto's 10:00 PM.
    expect(z.toZonedParts('2027-01-16T03:00:00.000Z', VIC)).toEqual({ date: '2027-01-15', time: '19:00' })
    expect(z.toZonedParts('2027-01-16T03:00:00.000Z', TOR)).toEqual({ date: '2027-01-15', time: '22:00' })
  })

  it('the spring-forward gap moves forward by the gap (2:30 AM → 3:30 AM)', () => {
    // 2026-03-08: Pacific clocks jump 2:00 → 3:00 at 10:00Z.
    expect(z.zonedPartsToIso('2026-03-08', '02:30', VIC)).toBe('2026-03-08T10:30:00.000Z')
    expect(z.toZonedParts('2026-03-08T10:30:00.000Z', VIC)).toEqual({ date: '2026-03-08', time: '03:30' })
    // Either side of the gap is exact.
    expect(z.zonedPartsToIso('2026-03-08', '01:59', VIC)).toBe('2026-03-08T09:59:00.000Z')
    expect(z.zonedPartsToIso('2026-03-08', '03:00', VIC)).toBe('2026-03-08T10:00:00.000Z')
  })

  it('the repeated fall-back hour is the first one', () => {
    // 2026-11-01: Pacific 1:00–2:00 AM happens twice (PDT then PST).
    expect(z.zonedPartsToIso('2026-11-01', '01:30', VIC)).toBe('2026-11-01T08:30:00.000Z')
    expect(z.zonedPartsToIso('2026-11-01', '02:00', VIC)).toBe('2026-11-01T10:00:00.000Z')
    expect(z.zonedPartsToIso('2026-11-01', '00:59', VIC)).toBe('2026-11-01T07:59:00.000Z')
  })

  it('round-trips every 30 minutes across both DST weekends', () => {
    for (const day of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
      for (let m = 0; m < 24 * 60; m += 30) {
        const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        if (day === '2026-03-08' && time.startsWith('02:')) continue // the gap
        const iso = z.zonedPartsToIso(day, time, VIC)
        expect(z.toZonedParts(iso, VIC)).toEqual({ date: day, time })
      }
    }
  })

  it('other markets: London, Sydney (southern DST), Dubai (none)', () => {
    expect(z.zonedPartsToIso('2027-03-28', '01:30', 'Europe/London')).toBe('2027-03-28T01:30:00.000Z') // gap → 02:30 BST
    expect(z.zonedPartsToIso('2027-01-10', '20:00', 'Australia/Sydney')).toBe('2027-01-10T09:00:00.000Z') // AEDT +11
    expect(z.zonedPartsToIso('2027-07-10', '20:00', 'Australia/Sydney')).toBe('2027-07-10T10:00:00.000Z') // AEST +10
    expect(z.zonedPartsToIso('2027-07-10', '20:00', 'Asia/Dubai')).toBe('2027-07-10T16:00:00.000Z')
  })

  it('a venue change keeps the wall clock: 7:00 PM Toronto becomes 7:00 PM Victoria', () => {
    const toronto = z.zonedPartsToIso('2027-02-20', '19:00', TOR)!
    expect(toronto).toBe('2027-02-21T00:00:00.000Z')
    const moved = z.reinterpretInZone(toronto, TOR, VIC)
    expect(moved).toBe('2027-02-21T03:00:00.000Z')
    expect(z.toZonedParts(moved, VIC)).toEqual({ date: '2027-02-20', time: '19:00' })
  })

  it('datetime-local values (add-on sales windows) read in the event zone', () => {
    expect(z.zonedInputToIso('2027-01-15T18:00', VIC)).toBe('2027-01-16T02:00:00.000Z')
    expect(z.isoToZonedInput('2027-01-16T02:00:00.000Z', VIC)).toBe('2027-01-15T18:00')
    expect(z.zonedInputToIso('', VIC)).toBeNull()
    expect(z.isoToZonedInput(null, VIC)).toBe('')
  })

  it('rejects junk', () => {
    expect(z.zonedPartsToIso('', '19:00', VIC)).toBeNull()
    expect(z.zonedPartsToIso('2027-01-15', '25:00', VIC)).toBeNull()
    expect(z.toZonedParts('nope', VIC)).toBeNull()
    expect(z.isValidZone('Mars/Olympus')).toBe(false)
    expect(z.isValidZone(VIC)).toBe(true)
  })

  it('labels the zone by name with the venue city', () => {
    expect(z.zoneLabel(VIC, 'en', 'Victoria')).toBe('Pacific Time (Victoria)')
    expect(z.zoneLabel(VIC, 'en', 'Victoria, BC')).toBe('Pacific Time (Victoria)')
    expect(z.zoneLabel(TOR, 'en')).toBe('Eastern Time')
    expect(z.sameOffset(VIC, 'America/Los_Angeles')).toBe(true)
    expect(z.sameOffset(VIC, TOR)).toBe(false)
  })

  it('adds calendar days to a wall-clock date', () => {
    expect(z.addDaysToDate('2027-02-27', 2)).toBe('2027-03-01')
    expect(z.addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('the event zone and the add-on window', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { addOnsFromDrafts, draftsFromAddOns, emptyAddOnDraft } = require('@/lib/addons/editor')

  it('a Montréal or Paris organizer typing 7:00 PM for a Port-au-Prince event means 7:00 PM there', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { timezoneForEvent } = require('@/lib/events/composer-country')
    const pap = timezoneForEvent('HT', 'Port-au-Prince')
    expect(pap).toBe('America/Port-au-Prince')
    // Winter: Port-au-Prince is UTC-5.
    expect(web.zonedPartsToIso('2026-12-20', '19:00', pap)).toBe('2026-12-21T00:00:00.000Z')
    // And the stored instant reads back as 7:00 PM in Port-au-Prince.
    expect(web.toZonedParts('2026-12-21T00:00:00.000Z', pap)).toEqual({ date: '2026-12-20', time: '19:00' })
    // A venue change keeps the wall clock: the same strings save in the new zone.
    expect(web.zonedPartsToIso('2027-02-20', '19:00', TOR)).toBe('2027-02-21T00:00:00.000Z')
    expect(web.zonedPartsToIso('2027-02-20', '19:00', VIC)).toBe('2027-02-21T03:00:00.000Z')
  })

  it('add-on sales windows are read and saved in the event zone', () => {
    const d = { ...emptyAddOnDraft(), name: 'T-shirt', price: '20', salesStart: '2027-03-01T18:00', salesEnd: '2027-03-06T23:59' }
    const [a] = addOnsFromDrafts([d], [], undefined, VIC)
    expect(a.sales_start).toBe('2027-03-02T02:00:00.000Z')
    expect(a.sales_end).toBe('2027-03-07T07:59:00.000Z')
    // Read back for a Victoria event: the same wall clock, wherever the device is.
    const [back] = draftsFromAddOns([a], VIC)
    expect(back.salesStart).toBe('2027-03-01T18:00')
    expect(back.salesEnd).toBe('2027-03-06T23:59')
    // The same strings for a Toronto event are three hours earlier.
    expect(addOnsFromDrafts([d], [], undefined, TOR)[0].sales_start).toBe('2027-03-01T23:00:00.000Z')
  })

  it('the app picker carrier round-trips the venue wall clock', () => {
    const at = new Date('2027-01-16T03:00:00.000Z') // 7:00 PM in Victoria
    const carrier = mobile.toWallClockCarrier(at, VIC)
    expect([carrier.getHours(), carrier.getMinutes(), carrier.getDate()]).toEqual([19, 0, 15])
    carrier.setHours(20)
    expect(mobile.fromWallClockCarrier(carrier, VIC).toISOString()).toBe('2027-01-16T04:00:00.000Z')
  })
})

it('the app copy matches the web module line for line (header aside)', () => {
  const body = (p: string) =>
    fs.readFileSync(path.join(__dirname, '..', p), 'utf8').split('\n').slice(17).join('\n')
  expect(body('mobile/lib/zonedTime.ts')).toBe(body('lib/events/zonedTime.ts'))
})
