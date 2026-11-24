// Browse first, sign in when it matters (owner, 2026-11-23: "for tikem it asks
// to login from the start. that is a big barrier to entry").
//
// A guest can browse Home, Discover, events, organizers, search and occasions.
// Anything that needs an account (tickets, RSVP, hearts, follows, messages,
// creating an event) calls requireAuth(): signed in, it returns true and the
// caller carries on; signed out, it opens the sign-in sheet (the root `Auth`
// route, presented as a modal over where the guest is) and remembers WHAT they
// tried, so the screen can pick it up again once they are signed in.
//
// Why this works without dumping them on Home: the guest stack and the full
// stack share the route names Main, EventDetail, OrganizerProfile… When the
// account appears, AppNavigator swaps the screen list and React Navigation
// keeps every route whose name still exists, dropping only `Auth`. The guest
// lands back on the very event they were looking at; that screen then calls
// takePendingAuthIntent() and reopens the ticket sheet.

/** What the guest was doing when we asked them to sign in. */
export interface AuthIntent {
  /** 'purchase' | 'favorite' | 'follow' | 'message' | … (free-form per screen). */
  kind: string;
  /** Which thing it was about, e.g. the event id. */
  key?: string;
  /** Anything the resumer needs, e.g. the route params of a deep link. */
  payload?: any;
  at: number;
}

// Ten minutes covers a sign-up with an email check; an intent older than that
// is a different visit and must not fire a ticket sheet out of nowhere.
const INTENT_TTL_MS = 10 * 60 * 1000;

let pending: AuthIntent | null = null;
// The last intent SET (kept after it is taken), so the first-run welcome can
// tell "signed in to buy a ticket" from "signed in from the Profile tab".
let recent: { kind: string; at: number } | null = null;

export function setPendingAuthIntent(kind: string, key?: string, payload?: any, now: number = Date.now()): void {
  pending = { kind, key, payload, at: now };
  recent = { kind, at: now };
}

/** Is a fresh intent waiting (any kind)? Used to hold back first-run sheets. */
export function hasPendingAuthIntent(now: number = Date.now()): boolean {
  if (!pending) return false;
  if (now - pending.at > INTENT_TTL_MS) {
    pending = null;
    return false;
  }
  return true;
}

/**
 * Consume the intent if it is this kind (and key, when given). Returns it
 * once; a second call, another kind, or a stale intent returns null.
 */
export function takePendingAuthIntent(kind: string, key?: string, now: number = Date.now()): AuthIntent | null {
  if (!hasPendingAuthIntent(now) || !pending) return null;
  if (pending.kind !== kind) return null;
  if (key !== undefined && pending.key !== key) return null;
  const taken = pending;
  pending = null;
  return taken;
}

export function clearPendingAuthIntent(): void {
  pending = null;
}

// Signing in to open a tab is not doing something: the welcome may show.
const NOT_AN_ACTION = new Set(['tab', 'discoverTab']);

/** Tabs that need an account; a tap opens sign-in and lands there after. */
export const ACCOUNT_TABS = ['Tickets', 'Profile'] as const;

/**
 * Did the guest just sign in to DO something (buy, save, follow, open a link)?
 * Then a first-run welcome would land on top of the very sheet they asked
 * for, so it waits for the next launch. Signing in from a tab does not count.
 */
export function signedInForAnAction(now: number = Date.now()): boolean {
  return !!recent && !NOT_AN_ACTION.has(recent.kind) && now - recent.at <= INTENT_TTL_MS;
}

type NavLike = { navigate: (name: any, params?: any) => void };

/**
 * Gate an action on an account. Returns true when signed in (go ahead).
 * Signed out: opens the sign-in sheet, remembers the intent, returns false.
 *
 *   if (!requireAuth(user, navigation, { kind: 'purchase', key: eventId })) return;
 *
 * Then, on the same screen, once `user` appears:
 *   if (takePendingAuthIntent('purchase', eventId)) handlePurchaseTicket();
 */
export function requireAuth<U>(
  user: U | null | undefined,
  navigation: NavLike,
  intent?: { kind: string; key?: string; payload?: any },
  opts: { screen?: 'Login' | 'Signup' } = {}
): user is U {
  if (user) return true;
  if (intent) setPendingAuthIntent(intent.kind, intent.key, intent.payload);
  else clearPendingAuthIntent();
  navigation.navigate('Auth', opts.screen ? { screen: opts.screen } : undefined);
  return false;
}

// Signing out keeps any open route whose name the guest stack also has, and
// for an account route that is a SignInGate: without this it would pop the
// sign-in sheet over the "back to Home" reset that follows a sign-out.
let signedOutAt = 0;
export function noteSignedOut(now: number = Date.now()): void {
  signedOutAt = now;
  pending = null;
  recent = null;
}
export function justSignedOut(now: number = Date.now()): boolean {
  return now - signedOutAt < 2000;
}

/** For tests: forget everything. */
export function __resetAuthGateForTests(): void {
  pending = null;
  recent = null;
  signedOutAt = 0;
}
