// Read-only: which hosts (and Storage buckets) the images on events, users,
// public profiles and organizations actually live on. Run before tightening
// next.config images.remotePatterns so no live image breaks.
//   node scripts/audit-image-hosts.mjs
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'
const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
let raw = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY=')).slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const IMAGE_KEY = /(image|img|logo|photo|avatar|cover|banner|poster|picture|flyer|thumb)/i
const hosts = new Map() // host -> { count, buckets: Map, fields: Set, collections: Set }

function note(url, field, coll) {
  let u
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (!/^https?:$/.test(u.protocol)) return
  const h = hosts.get(u.hostname) || { count: 0, buckets: new Map(), fields: new Set(), collections: new Set() }
  h.count++
  h.fields.add(field)
  h.collections.add(coll)
  let bucket = null
  if (u.hostname === 'firebasestorage.googleapis.com') bucket = u.pathname.split('/')[3] || null
  else if (u.hostname === 'storage.googleapis.com') bucket = u.pathname.split('/')[1] || null
  if (bucket) h.buckets.set(bucket, (h.buckets.get(bucket) || 0) + 1)
  hosts.set(u.hostname, h)
}

function walk(v, path, coll, depth = 0) {
  if (depth > 4 || v == null) return
  if (typeof v === 'string') {
    if (/^https?:\/\//i.test(v) && IMAGE_KEY.test(path)) note(v, path.replace(/\.\d+/g, '[]'), coll)
    return
  }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}.${i}`, coll, depth + 1))
  if (typeof v === 'object' && typeof v.toDate !== 'function') {
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, coll, depth + 1)
  }
}

const SKIP = new Set(['rate_limits', 'server_cache', 'pushDispatchLogs', 'notifications', 'event_views', 'audit_logs'])
const all = (await db.listCollections()).map((c) => c.id).filter((c) => !SKIP.has(c))
for (const coll of all) {
  let n = 0
  let last = null
  for (;;) {
    let q = db.collection(coll).orderBy(admin.firestore.FieldPath.documentId()).limit(500)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    snap.docs.forEach((d) => walk(d.data(), '', coll))
    n += snap.size
    last = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }
  console.log(`${coll}: ${n} docs scanned`)
}

console.log('\nhost'.padEnd(42), 'refs', ' collections / fields / buckets')
for (const [host, h] of [...hosts.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(
    host.padEnd(41),
    String(h.count).padStart(5),
    ' ',
    [...h.collections].join(','),
    '|',
    [...h.fields].slice(0, 6).join(','),
    h.buckets.size ? '| ' + [...h.buckets.entries()].map(([b, c]) => `${b}(${c})`).join(', ') : ''
  )
}
process.exit(0)
