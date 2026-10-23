// Backfill the organizer brand (organization_name + organization_logo) into
// its canonical home, public_profiles/{uid} (lib/profile/org-brand.ts).
//
// Before 2026-10-22 the two apps kept it in different places: the web
// organization settings wrote organizers/{uid}, the app wrote users/{uid} and
// mirrored public_profiles/{uid}. So a logo set on one side never showed on
// the other. Both now write the canonical place; this copies what each
// account already has there.
//
// For each field, per account:
//   - public_profiles already has a non-empty value: kept as is.
//   - otherwise the users/{uid} value, else the organizers/{uid} value.
//     An organizers value is skipped when users/{uid} explicitly holds ''
//     and was updated more recently: that is a logo/name removed in the app,
//     which cannot write organizers/{uid}, so the old one is still there.
//   - the chosen value is written to public_profiles AND to users/{uid}
//     (the copy installed app builds still read).
// Nothing is ever cleared or deleted, and organizers/{uid} is not touched.
// Idempotent: a second run finds nothing to do.
//
//   node scripts/backfill-org-brand.mjs --dry    preview every change
//   node scripts/backfill-org-brand.mjs          write
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const DRY = process.argv.includes('--dry')
const FIELDS = ['organization_name', 'organization_logo']

const str = (v) => (typeof v === 'string' ? v.trim() : null)

function toMillis(v) {
  if (!v) return 0
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (v instanceof Date) return v.getTime()
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** The value the canonical field should hold, or null to leave it alone. */
function choose(field, pub, user, org) {
  const canonical = str(pub?.[field])
  if (canonical) return null
  const fromUser = str(user?.[field])
  if (fromUser) return fromUser
  const fromOrg = str(org?.[field])
  if (!fromOrg) return null
  const removedInApp = fromUser === '' && toMillis(user?.updated_at) > toMillis(org?.updated_at)
  return removedInApp ? null : fromOrg
}

// Every account that might carry a brand: anyone with an organizers doc, and
// any users doc with a brand field set.
const ids = new Set()
for (const d of (await db.collection('organizers').select().get()).docs) ids.add(d.id)
for (const field of FIELDS) {
  const snap = await db.collection('users').where(field, '>', '').select().get()
  for (const d of snap.docs) ids.add(d.id)
}
console.log(`${ids.size} candidate account(s)${DRY ? ' (dry run)' : ''}`)

const all = Array.from(ids)
let changed = 0
for (let i = 0; i < all.length; i += 100) {
  const chunk = all.slice(i, i + 100)
  const refs = chunk.flatMap((id) => [
    db.collection('public_profiles').doc(id),
    db.collection('users').doc(id),
    db.collection('organizers').doc(id),
  ])
  const snaps = await db.getAll(...refs)
  const batch = db.batch()
  let writes = 0
  chunk.forEach((id, j) => {
    const [pub, user, org] = snaps.slice(j * 3, j * 3 + 3).map((s) => (s.exists ? s.data() : null))
    const pubPatch = {}
    const userPatch = {}
    for (const field of FIELDS) {
      const value = choose(field, pub, user, org)
      if (value != null) pubPatch[field] = value
      // Keep the users copy in step with the canonical value, so installed
      // app builds that only read users/{uid} show it too.
      const target = value ?? str(pub?.[field])
      if (target && user && str(user[field]) !== target) userPatch[field] = target
    }
    if (!Object.keys(pubPatch).length && !Object.keys(userPatch).length) return
    changed += 1
    console.log(id, JSON.stringify({ public_profiles: pubPatch, users: userPatch }))
    if (DRY) return
    if (Object.keys(pubPatch).length) {
      batch.set(db.collection('public_profiles').doc(id), pubPatch, { merge: true })
      writes += 1
    }
    if (Object.keys(userPatch).length) {
      // No updated_at bump: this is a copy, not an edit by the owner.
      batch.set(db.collection('users').doc(id), userPatch, { merge: true })
      writes += 1
    }
  })
  if (writes) await batch.commit()
}

console.log(`${changed} account(s) ${DRY ? 'would change' : 'updated'}`)
