/**
 * Guest browsing (owner, 2026-11-23: "for tikem it asks to login from the
 * start. that is a big barrier to entry. can you do like tikra?").
 *
 * A signed-out person browses Home, Discover, events, organizers, search and
 * occasions. Anything needing an account opens the sign-in sheet and carries
 * on afterwards (mobile/lib/authGate, mobile/navigation/guestRoutes).
 */
import fs from 'fs'
import path from 'path'
import {
  requireAuth,
  takePendingAuthIntent,
  hasPendingAuthIntent,
  clearPendingAuthIntent,
  signedInForAnAction,
  setPendingAuthIntent,
  noteSignedOut,
  justSignedOut,
  __resetAuthGateForTests,
} from '../mobile/lib/authGate'
import { GUEST_ROUTES, ACCOUNT_ROUTES } from '../mobile/navigation/guestRoutes'
import { LINKING_CONFIG } from '../mobile/navigation/linkingConfig'

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('requireAuth (the gated-action helper)', () => {
  beforeEach(() => __resetAuthGateForTests())

  it('lets a signed-in person straight through without navigating', () => {
    const nav = { navigate: jest.fn() }
    expect(requireAuth({ uid: 'u1' }, nav, { kind: 'purchase', key: 'e1' })).toBe(true)
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(hasPendingAuthIntent()).toBe(false)
  })

  it('opens the sign-in sheet for a guest and remembers what they tapped', () => {
    const nav = { navigate: jest.fn() }
    expect(requireAuth(null, nav, { kind: 'purchase', key: 'e1' })).toBe(false)
    expect(nav.navigate).toHaveBeenCalledWith('Auth', undefined)
    expect(takePendingAuthIntent('purchase', 'e2')).toBeNull()
    expect(takePendingAuthIntent('favorite', 'e1')).toBeNull()
    expect(takePendingAuthIntent('purchase', 'e1')).toMatchObject({ kind: 'purchase', key: 'e1' })
    // Once only: the ticket sheet must not reopen on the next visit.
    expect(takePendingAuthIntent('purchase', 'e1')).toBeNull()
  })

  it('can open Create an account directly', () => {
    const nav = { navigate: jest.fn() }
    requireAuth(null, nav, { kind: 'tab', key: 'Profile' }, { screen: 'Signup' })
    expect(nav.navigate).toHaveBeenCalledWith('Auth', { screen: 'Signup' })
  })

  it('a gate with no intent forgets an older one', () => {
    setPendingAuthIntent('purchase', 'e1')
    requireAuth(null, { navigate: jest.fn() })
    expect(hasPendingAuthIntent()).toBe(false)
  })

  it('drops a stale intent (a different visit)', () => {
    const t0 = 1_000_000
    setPendingAuthIntent('purchase', 'e1', undefined, t0)
    expect(takePendingAuthIntent('purchase', 'e1', t0 + 11 * 60 * 1000)).toBeNull()
  })

  it('"Not now" clears it', () => {
    setPendingAuthIntent('follow', 'org1')
    clearPendingAuthIntent()
    expect(takePendingAuthIntent('follow', 'org1')).toBeNull()
  })

  it('holds the first-run welcome back only after signing in for an action', () => {
    expect(signedInForAnAction()).toBe(false)
    setPendingAuthIntent('tab', 'Profile')
    expect(signedInForAnAction()).toBe(false)
    setPendingAuthIntent('purchase', 'e1')
    takePendingAuthIntent('purchase', 'e1')
    // Still true after the screen consumed it: the welcome checks later.
    expect(signedInForAnAction()).toBe(true)
    // Opening Discover's Saved tab is not an action either.
    setPendingAuthIntent('discoverTab', 'saved')
    expect(signedInForAnAction()).toBe(false)
  })

  it('a sign-out forgets everything and holds sign-in gates back briefly', () => {
    const t0 = 5_000_000
    setPendingAuthIntent('purchase', 'e1', undefined, t0)
    noteSignedOut(t0)
    expect(hasPendingAuthIntent(t0)).toBe(false)
    expect(justSignedOut(t0 + 100)).toBe(true)
    expect(justSignedOut(t0 + 5000)).toBe(false)
  })
})

describe('navigator: guest stack vs signed-in stack', () => {
  const src = read('mobile/navigation/AppNavigator.tsx')
  const guestStart = src.indexOf('{!user ? (')
  const split = src.indexOf(') : (', guestStart)
  const end = src.indexOf('</Stack.Navigator>', split)
  const guestBlock = src.slice(guestStart, split)
  const fullBlock = src.slice(split, end)
  const names = (block: string) => Array.from(block.matchAll(/<Stack\.Screen\s+name="([A-Za-z]+)"/g)).map((m) => m[1])

  it('found both stacks', () => {
    expect(guestStart).toBeGreaterThan(0)
    expect(names(fullBlock).length).toBeGreaterThan(40)
  })

  it('guests start on the home tabs, not a login wall', () => {
    expect(names(guestBlock)[0]).toBe('Main')
    expect(guestBlock).toMatch(/name="Main" component=\{AttendeeTabNavigator\}/)
  })

  it('guests get every browsing screen, by the SAME names as the signed-in stack', () => {
    const guest = names(guestBlock)
    const full = names(fullBlock)
    for (const r of GUEST_ROUTES) {
      expect(guest).toContain(r)
      expect(full).toContain(r)
    }
  })

  it('sign-in is a sheet over the page, and only exists for guests', () => {
    expect(guestBlock).toMatch(/name="Auth" component=\{AuthNavigator\} options=\{\{ presentation: 'modal' \}\}/)
    // Not in the signed-in stack: signing in drops `Auth` and keeps the rest.
    expect(names(fullBlock)).not.toContain('Auth')
  })

  it('every other signed-in route is a sign-in gate for guests', () => {
    expect(guestBlock).toMatch(/ACCOUNT_ROUTES\.map\(\(name\) => \(\s*<Stack\.Screen key=\{name\} name=\{name as any\} component=\{SignInGate\}/)
    const covered = new Set<string>([...GUEST_ROUTES, ...ACCOUNT_ROUTES])
    const missing = names(fullBlock).filter((n) => !covered.has(n))
    expect(missing).toEqual([])
  })

  it('the two lists do not overlap', () => {
    const guest = new Set<string>(GUEST_ROUTES)
    expect(ACCOUNT_ROUTES.filter((r) => guest.has(r))).toEqual([])
  })

  it('Tickets and Profile ask a guest to sign in', () => {
    expect(src).toMatch(/!tabUser && \(ACCOUNT_TABS as readonly string\[\]\)\.includes\(tab\.name\)/)
    expect(src).toMatch(/name="Tickets" component=\{TicketsTab\}/)
    expect(src).toMatch(/name="Profile" component=\{ProfileTab\}/)
  })

  it('a sign-in gate stands down while signing out (no sheet over the reset)', () => {
    expect(src).toMatch(/function SignInGate[\s\S]*?if \(justSignedOut\(\)\) return;/)
    expect(src).toMatch(/if \(prev && !uid\) \{\s*noteSignedOut\(\);/)
  })

  it('signing out returns to guest browsing from Home', () => {
    expect(src).toMatch(/if \(prev && !uid\) \{[\s\S]*?routes: \[\{ name: 'Main' as any, params: \{ screen: 'Home' \} \}/)
  })
})

describe('deep links for a guest', () => {
  const linked = Object.keys(LINKING_CONFIG.screens)
  const guest = new Set<string>(GUEST_ROUTES)
  const account = new Set<string>(ACCOUNT_ROUTES)

  it('event, organizer and occasion links open the screen, not the login wall', () => {
    for (const r of ['EventDetail', 'OrganizerProfile', 'Occasion', 'CategoryEvents', 'Main', 'InviteRedeem']) {
      expect(guest.has(r)).toBe(true)
      expect(linked).toContain(r)
    }
  })

  it('every linked screen is either open to guests or a sign-in gate (never silently dropped)', () => {
    expect(linked.filter((r) => !guest.has(r) && !account.has(r))).toEqual([])
  })

  it('still seeds Main beneath the linked screen for guests too', () => {
    expect(LINKING_CONFIG.initialRouteName).toBe('Main')
  })
})

describe('the sign-in sheet', () => {
  it('Login and Sign-up offer a way back to browsing', () => {
    // A quiet "Not now" link on both (2026-11-24, ported from Tikra: no X).
    for (const f of ['mobile/screens/auth/LoginScreen.tsx', 'mobile/screens/auth/SignupScreen.tsx']) {
      expect(read(f)).toMatch(/<AuthDismiss navigation=\{navigation\} variant="link"/)
    }
  })

  it('the event page reopens what the guest tapped once they are signed in', () => {
    const ev = read('mobile/screens/EventDetailScreen.tsx')
    expect(ev).toMatch(/requireAuth\(user, navigation, \{ kind: 'purchase', key: eventId \}\)/)
    expect(ev).toMatch(/takePendingAuthIntent\('purchase', eventId\)/)
    expect(ev).not.toMatch(/t\('eventDetail\.purchase\.loginBody'\)/)
  })

  it("Discover's Following and Saved tabs ask a guest to sign in, then open", () => {
    const d = read('mobile/screens/DiscoverScreen.tsx')
    expect(d).toMatch(/requireAuth\(user, navigation, \{ kind: 'discoverTab', key \}\)/)
    expect(d).toMatch(/takePendingAuthIntent\('discoverTab'\)/)
    expect(d).toMatch(/onPress=\{\(\) => openDiscoverTab\(tab\.key\)\}/)
  })

  it('the first-run welcome never lands on top of a resumed action', () => {
    expect(read('mobile/components/FirstRunWelcome.tsx')).toMatch(/if \(signedInForAnAction\(\)\) return;/)
  })
})
