#!/usr/bin/env node
/**
 * Remove `bio` from every public_profiles/{uid} doc.
 *
 * public_profiles is readable by any signed-in user, and until 2026-10-25 the
 * profile sync copied the personal bio there, so a PRIVATE person's bio was
 * readable past the privacy check. New writes no longer copy it
 * (lib/firestore/public-profile-fields.ts, mobile/lib/publicProfile.ts) and
 * nothing reads it from there; bios are served by
 * /api/profiles/[uid]/public-details with the privacy rule applied.
 *
 * Dry run by default (counts only). Pass --apply to delete the field.
 *
 *   node scripts/cleanup-public-profile-bio.mjs          # dry run
 *   node scripts/cleanup-public-profile-bio.mjs --apply  # delete
 */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const APPLY = process.argv.includes('--apply')

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const snap = await db.collection('public_profiles').get()
const withBio = snap.docs.filter((d) => d.get('bio') !== undefined)
console.log(`public_profiles: ${snap.size} docs, ${withBio.length} carry a bio`)

if (!APPLY) {
  console.log('Dry run: nothing changed. Re-run with --apply to remove the field.')
  process.exit(0)
}

let done = 0
for (let i = 0; i < withBio.length; i += 400) {
  const batch = db.batch()
  for (const d of withBio.slice(i, i + 400)) batch.update(d.ref, { bio: admin.firestore.FieldValue.delete() })
  await batch.commit()
  done += Math.min(400, withBio.length - i)
}
console.log(`Removed bio from ${done} public_profiles docs.`)
process.exit(0)
