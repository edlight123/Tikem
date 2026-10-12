// The showcase events' organizer displayed as "EdLight Initiative"; organizers
// must only ever see Tikèm. Sets the organization brand (which overrides the
// personal name wherever an organizer is shown) on the user doc and its
// public_profiles mirror. `--dry` prints the current value only.
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const ORGANIZER_ID = '2Rc7Gq8M19OL4ZNP2RGQyFeDjEA2' // the demo organizer of every showcase event
const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice(7) || 'Tikèm'
const DRY = process.argv.includes('--dry')

const user = (await db.collection('users').doc(ORGANIZER_ID).get()).data() || {}
console.log('now:', { full_name: user.full_name, organization_name: user.organization_name })
if (!DRY) {
  const patch = { organization_name: NAME, updated_at: admin.firestore.FieldValue.serverTimestamp() }
  await db.collection('users').doc(ORGANIZER_ID).set(patch, { merge: true })
  await db.collection('public_profiles').doc(ORGANIZER_ID).set({ organization_name: NAME }, { merge: true })
  console.log('set organization_name to', NAME)
}
process.exit(0)
