/**
 * What a verified phone number turns into: an account to sign in to, or a
 * number added to the account already signed in.
 *
 * New accounts get their `users/{uid}` profile from createUserProfileAdmin,
 * the same server-side writer the profile page uses, plus the two fields
 * every client signup path seeds (role, is_verified). No second schema.
 */

import { createUserProfileAdmin } from '@/lib/firestore/user-profile-admin'
import type { OtpLocale } from './senders'
import { profileCompletion } from '@/lib/auth/account/completion'

/** The slice of firebase-admin's Auth used here (keeps tests honest). */
export interface PhoneAuthAdmin {
  getUserByPhoneNumber(phone: string): Promise<{ uid: string; disabled?: boolean; phoneNumber?: string; email?: string }>
  getUser(uid: string): Promise<{ uid: string; phoneNumber?: string }>
  createUser(props: { phoneNumber: string }): Promise<{ uid: string }>
  updateUser(uid: string, props: { phoneNumber: string }): Promise<unknown>
  createCustomToken(uid: string, claims?: Record<string, unknown>): Promise<string>
}

export interface ProfileWriter {
  exists(uid: string): Promise<boolean>
  create(uid: string, e164: string, locale: OtpLocale, country: string): Promise<void>
  setPhone(uid: string, e164: string): Promise<void>
  /** Does this account still need a name or an email before entering the app? */
  needsProfile?(uid: string, authEmail: string | null): Promise<boolean>
}

export function adminProfileWriter(db: any): ProfileWriter {
  return {
    async exists(uid) {
      const snap = await db.collection('users').doc(uid).get()
      return Boolean(snap.exists)
    },
    async create(uid, e164, locale, country) {
      await createUserProfileAdmin(uid, {
        phone: e164,
        language: locale,
        defaultCountry: ['HT', 'US', 'CA', 'FR', 'DO'].includes(country) ? country : 'HT',
      })
      await db.collection('users').doc(uid).set(
        { role: 'attendee', is_verified: false, phone_verified: true },
        { merge: true }
      )
    },
    async needsProfile(uid, authEmail) {
      const snap = await db.collection('users').doc(uid).get()
      const d = snap.exists ? snap.data() || {} : {}
      const c = profileCompletion({
        fullName: d.full_name,
        authEmail,
        pendingEmail: d.pending_email,
      })
      return c.needsName || c.needsEmail
    },
    async setPhone(uid, e164) {
      await db.collection('users').doc(uid).set(
        { phone: e164, phone_number: e164, phone_verified: true, updated_at: new Date().toISOString() },
        { merge: true }
      )
    },
  }
}

const isCode = (err: unknown, code: string) => (err as { code?: string })?.code === code

export type SignInResolution =
  | { ok: true; uid: string; token: string; isNewUser: boolean; needsProfile: boolean }
  | { ok: false; code: 'account_disabled' }

/** Find the account for a verified number, or create one, then mint a token. */
export async function signInVerifiedPhone(params: {
  auth: PhoneAuthAdmin
  profiles: ProfileWriter
  e164: string
  country: string
  locale: OtpLocale
}): Promise<SignInResolution> {
  const { auth, profiles, e164, country, locale } = params
  let uid: string
  let isNewUser = false
  let authEmail: string | null = null

  try {
    const existing = await auth.getUserByPhoneNumber(e164)
    if (existing.disabled) return { ok: false, code: 'account_disabled' }
    uid = existing.uid
    authEmail = existing.email ?? null
  } catch (err) {
    if (!isCode(err, 'auth/user-not-found')) throw err
    try {
      uid = (await auth.createUser({ phoneNumber: e164 })).uid
      isNewUser = true
    } catch (createErr) {
      // Lost a race with a concurrent sign-in or link for the same number.
      if (!isCode(createErr, 'auth/phone-number-already-exists')) throw createErr
      uid = (await auth.getUserByPhoneNumber(e164)).uid
    }
  }

  // Seed the profile for a new account, and heal one an older bug left without.
  if (isNewUser || !(await profiles.exists(uid))) {
    await profiles.create(uid, e164, locale, country)
  }

  const token = await auth.createCustomToken(uid)
  // The app gates on the profile itself; this lets the web send the person
  // straight to the completion page.
  const needsProfile =
    isNewUser || (profiles.needsProfile ? await profiles.needsProfile(uid, authEmail).catch(() => false) : false)
  return { ok: true, uid, token, isNewUser, needsProfile }
}

export type LinkResolution =
  | { ok: true; phoneNumber: string }
  | { ok: false; code: 'phone_already_set' }
  /** ownerUid is set when the number is on another account (the merge flow needs it). */
  | { ok: false; code: 'phone_in_use'; ownerUid?: string }

/**
 * Add a verified number to the signed-in account. Refuses a number that
 * belongs to another account, and refuses to silently REPLACE a different
 * number already on this one (that would remove a sign-in method).
 */
export async function linkVerifiedPhone(params: {
  auth: PhoneAuthAdmin
  profiles: ProfileWriter
  uid: string
  e164: string
}): Promise<LinkResolution> {
  const { auth, profiles, uid, e164 } = params

  const current = await auth.getUser(uid)
  if (current.phoneNumber === e164) {
    await profiles.setPhone(uid, e164)
    return { ok: true, phoneNumber: e164 }
  }
  if (current.phoneNumber) return { ok: false, code: 'phone_already_set' }

  try {
    const owner = await auth.getUserByPhoneNumber(e164)
    if (owner.uid !== uid) return { ok: false, code: 'phone_in_use', ownerUid: owner.uid }
  } catch (err) {
    if (!isCode(err, 'auth/user-not-found')) throw err
  }

  try {
    await auth.updateUser(uid, { phoneNumber: e164 })
  } catch (err) {
    if (isCode(err, 'auth/phone-number-already-exists')) {
      const owner = await auth.getUserByPhoneNumber(e164).catch(() => null)
      return { ok: false, code: 'phone_in_use', ownerUid: owner?.uid }
    }
    throw err
  }
  await profiles.setPhone(uid, e164)
  return { ok: true, phoneNumber: e164 }
}
