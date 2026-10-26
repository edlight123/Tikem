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
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { organizerOutreachHtml } from './build-organizer-outreach-email'

const FROM = 'Fredler · Tikèm <events@hello.tikem.co>'
const REPLY_TO = 'info@tikem.co'
const CC = 'fredler@tikem.co'
const SUBJECT = 'Tikè ou yo, san tèt chaje'
const SPACING_MIN = 3

type Row = { wave: string | number; name: string; email: string; event: string; recent: string }

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

async function send(r: Row, to: string, scheduledAt: string | null, cc: boolean, live: boolean) {
  const body: Record<string, unknown> = {
    from: FROM,
    to: [to],
    reply_to: REPLY_TO,
    subject: SUBJECT,
    html: organizerOutreachHtml(r.name, r.event, r.recent !== 'no'),
    text: text(r),
    headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=non%20m%C3%A8si>` },
    tags: [{ name: 'campaign', value: 'organizer_outreach_2026_10' }],
  }
  if (cc) body.cc = [CC]
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
  const rows: Row[] = JSON.parse(readFileSync(listPath, 'utf8'))

  const testTo = flag('--test')
  if (testTo) {
    // The first wave-1 organizer's personalisation, delivered to the tester only, no Cc.
    console.log(await send(rows[0], testTo, null, false, true))
    return
  }

  const wave = String(flag('--wave') || '')
  const start = flag('--start')
  if (!wave || !start) throw new Error('--wave and --start are required')
  const batch = rows.filter((r) => String(r.wave) === wave)
  const t0 = new Date(start).getTime()
  const log = []
  for (const [i, r] of batch.entries()) {
    const at = new Date(t0 + i * SPACING_MIN * 60_000).toISOString()
    const out = await send(r, r.email.trim(), at, true, live)
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
