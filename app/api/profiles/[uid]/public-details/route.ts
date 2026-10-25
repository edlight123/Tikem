/**
 * GET /api/profiles/{uid}/public-details
 *
 * What a profile page shows under the name, decided server-side for the
 * viewer (signed in or not), so the app never needs to read users/{uid}
 * (owner-read-only in firestore.rules). The rule, org vs person, and what each
 * returns: lib/profile/public-details.ts.
 *
 * 200 { kind: 'org', org: { description, website, instagram, facebook, twitter, linkedin, tiktok } }
 * 200 { kind: 'person', person: { bio, socials: { instagram, tiktok, twitter, facebook } } | null }
 * 404 no such profile; 429 rate limited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { loadPublicProfileDetails } from '@/lib/profile/public-details'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/

export async function GET(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params
  if (!UID_RE.test(uid || '')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const viewer = await getCurrentUser().catch(() => null)
  const viewerId = viewer?.id ? String(viewer.id) : null

  // A profile view is a public read: fail open so a counter outage never
  // blanks profiles, but cap scraping per viewer (or per IP when signed out).
  const { limited } = await consumeRateLimit({
    key: `public-details:${viewerId ? `uid:${viewerId}` : `ip:${clientIp(request)}`}`,
    limit: 120,
    windowMs: 60_000,
    failOpen: true,
  })
  if (limited) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const result = await loadPublicProfileDetails(uid, viewerId)
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result.details, {
      // Depends on who is asking (friends see more), so never shared-cached.
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('[public-details] failed', (error as any)?.message)
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }
}
