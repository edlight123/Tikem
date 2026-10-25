// One-off: set the MonCash MERCHANT account number printed on Digicel funding
// letters (config/payouts.prefundingPlan.digicel.merchantAccountNumber), with
// the same before/after audit entry the super-admin settings form writes.
//
//   node scripts/set-prefunding-merchant-account.mjs 50934617779 --dry
//   node scripts/set-prefunding-merchant-account.mjs 50934617779
//
// Source: Digicel "REQUEST FORM PANTHEON SERVICES" (17 June 2026), "Moncash
// Merchant / Biller account", confirmed by the owner on 2026-10-25.
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const value = String(process.argv[2] || '').replace(/\s+/g, '')
const DRY = process.argv.includes('--dry')
if (!/^\d{8,15}$/.test(value)) {
  console.error('usage: node scripts/set-prefunding-merchant-account.mjs <digits> [--dry]')
  process.exit(1)
}

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const ref = db.collection('config').doc('payouts')
const snap = await ref.get()
const before = snap.data()?.prefundingPlan?.digicel?.merchantAccountNumber ?? ''
console.log(`merchantAccountNumber: "${before}" -> "${value}"${DRY ? ' (dry run)' : ''}`)
if (DRY || before === value) process.exit(0)

await ref.set({ prefundingPlan: { digicel: { merchantAccountNumber: value } } }, { merge: true })
const nowIso = new Date().toISOString()
await db.collection('admin_audit_log').add({
  action: 'moncash.prefunding_settings.update',
  adminId: 'script:set-prefunding-merchant-account',
  adminEmail: 'owner-confirmed',
  resourceId: 'config/payouts.prefundingPlan.digicel',
  resourceType: 'config',
  details: {
    changed: ['merchantAccountNumber'],
    diff: { merchantAccountNumber: { before, after: value } },
    source: 'Digicel REQUEST FORM PANTHEON SERVICES (2026-06-17), owner-confirmed 2026-10-25',
  },
  timestamp: nowIso,
  timestampMs: Date.now(),
})
console.log('saved + audited')
process.exit(0)
