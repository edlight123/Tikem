// Seeds 12 published showcase events in the US (New York, Miami, Boston) so
// the diaspora homepage is not carried by template listings (owner request,
// 2026-10-22). Same rules as the Haiti showcase: password-protected at
// checkout (code: tikem) and priced from US$45, so nobody buys by accident.
//
// Same field shape as seed-haiti-showcase-events.mjs. Photos are flyer-library
// pieces the Haiti showcase and free templates do not already use, so the
// homepage never shows the same picture twice.
//
// Every doc carries seed_batch, so the whole batch comes out in one go:
//   node scripts/seed-us-showcase-events.mjs --dry      preview
//   node scripts/seed-haiti-showcase-events.mjs            create
//   node scripts/seed-us-showcase-events.mjs --delete   remove the batch
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import admin from 'firebase-admin'

const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const ORGANIZER_ID = '2Rc7Gq8M19OL4ZNP2RGQyFeDjEA2' // the demo organizer (FÒJ 2026 etc.)
const SEED_BATCH = 'us-showcase-2026-10'
const ACCESS_CODE = 'tikem'
const DRY = process.argv.includes('--dry')
const DELETE = process.argv.includes('--delete')

// Curated flyer-library photos (lib/flyerLibrary): already allowed by
// next.config remotePatterns and the CSP img-src.
const photo = (id) => `https://images.unsplash.com/photo-${id}?w=1200&h=1500&fit=crop&q=80`

// US Eastern is UTC-4 until Nov 1 2026, UTC-5 after.
const EVENTS = [
  { title: 'KONPA NIGHT NYC', sub: 'Live band until late', category: 'Concert', city: 'New York', venue: 'Brooklyn Bowl', address: '61 Wythe Ave, Brooklyn, NY', date: '2026-11-14T21:00:00-05:00', ga: 55, vip: 95, total: 600, img: '1470229722913-7c0e2dbbafd3', accent: '#FB7185', desc: 'A full konpa band on stage in Williamsburg, a crowd that knows every word, and a dance floor that does not empty until 2.' },
  { title: 'DYASPORA DAY PARTY', sub: 'Afrobeats, konpa & brunch', category: 'Party', city: 'New York', venue: 'Rooftop, Midtown', address: '230 Fifth Ave, New York, NY', date: '2026-11-29T13:00:00-05:00', ga: 45, vip: 85, total: 350, img: '1664192578366-523c01b7ce43', accent: '#F59E0B', desc: 'Bottomless brunch, two DJs and the whole diaspora on one rooftop. Afrobeats, konpa and dancehall from noon to sundown.' },
  { title: 'RAP KREYÒL LIVE', sub: 'The new wave on one stage', category: 'Concert', city: 'New York', venue: 'SOB’s', address: '204 Varick St, New York, NY', date: '2026-12-11T20:00:00-05:00', ga: 50, vip: 90, total: 450, img: '1547661198-888c249734e7', accent: '#A855F7', desc: 'The artists taking rap kreyòl worldwide, back to back on one stage in SoHo.' },
  { title: 'BAL ANE NOUVO NYC', sub: 'New Year’s Eve, Haitian style', category: 'Party', city: 'New York', venue: 'Queens Ballroom', address: '89-00 Queens Blvd, Queens, NY', date: '2026-12-31T21:00:00-05:00', ga: 85, vip: 150, total: 800, img: '1492684223066-81342ee5ff30', accent: '#FACC15', desc: 'Ring in 2027 with a konpa band, a DJ, champagne at midnight and soup joumou after.' },
  { title: 'LITTLE HAITI SOUNDS', sub: 'Twoubadou under the lights', category: 'Concert', city: 'Miami', venue: 'Little Haiti Cultural Complex', address: '212 NE 59th Terrace, Miami, FL', date: '2026-11-21T19:00:00-05:00', ga: 45, vip: 80, total: 400, img: '1533174072545-7a4b6ad7a6c3', accent: '#14B8A6', desc: 'A night of twoubadou, konpa and rasin in the heart of Little Haiti.' },
  { title: 'SUNSET ON THE BAY', sub: 'Boat party, Biscayne Bay', category: 'Party', city: 'Miami', venue: 'Bayside Marina', address: '401 Biscayne Blvd, Miami, FL', date: '2026-12-05T17:00:00-05:00', ga: 75, vip: 140, total: 180, img: '1628029338883-61644ec68475', accent: '#0EA5E9', desc: 'Three hours on the water at golden hour. DJ on deck, rum punch and the Miami skyline.' },
  { title: 'KANAVAL MIAMI', sub: 'Pre-carnival block party', category: 'Festival', city: 'Miami', venue: 'North Miami Ave', address: 'North Miami Ave & NE 54th St, Miami, FL', date: '2027-01-30T15:00:00-05:00', ga: 50, vip: 95, total: 1200, img: '1514525253161-7a46d19cd819', accent: '#EF4444', desc: 'Costumes, rara, sound trucks and street food. Kanaval season starts in Miami.' },
  { title: 'RUM & KONPA', sub: 'Tasting night', category: 'Food & Drink', city: 'Miami', venue: 'Wynwood Lounge', address: '2550 NW 2nd Ave, Miami, FL', date: '2027-01-15T20:00:00-05:00', ga: 60, vip: 110, total: 150, img: '1615887625746-f3d2aa27e048', accent: '#F97316', desc: 'Barbancourt and craft rums from across the Caribbean, paired with a live konpa trio.' },
  { title: 'BOSTON KONPA BALL', sub: 'A night in black & gold', category: 'Party', city: 'Boston', venue: 'Royale Boston', address: '279 Tremont St, Boston, MA', date: '2026-11-28T21:00:00-05:00', ga: 55, vip: 100, total: 700, img: '1429962714451-bb934ecdc4ec', accent: '#EAB308', desc: 'Boston’s Haitian community dresses up for one night of konpa, live and DJ.' },
  { title: 'FLAVORS OF HAITI', sub: 'Food & wine evening', category: 'Food & Drink', city: 'Boston', venue: 'Dorchester Hall', address: '1 Morrissey Blvd, Dorchester, MA', date: '2026-12-12T18:30:00-05:00', ga: 65, vip: 120, total: 200, img: '1553361371-9b22f78e8b1d', accent: '#DC2626', desc: 'Five courses from Haitian chefs in Boston, each paired with a wine. Griyo has never been this elegant.' },
  { title: 'HAITIAN FILM NIGHT', sub: 'Screening & director Q&A', category: 'Theater', city: 'Boston', venue: 'Coolidge Corner Theatre', address: '290 Harvard St, Brookline, MA', date: '2027-01-09T19:00:00-05:00', ga: 45, vip: 75, total: 220, img: '1594808985790-98a065b97476', accent: '#38BDF8', desc: 'A new Haitian feature on the big screen, followed by a conversation with the director.' },
  { title: 'DIASPORA NETWORKING', sub: 'Founders, creatives & drinks', category: 'Conference', city: 'New York', venue: 'Flatiron Loft', address: '41 E 20th St, New York, NY', date: '2027-01-21T18:30:00-05:00', ga: 45, vip: 80, total: 250, img: '1515169067868-5387ec356754', accent: '#22C55E', desc: 'Meet the founders, artists and operators building across Haiti and the diaspora. Short talks, then drinks.' },
]

const codeHash = createHash('sha256').update(ACCESS_CODE.trim()).digest('hex')

if (DELETE) {
  const snap = await db.collection('events').where('seed_batch', '==', SEED_BATCH).get()
  for (const d of snap.docs) {
    const tiers = await db.collection('ticket_tiers').where('event_id', '==', d.id).get()
    if (DRY) { console.log('would delete', d.id, d.data().title, `(+${tiers.size} tiers)`); continue }
    for (const t of tiers.docs) await t.ref.delete()
    await d.ref.collection('private').doc('access').delete()
    await d.ref.delete()
    console.log('deleted', d.id, d.data().title)
  }
  console.log(`done: ${snap.size} events in ${SEED_BATCH}`)
  process.exit(0)
}

const existing = DRY ? { empty: true } : await db.collection('events').where('seed_batch', '==', SEED_BATCH).limit(1).get()
if (!existing.empty) {
  console.error(`${SEED_BATCH} already seeded; run with --delete first to reseed.`)
  process.exit(1)
}

for (const e of EVENTS) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  if (DRY) { console.log('would create', e.date.slice(0, 10), '|', e.title, '|', e.city, '|', '$' + e.ga, '/', '$' + e.vip); continue }
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
    country: 'US',
    currency: 'USD',
    ticket_price: e.ga,
    ticket_name: 'General Admission',
    total_tickets: e.total,
    has_paid_tiers: true,
    banner_image_url: photo(e.img),
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
    show_guestlist: true,
    guestlist: [],
    accent_color: e.accent,
    title_font: 'Default',
    spotify_url: null,
    seed_batch: SEED_BATCH,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  await ref.collection('private').doc('access').set({
    code_hash: codeHash,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  const tier = (name, price, qty, sort) => ({
    event_id: id,
    name,
    price,
    total_quantity: qty,
    sold_quantity: 0,
    description: null,
    sales_start: null,
    sales_end: null,
    valid_from: null,
    valid_until: null,
    sort_order: sort,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  const vipQty = Math.max(20, Math.round(e.total * 0.15))
  await db.collection('ticket_tiers').add(tier('General Admission', e.ga, e.total - vipQty, 0))
  await db.collection('ticket_tiers').add(tier('VIP', e.vip, vipQty, 1))
  console.log('created', id, '|', e.title, '|', e.city)
  await new Promise((r) => setTimeout(r, 25)) // keep Date.now() ids unique
}
console.log('done')
process.exit(0)
