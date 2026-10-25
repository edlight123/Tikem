#!/usr/bin/env node
/**
 * Read-only: why can't <email> sign in? Prints how the Firebase Auth account
 * was created (password, Google, Apple, phone), whether it is disabled or
 * verified, when it last signed in, and whether a users/{uid} profile exists.
 * Changes nothing.
 *
 *   node scripts/lookup-auth-user.mjs someone@example.com
 */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const email = String(process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('usage: node scripts/lookup-auth-user.mjs <email>')
  process.exit(1)
}

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })

try {
  const u = await admin.auth().getUserByEmail(email)
  const profile = await admin.firestore().collection('users').doc(u.uid).get()
  console.log({
    exists: true,
    uid: u.uid,
    providers: u.providerData.map((p) => p.providerId),
    hasPassword: u.providerData.some((p) => p.providerId === 'password'),
    disabled: u.disabled,
    emailVerified: u.emailVerified,
    created: u.metadata.creationTime,
    lastSignIn: u.metadata.lastSignInTime,
    profileDoc: profile.exists,
    role: profile.exists ? profile.get('role') || null : null,
  })
} catch (e) {
  if (e?.code === 'auth/user-not-found') console.log({ exists: false, note: 'No Tikèm account with this email: sign up first.' })
  else throw e
}
process.exit(0)
