/**
 * POST /api/organizer/import: bring events over from another platform
 * (Eventbrite, Luma, Meetup, or any page with schema.org Event markup).
 *
 *   { url }                  → preview: the upcoming events found on that page
 *   { url, uids: string[] }  → create them as DRAFTS in the acting org, photo
 *                              copied into our storage, one ticket type at the
 *                              listed price (lib/import/drafts)
 *
 * The page is re-read server-side on create (the client's copy is never
 * trusted). Fetches go through lib/import/safe-fetch (public https only, DNS
 * pinned to public addresses, redirects re-checked, 15 s, size caps). Rate
 * limited per user, since every call makes outbound requests.
 */
import { NextResponse } from 'next/server'
import { requireOrg, orgDisplayName } from '@/lib/organizer/context'
import { consumeRateLimit } from '@/lib/rate-limit'
import { safeFetchText, isPublicHttpsUrl } from '@/lib/import/safe-fetch'
import { orgStartingCountry, writeDraft, type DraftResult } from '@/lib/import/drafts'
import { parseImportedEvents, type ImportedEvent } from '@/lib/import/event-page'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_IMPORT = 20

async function readPage(url: string): Promise<{ events: ImportedEvent[]; finalUrl: string } | { error: string; code: string }> {
  if (!isPublicHttpsUrl(url)) return { error: 'Paste a public https link to an event or organizer page.', code: 'bad_url' }
  const got = await safeFetchText(url)
  if (!got) return { error: 'We couldn’t open that page. Check the link, or try the event’s own page.', code: 'unreachable' }
  const events = parseImportedEvents(got.text, got.finalUrl).filter((e) => Date.parse(e.start) > Date.now() - 86_400_000)
  if (!events.length) return { error: 'No upcoming events found on that page. Try the link to one event.', code: 'none_found' }
  return { events: events.slice(0, 50), finalUrl: got.finalUrl }
}

export async function POST(req: Request) {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  const ctx = gate.value

  const body = await req.json().catch(() => ({}))
  const uids: string[] = Array.isArray(body?.uids) ? body.uids.map(String).slice(0, MAX_IMPORT) : []
  // Previews are cheap-ish (one page); imports also copy photos.
  const { limited } = await consumeRateLimit({ key: `import-link:${ctx.user.id}`, limit: 30, windowMs: 60 * 60_000, cost: uids.length ? 3 : 1 })
  if (limited) return NextResponse.json({ error: 'Too many imports for now. Try again in a little while.', code: 'rate_limited' }, { status: 429 })

  const url = String(body?.url || '').trim().slice(0, 500)
  const page = await readPage(url)
  if ('error' in page) return NextResponse.json({ error: page.error, code: page.code }, { status: 400 })

  if (!uids.length) {
    return NextResponse.json({
      events: page.events.map(({ uid, title, start, venue, city, online, image, price, currency }) => ({ uid, title, start, venue, city, online, image, price, currency })),
    })
  }

  const chosen = page.events.filter((e) => uids.includes(e.uid))
  const [orgName, fallbackCountry] = await Promise.all([orgDisplayName(ctx.orgId), orgStartingCountry(ctx.orgId)])
  const source = new URL(page.finalUrl).hostname.replace(/^www\./, '')
  const created: DraftResult[] = []
  for (const e of chosen) {
    const price = e.price ?? 0
    created.push(
      await writeDraft(
        { orgId: ctx.orgId, userId: ctx.user.id, orgName, fallbackCountry },
        {
          key: e.uid,
          title: e.title,
          description: e.description,
          start: e.start,
          end: e.end,
          venue: e.venue,
          address: e.address,
          city: e.city,
          country: e.country,
          online: e.online,
          image: e.image,
          url: e.url || page.finalUrl,
          source,
          currency: e.currency,
          tiers: [{ name: price > 0 ? 'General admission' : 'Free', price, quantity: 100 }],
        },
      ),
    )
  }
  return NextResponse.json({ ok: true, created })
}
