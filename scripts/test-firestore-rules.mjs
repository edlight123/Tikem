// Test firestore.rules WITHOUT the emulator (no Java on this machine) by sending
// the ruleset to the Firebase Rules test API, which evaluates it server-side and
// never deploys it.
//
// Auth: the Admin service account does NOT have firebaserules.rulesets.test, so
// this uses the logged-in gcloud user (info@edlight.org). User ADC also needs an
// explicit quota project, hence the x-goog-user-project header — without it the
// API returns a confusing PERMISSION_DENIED that reads like a missing role.
//
//   node scripts/test-firestore-rules.mjs
//
// Run this before `firebase deploy --only firestore:rules`. The case that matters
// most is "edit a LIVE event without touching publication": the publish clause
// compares the FULL resulting document, so a clause that is slightly too strict
// stops organizers editing any published event at all.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// The Admin service account lacks firebaserules.rulesets.test; the logged-in
// user has it. Needs an explicit quota project for user ADC.
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim()
const project = 'event-haiti'

const source = { files: [{ name: 'firestore.rules', content: readFileSync('firestore.rules', 'utf8') }] }
const ORG = 'org_owner'
const NOW = new Date().toISOString()
const P = '/databases/(default)/documents/events/evt_1'

const base = { organizer_id: ORG, country: 'US', currency: 'USD', rejected: false, reports_count: 0 }
const doc = (d) => ({ data: { ...base, ...d } })

const cases = [
  ['create a DRAFT event', 'ALLOW', { method: 'create', resource: doc({ is_published: false }) }],
  ['create with is_published absent', 'ALLOW', { method: 'create', resource: doc({}) }],
  ['create an ALREADY-PUBLISHED event', 'DENY', { method: 'create', resource: doc({ is_published: true }) }],

  ['publish: false -> true', 'DENY',
    { method: 'update', resource: doc({ is_published: true }), _old: doc({ is_published: false }) }],
  ['unpublish: true -> false', 'ALLOW',
    { method: 'update', resource: doc({ is_published: false }), _old: doc({ is_published: true }) }],
  ['edit a LIVE event without touching publication', 'ALLOW',
    { method: 'update', resource: doc({ is_published: true, title: 'new' }), _old: doc({ is_published: true, title: 'old' }) }],
  ['edit a DRAFT without touching publication', 'ALLOW',
    { method: 'update', resource: doc({ is_published: false, title: 'new' }), _old: doc({ is_published: false, title: 'old' }) }],
  ['legacy doc with NO is_published field, edited', 'ALLOW',
    { method: 'update', resource: doc({ title: 'new' }), _old: doc({ title: 'old' }) }],
  ['legacy doc: absent -> true', 'DENY',
    { method: 'update', resource: doc({ is_published: true }), _old: doc({ title: 'old' }) }],
  ['still cannot flip moderation flags', 'DENY',
    { method: 'update', resource: doc({ is_published: false, rejected: false }), _old: doc({ is_published: false, rejected: true }) }],
  ['a DIFFERENT organizer cannot unpublish your event', 'DENY',
    { method: 'update', resource: { data: { ...base, organizer_id: ORG, is_published: false } }, _old: doc({ is_published: true }), _uid: 'someone_else' }],
]

const testCases = cases.map(([, expectation, c]) => ({
  expectation,
  request: {
    auth: { uid: c._uid || ORG, token: { email_verified: true } },
    path: P,
    method: c.method,
    time: NOW,
    resource: c.resource,
  },
  ...(c._old ? { resource: c._old } : {}),
}))

const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'x-goog-user-project': project,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ source, testSuite: { testCases } }),
})
const out = await res.json()
if (!res.ok) { console.error('API error:', JSON.stringify(out, null, 2)); process.exit(1) }

if (out.issues?.length) {
  console.error('RULES COMPILE ISSUES:')
  for (const i of out.issues) console.error(' ', i.severity, i.description, `(line ${i.sourcePosition?.line})`)
  process.exit(1)
}
console.log('Rules compiled with no issues.\n')

let pass = 0, fail = 0
out.testResults.forEach((r, i) => {
  const [name, expectation] = cases[i]
  const ok = r.state === 'SUCCESS'
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  [expect ${expectation}] ${name}`)
  if (!ok && r.errorPosition) console.log(`        line ${r.errorPosition.line}`)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
