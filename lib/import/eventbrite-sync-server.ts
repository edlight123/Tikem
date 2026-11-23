import 'server-only'
/**
 * Keep an organizer's Eventbrite events on Tikèm (lib/import/eventbrite-sync
 * holds the rules). Sequential and polite: a few pages per run, one call at a
 * time, and on a 429 it stops and the next run picks up (past events whose
 * counts are already stored aren't asked again). Attendee lists are COUNTED,
 * never stored: only Eventbrite's own total (pagination.object_count) is read.
 */
import { adminDb } from '@/lib/firebase/admin'
import { orgDisplayName } from '@/lib/organizer/context'
import { ebGet, loadToken } from '@/lib/import/eventbrite-server'
import { importDraftId, orgStartingCountry, storeImage } from '@/lib/import/drafts'
import {
  EB_PAST_MONTHS,
  EB_SOURCE,
  ebEventDocId,
  ebStatsFrom,
  emptySyncResult,
  mapEventbriteToEventFields,
  planEventbriteDoc,
  planMissingEventbriteDoc,
  type EbStats,
  type EbSyncResult,
} from '@/lib/import/eventbrite-sync'

const MAX_ORGS = 5
const MAX_PAGES = 4
const MAX_IMAGES = 20
const MAX_STATS = 40
const EXPAND = 'expand=venue,ticket_classes,logo&page_size=50'

class RateLimited extends Error {}

async function get(token: string, path: string): Promise<{ status: number; data: any | null }> {
  const r = await ebGet(token, path)
  if (r.status === 429) throw new RateLimited()
  return r
}

/** Every page (capped) of one organization's events for a query; `complete` false when cut short. */
async function pages(token: string, orgPath: string, query: string, stop?: (ev: any) => boolean): Promise<{ events: any[]; complete: boolean }> {
  const out: any[] = []
  let continuation = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await get(token, `${orgPath}?${query}&${EXPAND}${continuation ? `&continuation=${encodeURIComponent(continuation)}` : ''}`)
    if (!r.data) return { events: out, complete: false }
    for (const ev of r.data.events || []) {
      if (stop?.(ev)) return { events: out, complete: true }
      out.push(ev)
    }
    if (!r.data.pagination?.has_more_items || !r.data.pagination?.continuation) return { events: out, complete: true }
    continuation = r.data.pagination.continuation
  }
  return { events: out, complete: false }
}

/** Attendees still attending (checked in or not), as Eventbrite counts them; null when not allowed. */
async function attendingCount(token: string, eventId: string): Promise<number | null> {
  const r = await get(token, `/events/${encodeURIComponent(eventId)}/attendees/?status=attending`)
  if (!r.data) return null
  const n = Number(r.data.pagination?.object_count)
  if (Number.isFinite(n) && n >= 0) return n
  // No total given: count the first page only if it is the whole list.
  return r.data.pagination?.has_more_items ? null : Array.isArray(r.data.attendees) ? r.data.attendees.length : null
}

async function prevDocs(ids: string[]): Promise<Map<string, Record<string, any> | null>> {
  const out = new Map<string, Record<string, any> | null>()
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => adminDb.collection('events').doc(id))
    if (!refs.length) continue
    const snaps = await adminDb.getAll(...refs)
    snaps.forEach((s: any) => out.set(s.id, s.exists ? s.data() || {} : null))
  }
  return out
}

/** An event the organizer already brought over by hand (lib/import/drafts imp_ id) is theirs to run. */
async function handImportedIds(orgId: string, ebIds: string[]): Promise<Set<string>> {
  const byImp = new Map(ebIds.map((id) => [importDraftId(orgId, `eventbrite:${id}`), id]))
  const docs = await prevDocs([...byImp.keys()])
  const out = new Set<string>()
  docs.forEach((d, impId) => {
    if (d) out.add(byImp.get(impId)!)
  })
  return out
}

export async function syncEventbriteForOrg(orgId: string, opts: { now?: number; deadlineMs?: number } = {}): Promise<EbSyncResult> {
  const now = opts.now ?? Date.now()
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000)
  const result = emptySyncResult()
  const integration = adminDb.collection('organizer_integrations').doc(orgId)
  const finish = async (r: EbSyncResult) => {
    const { ok, reason, ...counts } = r
    await integration
      .set({ eventbrite: { last_synced_at: new Date().toISOString(), last_sync_result: { ok, reason: reason || null, ...counts } } }, { merge: true })
      .catch(() => {})
    return r
  }

  const token = await loadToken(orgId)
  if (!token) return { ...result, ok: false, reason: 'not_connected' }

  try {
    const orgs = await get(token, '/users/me/organizations/')
    if (!orgs.data) return finish({ ...result, ok: false, reason: orgs.status === 401 ? 'expired' : 'unavailable' })
    const [orgName, organizerSnap, fallbackCountry] = await Promise.all([
      orgDisplayName(orgId),
      adminDb.collection('users').doc(orgId).get().catch(() => null),
      orgStartingCountry(orgId),
    ])
    const organizer = organizerSnap?.exists ? organizerSnap.data() || null : null

    const pastCutoff = now - EB_PAST_MONTHS * 30.44 * 86_400_000
    const upcoming: any[] = []
    const past: any[] = []
    let upcomingComplete = true
    for (const o of (orgs.data.organizations || []).slice(0, MAX_ORGS)) {
      const orgPath = `/organizations/${encodeURIComponent(o.id)}/events/`
      const up = await pages(token, orgPath, 'status=live,started,ended,completed,canceled,draft&time_filter=current_future&order_by=start_asc')
      upcoming.push(...up.events)
      upcomingComplete &&= up.complete
      const old = await pages(token, orgPath, 'status=ended,completed&time_filter=past&order_by=start_desc', (ev) => (Date.parse(ev?.start?.utc) || 0) < pastCutoff)
      past.push(...old.events)
    }

    const all = [...upcoming, ...past].filter((ev, i, a) => ev?.id && a.findIndex((x) => String(x.id) === String(ev.id)) === i)
    const ids = all.map((ev) => ebEventDocId(ev.id))
    const [prev, handled] = await Promise.all([prevDocs(ids), handImportedIds(orgId, all.map((ev) => String(ev.id)))])
    let images = 0
    let statsCalls = 0

    for (const ev of all) {
      if (Date.now() > deadline) {
        upcomingComplete = false
        break
      }
      const id = ebEventDocId(ev.id)
      const before = prev.get(id) ?? null
      if (!before && handled.has(String(ev.id))) {
        result.skipped++
        continue
      }
      const end = Date.parse(ev?.end?.utc) || Date.parse(ev?.start?.utc) || 0
      const isPast = end > 0 && end <= now
      const status = String(ev?.status || '').toLowerCase()

      // Past events: Eventbrite's counts, once (they are final when it is over).
      let stats: EbStats | null | undefined
      if (isPast && (status === 'ended' || status === 'completed') && !before?.imported?.stats_fetched_at && !result.rate_limited) {
        if (statsCalls < MAX_STATS) {
          statsCalls++
          let attended: number | null = null
          try {
            attended = await attendingCount(token, String(ev.id))
          } catch (e) {
            if (!(e instanceof RateLimited)) throw e
            result.rate_limited = true
          }
          if (!result.rate_limited) {
            stats = ebStatsFrom(ev, attended)
            result.stats++
          }
        }
      }

      // The photo, copied into our bucket when it is new or changed (not for edited copies).
      let banner: string | null | undefined
      const fields = mapEventbriteToEventFields(ev, fallbackCountry)
      const src = fields?._image_src ?? null
      if (fields && before?.imported?.locally_edited !== true && (before?.imported?.image_src ?? null) !== src && images < MAX_IMAGES) {
        images++
        banner = src ? await storeImage(orgId, src) : null
      }

      const plan = planEventbriteDoc({ ev, prev: before, orgId, orgName, now, fallbackCountry, organizer, stats, banner })
      if (plan.kind === 'skip') {
        if (plan.reason !== 'not_live') result.skipped++
        continue
      }
      await adminDb.collection('events').doc(plan.id).set(plan.data, { merge: true })
      if (plan.created) result.created++
      else result.updated++
      if (plan.unpublished) result.unpublished++
      if (plan.flags.length && !plan.published) result.needs_review++
      if (plan.past && plan.published) result.past++
    }

    // Deleted on Eventbrite (gone from a complete upcoming list): unpublish the copy.
    if (upcomingComplete && !result.rate_limited) {
      const seen = new Set(ids)
      const mine = await adminDb.collection('events').where('organizer_id', '==', orgId).where('imported.source', '==', EB_SOURCE).limit(500).get()
      for (const d of mine.docs as any[]) {
        if (seen.has(d.id)) continue
        const patch = planMissingEventbriteDoc(d.data() || {}, now)
        if (!patch) continue
        await d.ref.set(patch, { merge: true })
        result.unpublished++
      }
    }
  } catch (e) {
    if (e instanceof RateLimited) result.rate_limited = true
    else {
      console.error('[eventbrite-sync]', orgId, (e as any)?.message || e)
      return finish({ ...result, ok: false, reason: 'unavailable' })
    }
  }
  return finish(result)
}

/** Every connected org with auto_sync on, one after another, within the cron's time. */
export async function syncAllEventbrite(opts: { deadlineMs?: number } = {}): Promise<Array<{ orgId: string } & EbSyncResult>> {
  const stopAt = Date.now() + (opts.deadlineMs ?? 270_000)
  const snap = await adminDb.collection('organizer_integrations').where('eventbrite.auto_sync', '==', true).limit(200).get()
  // Least recently synced first, so a run cut short is fair to everyone.
  const docs = [...(snap.docs as any[])].sort((a, b) => String(a.data()?.eventbrite?.last_synced_at || '').localeCompare(String(b.data()?.eventbrite?.last_synced_at || '')))
  const out: Array<{ orgId: string } & EbSyncResult> = []
  for (const d of docs) {
    const left = stopAt - Date.now()
    if (left < 15_000) break
    const r = await syncEventbriteForOrg(d.id, { deadlineMs: Math.min(60_000, left - 10_000) })
    out.push({ orgId: d.id, ...r })
  }
  return out
}
