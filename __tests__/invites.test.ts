/**
 * @jest-environment node
 *
 * Friend invites (lib/invites): who may be invited, the daily caps, mutes,
 * duplicate protection, the once-ever claim with auto-connect, purchase
 * attribution at fulfilment, the /i/{code} cookie, and the remote switch.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockDb = new FakeFirestore()
const mockGetUser = jest.fn()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockDb
  },
  adminAuth: { getUser: (...a: any[]) => mockGetUser(...a) },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__', increment: (n: number) => n },
}))
const mockCreateNotification = jest.fn(async () => 'n1')
jest.mock('@/lib/notifications/helpers', () => ({
  createNotification: (...a: any[]) => (mockCreateNotification as any)(...a),
}))
const mockPush = jest.fn(async () => undefined)
jest.mock('@/lib/notification-triggers', () => ({
  sendPushNotification: (...a: any[]) => (mockPush as any)(...a),
}))
const mockConsume = jest.fn(async (_o: any) => ({ limited: false }))
jest.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: (o: any) => mockConsume(o),
}))
let mockFlag = true
jest.mock('@/lib/social/flags', () => ({
  isSocialFlagOn: async () => mockFlag,
}))

import {
  attributionApplies,
  inviteCodeFromBytes,
  inviteLandingPath,
  inviteLinkUrl,
  isNewAccount,
  isValidInviteCode,
  normalizeFriendIds,
  parseInviteCookie,
  planInvites,
  serializeInviteCookie,
  INVITE_CAPS,
  INVITE_COOKIE,
} from '@/lib/invites/policy'
import {
  claimInvite,
  getInvitePicker,
  getOrCreateInviteCode,
  muteInviter,
  recordInvitePurchase,
  sendEventInvites,
  unmuteInviter,
} from '@/lib/invites/server'
import { handleSendInvites, inviteGuard } from '@/lib/invites/handlers'
import { GET as inviteLinkGET } from '@/app/i/[code]/route'

const NOW = Date.UTC(2026, 9, 6, 15)
const future = new Date(NOW + 5 * 86400000).toISOString()

const put = (path: string, data: Record<string, any>) => mockDb.store.set(path, data)
const friends = (a: string, b: string, status = 'accepted') =>
  put(`connections/${[a, b].sort().join('__')}`, { users: [a, b].sort(), status, requester_id: a, recipient_id: b })
const user = (uid: string, extra: Record<string, any> = {}) =>
  put(`users/${uid}`, { full_name: `Name ${uid}`, email: `${uid}@example.com`, phone_number: '+50937000000', ...extra })
const event = (id: string, extra: Record<string, any> = {}) =>
  put(`events/${id}`, { title: 'Kompa Night', is_published: true, start_datetime: future, ...extra })

beforeEach(() => {
  mockDb.store.clear()
  mockCreateNotification.mockClear()
  mockPush.mockClear()
  mockConsume.mockReset()
  mockConsume.mockImplementation(async () => ({ limited: false }))
  mockGetUser.mockReset()
  mockFlag = true
  ;['alice', 'bob', 'carl', 'dana', 'erin', 'zed'].forEach((u) => user(u))
  friends('alice', 'bob')
  friends('alice', 'carl')
  friends('alice', 'dana')
  friends('alice', 'erin')
  friends('alice', 'zed', 'pending')
  event('ev1')
})

// ── Pure rules ──────────────────────────────────────────────────────────────

describe('policy', () => {
  const facts = {
    accepted: new Set(['bob', 'carl', 'dana', 'erin']),
    alreadyInvited: new Set(['carl']),
    holders: new Set(['dana']),
    mutedBy: new Set(['erin']),
    blocked: new Set<string>(),
  }

  it('refuses non-connections and skips invited / going / muted', () => {
    const plan = planInvites(['bob', 'carl', 'dana', 'erin', 'zed'], facts)
    expect(plan.notConnected).toEqual(['zed'])
    expect(plan.send).toEqual(['bob'])
    expect(plan.skipped).toEqual([
      { uid: 'carl', reason: 'already_invited' },
      { uid: 'dana', reason: 'already_going' },
      // A mute is never named: just "unavailable".
      { uid: 'erin', reason: 'unavailable' },
    ])
  })

  it('validates friendIds', () => {
    expect(normalizeFriendIds(['a', 'a', 'b'], 'me')).toEqual(['a', 'b'])
    expect(normalizeFriendIds(['me'], 'me')).toBeNull()
    expect(normalizeFriendIds(['a/b'], 'me')).toBeNull()
    expect(normalizeFriendIds('a', 'me')).toBeNull()
    expect(normalizeFriendIds(Array.from({ length: 21 }, (_, i) => `u${i}`), 'me')).toBeNull()
  })

  it('makes and reads invite codes and cookies', () => {
    const code = inviteCodeFromBytes(new Uint8Array(16).map((_, i) => i * 37))
    expect(isValidInviteCode(code)).toBe(true)
    expect(isValidInviteCode('ABCDEFGH')).toBe(false)
    expect(inviteLinkUrl(code, 'ev1')).toBe(`https://www.tikem.co/i/${code}?e=ev1`)
    expect(parseInviteCookie(serializeInviteCookie(code, 'ev1'))).toEqual({ code, eventId: 'ev1' })
    expect(parseInviteCookie(serializeInviteCookie(code, null))).toEqual({ code, eventId: null })
    expect(parseInviteCookie('nope')).toBeNull()
    expect(inviteLandingPath('ev1')).toBe('/events/ev1')
    expect(inviteLandingPath(null)).toBe('/auth/signup')
  })

  it('applies attribution to the linked event any time, others within 30 days', () => {
    const attr = { inviter_uid: 'alice', event_id: 'ev1', claimed_at: new Date(NOW - 40 * 86400000) }
    expect(attributionApplies(attr, 'ev1', NOW)).toBe(true)
    expect(attributionApplies(attr, 'ev2', NOW)).toBe(false)
    expect(attributionApplies({ ...attr, claimed_at: new Date(NOW - 10 * 86400000) }, 'ev2', NOW)).toBe(true)
    expect(attributionApplies(null, 'ev1', NOW)).toBe(false)
  })

  it('treats only a young account as new', () => {
    expect(isNewAccount(new Date(NOW - 3600_000).toUTCString(), NOW)).toBe(true)
    expect(isNewAccount(new Date(NOW - 10 * 86400000).toUTCString(), NOW)).toBe(false)
    expect(isNewAccount(null, NOW)).toBe(false)
  })
})

// ── Event invites ───────────────────────────────────────────────────────────

describe('sendEventInvites', () => {
  const now = new Date(NOW)

  it('refuses the whole request when any target is not an accepted connection', async () => {
    const r = await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['bob', 'zed'] }, { now })
    expect(r.status).toBe('not_connected')
    expect(mockDb.docsIn('event_invites')).toHaveLength(0)
    expect(mockCreateNotification).not.toHaveBeenCalled()
  })

  it('refuses an unpublished, cancelled or ended event', async () => {
    event('draft', { is_published: false })
    event('gone', { status: 'cancelled' })
    event('past', { start_datetime: new Date(NOW - 3 * 86400000).toISOString() })
    for (const id of ['draft', 'gone', 'past']) {
      const r = await sendEventInvites({ inviterUid: 'alice', eventId: id, friendIds: ['bob'] }, { now })
      expect(r.status).toBe('event_unavailable')
    }
    expect((await sendEventInvites({ inviterUid: 'alice', eventId: 'nope', friendIds: ['bob'] }, { now })).status).toBe(
      'event_not_found'
    )
  })

  it('invites, skips going / muted / duplicates, and notifies', async () => {
    put('tickets/t1', { event_id: 'ev1', attendee_id: 'dana', status: 'confirmed' })
    await muteInviter('erin', 'alice', now)
    const r: any = await sendEventInvites(
      { inviterUid: 'alice', inviterName: 'Alice Pierre', eventId: 'ev1', friendIds: ['bob', 'dana', 'erin'] },
      { now }
    )
    expect(r.status).toBe('ok')
    expect(r.sent).toEqual(['bob'])
    expect(r.skipped).toEqual([
      { uid: 'dana', reason: 'already_going' },
      { uid: 'erin', reason: 'unavailable' },
    ])
    expect(mockDb.store.get('event_invites/ev1__alice__bob')).toMatchObject({
      event_id: 'ev1',
      inviter_uid: 'alice',
      target_uid: 'bob',
      status: 'sent',
    })
    // In-app notification with the first name only, deep link to the event.
    expect(mockCreateNotification).toHaveBeenCalledTimes(1)
    const [target, type, , body, url, meta] = (mockCreateNotification.mock.calls[0] as any[])
    expect([target, type, url]).toEqual(['bob', 'friend_invite', '/events/ev1'])
    expect(body).toMatch(/^Alice invited you to Kompa Night, \w+day$/)
    expect(meta).toMatchObject({ eventId: 'ev1', inviterId: 'alice' })
    expect(JSON.stringify(mockCreateNotification.mock.calls)).not.toMatch(/example\.com|\+509/)

    // A second request for the same friend is a duplicate, not a second invite.
    const again: any = await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['bob'] }, { now })
    expect(again).toEqual({ status: 'ok', sent: [], skipped: [{ uid: 'bob', reason: 'already_invited' }] })
    expect(mockCreateNotification).toHaveBeenCalledTimes(1)

    // Unmuted, erin can be invited again.
    await unmuteInviter('erin', 'alice')
    const third: any = await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['erin'] }, { now })
    expect(third.sent).toEqual(['erin'])
  })

  it('treats a block either way as "unavailable"', async () => {
    put('users/alice/blocked_organizers/bob', { organizer_id: 'bob' })
    put('users/carl/blocked_organizers/alice', { organizer_id: 'alice' })
    const r: any = await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['bob', 'carl'] }, { now })
    expect(r.sent).toEqual([])
    expect(r.skipped.map((s: any) => s.reason)).toEqual(['unavailable', 'unavailable'])
  })

  it('skips the push when the target turned friend invites off', async () => {
    user('bob', { notify_friend_invites: false })
    await sendEventInvites({ inviterUid: 'alice', inviterName: 'Alice', eventId: 'ev1', friendIds: ['bob'] }, { now })
    expect(mockCreateNotification).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('charges the per-event and per-day caps for the invites going out', async () => {
    await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['bob', 'carl'] }, { now })
    expect(mockConsume.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ key: 'invites:event:ev1:uid:alice', limit: INVITE_CAPS.perEventPerDay, cost: 2 }),
      expect.objectContaining({ key: 'invites:day:uid:alice', limit: INVITE_CAPS.perDay, cost: 2 }),
    ])
  })

  it('stops at either cap', async () => {
    mockConsume.mockImplementationOnce(async () => ({ limited: true }))
    expect((await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['bob'] }, { now })).status).toBe(
      'rate_limited'
    )
    mockConsume.mockImplementationOnce(async () => ({ limited: false })).mockImplementationOnce(async () => ({ limited: true }))
    expect((await sendEventInvites({ inviterUid: 'alice', eventId: 'ev1', friendIds: ['bob'] }, { now })).status).toBe(
      'rate_limited'
    )
    expect(mockDb.docsIn('event_invites')).toHaveLength(0)
  })

  it('picker lists only accepted connections, a mute reading as "unavailable"', async () => {
    put('tickets/t1', { event_id: 'ev1', attendee_id: 'dana', status: 'valid' })
    put('event_invites/ev1__alice__carl', { event_id: 'ev1', inviter_uid: 'alice', target_uid: 'carl', status: 'sent' })
    await muteInviter('erin', 'alice', now)
    const r: any = await getInvitePicker('alice', 'ev1', now)
    expect(r.ok).toBe(true)
    const byUid = Object.fromEntries(r.friends.map((f: any) => [f.uid, f.state]))
    expect(byUid).toEqual({ bob: 'available', carl: 'invited', dana: 'going', erin: 'unavailable' })
    expect(JSON.stringify(r.friends)).not.toMatch(/example\.com|\+509|muted/)
  })
})

describe('route guard', () => {
  const getUser = async () => ({ id: 'alice', full_name: 'Alice' })

  it('401 signed out, 404 feature_off when the switch is off', async () => {
    const out = await inviteGuard({ getUser: async () => null, flagOn: async () => true })
    expect((out as any).status).toBe(401)
    const off: any = await inviteGuard({ getUser, flagOn: async () => false })
    expect(off.status).toBe(404)
    expect(await off.json()).toMatchObject({ error: 'feature_off' })
  })

  it('maps send outcomes to status codes', async () => {
    const send = jest.fn()
    const deps = { getUser, flagOn: async () => true, send }
    expect((await handleSendInvites(deps, { friendIds: 'x' })).status).toBe(400)
    send.mockResolvedValueOnce({ status: 'not_connected' })
    expect((await handleSendInvites(deps, { friendIds: ['bob'] })).status).toBe(403)
    send.mockResolvedValueOnce({ status: 'rate_limited' })
    expect((await handleSendInvites(deps, { friendIds: ['bob'] })).status).toBe(429)
    send.mockResolvedValueOnce({ status: 'ok', sent: ['bob'], skipped: [] })
    const ok = await handleSendInvites(deps, { friendIds: ['bob'] })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, sent: ['bob'], skipped: [] })
  })
})

// ── Invite links and claims ─────────────────────────────────────────────────

describe('invite links', () => {
  it('gives each user one stable code', async () => {
    const codes = ['aaaaaaaa', 'bbbbbbbb']
    const gen = () => codes.shift() as string
    const first = await getOrCreateInviteCode('alice', gen)
    expect(first).toBe('aaaaaaaa')
    expect(await getOrCreateInviteCode('alice', gen)).toBe('aaaaaaaa')
    expect(mockDb.store.get('invite_codes/aaaaaaaa')).toMatchObject({ uid: 'alice' })
  })

  it('retries on a code collision', async () => {
    put('invite_codes/aaaaaaaa', { uid: 'someone' })
    const codes = ['aaaaaaaa', 'cccccccc']
    expect(await getOrCreateInviteCode('bob', () => codes.shift() as string)).toBe('cccccccc')
  })
})

describe('claimInvite', () => {
  const fresh = async () => new Date(NOW - 3600_000).toUTCString()
  beforeEach(() => {
    put('invite_codes/aaaaaaaa', { uid: 'alice' })
    user('newbie')
  })

  it('claims once, auto-connects and notifies the inviter', async () => {
    const r = await claimInvite({ uid: 'newbie', code: 'AAAAAAAA', eventId: 'ev1' }, { now: NOW, accountCreatedAt: fresh })
    expect(r).toEqual({ status: 'claimed', inviterUid: 'alice' })
    expect(mockDb.store.get('invite_attributions/newbie')).toMatchObject({
      inviter_uid: 'alice',
      code: 'aaaaaaaa',
      event_id: 'ev1',
    })
    expect(mockDb.store.get('connections/alice__newbie')).toMatchObject({ status: 'accepted' })
    expect(mockCreateNotification).toHaveBeenCalledWith(
      'alice',
      'invite_joined',
      expect.any(String),
      'Name joined Tikèm from your invite',
      '/profile/organizer/newbie',
      expect.objectContaining({ actorId: 'newbie' })
    )

    // Never overwritten, even by another inviter's code.
    put('invite_codes/bbbbbbbb', { uid: 'bob' })
    const again = await claimInvite({ uid: 'newbie', code: 'bbbbbbbb' }, { now: NOW, accountCreatedAt: fresh })
    expect(again.status).toBe('already_claimed')
    expect(mockDb.store.get('invite_attributions/newbie')).toMatchObject({ inviter_uid: 'alice' })
  })

  it('accepts a pending request rather than duplicating it', async () => {
    friends('newbie', 'alice', 'pending')
    await claimInvite({ uid: 'newbie', code: 'aaaaaaaa' }, { now: NOW, accountCreatedAt: fresh })
    expect(mockDb.store.get('connections/alice__newbie')).toMatchObject({ status: 'accepted' })
  })

  it('does not connect when either side blocked the other', async () => {
    put('users/alice/blocked_organizers/newbie', { organizer_id: 'newbie' })
    const r = await claimInvite({ uid: 'newbie', code: 'aaaaaaaa' }, { now: NOW, accountCreatedAt: fresh })
    expect(r.status).toBe('claimed')
    expect(mockDb.store.get('connections/alice__newbie')).toBeUndefined()
  })

  it('refuses old accounts, self-invites, unknown codes and drops unknown events', async () => {
    const old = async () => new Date(NOW - 30 * 86400000).toUTCString()
    expect((await claimInvite({ uid: 'newbie', code: 'aaaaaaaa' }, { now: NOW, accountCreatedAt: old })).status).toBe(
      'not_new'
    )
    expect((await claimInvite({ uid: 'alice', code: 'aaaaaaaa' }, { now: NOW, accountCreatedAt: fresh })).status).toBe(
      'self'
    )
    expect((await claimInvite({ uid: 'newbie', code: 'zzzzzzzz' }, { now: NOW, accountCreatedAt: fresh })).status).toBe(
      'invalid_code'
    )
    expect(mockDb.store.get('invite_attributions/newbie')).toBeUndefined()
    await claimInvite({ uid: 'newbie', code: 'aaaaaaaa', eventId: 'ghost' }, { now: NOW, accountCreatedAt: fresh })
    expect(mockDb.store.get('invite_attributions/newbie')).toMatchObject({ event_id: null })
  })
})

describe('GET /i/[code]', () => {
  const call = (path: string, code: string) =>
    inviteLinkGET(new Request(`https://www.tikem.co${path}`), { params: Promise.resolve({ code }) })

  beforeEach(() => put('invite_codes/aaaaaaaa', { uid: 'alice' }))

  it('sets the 30-day cookie and redirects to the event', async () => {
    const res = await call('/i/aaaaaaaa?e=ev1', 'aaaaaaaa')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://www.tikem.co/events/ev1')
    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).toContain(`${INVITE_COOKIE}=aaaaaaaa.ev1`)
    expect(cookie).toMatch(/Max-Age=2592000/)
    expect(cookie.toLowerCase()).toContain('httponly')
  })

  it('redirects to sign-up without an event', async () => {
    const res = await call('/i/aaaaaaaa', 'aaaaaaaa')
    expect(res.headers.get('location')).toBe('https://www.tikem.co/auth/signup')
    expect(res.headers.get('set-cookie')).toContain(`${INVITE_COOKIE}=aaaaaaaa`)
  })

  it('sets no cookie for an unknown code or with the switch off', async () => {
    expect((await call('/i/zzzzzzzz', 'zzzzzzzz')).headers.get('set-cookie')).toBeNull()
    mockFlag = false
    const off = await call('/i/aaaaaaaa?e=ev1', 'aaaaaaaa')
    expect(off.headers.get('set-cookie')).toBeNull()
    expect(off.headers.get('location')).toBe('https://www.tikem.co/events/ev1')
  })
})

// ── Purchase attribution ────────────────────────────────────────────────────

describe('recordInvitePurchase', () => {
  const tickets = (ids: string[], holder: string) =>
    ids.forEach((id) => put(`tickets/${id}`, { event_id: 'ev1', attendee_id: holder, status: 'valid' }))

  it('stamps tickets and the order from a joined-through-invite attribution', async () => {
    put('invite_attributions/newbie', { inviter_uid: 'alice', event_id: null, claimed_at: new Date(NOW - 5 * 86400000) })
    tickets(['t1', 't2'], 'newbie')
    const orderRef = mockDb.collection('stripe_orders').doc('pi_1')
    const inviter = await recordInvitePurchase({
      buyerUid: 'newbie',
      eventId: 'ev1',
      ticketIds: ['t1', 't2'],
      orderKey: 'pi_1',
      orderRefs: [orderRef],
      now: NOW,
    })
    expect(inviter).toBe('alice')
    expect(mockDb.store.get('tickets/t1')).toMatchObject({ invite_inviter_uid: 'alice', invite_source: 'invite_link' })
    expect(mockDb.store.get('tickets/t2')).toMatchObject({ invite_inviter_uid: 'alice' })
    expect(mockDb.store.get('stripe_orders/pi_1')).toMatchObject({ invite_inviter_uid: 'alice' })
    expect(mockDb.store.get('invite_purchases/ev1__newbie')).toMatchObject({ inviter_uid: 'alice', ticket_count: 2 })
  })

  it('falls back to the event invite and marks it purchased', async () => {
    put('event_invites/ev1__carl__bob', {
      event_id: 'ev1',
      inviter_uid: 'carl',
      target_uid: 'bob',
      status: 'sent',
      created_at: new Date(NOW - 86400000),
    })
    tickets(['t3'], 'bob')
    const inviter = await recordInvitePurchase({ buyerUid: 'bob', eventId: 'ev1', ticketIds: ['t3'], orderKey: 'o1', now: NOW })
    expect(inviter).toBe('carl')
    expect(mockDb.store.get('event_invites/ev1__carl__bob')).toMatchObject({ status: 'purchased' })
    expect(mockDb.store.get('tickets/t3')).toMatchObject({ invite_inviter_uid: 'carl', invite_source: 'event_invite' })
  })

  it('credits nobody outside the 30-day window, for guests, or with the switch off', async () => {
    put('invite_attributions/old', { inviter_uid: 'alice', event_id: 'other', claimed_at: new Date(NOW - 60 * 86400000) })
    tickets(['t4'], 'old')
    expect(await recordInvitePurchase({ buyerUid: 'old', eventId: 'ev1', ticketIds: ['t4'], orderKey: 'o', now: NOW })).toBeNull()
    expect(mockDb.store.get('tickets/t4')?.invite_inviter_uid).toBeUndefined()
    expect(await recordInvitePurchase({ buyerUid: 'guest_x', eventId: 'ev1', ticketIds: [], orderKey: 'o', now: NOW })).toBeNull()
    put('invite_attributions/newbie', { inviter_uid: 'alice', event_id: 'ev1', claimed_at: new Date(NOW) })
    mockFlag = false
    expect(await recordInvitePurchase({ buyerUid: 'newbie', eventId: 'ev1', ticketIds: [], orderKey: 'o', now: NOW })).toBeNull()
  })

  it('never throws into fulfilment', async () => {
    const boom = { set: () => Promise.reject(new Error('x')) }
    put('invite_attributions/newbie', { inviter_uid: 'alice', event_id: 'ev1', claimed_at: new Date(NOW) })
    await expect(
      recordInvitePurchase({
        buyerUid: 'newbie',
        eventId: 'ev1',
        ticketIds: [],
        orderKey: 'o',
        orderRefs: async () => {
          throw new Error('lookup failed')
        },
        now: NOW,
      })
    ).resolves.toBe('alice')
    await expect(
      recordInvitePurchase({ buyerUid: 'newbie', eventId: 'ev1', ticketIds: [], orderKey: 'o', orderRefs: [boom], now: NOW })
    ).resolves.toBe('alice')
  })
})

// ── Copy ────────────────────────────────────────────────────────────────────

describe('invite copy', () => {
  it('web and mobile locales carry the same invite keys in en/fr/ht, with no em-dashes', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const web = ['en', 'fr', 'ht'].map((l) => require(`../public/locales/${l}/common.json`).invites)
    const mobile = ['en', 'fr', 'ht'].map((l) => require(`../mobile/locales/${l}`).default.invites)
    /* eslint-enable @typescript-eslint/no-require-imports */
    for (const set of [web, mobile]) {
      const keys = Object.keys(set[0]).sort()
      set.forEach((s: Record<string, string>) => {
        expect(Object.keys(s).sort()).toEqual(keys)
        Object.values(s).forEach((v) => expect(v).not.toMatch(/—/))
      })
    }
  })
})

describe('mobile invite links', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { parseInviteUrl, whatsappPhone } = require('../mobile/lib/inviteLinkParse')
  /* eslint-enable @typescript-eslint/no-require-imports */

  it('reads the app scheme and the web link, with an optional event', () => {
    expect(parseInviteUrl('tikem://i/aaaaaaaa?e=ev1')).toEqual({ code: 'aaaaaaaa', eventId: 'ev1' })
    expect(parseInviteUrl('https://www.tikem.co/i/AAAAAAAA')).toEqual({ code: 'aaaaaaaa', eventId: null })
    expect(parseInviteUrl('https://tikem.co/i/aaaaaaaa/?utm=x&e=ev2')).toEqual({ code: 'aaaaaaaa', eventId: 'ev2' })
    expect(parseInviteUrl('tikem://events/ev1')).toBeNull()
    expect(parseInviteUrl('https://evil.co/i/aaaaaaaa')).toBeNull()
    expect(parseInviteUrl('tikem://i/short')).toBeNull()
  })

  it('only passes international numbers to WhatsApp', () => {
    expect(whatsappPhone('+509 37 00 0000')).toBe('50937000000')
    expect(whatsappPhone('3700 0000')).toBeNull()
  })
})
