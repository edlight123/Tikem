// Deep-link / universal-link route map for the root stack.
//
// Keep in sync with the web AASA paths (app/api/well-known/aasa/route.ts) and
// the Android intent filters in app.json.
//
// `initialRouteName: 'Main'` is load-bearing. Without it, a cold-start link
// (e.g. an event link tapped in WhatsApp) builds a root stack of exactly one
// route — [EventDetail] — so there is nothing underneath: the in-screen back
// chevron's goBack() is a no-op and the iOS edge swipe has nowhere to go
// (tester report, TestFlight 2026-09-23). With it, React Navigation seeds the
// stack as [Main, EventDetail], so back lands on the home tabs. When the user
// is signed out the stack has no `Main` route and the router drops both
// unknown routes, falling back to Auth exactly as before.
export const LINKING_CONFIG = {
  initialRouteName: 'Main',
  screens: {
    InviteRedeem: 'invite',
    // A friend's personal invite link (web app/i/[code]). App scheme only for
    // now: /i/* is not in the AASA or the Android intent filters, so the https
    // link opens the web page (which sets the attribution cookie).
    InviteLink: 'i/:code',
    // "X joined Tikèm from your invite" push (url /profile/organizer/{uid}).
    OrganizerProfile: 'profile/organizer/:organizerId',
    Notifications: 'notifications',
    TicketDetail: 'tickets/:ticketId',
    EventDetail: 'events/:eventId',
    // Push-notification targets (server-side `url`s, mapped to tikem://<path> in
    // lib/pushNotifications.ts). Without a route here a tap opened the app and
    // went nowhere. App scheme only, like national-day below.
    // Purchase / reminder pushes: the buyer's passes for one event.
    EventTickets: 'tickets/event/:eventId',
    // Organizer sale pushes.
    EventAttendees: 'organizer/events/:eventId/attendees',
    OrganizerEventManagement: 'organizer/events/:eventId',
    // Withdrawal outcome pushes.
    OrganizerEarningsHub: 'organizer/payouts',
    // Payout-verification / payout-health pushes.
    OrganizerPayoutSettings: 'organizer/settings/payouts',
    // City-discovery pushes. Discover is a tab of the attendee navigator; in
    // organizer/staff mode the tab does not exist and the link lands on Main.
    Main: {
      screens: {
        Discover: 'discover',
      },
    },
    // The national-day push's deepLink (tikem://national-day/vertieres) opens
    // the day's themed event list. App scheme only: there is no such web path,
    // so it is not in the AASA or the Android intent filters.
    CategoryEvents: 'national-day/:nationalDay',
  },
};

export const WEB_LINK_PREFIXES = ['tikem://', 'https://tikem.co', 'https://www.tikem.co'];
