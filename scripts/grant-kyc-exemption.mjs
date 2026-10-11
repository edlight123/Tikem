// Adds (or revokes with --revoke) a KYC exemption for an internal account.
//   node scripts/grant-kyc-exemption.mjs appreview.organizer@tikem.co "App Store / Play review demo organizer"
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'
const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if (raw.startsWith("'") || raw.startsWith('"')) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const [email, reason] = process.argv.slice(2).filter((a) => a !== '--revoke')
const revoke = process.argv.includes('--revoke')
if (!email || (!revoke && !reason)) { console.error('usage: <email> "<reason>" [--revoke]'); process.exit(1) }
const { uid } = await admin.auth().getUserByEmail(email)
const ref = admin.firestore().collection('kyc_exemptions').doc(uid)
if (revoke) { await ref.delete(); console.log('revoked', uid) }
else { await ref.set({ active: true, reason, email, grantedAt: admin.firestore.FieldValue.serverTimestamp(), grantedBy: 'scripts/grant-kyc-exemption.mjs' }); console.log('granted', uid) }
process.exit(0)
