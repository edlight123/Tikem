/**
 * @jest-environment node
 *
 * Connect Eventbrite: the callback (app/api/integrations/eventbrite/callback)
 * attaches a token only to the org AND person whose own browser started the
 * flow. Tikra had to add a claim step (c2bcb528, 2aff2986) because its app
 * state was a signed URL with no browser binding: a consent link opened on
 * someone else's phone linked THEIR Eventbrite to the link-maker's org. Tikèm's
 * state is `<orgId>.<uid>.<random>`, kept in an httpOnly cookie on the browser
 * (or the app's WebView) that called /start, and checked against the signed-in
 * org context on the way back. These are the cases an attacker would try.
 */
jest.mock('server-only', () => ({}), { virtual: true })

let cookieJar: Record<string, string> = {}
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n in cookieJar ? { value: cookieJar[n] } : undefined) }),
  headers: async () => new Headers(),
}))
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }))

let ctx: any = null
jest.mock('@/lib/organizer/context', () => ({ getOrgContext: async () => ctx }))

const saved: Array<{ orgId: string; token: string; by: string }> = []
jest.mock('@/lib/import/eventbrite-server', () => ({
  EB_STATE_COOKIE: 'eb_oauth_state',
  EB_STATE_PATH: '/api/integrations/eventbrite',
  eventbriteConfigured: () => true,
  integrationOrigin: () => 'https://www.tikem.co',
  exchangeCode: async (code: string) => `token-for-${code}`,
  saveToken: async (orgId: string, token: string, by: string) => {
    saved.push({ orgId, token, by })
  },
}))
jest.mock('@/lib/import/eventbrite-sync-server', () => ({ syncEventbriteForOrg: async () => ({ ok: true }) }))

import { GET as callback } from '@/app/api/integrations/eventbrite/callback/route'

const victim = { user: { id: 'victimUid' }, orgId: 'victimOrg', role: 'owner' }
const attacker = { user: { id: 'attackerUid' }, orgId: 'attackerOrg', role: 'owner' }

async function hit(query: string) {
  const res = await callback(new Request(`https://www.tikem.co/api/integrations/eventbrite/callback?${query}`))
  return res.headers.get('location') || ''
}

beforeEach(() => {
  cookieJar = {}
  ctx = null
  saved.length = 0
})

describe('Eventbrite OAuth callback binding', () => {
  it('connects when the state is this browser’s own, for the signed-in org and person', async () => {
    ctx = victim
    cookieJar.eb_oauth_state = 'victimOrg.victimUid.abc123'
    expect(await hit('code=C1&state=victimOrg.victimUid.abc123')).toMatch(/eventbrite=connected$/)
    expect(saved).toEqual([{ orgId: 'victimOrg', token: 'token-for-C1', by: 'victimUid' }])
  })

  it('login CSRF: the attacker’s own code+state, opened in the victim’s browser, links nothing', async () => {
    // The victim has no state cookie for that flow (it lives in the attacker's browser).
    ctx = victim
    expect(await hit('code=ATTACKER_CODE&state=attackerOrg.attackerUid.f00')).toMatch(/eventbrite=error$/)
    // Even with an unrelated flow of their own in progress.
    cookieJar.eb_oauth_state = 'victimOrg.victimUid.abc123'
    expect(await hit('code=ATTACKER_CODE&state=attackerOrg.attackerUid.f00')).toMatch(/eventbrite=error$/)
    expect(saved).toEqual([])
  })

  it('a consent link made by an attacker and approved by the victim never reaches the attacker’s org', async () => {
    // The victim approves on Eventbrite; Eventbrite sends the victim's browser
    // back with the attacker's state. No matching cookie there: refused, and
    // the code is never exchanged.
    ctx = victim
    expect(await hit('code=VICTIM_CODE&state=attackerOrg.attackerUid.f00')).toMatch(/eventbrite=error$/)
    // And a state minted for another org or person is refused even when the
    // cookie was planted to match it.
    cookieJar.eb_oauth_state = 'attackerOrg.attackerUid.f00'
    expect(await hit('code=VICTIM_CODE&state=attackerOrg.attackerUid.f00')).toMatch(/eventbrite=error$/)
    ctx = { ...victim, orgId: 'attackerOrg' } // victim is acting for another org now
    cookieJar.eb_oauth_state = 'attackerOrg.attackerUid.f00'
    expect(await hit('code=VICTIM_CODE&state=attackerOrg.attackerUid.f00')).toMatch(/eventbrite=error$/)
    expect(saved).toEqual([])
  })

  it('signed out, without manage_events, or cancelled on Eventbrite: nothing is saved', async () => {
    cookieJar.eb_oauth_state = 'victimOrg.victimUid.abc123'
    expect(await hit('code=C1&state=victimOrg.victimUid.abc123')).toMatch(/eventbrite=error$/)
    ctx = { ...victim, role: 'staff' }
    expect(await hit('code=C1&state=victimOrg.victimUid.abc123')).toMatch(/eventbrite=error$/)
    ctx = victim
    expect(await hit('error=access_denied&state=victimOrg.victimUid.abc123')).toMatch(/eventbrite=cancelled$/)
    expect(saved).toEqual([])
  })

  it('every exit deletes the one-time state cookie', async () => {
    ctx = attacker
    const res = await callback(new Request('https://www.tikem.co/api/integrations/eventbrite/callback?code=X&state=nope'))
    expect(res.headers.get('set-cookie') || '').toMatch(/eb_oauth_state=;/)
  })
})
