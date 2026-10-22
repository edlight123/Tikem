// Seeds 6 FREE template events: 2 in New York, 2 in Miami, 2 in Haiti (owner
// request, 2026-10-22), so the marketplace shows free listings next to the
// paid Haiti showcase. Every description opens by saying it is a template
// event, and each is password-protected at checkout (code: tikem) so nobody
// claims a ticket to an event that is not happening.
//
// Same field shape as seed-haiti-showcase-events.mjs, but free: one 0-priced
// tier and has_paid_tiers: false (lib/ticketPricing reads that flag first).
//
//   node scripts/seed-free-template-events.mjs --dry      preview
//   node scripts/seed-free-template-events.mjs            create
//   node scripts/seed-free-template-events.mjs --delete   remove the batch
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import admin from 'firebase-admin'

const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const ORGANIZER_ID = '2Rc7Gq8M19OL4ZNP2RGQyFeDjEA2' // the demo organizer, shown as "Tikèm"
const SEED_BATCH = 'free-templates-2026-10'
const ACCESS_CODE = 'tikem'
const DRY = process.argv.includes('--dry')
const DELETE = process.argv.includes('--delete')

// Curated flyer-library photos (lib/flyerLibrary): already allowed by
// next.config remotePatterns and the CSP img-src.
const photo = (id) => `https://images.unsplash.com/photo-${id}?w=1200&h=1500&fit=crop&q=80`

const TEMPLATE_EN =
  'Template event: this is a sample listing that shows what a free event looks like on Tikèm. It is not a real event and no tickets are issued.'
const TEMPLATE_HT =
  'Evènman modèl: sa a se yon egzanp pou montre kijan yon evènman gratis parèt sou Tikèm. Se pa yon vrè evènman.'

// US Eastern and Haiti are both UTC-4 until Nov 1 2026, UTC-5 after.
const EVENTS = [
  { title: 'BROOKLYN KONPA SUNDAY', sub: 'Free day party in the park', category: 'Party', city: 'New York', country: 'US', currency: 'USD', venue: 'Prospect Park Bandshell', address: 'Prospect Park West & 9th St, Brooklyn, NY', date: '2026-11-15T14:00:00-05:00', total: 400, img: '1517457373958-b7bdd4587205', accent: '#F59E0B', desc: 'A Sunday afternoon of konpa, food trucks and dancing in Prospect Park. Bring the whole family.' },
  { title: 'HARLEM OPEN MIC', sub: 'Poetry, comedy & song', category: 'Theater', city: 'New York', country: 'US', currency: 'USD', venue: 'Harlem Stage Lounge', address: '150 Convent Ave, New York, NY', date: '2026-12-03T19:00:00-05:00', total: 120, img: '1507676385008-e7fb562d11f8', accent: '#22C55E', desc: 'One mic, ten-minute sets. Poets, comics and singers from the Haitian diaspora and beyond.' },
  { title: 'LITTLE HAITI ART WALK', sub: 'Galleries, music & street food', category: 'Festival', city: 'Miami', country: 'US', currency: 'USD', venue: 'Little Haiti Cultural Complex', address: '212 NE 59th Terrace, Miami, FL', date: '2026-11-20T18:00:00-05:00', total: 500, img: '1769425158985-8452c0e54194', accent: '#06B6D4', desc: 'Open studios, live twoubadou and griyo on the street. A free evening walk through Little Haiti.' },
  { title: 'SUNRISE RUN CLUB', sub: '5K on the bay', category: 'Sports', city: 'Miami', country: 'US', currency: 'USD', venue: 'Bayfront Park', address: '301 Biscayne Blvd, Miami, FL', date: '2026-12-06T07:00:00-05:00', total: 200, img: '1739368732843-800f36a9b7d0', accent: '#84CC16', desc: 'An easy 5K along Biscayne Bay, then coffee and music. All paces welcome.' },
  { title: 'KONSÈ NAN PAK LA', sub: 'Mizik gratis anba pye bwa', category: 'Concert', city: 'Pétion-Ville', country: 'HT', currency: 'HTG', venue: 'Place Saint-Pierre', address: 'Place Saint-Pierre, Pétion-Ville', date: '2026-11-29T16:00:00-05:00', total: 600, img: '1785539139081-a511edaf0f6a', accent: '#14B8A6', desc: 'Yon apremidi twoubadou ak konpa gratis pou tout fanmi an, anba pye bwa Place Saint-Pierre.' },
  { title: 'JOUNEN FANMI JAKMÈL', sub: 'Jwèt, manje & mizik bò lanmè', category: 'Festival', city: 'Jacmel', country: 'HT', currency: 'HTG', venue: 'Bord de Mer', address: 'Bord de Mer, Jacmel', date: '2026-12-13T10:00:00-05:00', total: 800, img: '1761662827034-13225b496e66', accent: '#F97316', desc: 'Yon jounen gratis pou timoun ak granmoun: jwèt, atizan, manje lakay ak mizik bò lanmè.' },
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
  const template = e.country === 'HT' ? `${TEMPLATE_HT}\n${TEMPLATE_EN}` : TEMPLATE_EN
  if (DRY) { console.log('would create', e.date.slice(0, 10), '|', e.title, '|', e.city, '| FREE'); continue }
  const ref = db.collection('events').doc(id)
  await ref.set({
    id,
    title: e.title,
    summary: e.sub,
    description: `${template}\n\n${e.desc}`,
    category: e.category,
    tags: ['template'],
    start_datetime: new Date(e.date).toISOString(),
    end_datetime: null,
    venue_name: e.venue,
    address: e.address,
    city: e.city,
    commune: '',
    country: e.country,
    currency: e.currency,
    ticket_price: 0,
    ticket_name: 'Free',
    total_tickets: e.total,
    has_paid_tiers: false,
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
  await db.collection('ticket_tiers').add({
    event_id: id,
    name: 'Free',
    price: 0,
    total_quantity: e.total,
    sold_quantity: 0,
    description: null,
    sales_start: null,
    sales_end: null,
    valid_from: null,
    valid_until: null,
    sort_order: 0,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  console.log('created', id, '|', e.title, '|', e.city)
  await new Promise((r) => setTimeout(r, 25)) // keep Date.now() ids unique
}
console.log('done')
process.exit(0)
