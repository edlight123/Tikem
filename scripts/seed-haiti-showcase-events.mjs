// Seeds 20 published showcase events in Haiti so the marketplace does not
// read as empty while organizers are being onboarded (owner request,
// 2026-10-12). Every one is password-protected at checkout (code: tikem) and
// priced from 7,000 HTG (~US$53), so nobody buys a ticket by accident.
//
// Same field shape as seed-showcase-events.mjs, plus what that seeder missed:
// ticket_tiers rows (checkout reads tiers), has_paid_tiers, and the
// private/access hash the verify-access route compares against.
//
// Every doc carries seed_batch, so the whole batch comes out in one go:
//   node scripts/seed-haiti-showcase-events.mjs --dry      preview
//   node scripts/seed-haiti-showcase-events.mjs            create
//   node scripts/seed-haiti-showcase-events.mjs --delete   remove the batch
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
const SEED_BATCH = 'haiti-showcase-2026-10'
const ACCESS_CODE = 'tikem'
const DRY = process.argv.includes('--dry')
const DELETE = process.argv.includes('--delete')

// Curated flyer-library photos (lib/flyerLibrary): already allowed by
// next.config remotePatterns and the CSP img-src.
const photo = (id) => `https://images.unsplash.com/photo-${id}?w=1200&h=1500&fit=crop&q=80`

// Haiti is UTC-4 until Nov 1 2026, UTC-5 after.
const EVENTS = [
  { title: 'NWIT KONPA LIVE', sub: 'Gwoup an dirèk, jiska maten', category: 'Concert', city: 'Pétion-Ville', venue: 'Place Boyer', address: 'Place Boyer, Pétion-Ville', date: '2026-10-24T21:00:00-04:00', ga: 7000, vip: 12000, total: 600, img: '1516450360452-9312f5e86fc7', accent: '#FB7185', desc: 'Yon gwo swa konpa an dirèk anba zetwal Pétion-Ville. Mizisyen sou sèn, son ki pwòp, ak yon foul ki konn danse.' },
  { title: 'ROOFTOP SWARE', sub: 'Sunset, DJ & kokteyl', category: 'Party', city: 'Pétion-Ville', venue: 'Rooftop, Rue Grégoire', address: 'Rue Grégoire, Pétion-Ville', date: '2026-10-31T18:00:00-04:00', ga: 7500, vip: 13000, total: 250, img: '1692261920240-a3c88f29e25f', accent: '#F59E0B', desc: 'Solèy la ap kouche sou mòn yo, DJ a ap chofe. Yon sware sou twa ak kokteyl, afrobeats ak konpa.' },
  { title: 'RASIN AK TANBOU', sub: 'Yon nwit mizik rasin', category: 'Concert', city: 'Port-au-Prince', venue: 'Pacot', address: 'Rue Pacot, Port-au-Prince', date: '2026-11-07T20:00:00-05:00', ga: 7000, vip: 11000, total: 300, img: '1778338943581-a43e09f48d02', accent: '#EF4444', desc: 'Tanbou, vaksin ak chante. Mizik rasin jan li dwe tande: fò, pre, e jiska maten.' },
  { title: 'TWOUBADOU KENSCOFF', sub: 'Gita, mòn ak lafrechè', category: 'Concert', city: 'Kenscoff', venue: 'Fermathe', address: 'Route de Kenscoff, Fermathe', date: '2026-11-08T17:00:00-05:00', ga: 7000, vip: 10000, total: 150, img: '1785539139081-a511edaf0f6a', accent: '#14B8A6', desc: 'Yon apremidi twoubadou nan lafrechè Kenscoff. Vye chante, gita, maracas, ak yon tas kafe peyi.' },
  { title: 'GOU LAKAY', sub: 'Festival manje ayisyen', category: 'Food & Drink', city: 'Pétion-Ville', venue: 'Place Saint-Pierre', address: 'Place Saint-Pierre, Pétion-Ville', date: '2026-11-14T12:00:00-05:00', ga: 7000, vip: 10500, total: 800, img: '1603088549155-6ae9395b928f', accent: '#F97316', desc: 'Griyo, lambi, diri djondjon ak pikliz. Pi bon chèf lakay yo reyini pou yon jounen gou.' },
  { title: 'OKAP NIGHT', sub: 'DJ sou Boulva a', category: 'Party', city: 'Cap-Haïtien', venue: 'Boulevard du Cap', address: 'Boulevard, Cap-Haïtien', date: '2026-11-21T21:00:00-05:00', ga: 7000, vip: 12000, total: 700, img: '1763630054130-0129c32d3f7f', accent: '#A855F7', desc: 'Nò a sou pye: DJ yo pran Boulva a pou yon nwit fèt anba lanmè Okap.' },
  { title: 'JAZZ NAN LAKOU', sub: 'Jazz kreyòl an dirèk', category: 'Concert', city: 'Port-au-Prince', venue: 'Bois Verna', address: 'Bois Verna, Port-au-Prince', date: '2026-11-22T19:00:00-05:00', ga: 8000, vip: 13500, total: 200, img: '1511192336575-5a79af67a629', accent: '#EAB308', desc: 'Kwiv, pyano ak tanbou: yon sware jazz kreyòl nan yon lakou ki plen limyè.' },
  { title: 'JAKMÈL ATIZANA', sub: 'Mache atizan & mizik', category: 'Festival', city: 'Jacmel', venue: 'Bord de Mer', address: 'Bord de Mer, Jacmel', date: '2026-11-28T10:00:00-05:00', ga: 7000, vip: 9500, total: 500, img: '1769425158985-8452c0e54194', accent: '#06B6D4', desc: 'Papye mache, penti, bijou ak mizik bò lanmè. Yon jounen ak atizan Jakmèl yo.' },
  { title: 'TEYAT LAKAY', sub: 'Yon pyès an kreyòl', category: 'Theater', city: 'Port-au-Prince', venue: 'Turgeau', address: 'Avenue Jean Paul II, Turgeau', date: '2026-12-05T19:00:00-05:00', ga: 7000, vip: 10000, total: 250, img: '1514306191717-452ec28c7814', accent: '#DC2626', desc: 'Yon pyès teyat an kreyòl ki pral fè w ri, reflechi e rete chita jiska dènye mo a.' },
  { title: 'KOMEDI SWA', sub: 'Stand-up an kreyòl', category: 'Theater', city: 'Pétion-Ville', venue: 'Rue Lambert', address: 'Rue Lambert, Pétion-Ville', date: '2026-12-06T20:00:00-05:00', ga: 7000, vip: 10500, total: 180, img: '1507676385008-e7fb562d11f8', accent: '#22C55E', desc: 'Pi bon komedyen lakay yo sou yon sèl sèn. Yon swa ri san rete.' },
  { title: 'KOURI POU LAVI', sub: '10K maten bonè', category: 'Sports', city: 'Port-au-Prince', venue: 'Champ de Mars', address: 'Champ de Mars, Port-au-Prince', date: '2026-12-12T06:00:00-05:00', ga: 7000, vip: 9000, total: 1000, img: '1739368732843-800f36a9b7d0', accent: '#84CC16', desc: 'Yon kous 10K ak 5K nan lari Pòtoprens anvan solèy leve. Meday pou tout moun ki fini.' },
  { title: 'GALA NWÈL', sub: 'Yon sware elegant', category: 'Food & Drink', city: 'Pétion-Ville', venue: 'Montagne Noire', address: 'Montagne Noire, Pétion-Ville', date: '2026-12-19T19:00:00-05:00', ga: 9500, vip: 15000, total: 220, img: '1780542900375-0cf459e38fbb', accent: '#EAB308', desc: 'Dine, mizik live ak tenyen. Yon gala pou fete fen ane a ak tout elegans.' },
  { title: 'KONSÈ NWÈL', sub: 'Koral & gospel', category: 'Concert', city: 'Port-au-Prince', venue: 'Bourdon', address: 'Route de Bourdon, Port-au-Prince', date: '2026-12-20T18:00:00-05:00', ga: 7000, vip: 10000, total: 400, img: '1720186576697-24c1496a07e1', accent: '#38BDF8', desc: 'Koral, gospel ak chante Nwèl an kreyòl ak fransè. Yon swa lapè pou tout fanmi an.' },
  { title: 'RÉVEILLON OKAP', sub: 'Fèt 24 desanm', category: 'Party', city: 'Cap-Haïtien', venue: 'Carénage', address: 'Carénage, Cap-Haïtien', date: '2026-12-24T21:00:00-05:00', ga: 8000, vip: 14000, total: 500, img: '1517457373958-b7bdd4587205', accent: '#F43F5E', desc: 'Pase Nwèl la nan Okap: DJ, konpa, manje ak limyè jiska minwi epi pi lwen.' },
  { title: 'BAL ANE NOUVO', sub: '31 desanm, Pétion-Ville', category: 'Party', city: 'Pétion-Ville', venue: 'Place Boyer', address: 'Place Boyer, Pétion-Ville', date: '2026-12-31T21:00:00-05:00', ga: 9000, vip: 16000, total: 900, img: '1533219057257-4bb9ed5d2cc6', accent: '#FACC15', desc: 'Antre nan 2027 ak klas: gwoup konpa, DJ, chanpay ak dife atifis a minwi.' },
  { title: 'FÈT ENDEPANDANS', sub: '1ye janvye, soup joumou', category: 'Festival', city: 'Gonaïves', venue: "Place d'Armes", address: "Place d'Armes, Gonaïves", date: '2027-01-01T11:00:00-05:00', ga: 7000, vip: 10000, total: 1200, img: '1742095228943-1b0ceb0fd82e', accent: '#2563EB', desc: 'Soup joumou, dans folklorik ak mizik rasin nan vil endepandans lan. Fete libète nou ansanm.' },
  { title: 'PLAJ & KONPA', sub: 'Yon jounen bò lanmè', category: 'Party', city: 'Arcahaie', venue: 'Côte des Arcadins', address: 'Route Nationale 1, Arcahaie', date: '2027-01-16T11:00:00-05:00', ga: 7500, vip: 13000, total: 400, img: '1580741186862-c5d0bf2aff33', accent: '#0EA5E9', desc: 'Sab, solèy ak konpa toutlajounen sou Kot Akaden yo. Bato, manje lanmè ak DJ.' },
  { title: 'FASHION NIGHT', sub: 'Kreyatè ayisyen sou podyòm', category: 'Festival', city: 'Pétion-Ville', venue: 'Rue Pan-Américaine', address: 'Rue Pan-Américaine, Pétion-Ville', date: '2027-01-23T19:00:00-05:00', ga: 8000, vip: 14000, total: 300, img: '1543728069-a3f97c5a2f32', accent: '#E879F9', desc: 'Pi bon estilis lakay yo prezante nouvo koleksyon yo. Podyòm, mizik ak style.' },
  { title: 'PRE-KANAVAL JAKMÈL', sub: 'Mas, rara & koulè', category: 'Festival', city: 'Jacmel', venue: 'Avenue Baranquilla', address: 'Avenue Baranquilla, Jacmel', date: '2027-01-31T14:00:00-05:00', ga: 7000, vip: 12000, total: 1500, img: '1639002549231-a895a33c4888', accent: '#F97316', desc: 'Mas papye mache, rara ak koulè: Jakmèl ap prepare kanaval la, vin viv li anvan tout moun.' },
  { title: 'KANAVAL STAND', sub: 'Pi bon plas pou defile a', category: 'Festival', city: 'Port-au-Prince', venue: 'Champ de Mars', address: 'Champ de Mars, Port-au-Prince', date: '2027-02-07T15:00:00-05:00', ga: 10000, vip: 18000, total: 600, img: '1527091736853-64ca6a9b64d9', accent: '#EF4444', desc: 'Yon plas nan stand la pou wè tout cha yo pase. Manje, bwason ak pi bon vi sou defile a.' },
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
  if (DRY) { console.log('would create', e.date.slice(0, 10), '|', e.title, '|', e.city, '|', e.ga, '/', e.vip, 'HTG'); continue }
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
