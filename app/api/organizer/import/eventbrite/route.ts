/**
 * The acting org's Eventbrite events.
 *   GET           → { available, connected, expired?, events: [{ id, title, start, venue, online, image, currency, tiers }] }
 *   POST { ids }  → import those as DRAFTS with their ticket types (re-read
 *                   from Eventbrite, never from the client)
 *   DELETE        → disconnect (forget the token)
 *
 * `available` is false when the Eventbrite app isn't configured
 * (EVENTBRITE_CLIENT_ID / EVENTBRITE_CLIENT_SECRET / INTEGRATIONS_ENCRYPTION_KEY):
 * the UI then hides Connect Eventbrite. Everything needs manage_events.
 */
import { NextResponse } from 'next/server'
import { requireOrg, orgDisplayName } from '@/lib/organizer/context'
import { consumeRateLimit } from '@/lib/rate-limit'
import { adminDb } from '@/lib/firebase/admin'
import { eventbriteConfigured, forget, listEvents, loadToken } from '@/lib/import/eventbrite-server'
import { mapEventbriteEvent } from '@/lib/import/eventbrite'
import { ebEventDocId } from '@/lib/import/eventbrite-sync'
import { orgStartingCountry, writeDraft, type DraftResult } from '@/lib/import/drafts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  if (!eventbriteConfigured()) return NextResponse.json({ available: false, connected: false, events: [] })
  const orgId = gate.value.orgId
  const token = await loadToken(orgId)
  if (!token) return NextResponse.json({ available: true, connected: false, events: [] })
  const raw = await listEvents(token)
  if (!raw) return NextResponse.json({ available: true, connected: false, expired: true, events: [] })
  // Already listed on Tikèm by the sync (lib/import/eventbrite-sync-server): not offered twice.
  const synced = new Set<string>()
  const refs = raw.map((ev) => adminDb.collection('events').doc(ebEventDocId(ev.id)))
  if (refs.length) {
    const snaps = await adminDb.getAll(...refs).catch(() => [] as any[])
    snaps.forEach((s: any) => {
      const d = s.exists ? s.data() || {} : null
      if (d && d.organizer_id === orgId && d.is_published === true) synced.add(String(d.imported?.source_event_id || ''))
    })
  }
  const events = raw
    .filter((ev) => !synced.has(String(ev.id)))
    .map((ev) => ({ id: String(ev.id), d: mapEventbriteEvent(ev) }))
    .filter((x) => x.d)
    .map(({ id, d }) => ({ id, title: d!.title, start: d!.start, venue: d!.venue || d!.city, online: d!.online, image: d!.image, currency: d!.currency, tiers: d!.tiers }))
  return NextResponse.json({ available: true, connected: true, events })
}

export async function POST(req: Request) {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  const ctx = gate.value
  if (!eventbriteConfigured()) return NextResponse.json({ error: 'Eventbrite import is not available yet.', code: 'unavailable' }, { status: 503 })
  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 50) : []
  if (!ids.length) return NextResponse.json({ error: 'Pick at least one event.', code: 'none_picked' }, { status: 400 })
  const { limited } = await consumeRateLimit({ key: `import-eventbrite:${ctx.user.id}`, limit: 10, windowMs: 60 * 60_000 })
  if (limited) return NextResponse.json({ error: 'Too many imports for now. Try again in a little while.', code: 'rate_limited' }, { status: 429 })
  const token = await loadToken(ctx.orgId)
  if (!token) return NextResponse.json({ error: 'Connect Eventbrite first.', code: 'not_connected' }, { status: 400 })
  const raw = await listEvents(token)
  if (!raw) return NextResponse.json({ error: 'Eventbrite didn’t answer. Reconnect and try again.', code: 'expired' }, { status: 502 })
  const [orgName, fallbackCountry] = await Promise.all([orgDisplayName(ctx.orgId), orgStartingCountry(ctx.orgId)])
  const created: DraftResult[] = []
  for (const ev of raw.filter((e) => ids.includes(String(e.id)))) {
    const d = mapEventbriteEvent(ev)
    if (!d) continue
    created.push(await writeDraft({ orgId: ctx.orgId, userId: ctx.user.id, orgName, fallbackCountry }, d))
  }
  return NextResponse.json({ ok: true, created })
}

export async function DELETE() {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  await forget(gate.value.orgId)
  return NextResponse.json({ ok: true })
}
