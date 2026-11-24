/**
 * POST /api/community/submissions
 *   { image_url, source_url?, organizer_name?, organizer_handle?, note?, details? }
 *
 * A signed-in member shares an event they saw ("Share an event", web
 * /share-event and the app). The flyer was already uploaded to our bucket and,
 * if they wanted, read by /api/flyers/read to prefill the form. Nothing is
 * published from here: the share waits in event_submissions (server-only,
 * default-deny in firestore.rules) for an admin (/admin/community).
 *
 * Guards: signed in (Tikra allowed no guests either), not banned, our own
 * uploaded image only (lib/posters/hosts.isOwnPoster), source links http(s)
 * only (lib/community/submissions.parseSourceUrl), and a daily budget per
 * account AND per IP so one person cannot flood the queue from many accounts.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { isOwnPoster } from '@/lib/posters/hosts'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import {
  SUBMIT_LIMIT_PER_IP,
  SUBMIT_LIMIT_PER_USER,
  isBannedProfile,
  parseSubmissionInput,
} from '@/lib/community/submissions'
import { notifyAdminsOfCommunity } from '@/lib/community/notify'

export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to share an event.', code: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const imageUrl = typeof body?.image_url === 'string' ? body.image_url.trim() : ''
  if (!isOwnPoster(imageUrl)) return NextResponse.json({ error: 'Upload the flyer first.', code: 'bad_image' }, { status: 400 })

  const profile = await adminDb.collection('users').doc(user.id).get()
  if (isBannedProfile(profile.exists ? profile.data() : null)) {
    return NextResponse.json({ error: 'This account cannot share events.', code: 'forbidden' }, { status: 403 })
  }

  // Per account first, then per IP: both must have room.
  const perUser = await consumeRateLimit({ key: `community-submit:user:${user.id}`, limit: SUBMIT_LIMIT_PER_USER, windowMs: DAY })
  if (perUser.limited) return NextResponse.json({ error: 'You have shared a lot today. Try again tomorrow.', code: 'rate_limited' }, { status: 429 })
  const perIp = await consumeRateLimit({ key: `community-submit:ip:${clientIp(request)}`, limit: SUBMIT_LIMIT_PER_IP, windowMs: DAY })
  if (perIp.limited) return NextResponse.json({ error: 'Too many shares from this network today.', code: 'rate_limited' }, { status: 429 })

  const input = parseSubmissionInput(body)
  const now = new Date().toISOString()
  const ref = adminDb.collection('event_submissions').doc()
  await ref.set({
    status: 'pending',
    image_url: imageUrl,
    ...input,
    submitted_by: user.id,
    submitted_by_email: user.email || '',
    created_at: now,
    updated_at: now,
  })
  await notifyAdminsOfCommunity({ kind: 'submission', title: input.details.title || input.organizer_name })
  return NextResponse.json({ ok: true, id: ref.id }, { status: 201 })
}
