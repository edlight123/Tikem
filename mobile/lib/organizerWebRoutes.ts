/**
 * The website's organizer pages that the app has its own screen for. A link to
 * one of them, from a page in the app's web view, opens the native screen
 * instead of the website's (Tikra TestFlight 2026-11-25: the payouts page showed in
 * the app with the website's organizer bar on top of the app's back button).
 *
 * Pure (a path in, a route out) so Jest can check the table. Pages with no
 * native screen return null and stay in the web view, in embed mode.
 */
export type NativeOrganizerRoute = { screen: string; params?: Record<string, unknown> };

const EVENT_ID = '([A-Za-z0-9_-]{6,128})';

const TABLE: Array<[RegExp, (m: RegExpMatchArray) => NativeOrganizerRoute]> = [
  // Payout setup and status (Stripe Connect).
  [/^\/organizer\/settings\/payouts$/, () => ({ screen: 'OrganizerPayoutSettings' })],
  [/^\/organizer\/onboarding$/, () => ({ screen: 'OrganizerPayoutSettings' })],
  // Money: earnings, payouts list, finance.
  [/^\/organizer\/(earnings|payouts|finance)$/, () => ({ screen: 'OrganizerEarningsHub' })],
  [/^\/organizer\/verify$/, () => ({ screen: 'OrganizerVerification' })],
  [/^\/organizer\/analytics$/, () => ({ screen: 'OrganizerAnalytics' })],
  [/^\/organizer\/(team|settings\/team)$/, () => ({ screen: 'OrganizerTeamHub' })],
  [/^\/organizer\/settings\/notifications$/, () => ({ screen: 'NotificationSettings', params: { organizer: true } })],
  [/^\/organizer\/events\/new$/, () => ({ screen: 'CreateEvent' })],
  [new RegExp(`^/organizer/events/${EVENT_ID}/earnings$`), (m) => ({ screen: 'OrganizerEventEarnings', params: { eventId: m[1] } })],
  [new RegExp(`^/organizer/events/${EVENT_ID}$`), (m) => ({ screen: 'OrganizerEventManagement', params: { eventId: m[1] } })],
];

/** The native screen for an organizer page path (query and hash ignored), or null. */
export function nativeOrganizerRoute(pathname: string): NativeOrganizerRoute | null {
  const path = String(pathname || '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (!path.startsWith('/organizer/')) return null;
  for (const [re, build] of TABLE) {
    // First match wins: /organizer/events/new is listed before the event id rule.
    const m = path.match(re);
    if (m) return build(m);
  }
  return null;
}
