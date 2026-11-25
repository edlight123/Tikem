/**
 * Phone-account onboarding and account merges (lib/auth/account).
 *
 * Covers: the completion rule (name + email before entering the app); the
 * profile/email routes; an email that belongs to another account opening a
 * merge; the merge job itself (every person-level collection, idempotent
 * retries, the lease, tickets never lost); the organizer-money safeguard
 * (admin review instead of a merge); the phone link route offering a merge;
 * and phone sign-in landing on the merged account (no duplicate).
 *
 * Nothing talks to Firebase, Resend or Meta: Auth is faked, Firestore is the
 * in-memory FakeFirestore, codes go to DevLogSender.
 *
 * @jest-environment node
 */

jest.mock('server-only', () => ({}))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {} }))
jest.mock('@/lib/firestore/user-profile-admin', () => ({ createUserProfileAdmin: jest.fn(async () => {}) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => 'n1') }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn(async () => {}) }))
jest.mock('@/lib/email', () => ({ escapeHtml: (s: string) => s, sendEmail: jest.fn(async () => ({ success: true })) }))

import { FakeFirestore } from './helpers/fakeFirestore'
import { DevLogSender } from '@/lib/auth/otp/senders'
import { memoryOtpStore } from '@/lib/auth/otp/store'
import { signInVerifiedPhone, linkVerifiedPhone, type ProfileWriter } from '@/lib/auth/otp/users'
import { handleLinkStart, handleLinkVerify, type PhoneAuthDeps } from '@/lib/auth/otp/handlers'
import { profileCompletion, composeFullName, normalizeEmail } from '@/lib/auth/account/completion'
import { runAccountMerge, assessMerge, orgFootprint, MERGES, MERGE_REVIEWS } from '@/lib/auth/account/merge'
import {
  handleCompleteProfile,
  handleEmailStart,
  handleEmailVerify,
  handleEmailLater,
  handleMerge,
  openMergeSession,
  MERGE_SESSIONS,
  type AccountDeps,
} from '@/lib/auth/account/handlers'
import { profileCompletion as mobileCompletion } from '../mobile/lib/profileCompletion'

const SECRET = 'test-secret-test-secret-test-secret-1234'
const PHONE = '+50937123456'
const T0 = Date.UTC(2026, 10, 25, 12, 0, 0)
const FRESH = T0 / 1000 - 60
const STALE = T0 / 1000 - 3600

// ── Fakes ───────────────────────────────────────────────────────────────────

type U = { uid: string; email?: string; emailVerified?: boolean; phoneNumber?: string; disabled?: boolean }

function fakeAuth(initial: U[]) {
  const users = new Map(initial.map((u) => [u.uid, { ...u }]))
  const err = (code: string) => Object.assign(new Error(code), { code })
  let n = 0
  const revoked: string[] = []
  const auth = {
    users,
    revoked,
    async getUser(uid: string) {
      const u = users.get(uid)
      if (!u) throw err('auth/user-not-found')
      return { ...u }
    },
    async getUserByEmail(email: string) {
      const u = Array.from(users.values()).find((x) => x.email === email)
      if (!u) throw err('auth/user-not-found')
      return { ...u }
    },
    async getUserByPhoneNumber(phone: string) {
      const u = Array.from(users.values()).find((x) => x.phoneNumber === phone)
      if (!u) throw err('auth/user-not-found')
      return { ...u }
    },
    async createUser({ phoneNumber }: { phoneNumber: string }) {
      if (Array.from(users.values()).some((x) => x.phoneNumber === phoneNumber)) throw err('auth/phone-number-already-exists')
      const uid = `new${++n}`
      users.set(uid, { uid, phoneNumber })
      return { uid }
    },
    async updateUser(uid: string, props: Record<string, any>) {
      const u = users.get(uid)
      if (!u) throw err('auth/user-not-found')
      if (props.email && Array.from(users.values()).some((x) => x.email === props.email && x.uid !== uid)) {
        throw err('auth/email-already-exists')
      }
      if (props.phoneNumber && Array.from(users.values()).some((x) => x.phoneNumber === props.phoneNumber && x.uid !== uid)) {
        throw err('auth/phone-number-already-exists')
      }
      if ('phoneNumber' in props && props.phoneNumber === null) delete u.phoneNumber
      else if (props.phoneNumber) u.phoneNumber = props.phoneNumber
      if (props.email) u.email = props.email
      if ('emailVerified' in props) u.emailVerified = props.emailVerified
      if ('disabled' in props) u.disabled = props.disabled
    },
    async revokeRefreshTokens(uid: string) {
      revoked.push(uid)
    },
    async createCustomToken(uid: string) {
      return `token-for-${uid}`
    },
  }
  return auth
}

function world() {
  const db = new FakeFirestore()
  const auth = fakeAuth([
    { uid: 'phone', phoneNumber: PHONE },
    { uid: 'email', email: 'ana@example.com', emailVerified: true },
  ])
  db.store.set('users/phone', { role: 'attendee', full_name: 'Ana Joseph', phone_number: PHONE, photo_url: 'https://p/ana.jpg' })
  db.store.set('users/email', { role: 'attendee', full_name: '', email: 'ana@example.com', created_at: '2025-01-01' })
  return { db, auth }
}

function seedPersonData(db: FakeFirestore) {
  // Tickets on both sides: all must end up on the target.
  db.store.set('tickets/t1', { user_id: 'phone', attendee_id: 'phone', event_id: 'e1', status: 'valid' })
  db.store.set('tickets/t2', { user_id: 'phone', event_id: 'e2', status: 'confirmed' })
  db.store.set('tickets/t3', { user_id: 'email', event_id: 'e3', status: 'valid' })
  db.store.set('pending_transactions/o1', { user_id: 'phone', status: 'completed' })
  db.store.set('guest_orders/g1', { claimed_by_uid: 'phone' })
  db.store.set('ticket_transfers/x1', { from_user_id: 'phone', to_user_id: 'friend' })
  // Same event favorited on both: one survives.
  db.store.set('event_favorites/f1', { user_id: 'phone', event_id: 'e9' })
  db.store.set('event_favorites/f2', { user_id: 'email', event_id: 'e9' })
  db.store.set('event_favorites/f3', { user_id: 'phone', event_id: 'e10' })
  db.store.set('organizer_follows/fo1', { follower_id: 'phone', organizer_id: 'orgA' })
  db.store.set('connections/friend__phone', { users: ['friend', 'phone'], requester_id: 'phone', recipient_id: 'friend', status: 'accepted' })
  db.store.set('reviews/r1', { user_id: 'phone', event_id: 'e1' })
  db.store.set('users/phone/fcmTokens/tok1', { token: 'ExponentPushToken[x]' })
  db.store.set('users/phone/notifications/n1', { title: 'hi' })
  // Team member (not owner) on someone else's org, and door staff on an event.
  db.store.set('organizers/orgB/team/phone', { uid: 'phone', role: 'manager', status: 'active' })
  db.store.set('users/phone/org_memberships/orgB', { org_id: 'orgB', role: 'manager', org_name: 'B' })
  db.store.set('events/e5/members/phone', { uid: 'phone', role: 'staff' })
}

const merge = (db: FakeFirestore, auth: any, over: Partial<Parameters<typeof runAccountMerge>[2]> = {}) =>
  runAccountMerge(db, auth, {
    sourceUid: 'phone',
    targetUid: 'email',
    reason: 'phone_account_added_email',
    proofs: { source: 'fresh_signin', target: 'email_code' },
    requestedBy: 'phone',
    now: new Date(T0),
    ...over,
  })

// ── Completion rule ─────────────────────────────────────────────────────────

describe('profile completion', () => {
  it('a new phone account needs a name and an email', () => {
    expect(profileCompletion({ fullName: '', authEmail: null, pendingEmail: null })).toEqual({
      needsName: true,
      needsEmail: true,
      emailUnverified: false,
    })
  })

  it('"Verify later" satisfies the gate but leaves the reminder on', () => {
    expect(profileCompletion({ fullName: 'Ana J', authEmail: null, pendingEmail: 'a@b.co' })).toEqual({
      needsName: false,
      needsEmail: false,
      emailUnverified: true,
    })
  })

  it('an email/Google/Apple account only ever needs a name', () => {
    expect(profileCompletion({ fullName: '  ', authEmail: 'a@b.co' })).toEqual({
      needsName: true,
      needsEmail: false,
      emailUnverified: false,
    })
  })

  it('the app and the web agree', () => {
    for (const input of [
      { fullName: '', authEmail: null, pendingEmail: null },
      { fullName: 'X Y', authEmail: null, pendingEmail: 'a@b.co' },
      { fullName: 'X Y', authEmail: 'a@b.co', pendingEmail: null },
    ]) {
      expect(mobileCompletion(input)).toEqual(profileCompletion(input))
    }
  })

  it('names and emails are validated', () => {
    expect(composeFullName('  Ana ', ' Joseph  ')).toEqual({ first: 'Ana', last: 'Joseph', full: 'Ana Joseph' })
    expect(composeFullName('Ana', '')).toBeNull()
    expect(composeFullName('<b>', 'x')).toBeNull()
    expect(composeFullName('a'.repeat(51), 'x')).toBeNull()
    expect(normalizeEmail(' Ana@Example.COM ')).toBe('ana@example.com')
    expect(normalizeEmail('nope')).toBeNull()
  })
})

// ── The merge job ───────────────────────────────────────────────────────────

describe('runAccountMerge', () => {
  it('moves every person-level record onto the target and retires the source', async () => {
    const { db, auth } = world()
    seedPersonData(db)
    const out = await merge(db, auth)
    expect(out.status).toBe('completed')

    // Tickets: both of the phone account's, plus the target's own.
    const owners = ['t1', 't2', 't3'].map((id) => db.store.get(`tickets/${id}`)!.user_id)
    expect(owners).toEqual(['email', 'email', 'email'])
    expect(db.store.get('tickets/t1')!.attendee_id).toBe('email')
    expect(db.store.get('tickets/t1')!.merged_from_uid).toBe('phone')
    expect(db.store.get('pending_transactions/o1')!.user_id).toBe('email')
    expect(db.store.get('guest_orders/g1')!.claimed_by_uid).toBe('email')
    expect(db.store.get('ticket_transfers/x1')!.from_user_id).toBe('email')

    // Favorites: the duplicate is dropped, the new one moves.
    expect(db.store.has('event_favorites/f1')).toBe(false)
    expect(db.store.get('event_favorites/f3')!.user_id).toBe('email')
    expect(db.store.get('organizer_follows/fo1')!.follower_id).toBe('email')

    // Friendship re-keyed onto the target pair id.
    expect(db.store.has('connections/friend__phone')).toBe(false)
    expect(db.store.get('connections/email__friend')!.users).toEqual(['email', 'friend'])
    expect(db.store.get('connections/email__friend')!.requester_id).toBe('email')

    expect(db.store.get('reviews/r1')!.user_id).toBe('email')
    expect(db.store.get('users/email/fcmTokens/tok1')).toBeTruthy()
    expect(db.store.has('users/phone/fcmTokens/tok1')).toBe(false)
    expect(db.store.get('users/email/notifications/n1')).toBeTruthy()

    // Team seat and door-staff seat follow the person.
    expect(db.store.get('organizers/orgB/team/email')).toMatchObject({ uid: 'email', role: 'manager' })
    expect(db.store.has('organizers/orgB/team/phone')).toBe(false)
    expect(db.store.get('users/email/org_memberships/orgB')).toMatchObject({ org_id: 'orgB', role: 'manager' })
    expect(db.store.get('events/e5/members/email')).toMatchObject({ uid: 'email' })
    expect(db.store.has('events/e5/members/phone')).toBe(false)

    // Profile: the empty name and photo are filled; the phone lands on the target.
    expect(db.store.get('users/email')).toMatchObject({ full_name: 'Ana Joseph', photo_url: 'https://p/ana.jpg', phone_number: PHONE })
    expect(db.store.get('public_profiles/email')).toMatchObject({ full_name: 'Ana Joseph' })

    // Auth: phone moved, source disabled and signed out everywhere.
    expect(auth.users.get('email')!.phoneNumber).toBe(PHONE)
    expect(auth.users.get('phone')!.phoneNumber).toBeUndefined()
    expect(auth.users.get('phone')!.disabled).toBe(true)
    expect(auth.revoked).toContain('phone')
    expect(db.store.get('users/phone')).toMatchObject({ account_status: 'merged', merged_into: 'email' })

    // Audit record: status + counts, no phone number.
    const audit = db.store.get(`${MERGES}/phone__email`)!
    expect(audit).toMatchObject({ status: 'completed', reason: 'phone_account_added_email', phone_moved: true })
    expect(audit.counts.tickets).toBe(2)
    expect(JSON.stringify(audit)).not.toContain(PHONE)
  })

  it('is idempotent: a retry after completion changes nothing', async () => {
    const { db, auth } = world()
    seedPersonData(db)
    await merge(db, auth)
    const before = JSON.stringify(Array.from(db.store.entries()))
    const again = await merge(db, auth)
    expect(again).toMatchObject({ status: 'completed', alreadyDone: true })
    expect(JSON.stringify(Array.from(db.store.entries()))).toBe(before)
  })

  it('finishes a merge that crashed part-way (tickets are never lost)', async () => {
    const { db, auth } = world()
    seedPersonData(db)
    const realUpdate = auth.updateUser
    let failOnce = true
    auth.updateUser = async (uid: string, props: any) => {
      if (failOnce && 'phoneNumber' in props) {
        failOnce = false
        throw new Error('network')
      }
      return realUpdate(uid, props)
    }
    await expect(merge(db, auth)).rejects.toThrow('network')
    // Data already moved; the phone account still signs in.
    expect(db.store.get('tickets/t1')!.user_id).toBe('email')
    expect(auth.users.get('phone')!.disabled).toBeUndefined()
    // The lease is still held; once it lapses the retry completes.
    expect((await merge(db, auth)).status).toBe('busy')
    const out = await merge(db, auth, { now: new Date(T0 + 3 * 60 * 1000) })
    expect(out.status).toBe('completed')
    expect(auth.users.get('email')!.phoneNumber).toBe(PHONE)
    expect(auth.users.get('phone')!.disabled).toBe(true)
  })

  it('stops at needs_review when the source owns an organization with events', async () => {
    const { db, auth } = world()
    db.store.set('organizers/phone', { business_name: 'Phone Events' })
    db.store.set('events/ev1', { organizer_id: 'phone', title: 'Konpa' })
    db.store.set('organizers/email', { business_name: 'Email Events' })
    db.store.set('events/ev2', { organizer_id: 'email', title: 'Rara' })
    db.store.set('tickets/t1', { user_id: 'phone', event_id: 'x' })

    const out = await merge(db, auth)
    expect(out).toMatchObject({ status: 'needs_review' })
    expect((out as any).reasons).toEqual(expect.arrayContaining(['source_org_has_events', 'both_accounts_are_organizers']))
    const review = db.store.get(`${MERGE_REVIEWS}/phone__email`)!
    expect(review).toMatchObject({ status: 'pending', source_uid: 'phone', target_uid: 'email' })
    // Nothing moved, nobody disabled.
    expect(db.store.get('tickets/t1')!.user_id).toBe('phone')
    expect(auth.users.get('phone')!.disabled).toBeUndefined()
    expect(db.store.get(`${MERGES}/phone__email`)!.status).toBe('needs_review')
  })

  it('stops at needs_review for payout settings or a promoter wallet on the source', async () => {
    const { db, auth } = world()
    db.store.set('organizers/phone/payoutDestinations/d1', { method: 'moncash' })
    expect((await merge(db, auth)).status).toBe('needs_review')
    const w = world()
    w.db.store.set('promoter_wallets/phone', { withdrawn_by_currency: {} })
    expect((await merge(w.db, w.auth)).status).toBe('needs_review')
  })

  it('merges when only the TARGET is an organizer; the target stays the org owner', async () => {
    const { db, auth } = world()
    db.store.set('organizers/email', { business_name: 'Email Events', stripe_account_id: 'acct_1' })
    db.store.set('events/ev2', { organizer_id: 'email' })
    db.store.set('tickets/t1', { user_id: 'phone', event_id: 'ev2' })
    expect((await merge(db, auth)).status).toBe('completed')
    expect(db.store.get('events/ev2')!.organizer_id).toBe('email')
    expect(db.store.get('organizers/email')!.stripe_account_id).toBe('acct_1')
    expect(db.store.get('tickets/t1')!.user_id).toBe('email')
  })

  it('an empty organizer profile on the source does not block', async () => {
    const { db, auth } = world()
    db.store.set('organizers/phone', { business_name: '' })
    expect(orgFootprint(db, 'phone')).resolves.toMatchObject({ hasOrgDoc: true, events: 0, money: [] })
    expect((await merge(db, auth)).status).toBe('completed')
  })

  it('refuses when the target already has a different phone number', async () => {
    const { db, auth } = world()
    auth.users.get('email')!.phoneNumber = '+50937000000'
    expect(await merge(db, auth)).toMatchObject({ status: 'blocked', code: 'target_has_other_phone' })
  })

  it('refuses a merge into itself or into a disabled account', async () => {
    const { db, auth } = world()
    expect(await assessMerge(db, auth, 'phone', 'phone')).toMatchObject({ ok: false, code: 'same_account' })
    auth.users.get('email')!.disabled = true
    expect(await assessMerge(db, auth, 'phone', 'email')).toMatchObject({ ok: false, code: 'account_disabled' })
  })

  it('after the merge, phone sign-in lands on the target (no second account)', async () => {
    const { db, auth } = world()
    await merge(db, auth)
    const profiles: ProfileWriter = {
      exists: async () => true,
      create: jest.fn(async () => {}),
      setPhone: async () => {},
    }
    const r = await signInVerifiedPhone({ auth: auth as any, profiles, e164: PHONE, country: 'HT', locale: 'en' })
    expect(r).toMatchObject({ ok: true, uid: 'email', isNewUser: false })
    expect(profiles.create).not.toHaveBeenCalled()
    expect(auth.users.size).toBe(2)
  })
})

// ── Routes ──────────────────────────────────────────────────────────────────

function req(uid: string | null, body: unknown, ip = '5.5.5.5') {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': ip }
  if (uid) headers.authorization = `Bearer idtoken-${uid}`
  return new Request('https://www.tikem.co/api/account/x', { method: 'POST', headers, body: JSON.stringify(body) })
}

function accountDeps(over: Partial<AccountDeps> = {}, authTimes: Record<string, number> = {}) {
  const { db, auth } = world()
  const store = memoryOtpStore()
  const counters = new Map<string, number>()
  const d: AccountDeps = {
    enabled: async () => true,
    db: () => db,
    auth: () => auth as any,
    store: () => store,
    emailSender: () => new DevLogSender({ NODE_ENV: 'test' }),
    caller: async (t) => {
      if (!t.startsWith('idtoken-')) return null
      const uid = t.slice('idtoken-'.length)
      return { uid, authTime: authTimes[uid] ?? FRESH }
    },
    rateLimit: async (key, limit) => {
      const n = (counters.get(key) || 0) + 1
      counters.set(key, n)
      return { limited: n > limit }
    },
    ipKey: (r) => r.headers.get('x-forwarded-for') || 'unknown',
    onMerged: jest.fn(async () => {}),
    secret: () => SECRET,
    now: () => T0,
    ...over,
  }
  return { d, db, auth, store }
}

async function sendAndVerify(d: AccountDeps, uid: string, email: string) {
  const start = await handleEmailStart(req(uid, { email, locale: 'fr' }), d)
  const started = await start.json()
  const code = DevLogSender.lastCode(email)!
  const res = await handleEmailVerify(req(uid, { email, code }), d)
  return { started, res, body: await res.json() }
}

describe('account routes', () => {
  beforeEach(() => DevLogSender.sent.clear())

  it('email + merge routes answer 404 while phone sign-in is off', async () => {
    const { d } = accountDeps({ enabled: async () => false })
    for (const h of [handleEmailStart, handleEmailVerify, handleEmailLater, handleMerge]) {
      expect((await h(req('phone', {}), d)).status).toBe(404)
    }
  })

  it('every route needs a bearer ID token and JSON', async () => {
    const { d } = accountDeps()
    expect((await handleCompleteProfile(req(null, { firstName: 'A', lastName: 'B' }), d)).status).toBe(401)
    const form = new Request('https://www.tikem.co/x', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer idtoken-phone' },
      body: 'a=b',
    })
    expect((await handleEmailStart(form, d)).status).toBe(415)
  })

  it('profile/complete writes the name to users and public_profiles', async () => {
    const { d, db } = accountDeps()
    expect((await handleCompleteProfile(req('phone', { firstName: 'Ana', lastName: '' }), d)).status).toBe(400)
    const res = await handleCompleteProfile(req('phone', { firstName: ' Ana ', lastName: 'Joseph' }), d)
    expect(res.status).toBe(200)
    expect(db.store.get('users/phone')).toMatchObject({ first_name: 'Ana', last_name: 'Joseph', full_name: 'Ana Joseph' })
    expect(db.store.get('public_profiles/phone')).toEqual({ full_name: 'Ana Joseph' })
  })

  it('a new email is verified and attached to the phone account', async () => {
    const { d, db, auth } = accountDeps()
    const { started, res, body } = await sendAndVerify(d, 'phone', 'new@example.com')
    expect(started).toMatchObject({ ok: true, taken: false })
    expect(DevLogSender.sent.get('new@example.com')!.locale).toBe('fr')
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'attached', email: 'new@example.com' })
    expect(auth.users.get('phone')).toMatchObject({ email: 'new@example.com', emailVerified: true })
    expect(db.store.get('users/phone')).toMatchObject({ email: 'new@example.com', email_verified: true, pending_email: null })
  })

  it('a wrong code does not attach anything', async () => {
    const { d, auth } = accountDeps()
    await handleEmailStart(req('phone', { email: 'new@example.com' }), d)
    const res = await handleEmailVerify(req('phone', { email: 'new@example.com', code: '000000' === DevLogSender.lastCode('new@example.com') ? '111111' : '000000' }), d)
    expect(res.status).toBe(400)
    expect(auth.users.get('phone')!.email).toBeUndefined()
  })

  it("another account's code cannot verify this one", async () => {
    const { d } = accountDeps()
    await handleEmailStart(req('phone', { email: 'new@example.com' }), d)
    const code = DevLogSender.lastCode('new@example.com')!
    const res = await handleEmailVerify(req('someone', { email: 'new@example.com', code }), d)
    expect(res.status).toBe(400)
  })

  it('an account that already has an email cannot use this to change it', async () => {
    const { d } = accountDeps()
    const res = await handleEmailStart(req('email', { email: 'other@example.com' }), d)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('email_already_set')
  })

  it('a taken email says so, then the verified code opens a merge into the email account', async () => {
    const { d, db, auth } = accountDeps()
    seedPersonData(db)
    const { started, body } = await sendAndVerify(d, 'phone', 'ana@example.com')
    expect(started.taken).toBe(true)
    expect(body.status).toBe('merge_available')
    expect(body.mergeId).toMatch(/^[a-f0-9]{36}$/)
    const session = db.store.get(`${MERGE_SESSIONS}/${body.mergeId}`)!
    expect(session).toMatchObject({ caller_uid: 'phone', source_uid: 'phone', target_uid: 'email' })
    // Nothing merged yet: the person confirms first.
    expect(db.store.get('tickets/t1')!.user_id).toBe('phone')

    const res = await handleMerge(req('phone', { mergeId: body.mergeId }), d)
    expect(res.status).toBe(200)
    const merged = await res.json()
    // The caller's own account is retired: it gets a sign-in for the target.
    expect(merged).toMatchObject({ status: 'merged', targetUid: 'email', token: 'token-for-email' })
    expect(db.store.get('tickets/t1')!.user_id).toBe('email')
    expect(auth.users.get('email')!.phoneNumber).toBe(PHONE)
    expect(d.onMerged).toHaveBeenCalledWith('email', PHONE)
  })

  it('a merge needs a fresh sign-in by the caller', async () => {
    const { d, db } = accountDeps({}, { phone: STALE })
    const { body } = await sendAndVerify(d, 'phone', 'ana@example.com')
    const res = await handleMerge(req('phone', { mergeId: body.mergeId }), d)
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('reauth_required')
    expect(db.store.get(`${MERGES}/phone__email`)).toBeUndefined()
  })

  it('a merge session is bound to the account that opened it and expires', async () => {
    const { d, db } = accountDeps()
    const { body } = await sendAndVerify(d, 'phone', 'ana@example.com')
    expect((await handleMerge(req('email', { mergeId: body.mergeId }), d)).status).toBe(404)
    expect((await handleMerge(req('phone', { mergeId: 'f'.repeat(36) }), d)).status).toBe(404)
    const late = { ...d, now: () => T0 + 16 * 60 * 1000 }
    expect((await handleMerge(req('phone', { mergeId: body.mergeId }), late)).status).toBe(404)
    expect(db.store.get('users/phone')!.merged_into).toBeUndefined()
  })

  it('merge is rate limited per account', async () => {
    const { d } = accountDeps()
    let last = 0
    for (let i = 0; i < 11; i++) last = (await handleMerge(req('phone', { mergeId: 'f'.repeat(36) }), d)).status
    expect(last).toBe(429)
  })

  it('an organizer on the phone side gets needs_review and an admin review item, never a merge', async () => {
    const { d, db, auth } = accountDeps()
    db.store.set('organizers/phone', { business_name: 'P' })
    db.store.set('events/ev1', { organizer_id: 'phone' })
    db.store.set('organizers/email', { business_name: 'E' })
    db.store.set('events/ev2', { organizer_id: 'email' })
    const { body } = await sendAndVerify(d, 'phone', 'ana@example.com')
    expect(body.status).toBe('needs_review')
    expect(body.mergeId).toBeUndefined()
    expect(db.store.get(`${MERGE_REVIEWS}/phone__email`)).toMatchObject({ status: 'pending' })
    expect(auth.users.get('phone')!.disabled).toBeUndefined()
  })

  it('"Verify later" parks the address unverified, but never an address another account owns', async () => {
    const { d, db, auth } = accountDeps()
    const taken = await handleEmailLater(req('phone', { email: 'ana@example.com' }), d)
    expect(taken.status).toBe(409)
    expect((await taken.json()).code).toBe('email_taken')
    const res = await handleEmailLater(req('phone', { email: 'Later@Example.com' }), d)
    expect(res.status).toBe(200)
    expect(db.store.get('users/phone')).toMatchObject({ pending_email: 'later@example.com', email_verified: false })
    // Not on the sign-in identity until verified.
    expect(auth.users.get('phone')!.email).toBeUndefined()
  })
})

// ── Phone on an email account (link route) ──────────────────────────────────

describe('adding a phone that belongs to another account', () => {
  it('link/verify answers phone_in_use with a merge session into the signed-in account', async () => {
    const { d: acct, db, auth } = accountDeps()
    seedPersonData(db)
    const store = memoryOtpStore()
    const phoneDeps: PhoneAuthDeps = {
      enabled: async () => true,
      store: () => store,
      sender: () => new DevLogSender({ NODE_ENV: 'test' }),
      auth: () => auth as any,
      profiles: () => ({ exists: async () => true, create: async () => {}, setPhone: async () => {} }),
      bearerUid: async (t) => (t.startsWith('idtoken-') ? t.slice(8) : null),
      secret: () => SECRET,
      allowedCountries: () => ['HT'],
      onPhoneInUse: (callerUid, ownerUid) =>
        openMergeSession(acct, {
          callerUid,
          sourceUid: ownerUid,
          targetUid: callerUid,
          reason: 'account_added_phone',
          proofs: { source: 'phone_code', target: 'fresh_signin' },
        }),
    }
    DevLogSender.sent.clear()
    expect((await handleLinkStart(req('email', { phone: PHONE }), phoneDeps)).status).toBe(200)
    const code = DevLogSender.lastCode(PHONE)!
    const res = await handleLinkVerify(req('email', { phone: PHONE, code }), phoneDeps)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'phone_in_use', mergeStatus: 'merge_available' })

    const merged = await handleMerge(req('email', { mergeId: body.mergeId }), acct)
    expect(merged.status).toBe(200)
    const m = await merged.json()
    // The caller is the target: no token, it stays signed in.
    expect(m).toMatchObject({ status: 'merged', targetUid: 'email' })
    expect(m.token).toBeUndefined()
    expect(auth.users.get('email')!.phoneNumber).toBe(PHONE)
    expect(auth.users.get('phone')!.disabled).toBe(true)
    expect(db.store.get('tickets/t2')!.user_id).toBe('email')

    // And the number now signs straight into the email account.
    const profiles: ProfileWriter = { exists: async () => true, create: jest.fn(async () => {}), setPhone: async () => {} }
    expect(await signInVerifiedPhone({ auth: auth as any, profiles, e164: PHONE, country: 'HT', locale: 'en' })).toMatchObject({
      ok: true,
      uid: 'email',
      isNewUser: false,
    })
  })

  it('linkVerifiedPhone reports who owns the number', async () => {
    const { auth } = world()
    const r = await linkVerifiedPhone({
      auth: auth as any,
      profiles: { exists: async () => true, create: async () => {}, setPhone: async () => {} },
      uid: 'email',
      e164: PHONE,
    })
    expect(r).toEqual({ ok: false, code: 'phone_in_use', ownerUid: 'phone' })
  })
})

describe('phone sign-in reports whether the profile is complete', () => {
  it('new accounts and nameless accounts need the completion step', async () => {
    const { auth } = world()
    const profiles: ProfileWriter = {
      exists: async () => true,
      create: async () => {},
      setPhone: async () => {},
      needsProfile: async (_uid, authEmail) => !authEmail,
    }
    const fresh = await signInVerifiedPhone({ auth: auth as any, profiles, e164: '+50937000001', country: 'HT', locale: 'en' })
    expect(fresh).toMatchObject({ ok: true, isNewUser: true, needsProfile: true })
    const known = await signInVerifiedPhone({ auth: auth as any, profiles, e164: PHONE, country: 'HT', locale: 'en' })
    expect(known).toMatchObject({ ok: true, isNewUser: false, needsProfile: true })
  })
})
