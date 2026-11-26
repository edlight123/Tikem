/**
 * A link to a website organizer page the app has its own screen for opens the
 * native screen (mobile/lib/organizerWebRoutes); everything else stays on the
 * web view in embed mode.
 */
import * as fs from 'fs'
import * as path from 'path'
import { nativeOrganizerRoute } from '../mobile/lib/organizerWebRoutes'
import { ACCOUNT_ROUTES } from '../mobile/navigation/guestRoutes'

describe('nativeOrganizerRoute', () => {
  it('maps payouts, money, team and an event to native screens', () => {
    expect(nativeOrganizerRoute('/organizer/settings/payouts')?.screen).toBe('OrganizerPayoutSettings')
    expect(nativeOrganizerRoute('/organizer/earnings')?.screen).toBe('OrganizerEarningsHub')
    expect(nativeOrganizerRoute('/organizer/team/')?.screen).toBe('OrganizerTeamHub')
    expect(nativeOrganizerRoute('/organizer/events/new')?.screen).toBe('CreateEvent')
    expect(nativeOrganizerRoute('/organizer/events/abc123XYZ?tab=1')).toEqual({
      screen: 'OrganizerEventManagement',
      params: { eventId: 'abc123XYZ' },
    })
  })

  it('leaves everything else on the web', () => {
    expect(nativeOrganizerRoute('/organizer/events/abc123XYZ/printed')).toBeNull()
    expect(nativeOrganizerRoute('/events/abc123XYZ')).toBeNull()
    expect(nativeOrganizerRoute('')).toBeNull()
  })

  it('every target is a real screen of the app and a real page of the site', () => {
    const src = fs.readFileSync(path.join(__dirname, '../mobile/lib/organizerWebRoutes.ts'), 'utf8')
    const screens = Array.from(src.matchAll(/screen: '([A-Za-z]+)'/g)).map((m) => m[1])
    for (const s of screens) expect(ACCOUNT_ROUTES as readonly string[]).toContain(s)
    for (const p of ['settings/payouts', 'onboarding', 'earnings', 'payouts', 'finance', 'verify', 'analytics', 'team', 'settings/team', 'settings/notifications', 'events/new']) {
      expect(fs.existsSync(path.join(__dirname, '../app/organizer', p))).toBe(true)
    }
  })
})
