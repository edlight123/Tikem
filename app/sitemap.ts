import type { MetadataRoute } from 'next'
import { adminDb } from '@/lib/firebase/admin'
import { CULTURAL_CATEGORIES } from '@/lib/categories'
import { CANONICAL_SITE_URL as siteUrl } from '@/lib/site-url'


// Generated per REQUEST, not at build time. lib/firebase/admin.ts deliberately
// skips initialization during the build (`isBuildTime`), so a prerendered
// sitemap gets an uninitialized adminDb and silently degrades to the static
// routes — an eventless sitemap, which defeats the point. Crawlers hit this
// rarely, so one query per fetch is cheap.
export const dynamic = 'force-dynamic'

/** Sitemaps cap at 50k URLs; we stay well under and keep the newest events. */
const MAX_EVENTS = 5000

function toDate(v: any): Date | undefined {
  if (!v) return undefined
  try {
    if (typeof v?.toDate === 'function') return v.toDate()
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000)
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d
  } catch {
    return undefined
  }
}

/**
 * Every publicly reachable URL, so crawlers can find the event pages instead
 * of guessing. Authenticated surfaces are excluded here AND in robots.ts.
 *
 * A Firestore failure must not 500 the sitemap — it degrades to the static
 * routes, which is strictly better than serving nothing.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${siteUrl}/discover`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${siteUrl}/categories`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${siteUrl}/platform`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/resources`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${siteUrl}/create`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/support`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${siteUrl}/download`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${siteUrl}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/legal/refunds`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]

  // The eight Kreyòl worlds browse through Discover with their stored
  // categories (/categories/<world> redirects there), so list that URL.
  const categoryRoutes: MetadataRoute.Sitemap = CULTURAL_CATEGORIES.map((c) => ({
    url: `${siteUrl}/discover?${c.categories.map((x) => `category=${encodeURIComponent(x)}`).join('&amp;')}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }))

  let eventRoutes: MetadataRoute.Sitemap = []
  try {
    const snap = await adminDb
      .collection('events')
      .where('is_published', '==', true)
      .limit(MAX_EVENTS)
      .get()

    eventRoutes = snap.docs
      // Rejected events are published:true in some legacy docs — never list them.
      .filter((d: any) => d.get('rejected') !== true && d.get('show_on_explore') !== false)
      .map((d: any) => ({
        url: `${siteUrl}/events/${d.id}`,
        lastModified: toDate(d.get('updated_at')) || toDate(d.get('created_at')) || now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }))
  } catch (err) {
    console.error('sitemap: could not enumerate events, serving static routes only', err)
  }

  return [...staticRoutes, ...categoryRoutes, ...eventRoutes]
}
