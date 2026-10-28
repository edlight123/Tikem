/**
 * Schedules the organizer outreach email through Resend, one message per
 * organizer, from the outreach subdomain (hello.tikem.co, kept apart from the
 * tikem.co ticket mail). Dry run by default: prints what it would send.
 *
 *   npx tsx scripts/send-organizer-outreach.ts <list.json> --test you@example.com
 *   npx tsx scripts/send-organizer-outreach.ts <list.json> --wave 1 --start 2026-10-27T11:30:00Z --send
 *
 * list.json: [{ wave, name, email, event, recent: 'yes'|'no' }]
 * Each wave's messages go out SPACING_MIN apart from --start. A log of the
 * Resend ids is written next to the list (outreach-log-wave<N>.json).
 *
 * Before scheduling, rows are dropped when the address has ever bounced,
 * complained or been suppressed in this Resend account, looks like a test or
 * throwaway inbox, or reaches an inbox that already has a copy (gmail +aliases
 * and dots land in one inbox) in this wave or in mail already sent/scheduled
 * from the outreach domain. Bounces above ~4% put the whole account at risk.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { organizerOutreachHtml, discoveryOutreachHtml } from './build-organizer-outreach-email'

const FROM = 'Fredler · Tikèm <events@hello.tikem.co>'
const REPLY_TO = 'info@tikem.co'
const CC = 'fredler@tikem.co'
// Hidden copy of every outgoing email for the team's own record (recipients
// don't see it). Replies still route to REPLY_TO (info@tikem.co).
const BCC = 'info@tikem.co'
const SUBJECT = 'Tikè ou yo, san tèt chaje'
// Phase-2 discovery campaign: the subject carries the recipient's name (the
// biggest open-rate lever), but ONLY when the name reads like a real person.
// A bare handle ("zenayiti", "jeanpierrefinal") in a subject screams mail-merge,
// so those fall back to a nameless question.
const DISCOVERY_SUBJECT_FALLBACK = 'Ki kote w ap soti wikenn sa a?'
const SPACING_MIN = 3

type Row = { wave: string | number; name: string; email: string; event: string; recent: string }

const BAD_EVENTS = new Set(['bounced', 'complained', 'suppressed'])
const TEST_ADDRESS = /(^|[._-])(scan|test|demo|fake|dummy|example|qa)[a-z0-9]*@|@(example|test)\./i
const THROWAWAY_DOMAIN =
  /(blaxion|mailinator|guerrillamail|yopmail|10minutemail|tempmail|temp-mail|sharklasers|trashmail|dispostable|getnada|maildrop|mohmal|emailnator|fakeinbox)/i

/** The inbox an address delivers to: drops +tags, and dots for Gmail. */
function inboxKey(address: string): string {
  const [local, domain = ''] = address.trim().toLowerCase().split('@')
  const d = domain === 'googlemail.com' ? 'gmail.com' : domain
  let base = local.split('+')[0]
  if (d === 'gmail.com') base = base.replace(/\./g, '')
  return `${base}@${d}`
}

/**
 * One pass over the account's sent mail: addresses that bounced, complained or
 * were suppressed (any domain), and inboxes the outreach domain has already
 * sent or scheduled to.
 */
async function resendHistory(): Promise<{ bad: Set<string>; contacted: Set<string> }> {
  const bad = new Set<string>()
  const contacted = new Set<string>()
  const outreachDomain = FROM.match(/@([^>]+)/)![1]
  let after = ''
  for (;;) {
    const res = await fetch(`https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ''}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    })
    if (res.status === 429) {
      await new Promise((ok) => setTimeout(ok, 1100))
      continue
    }
    if (!res.ok) throw new Error(`Resend history: ${res.status} ${await res.text()}`)
    const page: any = await res.json()
    for (const e of page.data || []) {
      const tos: string[] = [].concat(e.to).map((t: string) => t.toLowerCase())
      if (BAD_EVENTS.has(e.last_event)) tos.forEach((t) => bad.add(t))
      if (String(e.from).includes(`@${outreachDomain}`) && e.last_event !== 'canceled')
        tos.forEach((t) => contacted.add(inboxKey(t)))
    }
    if (!page.has_more || !page.data?.length) break
    after = page.data.at(-1).id
    await new Promise((ok) => setTimeout(ok, 550))
  }
  return { bad, contacted }
}

/**
 * Clean a scraped name for display + decide whether it is a real person's name.
 * Real: has a space OR an uppercase letter, no digits, not a lowercase one-word
 * handle. Returns the title-cased name (empty when not real) and the flag.
 */
function cleanName(raw: string): { display: string; isReal: boolean } {
  const n = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!n || n === '—') return { display: '', isReal: false }
  const hasSpace = /\s/.test(n)
  const lowerOneWord = !hasSpace && n === n.toLowerCase()
  const digitHandle = /\d/.test(n) && !hasSpace // "user123" yes, "Whisky Legend 1804" no
  const tooLong = n.length > 40
  const isReal = !lowerOneWord && !digitHandle && !tooLong
  // Capitalise only all-lowercase tokens; leave brand casing alone (BMIXX, LAKÚ, McFly).
  const display = isReal
    ? n
        .split(' ')
        .map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ')
    : ''
  return { display, isReal }
}

function discoverySubject(name: string): string {
  const { display, isReal } = cleanName(name)
  return isReal ? `${display}, men sa k ap pase an Ayiti` : DISCOVERY_SUBJECT_FALLBACK
}

/** Plain-text body for the discovery email (generic greeting when no real name). */
function discoveryText(name: string): string {
  const { display } = cleanName(name)
  const hi = display ? `Bonjou ${display},` : 'Bonjou,'
  return `${hi}

Tikèm se kote pou jwenn, achte ak viv evènman an Ayiti ak nan dyaspora a. Konsè, fèt, konferans, fòmasyon, tout bagay yon sèl kote.

Poukisa Tikèm:
Jwenn sa k ap pase: tout evènman yo, pa vil ak pa dat.
Achte fasil: MonCash oswa kat. Tikè a antre nan Apple ak Google Wallet.
Tikè ki pa pèdi: QR pwoteje, nan telefòn ou, menm san entènèt.
Kreyòl, Fransè, Anglè.

Telechaje aplikasyon an: https://www.tikem.co/download
Dekouvri evènman yo: https://www.tikem.co

Ou menm, ou fè evènman? Li fasil sou Tikèm: 10% tou konpri, MonCash ladan l, done kliyan an sekirite, pòt la mache menm san entènèt. Reponn imèl sa a, n ap mete w kanpe.

Fredler Pierre-Louis
Tikèm · tikem.co
WhatsApp: +1 754 276 8676

Si ou pa vle resevwa lòt mesaj, jis reponn "non mèsi".`
}

function apiKey(): string {
  const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('RESEND_API_KEY='))
  return String(line || '').slice('RESEND_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
}

function text(r: Row): string {
  const opener =
    r.recent === 'no'
      ? `Bonjou ${r.name}, nou te wè ${r.event} ak lòt evènman ou yo. Bravo pou bèl travay la.`
      : `Bonjou ${r.name}, mwen wè ou te òganize ${r.event} dènyèman. Bravo pou bèl travay la.`
  return `${opener}

Ou janm viv sa?
1. Nimewo telefòn oswa imèl kliyan ou yo parèt kote yo pa t dwe parèt.
2. Kòd QR yo refize mache nan pòt la, moun kanpe nan liy ap tann.
3. Frè sou chak tikè, epi frè peman an ki vin sou sa ankò.

Sa Tikèm chanje:
10%, MonCash ladan l. Anyen pa ajoute sou sa. Tikè 1 000 goud: 100 goud an tou. Tikè gratis: 0.
Done kliyan an sekirite: se ou menm sèl ki wè lis envite ou.
Pòt la mache: QR pwoteje, eskane menm san entènèt. Yon tikè pa pase de fwa.
MonCash ak kat: dyaspora a achte tou, tikè a antre nan Apple ak Google Wallet.
Zouti pou vann: early bird, VIP, kòd pwomo, lyen pou pwomotè.
Ekip ou avè ou: admin, manadjè ak moun pou pòt la.
Kreyòl, Fransè, Anglè.

Nou mete pwochen evènman ou an liy pou ou, gratis. Ou pa peye anyen davans. Reponn imèl sa a ak afich la, dat la, kote a ak pri yo.

Vizite: https://www.tikem.co
Aplikasyon an: https://www.tikem.co/download
Prezantasyon an: https://www.tikem.co/decks/Tikem-oganizate-Ayiti.pdf

Fredler Pierre-Louis
Tikèm · tikem.co
WhatsApp: +1 754 276 8676

Si ou pa vle resevwa lòt mesaj, jis reponn "non mèsi".`
}

async function send(
  r: Row,
  to: string,
  scheduledAt: string | null,
  cc: boolean,
  live: boolean,
  discovery = false
) {
  const name = discovery ? cleanName(r.name).display : r.name
  const body: Record<string, unknown> = {
    from: FROM,
    to: [to],
    reply_to: REPLY_TO,
    subject: discovery ? discoverySubject(r.name) : SUBJECT,
    html: discovery ? discoveryOutreachHtml(name) : organizerOutreachHtml(r.name, r.event, r.recent !== 'no'),
    text: discovery ? discoveryText(r.name) : text(r),
    headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=non%20m%C3%A8si>` },
    tags: [{ name: 'campaign', value: discovery ? 'discovery_2026_11' : 'organizer_outreach_2026_10' }],
  }
  if (cc) {
    body.cc = [CC]
    body.bcc = [BCC]
  }
  if (scheduledAt) body.scheduled_at = scheduledAt
  if (!live) return { dryRun: true, to, scheduledAt }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `outreach-2026-10-${to}-${scheduledAt || 'now'}`.slice(0, 256),
    },
    body: JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => ({}))
  return { to, scheduledAt, status: res.status, id: json.id || null, error: json.message || null }
}

async function main() {
  const args = process.argv.slice(2)
  const listPath = args[0]
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const live = args.includes('--send')
  // --discovery: use the phase-2 app/discovery email + per-row personalised subject.
  const discovery = args.includes('--discovery')
  const rows: Row[] = JSON.parse(readFileSync(listPath, 'utf8'))

  const testTo = flag('--test')
  if (testTo) {
    // The first organizer's personalisation, delivered to the tester only, no Cc.
    console.log(await send(rows[0], testTo, null, false, true, discovery))
    return
  }

  const wave = String(flag('--wave') || '')
  const start = flag('--start')
  if (!wave || !start) throw new Error('--wave and --start are required')
  console.log('Checking Resend history for bounces and earlier sends...')
  const { bad, contacted } = await resendHistory()
  const batch: Row[] = []
  const skipped: { email: string; why: string }[] = []
  for (const r of rows.filter((r) => String(r.wave) === wave)) {
    const email = r.email.trim().toLowerCase()
    const why = bad.has(email)
      ? 'bounced/complained before'
      : TEST_ADDRESS.test(email)
        ? 'test address'
        : THROWAWAY_DOMAIN.test(email.split('@')[1] || '')
          ? 'throwaway domain'
          : contacted.has(inboxKey(email))
            ? 'inbox already has a copy'
            : ''
    if (why) skipped.push({ email, why })
    else {
      batch.push(r)
      contacted.add(inboxKey(email))
    }
  }
  for (const s of skipped) console.log(`skip ${s.email} (${s.why})`)
  console.log(`${batch.length} to schedule, ${skipped.length} skipped`)
  const t0 = new Date(start).getTime()
  const log = []
  for (const [i, r] of batch.entries()) {
    const at = new Date(t0 + i * SPACING_MIN * 60_000).toISOString()
    const out = await send(r, r.email.trim(), at, true, live, discovery)
    console.log(JSON.stringify(out))
    log.push({ ...out, name: r.name, event: r.event })
    await new Promise((ok) => setTimeout(ok, 600))
  }
  if (live) writeFileSync(listPath.replace(/[^/]+$/, `outreach-log-wave${wave}.json`), JSON.stringify(log, null, 1))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
