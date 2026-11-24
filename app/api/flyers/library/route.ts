/**
 * GET /api/flyers/library
 *
 * The curated flyer library (lib/flyerLibrary), served so the mobile composer
 * offers exactly the photos the web composer does. Before this the app shipped
 * its own picker: bundled illustrations first, then a live Unsplash search, so
 * an organizer saw a different shelf on each device. The list lives here, in
 * one place, and a change to it reaches phones without an app update.
 *
 * Public on purpose: it is a static list of public CDN URLs, and the composer
 * should never fail to show it because a token was slow to refresh.
 */
import { NextResponse } from 'next/server'
import { flyerLibraryFullUrl, flyerLibraryThumbUrl, seasonalFlyerLibrary } from '@/lib/flyerLibrary'

/**
 * Seasonal: for the 30 days before an occasion with holiday templates (and
 * while it is on), its photos lead (lib/flyerLibrary seasonalFlyerLibrary).
 * `labels` carries a seasonal piece's caption in en/fr/ht.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  const items = seasonalFlyerLibrary(Date.now()).map((item) => ({
    id: item.id,
    label: item.label,
    ...(item.labels ? { labels: item.labels } : {}),
    tags: item.tags,
    thumbUrl: flyerLibraryThumbUrl(item),
    fullUrl: flyerLibraryFullUrl(item),
  }))
  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } }
  )
}
