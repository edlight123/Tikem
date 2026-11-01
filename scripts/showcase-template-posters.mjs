// Template posters for the showcase events, plus a new showcase batch.
//
// The seeded showcase events carried bare stock photos with no text on them,
// which read as stock imagery next to a real designed flyer. This gives each
// one a poster drawn from a template (lib/posters/templates) with its own
// title, date, venue and lineup, and seeds a new batch that uses them too.
//
// Posters are drawn by the website (GET /api/posters/preview?full=1), so run
// it after the template code is deployed. Each event keeps its original photo
// in poster_original_url, so --revert puts every poster back exactly.
//
//   node scripts/showcase-template-posters.mjs --dry             list the plan
//   node scripts/showcase-template-posters.mjs                   apply + seed new batch
//   node scripts/showcase-template-posters.mjs --revert          restore photos, delete new batch
//   node scripts/showcase-template-posters.mjs --preview <dir>   draw the NEW batch's posters
//                                                                into <dir>; no database access
//
// POSTER_BASE overrides the site that draws them (default https://www.tikem.co).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

const DRY = process.argv.includes('--dry')
const REVERT = process.argv.includes('--revert')
const previewIdx = process.argv.indexOf('--preview')
const PREVIEW_DIR = previewIdx > -1 ? process.argv[previewIdx + 1] : null
const BASE = process.env.POSTER_BASE || 'https://www.tikem.co'

const ORGANIZER_ID = '2Rc7Gq8M19OL4ZNP2RGQyFeDjEA2' // the demo organizer ("Tikèm")
const NEW_BATCH = 'haiti-showcase-2026-11'
const ACCESS_CODE = 'tikem'
const photo = (id) => `https://images.unsplash.com/photo-${id}?w=1200&h=1500&fit=crop&q=80`

// ---------------------------------------------------------------------------
// The new batch. Fictional artists (no real act is implied to be booked).
// Haiti is UTC-5 from Nov 1 2026 to Mar 14 2027.
const NEW_EVENTS = [
  { template: 'bill-center', title: 'Festival Mizik Lakay', sub: 'De jou mizik sou plaj', category: 'Festival', city: 'Cap-Haïtien', venue: 'Plaj Cormier', address: 'Route de Labadie, Cap-Haïtien', date: '2026-12-12T14:00:00-05:00', ga: 9000, vip: 15000, total: 1200, img: '1429962714451-bb934ecdc4ec', lineup: ['Klass Anvil', 'Ti Bwa', 'DJ Lakay', 'Manmzèl Kreyòl', 'Rasin Jòn', 'Ayiti Brass', 'MC Solèy'], presenter: 'Tikèm prezante', desc: 'De jou mizik bò lanmè Okap: konpa, rasin, twoubadou ak DJ jiska solèy leve.' },
  { template: 'neon', title: 'Minwi Konpa', sub: 'Antre nan 2027 ak konpa', category: 'Party', city: 'Pétion-Ville', venue: 'Royal Oasis', address: 'Rue Panaméricaine, Pétion-Ville', date: '2026-12-31T22:00:00-05:00', ga: 9500, vip: 16000, total: 700, img: null, lineup: [], presenter: '', desc: 'Konpa live jiska minwi, chanpay ak dife atifis. Pi bèl fason pou antre nan 2027.' },
  { template: 'set-times', title: 'Sware DJ', sub: 'Kat DJ, yon sèl nwit', category: 'Party', city: 'Port-au-Prince', venue: 'Juvenat', address: 'Juvenat, Pétion-Ville', date: '2026-11-21T22:00:00-05:00', ga: 7000, vip: 12000, total: 400, img: '1470225620780-dba8ba36b745', lineup: ['DJ Tikal', 'Selektè Moun', 'Nadia b2b Zoe', 'Ti Kenz'], presenter: '', desc: 'Afrobeats, kompa ak amapiano: kat DJ ap pase plak jiska maten.' },
  { template: 'serif-paper', title: 'Lekti anba pye mango', sub: 'Powèm ak twoubadou', category: 'Theater', city: 'Jacmel', venue: 'Lakou Kafe', address: 'Rue du Commerce, Jacmel', date: '2026-12-05T16:00:00-05:00', ga: 7000, vip: 9000, total: 120, img: null, lineup: [], presenter: '', desc: 'Yon apremidi powèm an kreyòl ak mizik twoubadou anba yon gwo pye mango Jakmèl.' },
  { template: 'calendar-tile', title: 'Nwèl Lakay', sub: 'Konsè koral ak reveyon', category: 'Concert', city: 'Port-au-Prince', venue: 'Katedral Sen Trinite', address: 'Rue Monseigneur Guilloux, Port-au-Prince', date: '2026-12-24T19:00:00-05:00', ga: 7000, vip: 10000, total: 500, img: null, lineup: [], presenter: '', desc: 'Chante Nwèl an kreyòl ak fransè, koral ak gospel, epi yon reveyon an fanmi.' },
  { template: 'tilt-pop', title: 'Kanaval Pre-Party', sub: 'Chofe anvan defile a', category: 'Party', city: 'Port-au-Prince', venue: 'Champ de Mars', address: 'Champ de Mars, Port-au-Prince', date: '2027-02-06T22:00:00-05:00', ga: 8000, vip: 14000, total: 900, img: '1514525253161-7a46d19cd819', lineup: [], presenter: '', desc: 'Yon semèn anvan kanaval: DJ, konpa ak rara pou chofe kò w.' },
  { template: 'split-half', title: 'Gou Lakay Food Fest', sub: 'Pi bon manje Nò a', category: 'Food & Drink', city: 'Cap-Haïtien', venue: 'Pak Istorik', address: 'Rue 24, Cap-Haïtien', date: '2026-12-06T12:00:00-05:00', ga: 7000, vip: 10000, total: 800, img: '1555939594-58d7cb561ad1', lineup: [], presenter: '', desc: 'Griyo, lambi, pwason boukannen ak dous makòs. Chèf Nò yo reyini pou yon jounen gou.' },
  { template: 'framed', title: 'Ekspozisyon Atis Jakmèl', sub: 'Penti ak papye mache', category: 'Festival', city: 'Jacmel', venue: 'Galri Ayiti', address: 'Rue Seymour Pradel, Jacmel', date: '2026-12-03T18:00:00-05:00', ga: 7000, vip: 9500, total: 200, img: '1460661419201-fd4cecdf8a8b', lineup: [], presenter: 'Fondasyon Atizana', desc: 'Penti, eskilti ak papye mache: atis Jakmèl yo louvri pòt galri a pou yon swa.' },
  { template: 'giant-date', title: 'Fèt anivèsè Lakay', sub: 'Yon nwit sou twa', category: 'Party', city: 'Cap-Haïtien', venue: 'Rooftop Le Roi', address: 'Boulevard, Cap-Haïtien', date: '2026-11-14T21:00:00-05:00', ga: 7500, vip: 13000, total: 250, img: '1492684223066-81342ee5ff30', lineup: [], presenter: '', desc: 'Yon fèt anivèsè sou twa ak DJ, kokteyl ak bèl vi sou lanmè Okap.' },
  { template: 'ticket-stub', title: 'Gala Fen Ane', sub: 'Dine ak dans', category: 'Food & Drink', city: 'Pétion-Ville', venue: 'El Rancho', address: 'Rue José de San Martin, Pétion-Ville', date: '2026-12-19T20:00:00-05:00', ga: 10000, vip: 17000, total: 220, img: '1580657274234-7339717f4541', lineup: [], presenter: 'Tikèm', desc: 'Dine, mizik live ak dans: yon gala elegant pou fèmen ane a.' },
  { template: 'magazine', title: 'Fashion Week Ayiti', sub: 'Kreyatè lakay sou podyòm', category: 'Festival', city: 'Port-au-Prince', venue: 'Marriott', address: 'Avenue Jean Paul II, Port-au-Prince', date: '2027-01-16T20:00:00-05:00', ga: 8500, vip: 15000, total: 300, img: '1509631179647-0177331693ae', lineup: [], presenter: '', desc: 'Nouvo koleksyon kreyatè ayisyen yo, podyòm, mizik ak style.' },
  { template: 'date-rail', title: 'Jazz nan Jaden', sub: 'Jazz anba pye bwa', category: 'Concert', city: 'Kenscoff', venue: 'Jaden Botanik', address: 'Route de Kenscoff', date: '2027-01-29T18:00:00-05:00', ga: 8000, vip: 13000, total: 250, img: '1511192336575-5a79af67a629', lineup: [], presenter: '', desc: 'Kwiv, kontrebas ak pyano nan lafrechè Kenscoff, anba limyè jaden an.' },
]

// Existing showcase events get a template by category, rotating within it,
// so the feed doesn't repeat a layout.
const BY_CATEGORY = {
  Concert: ['bill-center', 'giant-date', 'serif-duotone', 'stack-bar', 'date-rail'],
  Party: ['tilt-pop', 'outline-block', 'neon', 'set-times', 'giant-date'],
  'Food & Drink': ['split-half', 'ticket-stub', 'framed'],
  Festival: ['repeat', 'magazine', 'framed', 'stack-bar', 'date-rail'],
  Theater: ['serif-center', 'calendar-tile', 'serif-paper'],
  Sports: ['stack-bar', 'giant-date'],
}
const FALLBACK_ROTATION = ['serif-duotone', 'stack-bar', 'giant-date', 'split-half', 'magazine', 'framed']

// ---------------------------------------------------------------------------
// Event facts → poster query.

const TZ = { HT: 'America/Port-au-Prince', US: 'America/New_York', CA: 'America/Toronto', FR: 'Europe/Paris' }
const LOCALE = { HT: 'ht', FR: 'fr', US: 'en', CA: 'en' }

function localStart(iso, country) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ[country] || TZ.HT,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function seedPalette(seed) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 3
}

async function draw({ template, palette, title, startIso, country, venue, city, lineup, presenter, photoUrl }) {
  const q = new URLSearchParams({
    template,
    palette: String(palette),
    title,
    start: localStart(startIso, country),
    venue: venue || '',
    city: city || '',
    lineup: (lineup || []).join('|'),
    presenter: presenter || '',
    locale: LOCALE[country] || 'ht',
    full: '1',
  })
  if (photoUrl) q.set('photo', photoUrl)
  const res = await fetch(`${BASE}/api/posters/preview?${q}`)
  if (!res.ok) throw new Error(`draw ${template} "${title}": ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

const titleCase = (s) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s

// ---------------------------------------------------------------------------
// --preview: draw the new batch to a folder. No database.

if (PREVIEW_DIR) {
  mkdirSync(PREVIEW_DIR, { recursive: true })
  for (const [i, e] of NEW_EVENTS.entries()) {
    const jpeg = await draw({
      template: e.template, palette: seedPalette(e.title), title: e.title, startIso: e.date, country: 'HT',
      venue: e.venue, city: e.city, lineup: e.lineup, presenter: e.presenter, photoUrl: e.img ? photo(e.img) : null,
    })
    const file = `${PREVIEW_DIR}/${String(i).padStart(2, '0')}-${e.template}.jpg`
    writeFileSync(file, jpeg)
    console.log('drew', file)
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Database modes.

const { default: admin } = await import('firebase-admin')
const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(raw)),
  storageBucket: 'event-haiti.firebasestorage.app',
})
const db = admin.firestore()
const bucket = admin.storage().bucket()

async function upload(jpeg) {
  const token = randomUUID()
  const dest = `event-images/${randomUUID()}.jpg`
  await bucket.file(dest).save(jpeg, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
  })
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`
}

async function deleteStored(url) {
  const m = (url || '').match(/\/o\/([^?]+)\?/)
  if (!m || !decodeURIComponent(m[1]).startsWith('event-images/')) return
  try {
    await bucket.file(decodeURIComponent(m[1])).delete()
  } catch {
    /* already gone */
  }
}

// Every seeded showcase event of the demo organizer (seed_batch set). Real
// events never carry seed_batch, so they are never touched.
const all = await db.collection('events').where('organizer_id', '==', ORGANIZER_ID).get()
const seeded = all.docs.filter((d) => d.get('seed_batch') && d.get('seed_batch') !== NEW_BATCH)

if (REVERT) {
  for (const d of seeded) {
    const original = d.get('poster_original_url')
    if (!original) continue
    if (DRY) { console.log('would restore', d.id, d.get('title')); continue }
    const templated = d.get('banner_image_url')
    await d.ref.update({
      banner_image_url: original,
      cover_image_url: original,
      image_url: original,
      poster_template: admin.firestore.FieldValue.delete(),
      poster_original_url: admin.firestore.FieldValue.delete(),
    })
    await deleteStored(templated)
    console.log('restored', d.id, d.get('title'))
  }
  const batch = await db.collection('events').where('seed_batch', '==', NEW_BATCH).get()
  for (const d of batch.docs) {
    const tiers = await db.collection('ticket_tiers').where('event_id', '==', d.id).get()
    if (DRY) { console.log('would delete', d.id, d.get('title'), `(+${tiers.size} tiers)`); continue }
    for (const t of tiers.docs) await t.ref.delete()
    await d.ref.collection('private').doc('access').delete()
    await deleteStored(d.get('banner_image_url'))
    await d.ref.delete()
    console.log('deleted', d.id, d.get('title'))
  }
  console.log('reverted')
  process.exit(0)
}

// 1) Existing showcase events.
const used = {}
for (const d of seeded.sort((a, b) => String(a.get('start_datetime')).localeCompare(String(b.get('start_datetime'))))) {
  if (d.get('poster_original_url')) { console.log('skip (already templated)', d.get('title')); continue }
  const category = d.get('category') || ''
  const rot = BY_CATEGORY[category] || FALLBACK_ROTATION
  used[category] = (used[category] ?? -1) + 1
  const template = rot[used[category] % rot.length]
  const palette = seedPalette(d.id)
  const original = d.get('banner_image_url') || null
  const country = d.get('country') || 'HT'
  const title = titleCase(String(d.get('title') || ''))
  if (DRY) { console.log('would template', d.get('seed_batch'), '|', title, '|', template, palette); continue }
  const jpeg = await draw({
    template, palette, title, startIso: d.get('start_datetime'), country,
    venue: d.get('venue_name'), city: d.get('city'),
    lineup: (d.get('guestlist') || []).map((g) => g?.name).filter(Boolean),
    presenter: '', photoUrl: original,
  })
  const url = await upload(jpeg)
  await d.ref.update({
    banner_image_url: url,
    cover_image_url: url,
    image_url: url,
    poster_template: { template, palette, photo: original },
    poster_original_url: original,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  console.log('templated', d.id, '|', title, '|', template)
}

// 2) The new batch.
const already = await db.collection('events').where('seed_batch', '==', NEW_BATCH).limit(1).get()
if (!already.empty) {
  console.log(`${NEW_BATCH} already seeded; --revert first to reseed it.`)
  process.exit(0)
}
const codeHash = createHash('sha256').update(ACCESS_CODE).digest('hex')
for (const e of NEW_EVENTS) {
  if (DRY) { console.log('would create', e.date.slice(0, 10), '|', e.title, '|', e.city, '|', e.template); continue }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const palette = seedPalette(e.title)
  const photoUrl = e.img ? photo(e.img) : null
  const url = await upload(await draw({
    template: e.template, palette, title: e.title, startIso: e.date, country: 'HT',
    venue: e.venue, city: e.city, lineup: e.lineup, presenter: e.presenter, photoUrl,
  }))
  const ref = db.collection('events').doc(id)
  await ref.set({
    id,
    title: e.title,
    summary: e.sub,
    description: e.desc,
    category: e.category,
    tags: [],
    start_datetime: new Date(e.date).toISOString(),
    end_datetime: null,
    venue_name: e.venue,
    address: e.address,
    city: e.city,
    commune: '',
    country: 'HT',
    currency: 'HTG',
    ticket_price: e.ga,
    ticket_name: 'General Admission',
    total_tickets: e.total,
    has_paid_tiers: true,
    banner_image_url: url,
    cover_image_url: url,
    image_url: url,
    poster_template: { template: e.template, palette, photo: photoUrl },
    organizer_id: ORGANIZER_ID,
    is_published: true,
    status: 'published',
    rejected: false,
    reports_count: 0,
    featured: false,
    show_on_explore: true,
    is_online: false,
    is_recurring: false,
    is_password_protected: true,
    password_protected: true,
    enable_waitlist: false,
    show_guestlist: e.lineup.length > 0,
    guestlist: e.lineup.map((name) => ({ name })),
    title_font: 'Default',
    spotify_url: null,
    seed_batch: NEW_BATCH,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  await ref.collection('private').doc('access').set({
    code_hash: codeHash,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  const tier = (name, price, qty, sort) => ({
    event_id: id, name, price, total_quantity: qty, sold_quantity: 0, description: null,
    sales_start: null, sales_end: null, valid_from: null, valid_until: null, sort_order: sort,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  const vipQty = Math.max(20, Math.round(e.total * 0.15))
  await db.collection('ticket_tiers').add(tier('General Admission', e.ga, e.total - vipQty, 0))
  await db.collection('ticket_tiers').add(tier('VIP', e.vip, vipQty, 1))
  console.log('created', id, '|', e.title, '|', e.template)
  await new Promise((r) => setTimeout(r, 25)) // keep Date.now() ids unique
}
console.log('done')
process.exit(0)
