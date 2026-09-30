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
    Notifications: 'notifications',
    TicketDetail: 'tickets/:ticketId',
    EventDetail: 'events/:eventId',
  },
};

export const WEB_LINK_PREFIXES = ['tikem://', 'https://tikem.co', 'https://www.tikem.co'];
