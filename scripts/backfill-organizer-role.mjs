/**
 * One-time fix (2026-11-17): every account that owns an event but still has
 * role "attendee" becomes an organizer, so it can open organizer mode in the
 * app (sales, scanning, messages). Before the app started calling
 * /api/account/become-organizer after a first save, an attendee could publish
 * an event and then had no way to manage it (SANTA PIANO).
 *
 * Only attendee -> organizer. Organizers, admins and missing user docs are
 * left alone. Dry run by default; pass --apply to write.
 *
 *   node scripts/backfill-organizer-role.mjs           # list only
 *   node scripts/backfill-organizer-role.mjs --apply   # write
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const admin = require('firebase-admin')

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
let raw = env
  .split('\n')
  .find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
  .slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length)
  .trim()
if (raw.startsWith("'") || raw.startsWith('"')) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const apply = process.argv.includes('--apply')

const events = await db.collection('events').select('organizer_id', 'title').get()
const owners = new Map()
for (const d of events.docs) {
  const id = String(d.get('organizer_id') || '')
  if (!id) continue
  if (!owners.has(id)) owners.set(id, [])
  owners.get(id).push(String(d.get('title') || d.id))
}

const ids = [...owners.keys()]
const toFix = []
for (let i = 0; i < ids.length; i += 300) {
  const refs = ids.slice(i, i + 300).map((id) => db.collection('users').doc(id))
  const docs = await db.getAll(...refs)
  for (const u of docs) {
    if (!u.exists) continue
    const role = String(u.get('role') || 'attendee')
    if (role === 'attendee') toFix.push({ id: u.id, events: owners.get(u.id) })
  }
}

console.log(`${events.size} events, ${owners.size} owners, ${toFix.length} still attendee`)
for (const f of toFix) console.log(`  ${f.id}  (${f.events.length}) ${f.events.slice(0, 3).join(' | ')}`)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to make them organizers.')
  process.exit(0)
}

for (const f of toFix) {
  await db.collection('users').doc(f.id).update({ role: 'organizer', updated_at: new Date() })
}
console.log(`\nUpdated ${toFix.length} account(s) to organizer.`)
process.exit(0)
