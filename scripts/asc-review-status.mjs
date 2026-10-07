#!/usr/bin/env node
/**
 * Read-only: where is the iOS app in App Store review?
 *
 * Prints every App Store version with its state, the build attached to it,
 * the review submissions (and their items), and the latest TestFlight builds.
 * GET requests only, nothing is changed.
 *
 *   node scripts/asc-review-status.mjs
 *
 * Auth: same ASC API key as asc-apply-metadata.mjs (ASC_KEY_ID / ASC_ISSUER_ID /
 * ASC_KEY_PATH, defaulting to ~/Downloads/AuthKey_<id>.p8).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'app-store', 'metadata.json'), 'utf8'))
const APP_ID = meta.app.appId
const API = 'https://api.appstoreconnect.apple.com'

const KEY_ID = process.env.ASC_KEY_ID || 'XA7DX3A8Z8'
const ISSUER = process.env.ASC_ISSUER_ID || '0eddb34e-a05b-4930-8418-7f60a80d0f04'
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(os.homedir(), 'Downloads', `AuthKey_${KEY_ID}.p8`)

function token() {
  const now = Math.floor(Date.now() / 1000)
  const key = fs.readFileSync(KEY_PATH, 'utf8')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${unsigned}.${sig}`
}

const TOKEN = token()
async function get(p) {
  const res = await fetch(API + p, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status}: ${(json.errors || []).map((e) => e.detail).join(' | ')}`)
  return json
}
const day = (s) => (s ? s.replace('T', ' ').slice(0, 16) + ' UTC' : '-')

const versions = await get(`/v1/apps/${APP_ID}/appStoreVersions?limit=10&include=build`)
const builds = Object.fromEntries((versions.included || []).filter((x) => x.type === 'builds').map((b) => [b.id, b.attributes.version]))
console.log('== App Store versions')
for (const v of versions.data) {
  const a = v.attributes
  const b = v.relationships?.build?.data?.id
  console.log(`  ${a.platform} ${a.versionString}  state=${a.appStoreState}  build=${b ? builds[b] || b : 'none'}  created=${day(a.createdDate)}  release=${a.releaseType}`)
}

const subs = await get(`/v1/reviewSubmissions?filter[app]=${APP_ID}&limit=10&include=items`)
console.log('\n== Review submissions')
if (!subs.data.length) console.log('  (none)')
for (const s of subs.data) {
  const a = s.attributes
  console.log(`  ${s.id}  state=${a.state}  platform=${a.platform}  submitted=${day(a.submittedDate)}`)
}
for (const it of (subs.included || []).filter((x) => x.type === 'reviewSubmissionItems')) {
  console.log(`    item ${it.id}  state=${it.attributes.state}`)
}

const tf = await get(`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=5`)
console.log('\n== Latest builds')
for (const b of tf.data) {
  const a = b.attributes
  console.log(`  build ${a.version}  processing=${a.processingState}  uploaded=${day(a.uploadedDate)}  expired=${a.expired}`)
}
