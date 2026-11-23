/**
 * Keeping the acting org's Eventbrite events on Tikèm (lib/import/eventbrite-sync-server).
 *   GET                  → { available, connected, auto_sync, last_synced_at, last_sync_result }
 *   POST                 → sync now (rate limited), returns the counts
 *   PATCH { auto_sync }  → turn the daily sync on or off
 */
import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/organizer/context'
import { adminDb } from '@/lib/firebase/admin'
import { consumeRateLimit } from '@/lib/rate-limit'
import { eventbriteConfigured } from '@/lib/import/eventbrite-server'
import { syncEventbriteForOrg } from '@/lib/import/eventbrite-sync-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function status(orgId: string) {
  const snap = await adminDb.collection('organizer_integrations').doc(orgId).get()
  const eb = snap.exists ? snap.data()?.eventbrite : null
  const r = eb?.last_sync_result || null
  return {
    available: eventbriteConfigured(),
    connected: !!eb?.token,
    auto_sync: eb?.token ? eb.auto_sync === true : false,
    last_synced_at: typeof eb?.last_synced_at === 'string' ? eb.last_synced_at : null,
    // Counts only: nothing about the Eventbrite account itself.
    last_sync_result: r
      ? {
          ok: r.ok === true,
          reason: r.reason || null,
          created: Number(r.created || 0),
          updated: Number(r.updated || 0),
          unpublished: Number(r.unpublished || 0),
          needs_review: Number(r.needs_review || 0),
          rate_limited: r.rate_limited === true,
        }
      : null,
  }
}

export async function GET() {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  return NextResponse.json(await status(gate.value.orgId))
}

export async function POST() {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  if (!eventbriteConfigured()) return NextResponse.json({ error: 'Eventbrite import is not available yet.', code: 'unavailable' }, { status: 503 })
  const { limited } = await consumeRateLimit({ key: `eventbrite-sync:${gate.value.orgId}`, limit: 6, windowMs: 60 * 60_000 })
  if (limited) return NextResponse.json({ error: 'You synced a few times already. Try again in a little while.', code: 'rate_limited' }, { status: 429 })
  const result = await syncEventbriteForOrg(gate.value.orgId, { deadlineMs: 50_000 })
  if (!result.ok && result.reason === 'not_connected') return NextResponse.json({ error: 'Connect Eventbrite first.', code: 'not_connected' }, { status: 400 })
  return NextResponse.json({ ...(await status(gate.value.orgId)), result })
}

export async function PATCH(req: Request) {
  const gate = await requireOrg('manage_events')
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => ({}))
  if (typeof body?.auto_sync !== 'boolean') return NextResponse.json({ error: 'auto_sync must be true or false.' }, { status: 400 })
  const now = await status(gate.value.orgId)
  if (!now.connected) return NextResponse.json({ error: 'Connect Eventbrite first.', code: 'not_connected' }, { status: 400 })
  await adminDb.collection('organizer_integrations').doc(gate.value.orgId).set({ eventbrite: { auto_sync: body.auto_sync } }, { merge: true })
  return NextResponse.json({ ...now, auto_sync: body.auto_sync })
}
