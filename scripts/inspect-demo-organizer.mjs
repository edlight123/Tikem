// Read-only: the App Review demo organizer's identity verification state.
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'
const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if (raw.startsWith("'") || raw.startsWith('"')) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()
const email = process.argv[2] || 'appreview.organizer@tikem.co'
const u = await admin.auth().getUserByEmail(email)
const uid = u.uid
const user = (await db.collection('users').doc(uid).get()).data() || {}
const org = (await db.collection('organizers').doc(uid).get()).data() || {}
const reqs = await db.collection('verification_requests').where('userId', '==', uid).get().catch(() => ({ docs: [] }))
const byId = await db.collection('verification_requests').doc(uid).get()
console.log({ uid, user_is_verified: user.is_verified, user_verification_status: user.verification_status, org_is_verified: org.is_verified, org_verification_status: org.verification_status, default_country: user.default_country })
for (const d of [byId, ...reqs.docs].filter((d) => d && d.exists)) {
  const r = d.data()
  console.log('request', d.id, { status: r.status, hasIdFront: Boolean(r.files?.governmentId?.front), hasSelfie: Boolean(r.files?.selfie?.path || r.files?.selfie), submittedAt: r.submittedAt?.toDate?.() || r.submittedAt, reviewedAt: r.reviewedAt?.toDate?.() || r.reviewedAt })
}
const prof = await db.collection('organizers').doc(uid).collection('payoutProfiles').get().catch(() => ({ docs: [] }))
for (const d of prof.docs) console.log('payoutProfile', d.id, { status: d.data().status, method: d.data().method })
process.exit(0)
