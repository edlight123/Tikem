import { unstable_cache } from 'next/cache'
import { adminDb } from '@/lib/firebase/admin'
import { NEW_READ_WINDOW_MS } from '@/lib/home/new-on-tikem'

/** Docs read per stored type of created_at; the catalogue is small, the country cut is in memory. */
const READ_MAX = 150

/** Top-level Timestamps → ISO strings, so the rows survive the cache's JSON. */
function plain(id: string, data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { id }
  for (const [k, v] of Object.entries(data || {})) {
    out[k] = v && typeof (v as any).toDate === 'function' ? (v as any).toDate().toISOString() : v
  }
  return out
}

/**
 * Published events created in the last two weeks, newest first, for Home's
 * "new on Tikèm" rail (lib/home/new-on-tikem picks from them). Read on their
 * own, not from the soonest-first feed, so an event announced today for a date
 * weeks out still surfaces.
 *
 * created_at is an ISO string on web-made events and a Timestamp on app-made
 * ones, and a range matches only its own type, so it is read once per type
 * (the lib/firestore/dateRange trick). Country is applied in memory, so this
 * uses the deployed index events is_published ASC + created_at DESC and needs
 * no new one. A failed read gives an empty rail, never a broken page.
 */
const readNewDocs = unstable_cache(
  async (sinceIso: string): Promise<Array<Record<string, any>>> => {
    const since = new Date(sinceIso)
    // published_at (ISO, stamped on first publish: lib/events/publishedAt)
    // catches an old draft published today; created_at covers events from
    // before that stamp, read once per stored type (Timestamp / ISO string).
    const read = (field: 'published_at' | 'created_at', bound: Date | string) =>
      adminDb
        .collection('events')
        .where('is_published', '==', true)
        .where(field, '>=', bound)
        .orderBy(field, 'desc')
        .limit(READ_MAX)
        .get()
        .catch((err: any) => {
          console.warn('[new-on-tikem] read failed', err?.message)
          return null
        })
    const snaps = await Promise.all([
      read('published_at', since.toISOString()),
      read('created_at', since),
      read('created_at', since.toISOString()),
    ])
    const seen = new Set<string>()
    const out: Array<Record<string, any>> = []
    for (const s of snaps) {
      for (const d of (s?.docs || []) as any[]) {
        if (seen.has(d.id)) continue
        seen.add(d.id)
        out.push(plain(d.id, d.data()))
      }
    }
    return out
  },
  ['home-new-on-tikem'],
  { revalidate: 60 }
)

export async function readNewOnTikemDocs(now: number): Promise<Array<Record<string, any>>> {
  // The bound is rounded to the hour so the cache key holds for an hour; the
  // exact two-week cut is applied in memory (selectNewOnTikem).
  const hour = 3_600_000
  const since = Math.floor((now - NEW_READ_WINDOW_MS) / hour) * hour - hour
  try {
    return await readNewDocs(new Date(since).toISOString())
  } catch (err: any) {
    console.warn('[new-on-tikem] cache read failed', err?.message)
    return []
  }
}
