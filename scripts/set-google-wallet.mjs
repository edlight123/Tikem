#!/usr/bin/env node
/**
 * Turn the Google Wallet button on or off for everyone, live (web + app), no
 * deploy and no app update: writes Firestore config/wallet.google_enabled,
 * which lib/wallet/config.ts isGoogleWalletOffered reads. Takes effect within
 * ~5 minutes (server cache 1 min, capability probe cached 5 at the edge).
 *
 * Turn it ON only after Google's email says publishing access is approved:
 * in demo mode a save fails for everyone but the console admin.
 *
 *   node scripts/set-google-wallet.mjs status
 *   node scripts/set-google-wallet.mjs on
 *   node scripts/set-google-wallet.mjs off
 */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const cmd = String(process.argv[2] || 'status').toLowerCase()
if (!['on', 'off', 'status'].includes(cmd)) {
  console.error('usage: node scripts/set-google-wallet.mjs on|off|status')
  process.exit(1)
}

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const ref = admin.firestore().collection('config').doc('wallet')

if (cmd !== 'status') {
  await ref.set(
    { google_enabled: cmd === 'on', updated_at: new Date().toISOString() },
    { merge: true },
  )
}
const now = (await ref.get()).data() || {}
console.log(`Google Wallet button: ${now.google_enabled === true ? 'ON' : 'OFF'}`)
process.exit(0)
