/**
 * Preview the organizer post-event recap email (lib/email-templates/eventRecap)
 * with sample data, in en/fr/ht, plus an edge case (no poster, no ratings, no
 * ticket sales). Writes HTML files only; sends nothing.
 *
 *   npx tsx scripts/preview-recap-email.ts [outDir]   (default: tmp-recap-previews)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getEventRecapEmail, type RecapEmailData, type RecapEmailEvent } from '../lib/email-templates/eventRecap'
import { appUrl } from '../lib/email-kit/layout'
import type { EmailLang } from '../lib/email-kit/i18n'

const outDir = process.argv[2] || 'tmp-recap-previews'
mkdirSync(outDir, { recursive: true })

const event: RecapEmailEvent = {
  id: 'sample-event',
  title: 'Kompa Lakay: Nuit Blanche',
  start_datetime: '2026-11-15T01:00:00.000Z', // Sat 14 Nov, 8:00 PM in Port-au-Prince
  timezone: 'America/Port-au-Prince',
  city: 'Pétion-Ville',
  country: 'HT',
  banner_image_url: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1080&q=80',
}

// 30-minute buckets from 8:00 PM local (01:00Z).
const slot = (i: number) => new Date(Date.parse('2026-11-15T01:00:00.000Z') + i * 30 * 60_000).toISOString()

const recap: RecapEmailData = {
  sold: 41,
  checkedIn: 38,
  revenue: 152000,
  currency: 'HTG',
  arrivals: [3, 7, 14, 9, 4, 1].map((count, i) => ({ at: slot(i), count })),
  newFollowers: 5,
  feedback: {
    total: 16,
    counts: { 1: 1, 2: 3, 3: 12 },
    comments: [
      { name: 'Nadège Pierre', rating: 3, text: 'Best night of the year. The band played until 2 and nobody wanted to leave.', at: null },
      { name: 'Jean-Marc', rating: 2, text: 'Great music. The line at the door was long around 9:30, maybe open a second lane next time.', at: null },
    ],
  },
}

const edge: RecapEmailData = {
  sold: 120,
  checkedIn: 0,
  revenue: 0,
  currency: 'HTG',
  arrivals: [],
  newFollowers: 0,
  feedback: { total: 0, counts: { 1: 0, 2: 0, 3: 0 }, comments: [] },
}

const recapUrl = `${appUrl()}/organizer/events/${event.id}/recap`
const written: string[] = []
for (const lang of ['en', 'fr', 'ht'] as EmailLang[]) {
  const { subject, html } = getEventRecapEmail({ lang, event, recap, includeRevenue: true, recapUrl })
  const file = join(outDir, `recap-${lang}.html`)
  writeFileSync(file, html)
  written.push(`${file}  (${subject})`)
}

// Manager view (no revenue) and the empty edge case.
{
  const { html } = getEventRecapEmail({ lang: 'en', event, recap, includeRevenue: false, recapUrl })
  writeFileSync(join(outDir, 'recap-en-manager.html'), html)
  written.push(join(outDir, 'recap-en-manager.html'))
}
{
  const { subject, html } = getEventRecapEmail({
    lang: 'en',
    event: { ...event, title: 'Sunday Brunch Rara', banner_image_url: null },
    recap: edge,
    includeRevenue: false,
    recapUrl,
  })
  writeFileSync(join(outDir, 'recap-en-edge.html'), html)
  written.push(`${join(outDir, 'recap-en-edge.html')}  (${subject})`)
}

console.log(written.join('\n'))
