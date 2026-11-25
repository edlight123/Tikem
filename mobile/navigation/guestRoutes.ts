// Which root routes a signed-out guest gets (owner, 2026-11-23: "for tikem it
// asks to login from the start. that is a big barrier to entry").
//
// GUEST_ROUTES render the real screen for a guest: they read only public data
// (events, ticket tiers, reviews, follower counts, the public-details API) and
// gate their own account actions through lib/authGate.requireAuth.
//
// ACCOUNT_ROUTES are everything else in the signed-in stack. For a guest each
// one is registered as a SignInGate: navigating to it (a button, a push tap,
// a deep link) opens the sign-in sheet instead, and once signed in the app
// carries on to the route that was asked for, with its params.
//
// The two lists share no names, and together they must cover every route of
// the signed-in stack and every linked path (__tests__/mobile-guest-browsing).

export const GUEST_ROUTES = [
  'Main',
  'EventDetail',
  'Search',
  'CategoryEvents',
  'Occasion',
  'OrganizerProfile',
  'InAppWebView',
  'ContentPage',
  'InviteRedeem',
] as const;

export const ACCOUNT_ROUTES = [
  'InviteLink',
  'VerifyEmail',
  'PaymentWebView',
  'StripeConnectWebView',
  'StripeOnboarding',
  'ImportEvents',
  'IntegrationWebView',
  'Subscriptions',
  'Followers',
  'NotificationSettings',
  'PhotoCredits',
  'AccessibilitySettings',
  'Favorites',
  'Messages',
  'MessageThread',
  'EventFeedback',
  'OrganizerEventRecap',
  'EditProfile',
  'EventTickets',
  'TicketDetail',
  'OrgGallery',
  'Connections',
  'Notifications',
  'OrganizerVerification',
  'OrganizerInfoForm',
  'GovernmentIDUpload',
  'SelfieUpload',
  'OrganizerEventManagement',
  'OrganizerEventEarnings',
  'OrganizerEarningsHub',
  'OrganizerPayoutSettings',
  'OrganizerEventStaff',
  'OrganizerTeamHub',
  'OrganizerOrgTeam',
  'OrganizerPromoCodes',
  'OrganizerComps',
  'OrganizerPromoters',
  'OrganizerGuestList',
  'EventRequests',
  'OrganizerTrackingLinks',
  'OrganizerMessages',
  'CreateEvent',
  'TicketScanner',
  'EventAttendees',
  'EventOrders',
  'EventOrderDetail',
  'EventAnalytics',
  'SendEventUpdate',
  'EditEvent',
  'RefundRequest',
  'Review',
  // The community "share an event you saw" entry (Discover): needs an account
  // to submit, so a guest signs in first and lands on the form.
  'ShareEvent',
  'ClaimEvent',
  'OrganizerAnalytics',
  'OrganizerRefunds',
] as const;

export type GuestRouteName = (typeof GUEST_ROUTES)[number];
export type AccountRouteName = (typeof ACCOUNT_ROUTES)[number];

/** The intent kind a SignInGate stores; AppNavigator resumes it after sign-in. */
export const ROUTE_INTENT = 'route';
/** The intent kind an account tab (Tickets, Profile) stores. */
export const TAB_INTENT = 'tab';
