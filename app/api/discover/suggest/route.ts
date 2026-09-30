/**
 * Discover autosuggest — the one query behind the /discover search field.
 *
 * Priority order is the feature: events first (this is a ticketing site), then
 * organizers, then people (friends ranked above strangers, signed-in only), then
 * a small cities tail that filters rather than navigates.
 *
 * Firestore has no substring search, so this uses the two tools it does have:
 *   - prefix range queries (`orderBy(f).startAt(q).endAt(q + PREFIX_END)`) on the
 *     public_profiles name fields, which is what makes people/organizers cheap;
 *   - a bounded in-memory scan of the published upcoming events. That set is
 *     small (~27 today) AND it is the same 30s-cached read the discover page
 *     itself performs (getDiscoverEvents), so on a warm cache it costs nothing
 *     and it inherits the project's Timestamp-vs-string coercion instead of
 *     re-inventing a type-sensitive inequality query.
 */

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { getDiscoverEvents } from '@/lib/data/events'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { getAcceptedFriendIds } from '@/lib/firestore/connections'
import { getCitiesForCountry } from '@/lib/filters/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Abuse guards: a suggestion query is never long, and never returns much. */
const MAX_Q_LENGTH = 60
const MAX_EVENTS = 4
const MAX_ORGANIZERS = 2
const MAX_PEOPLE = 2
const MAX_CITIES = 3
/** Bounded candidate set per prefix query — enough to rank, small enough to be fast. */
const PROFILE_QUERY_LIMIT = 8
/** Hard ceiling on profile docs we will consider before ranking. */
const MAX_PROFILE_CANDIDATES = 40
/** Event hosts whose profiles we resolve outright for case-insensitive matching. */
const MAX_HOST_PROFILES = 50

/** public_profiles fields that carry a searchable display name. */
const NAME_FIELDS = ['organization_name', 'full_name', 'username'] as const

/** Firestore's conventional "end of any string with this prefix" sentinel. */
const PREFIX_END = '\uf8ff'

interface EventSuggestion {
  id: string
  title: string
  image: string | null
  city: string
  date: string
}

interface ProfileSuggestion {
  uid: string
  name: string
  photo: string | null
  verified: boolean
  /** People only: true when the viewer and this user are accepted friends. */
  connected?: boolean
}

/**
 * Match strength of `haystack` against an already-lowercased query.
 * 0 = whole-string prefix, 1 = word prefix, 2 = substring, -1 = no match.
 * Lower is better so scores compose by simple addition of a field offset.
 */
/**
 * Case AND diacritics, because half this catalogue is written in Kreyòl and
 * French. Lowercasing alone meant `montreal` matched nothing while `Montréal`
 * matched three events, and `foj` missed `FÒJ 2026` — nobody types an accent
 * on a phone keyboard. NFD splits a letter from its combining mark, then the
 * marks are dropped, so `ò` and `o` compare equal.
 */
// Not exported: Next validates a route file's exports and rejects unknown ones.
function fold(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function matchRank(haystack: unknown, q: string): number {
  const h = fold(haystack)
  if (!h) return -1
  if (h.startsWith(q)) return 0
  // Static split (never a regex built from user input).
  if (h.split(/[^0-9a-zà-ÿ]+/).some((word) => word && word.startsWith(q))) return 1
  if (h.includes(q)) return 2
  return -1
}

/** Pick the best of several candidate haystacks. */
function bestRank(q: string, ...haystacks: unknown[]): number {
  let best = -1
  for (const h of haystacks) {
    const r = matchRank(h, q)
    if (r >= 0 && (best < 0 || r < best)) best = r
  }
  return best
}

/**
 * Casing variants to run prefix queries with. Firestore range queries are
 * byte-exact, and this project stores names as the user typed them
 * ("Jean Pierre", "konpa_kings"), so we probe the raw, lowercase and
 * capitalized forms — the same forgiveness /api/users/search already applies.
 */
function casingVariants(q: string): string[] {
  const lower = q.toLowerCase()
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1)
  return Array.from(new Set([q, lower, capitalized]))
}

/**
 * Fetch a bounded set of public_profiles docs whose name fields start with the
 * query. Each individual query is isolated so one missing single-field index
 * degrades that probe instead of failing the whole handler.
 */
async function fetchProfileCandidates(q: string): Promise<Map<string, any>> {
  const candidates = new Map<string, any>()
  if (typeof (adminDb as any)?.collection !== 'function') return candidates

  const probes: Promise<any[]>[] = []
  for (const field of NAME_FIELDS) {
    for (const variant of casingVariants(q)) {
      probes.push(
        adminDb
          .collection('public_profiles')
          .orderBy(field)
          .startAt(variant)
          .endAt(variant + PREFIX_END)
          .limit(PROFILE_QUERY_LIMIT)
          .get()
          .then((snap: any) => snap.docs)
          .catch((err: any) => {
            console.warn(`[discover/suggest] public_profiles probe failed on ${field}`, err?.message)
            return []
          })
      )
    }
  }

  const results = await Promise.all(probes)
  for (const docs of results) {
    for (const doc of docs) {
      if (candidates.size >= MAX_PROFILE_CANDIDATES) return candidates
      if (!candidates.has(doc.id)) candidates.set(doc.id, doc.data() || {})
    }
  }
  return candidates
}

/**
 * Resolve the public profiles of the organizers hosting the event pool.
 *
 * The prefix probes above are byte-exact, so a lowercase "edlight" never finds
 * "EdLight Initiative". Event hosts are a small bounded set we already know the
 * ids of, so we can fetch them outright and match them case-insensitively (and
 * on word boundaries) in memory — which is exactly the organizer people are
 * most likely to be searching for, since they have events on sale.
 */
async function fetchHostProfiles(hostIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  const ids = hostIds.slice(0, MAX_HOST_PROFILES)
  if (ids.length === 0 || typeof (adminDb as any)?.collection !== 'function') return out

  try {
    const refs = ids.map((id) => adminDb.collection('public_profiles').doc(id))
    const docs = await (adminDb as any).getAll(...refs)
    for (const doc of docs) {
      if (doc?.exists) out.set(doc.id, doc.data() || {})
    }
  } catch (err: any) {
    console.warn('[discover/suggest] host profile fetch failed', err?.message)
  }
  return out
}

/** Display name for a public profile, organization first (the brand people search). */
function profileName(data: any): string {
  return String(
    data?.organization_name || data?.full_name || data?.username || ''
  ).trim()
}

function profilePhoto(data: any): string | null {
  const photo = data?.organization_logo || data?.photo_url || data?.photoURL
  return photo ? String(photo) : null
}

export async function GET(request: Request) {
  try {
    // Next 15: read the query off the request URL, never from a params promise.
    const { searchParams } = new URL(request.url)
    const raw = (searchParams.get('q') || '').trim()
    if (raw.length < 2) {
      return NextResponse.json({})
    }
    const q = raw.slice(0, MAX_Q_LENGTH)
    // Folded to match `matchRank`'s haystack — one side alone fixes nothing.
    const needle = fold(q)
    const country = (searchParams.get('country') || 'HT').slice(0, 4).toUpperCase()

    // Auth, the event pool and the profile probes are independent — fan out.
    const [user, eventPool, profileCandidates] = await Promise.all([
      getCurrentUser().catch(() => null),
      getDiscoverEvents({}, 200).catch((err) => {
        console.warn('[discover/suggest] event pool failed', err?.message)
        return [] as any[]
      }),
      fetchProfileCandidates(q),
    ])

    // ---- 1. Events: title (prefix > word > substring), then venue, then city.
    const blockedOrganizers = await getBlockedOrganizerIds((user as any)?.id)
    const events: EventSuggestion[] = filterBlockedEvents(eventPool as any[], blockedOrganizers)
      .map((event: any) => {
        const titleRank = matchRank(event?.title, needle)
        const venueRank = matchRank(event?.venue_name, needle)
        const cityRank = matchRank(event?.city, needle)
        // Field offsets keep title above venue above city regardless of how
        // strong the weaker field's match is.
        let score = -1
        if (titleRank >= 0) score = titleRank
        else if (venueRank >= 0) score = 10 + venueRank
        else if (cityRank >= 0) score = 20 + cityRank
        return { event, score }
      })
      .filter((row) => row.score >= 0)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score
        // Same relevance → soonest first.
        const ta = new Date(a.event?.start_datetime).getTime()
        const tb = new Date(b.event?.start_datetime).getTime()
        return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb)
      })
      .slice(0, MAX_EVENTS)
      .map(({ event }) => ({
        id: String(event.id),
        title: String(event.title || ''),
        image: event.banner_image_url || event.image_url || null,
        city: String(event.city || ''),
        date: String(event.start_datetime || ''),
      }))

    // Organizer signal: anyone hosting a published upcoming event, plus anyone
    // who has filled in an organization name.
    const hostIds = new Set<string>(
      eventPool.map((e: any) => String(e?.organizer_id || '')).filter(Boolean)
    )

    // Host profiles (case-insensitive) + the byte-exact prefix probes.
    // Friends are only consulted for a signed-in requester.
    const [hostProfiles, friendIdList] = await Promise.all([
      fetchHostProfiles(Array.from(hostIds)),
      user ? getAcceptedFriendIds(user.id).catch(() => [] as string[]) : Promise.resolve([]),
    ])
    const friendIds = new Set(friendIdList)

    const allProfiles = new Map<string, any>(profileCandidates)
    hostProfiles.forEach((data, uid) => {
      if (!allProfiles.has(uid)) allProfiles.set(uid, data)
    })

    const organizerRows: Array<{ item: ProfileSuggestion; score: number }> = []
    const peopleRows: Array<{ item: ProfileSuggestion; score: number }> = []

    allProfiles.forEach((data, uid) => {
      if (user && uid === user.id) return // never suggest yourself
      const name = profileName(data)
      if (!name) return

      const rank = bestRank(needle, data?.organization_name, data?.full_name, data?.username)
      if (rank < 0) return

      const isOrganizer = Boolean(String(data?.organization_name || '').trim()) || hostIds.has(uid)
      const verified = Boolean(data?.is_verified)
      const base: ProfileSuggestion = {
        uid,
        name,
        photo: profilePhoto(data),
        verified,
      }

      if (isOrganizer) {
        // Verified organizers edge out unverified ones at equal match strength.
        organizerRows.push({ item: base, score: rank * 2 + (verified ? 0 : 1) })
      } else if (user) {
        // ---- 3. People, but only for a signed-in requester.
        const connected = friendIds.has(uid)
        // Connections outrank strangers, whatever the match strength.
        peopleRows.push({
          item: { ...base, connected },
          score: (connected ? 0 : 100) + rank,
        })
      }
    })

    const organizers = organizerRows
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, MAX_ORGANIZERS)
      .map((r) => r.item)

    const people = peopleRows
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, MAX_PEOPLE)
      .map((r) => r.item)

    // ---- 4. Cities: a filter, not a destination. Static config, no read.
    const cities = getCitiesForCountry(country)
      .map((city) => ({ city, rank: matchRank(city, needle) }))
      .filter((row) => row.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.city.localeCompare(b.city))
      .slice(0, MAX_CITIES)
      .map((row) => row.city)

    return NextResponse.json({ events, organizers, people, cities })
  } catch (error: any) {
    // A failed suggestion must never break the search field — the plain-Enter
    // path still works, so degrade to "no suggestions".
    console.error('[discover/suggest] failed', error)
    return NextResponse.json({}, { status: 200 })
  }
}
