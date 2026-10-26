#!/usr/bin/env node
/**
 * Read-only: why can't a team member act for an org? Shows the member's team
 * row(s) in the owner's org, open invites to them, and the membership mirror
 * that drives the "Acting for" switcher. Changes nothing.
 *
 *   node scripts/diagnose-team-member.mjs <owner-email> <member-email>
 */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const [ownerEmail, memberEmail] = process.argv.slice(2).map((s) => String(s || '').trim().toLowerCase())
if (!ownerEmail || !memberEmail) {
  console.error('usage: node scripts/diagnose-team-member.mjs <owner-email> <member-email>')
  process.exit(1)
}

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const iso = (v) => v?.toDate?.()?.toISOString?.() ?? v ?? null
async function account(email) {
  try {
    const u = await admin.auth().getUserByEmail(email)
    const p = (await db.collection('users').doc(u.uid).get()).data() || {}
    return { uid: u.uid, providers: u.providerData.map((x) => x.providerId), role: p.role || null, verifiedEmail: u.emailVerified }
  } catch {
    return null
  }
}

const owner = await account(ownerEmail)
const member = await account(memberEmail)
console.log('owner :', owner)
console.log('member:', member)
if (!owner) process.exit(0)

const team = await db.collection('organizers').doc(owner.uid).collection('team').get()
const rows = team.docs.filter((d) => String(d.get('email') || '').toLowerCase() === memberEmail || (member && d.id === member.uid))
console.log(`\nteam rows for ${memberEmail}: ${rows.length}`)
for (const d of rows) {
  const x = d.data()
  console.log({ docId: d.id, keyedByUid: member ? d.id === member.uid : false, uid: x.uid || null, role: x.role, status: x.status, finance_view: x.finance_view ?? null, joined_at: iso(x.joined_at) })
}

const inv = await db.collection('org_team_invites').where('org_id', '==', owner.uid).where('email', '==', memberEmail).get()
console.log(`\ninvites: ${inv.size}`)
for (const d of inv.docs) {
  const x = d.data()
  console.log({ id: d.id, role: x.role, accepted_at: iso(x.accepted_at), revoked_at: iso(x.revoked_at), expires_at: iso(x.expires_at) })
}

if (member) {
  const mirror = await db.collection('users').doc(member.uid).collection('org_memberships').doc(owner.uid).get()
  console.log('\nswitcher mirror (users/{member}/org_memberships/{owner}):', mirror.exists ? mirror.data() : 'MISSING')
}
process.exit(0)
