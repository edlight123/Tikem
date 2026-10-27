#!/usr/bin/env node
/**
 * Count App Store downloads from the daily Sales reports: first-time
 * downloads, redownloads and updates per day, plus a total by country.
 *
 * Apple publishes a day's report the next morning (Pacific), so today never
 * shows; a day with no activity returns 404 and is counted as zero.
 *
 * Usage:
 *   ASC_ISSUER_ID=<uuid> ASC_KEY_ID=<kid> ASC_KEY_PATH=<path.p8> \
 *   ASC_VENDOR_NUMBER=<vendor #> node scripts/asc-downloads.mjs [days=30]
 *
 * The vendor number is in App Store Connect → Payments and Financial Reports
 * (top left). The API key needs the Sales and Reports (or Finance/Admin) role.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import zlib from 'node:zlib'

const APP_ID = process.env.ASC_APP_ID || '6794334427'
const ISSUER_ID = process.env.ASC_ISSUER_ID
const KEY_ID = process.env.ASC_KEY_ID
const KEY_PATH = (process.env.ASC_KEY_PATH || '').replace(/^~/, os.homedir())
const VENDOR = process.env.ASC_VENDOR_NUMBER
const DAYS = Number(process.argv[2]) || 30

if (!ISSUER_ID || !KEY_ID || !KEY_PATH || !VENDOR) {
  console.error('Missing ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH, or ASC_VENDOR_NUMBER')
  process.exit(1)
}

const now = Math.floor(Date.now() / 1000)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const signingInput = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({
  iss: ISSUER_ID,
  iat: now,
  exp: now + 900,
  aud: 'appstoreconnect-v1',
})}`
const token = `${signingInput}.${crypto
  .createSign('SHA256')
  .update(signingInput)
  .sign({ key: fs.readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' })
  .toString('base64url')}`

// Product Type Identifier → bucket (iOS/iPadOS/macOS/tvOS app codes).
const KIND = {
  1: 'new', '1F': 'new', '1T': 'new', 'F1': 'new',
  3: 'redownload', '3F': 'redownload', '3T': 'redownload', 'F3': 'redownload',
  7: 'update', '7F': 'update', '7T': 'update', 'F7': 'update',
}

async function dailyReport(date) {
  const qs = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': VENDOR,
    'filter[reportDate]': date,
  })
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
  })
  if (res.status === 404) return [] // no activity that day, or not published yet
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}\n${await res.text()}`)
  const tsv = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')
  const [header, ...rows] = tsv.trim().split('\n')
  const cols = header.split('\t')
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v])))
}

const totals = { new: 0, redownload: 0, update: 0 }
const byCountry = {}
console.log(`\nApp ${APP_ID}, last ${DAYS} day(s):\n`)
console.log('date        new  redl  upd')

for (let d = DAYS; d >= 1; d--) {
  const date = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10)
  const day = { new: 0, redownload: 0, update: 0 }
  for (const row of await dailyReport(date)) {
    if (row['Apple Identifier'] !== APP_ID) continue
    const kind = KIND[row['Product Type Identifier']]
    if (!kind) continue
    const units = Number(row.Units) || 0
    day[kind] += units
    if (kind === 'new') byCountry[row['Country Code']] = (byCountry[row['Country Code']] || 0) + units
  }
  for (const k in day) totals[k] += day[k]
  console.log(`${date}  ${String(day.new).padStart(4)}  ${String(day.redownload).padStart(4)}  ${String(day.update).padStart(4)}`)
}

console.log(`\nTOTAL  first-time downloads: ${totals.new}  redownloads: ${totals.redownload}  updates: ${totals.update}`)
const countries = Object.entries(byCountry).sort((a, b) => b[1] - a[1])
if (countries.length) console.log(`by country: ${countries.map(([c, n]) => `${c} ${n}`).join(', ')}`)
