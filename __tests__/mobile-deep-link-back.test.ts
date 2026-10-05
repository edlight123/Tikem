/**
 * TestFlight 2026-09-23: an event link opened from WhatsApp launched the app
 * straight onto EventDetail with nothing beneath it, so back did nothing.
 */
import { goBackOrHome } from '../mobile/lib/goBackOrHome'
import { LINKING_CONFIG } from '../mobile/navigation/linkingConfig'

function fakeNav(canGoBack: boolean, routeNames: string[]) {
  return {
    canGoBack: jest.fn(() => canGoBack),
    goBack: jest.fn(),
    reset: jest.fn(),
    getState: jest.fn(() => ({ routeNames })),
  }
}

describe('goBackOrHome', () => {
  it('goes back when there is history', () => {
    const nav = fakeNav(true, ['Main', 'EventDetail'])
    goBackOrHome(nav)
    expect(nav.goBack).toHaveBeenCalled()
    expect(nav.reset).not.toHaveBeenCalled()
  })

  it('resets to the home tabs when the deep-linked screen is alone', () => {
    const nav = fakeNav(false, ['Main', 'EventDetail'])
    goBackOrHome(nav)
    expect(nav.goBack).not.toHaveBeenCalled()
    expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] })
  })

  it('falls back to Auth when signed out', () => {
    const nav = fakeNav(false, ['Auth', 'InviteRedeem'])
    goBackOrHome(nav)
    expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Auth' }] })
  })
})

describe('linking config', () => {
  it('seeds Main beneath deep-linked screens', () => {
    expect(LINKING_CONFIG.initialRouteName).toBe('Main')
  })

  // React Navigation v7 ships ESM-only, which this Jest setup cannot load, so
  // getStateFromPath(path, LINKING_CONFIG) was checked with plain node instead:
  // every configured path yields [Main, <screen>] (previously [<screen>]).
  it('keeps the deep-linkable paths mapped', () => {
    expect(LINKING_CONFIG.screens).toEqual({
      InviteRedeem: 'invite',
      Notifications: 'notifications',
      TicketDetail: 'tickets/:ticketId',
      EventDetail: 'events/:eventId',
      CategoryEvents: 'national-day/:nationalDay',
      // Push notification targets (lib/pushNotifications maps relative URLs to tikem://).
      EventTickets: 'tickets/event/:eventId',
      EventAttendees: 'organizer/events/:eventId/attendees',
      OrganizerEventManagement: 'organizer/events/:eventId',
      OrganizerEarningsHub: 'organizer/payouts',
      OrganizerPayoutSettings: 'organizer/settings/payouts',
      Main: { screens: { Discover: 'discover' } },
    })
  })
})
