import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { checkPaidPublishGate, type PublishGateResult } from '@/lib/events/publish-gate'
import { sweepCandidacy, shouldRenotify } from '@/lib/events/connect-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Re-validate the publish gate for events that are ALREADY live.
 *
 * The gate at /api/events/[id]/publish is point-in-time: it proves an organizer
 * could take money at the moment they published, and nothing re-asks. A Connect
 * account can stop accepting charges long after that — expiring KYC documents, a
 * dispute threshold, or the platform moving to a new acct_ — and when it does,
 * the event stays published and every buyer hits a 400 at checkout. The organizer
 * is the last to know, because nothing in the product is watching.
 *
 * So: walk the live paid events in Stripe Connect markets, ask the same gate the
 * publish route asks, and tell the organizer when the answer has turned to no.
 *
 * This NOTIFIES; it does not unpublish. Taking someone's event off sale is a
 * destructive, outward-facing action and a false positive (a Stripe blip) would
 * be expensive, so it stays a human decision — set
 * `config/payouts.autoUnpublishOnPayoutBlock` to opt in. `stripe_unreachable`
 * verdicts are ignored entirely: they mean WE could not check, not that the
 * organizer did anything wrong.
 *
 * Security: requires `CRON_SECRET` (Authorization: Bearer <secret>)
 */

/** Ceiling on one run's scan — same convention as organizer-nudge/city-discovery. */
const MAX_EVENTS_SCANNED = 2000

/** Don't re-nag an organizer about the same problem more often than this. */
const RENOTIFY_AFTER_HOURS = 72

type Verdict = Extract<PublishGateResult, { ok: false }>

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  try {
    const configSnap = await adminDb.collection('config').doc('payouts').get()
    const autoUnpublish = Boolean(configSnap.exists && (configSnap.data() as any)?.autoUnpublishOnPayoutBlock)

    const snap = await adminDb
      .collection('events')
      .where('is_published', '==', true)
      .limit(MAX_EVENTS_SCANNED)
      .get()

    // One gate call per (organizer, country) — an organizer with twelve live
    // events is one Stripe account, and the sweep should not ask twelve times.
    const gateCache = new Map<string, PublishGateResult>()

    let scanned = 0
    let checked = 0
    let blocked = 0
    let cleared = 0
    let notified = 0
    let unpublished = 0
    let uncheckable = 0

    const affected: Array<{ eventId: string; organizerId: string; code: string }> = []

    for (const doc of snap.docs) {
      const event: any = { id: doc.id, ...(doc.data() || {}) }
      scanned++

      if (sweepCandidacy(event, now) !== 'check') continue

      const organizerId = String(event.organizer_id || '')
      const country = event.country
      const cacheKey = `${organizerId}:${String(country || '').toUpperCase()}`
      let gate = gateCache.get(cacheKey)
      if (!gate) {
        gate = await checkPaidPublishGate({ organizerId, country })
        gateCache.set(cacheKey, gate)
      }
      checked++

      // "We couldn't check" is not "they're broken" — never act on it.
      if (!gate.ok && gate.code === 'stripe_unreachable') {
        uncheckable++
        continue
      }

      if (gate.ok) {
        // Recovered: clear the marker so the UI stops flagging it.
        if (event.payout_blocked) {
          await doc.ref.update({
            payout_blocked: false,
            payout_blocked_code: null,
            payout_blocked_reason: null,
            payout_blocked_at: null,
            updated_at: now,
          })
          cleared++
        }
        continue
      }

      const verdict = gate as Verdict
      blocked++
      affected.push({ eventId: event.id, organizerId, code: verdict.code })

      // Only write when the state actually changes. Re-stamping an
      // already-blocked event every night would burn a write per event per day
      // and, worse, bump `updated_at` — which is a "the organizer changed
      // something" signal, not "a cron looked at it".
      const alreadyMarked = event.payout_blocked === true && event.payout_blocked_code === verdict.code
      if (!alreadyMarked || autoUnpublish) {
        await doc.ref.update({
          payout_blocked: true,
          payout_blocked_code: verdict.code,
          payout_blocked_reason: verdict.error,
          payout_blocked_at: event.payout_blocked_at || now,
          updated_at: now,
          ...(autoUnpublish ? { is_published: false, status: 'draft' } : {}),
        })
        if (autoUnpublish) unpublished++
      }

      if (await claimOrganizerNotice(organizerId, verdict.code, now)) {
        await notifyOrganizer(organizerId, event, verdict, autoUnpublish)
        notified++
      }
    }

    return NextResponse.json({
      success: true,
      scanned,
      checked,
      stripeChecks: gateCache.size,
      blocked,
      cleared,
      notified,
      unpublished,
      uncheckable,
      autoUnpublish,
      affected: affected.slice(0, 50),
      ranAt: now.toISOString(),
    })
  } catch (error: any) {
    console.error('connect-health-sweep cron error:', error)
    return NextResponse.json(
      { error: 'Connect health sweep failed', message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

/**
 * Claim the right to notify this organizer about this problem, at most once per
 * RENOTIFY_AFTER_HOURS. Claims BEFORE sending (the reminder-claim convention):
 * a duplicate silence is better than notifying the same person every single day.
 */
async function claimOrganizerNotice(organizerId: string, code: string, now: Date): Promise<boolean> {
  const ref = adminDb.collection('payout_health_notices').doc(`${organizerId}_${code}`)

  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const last = snap.exists ? (snap.data() as any)?.notifiedAt : null
      if (!shouldRenotify(last, now, RENOTIFY_AFTER_HOURS)) return false

      tx.set(ref, { organizerId, code, notifiedAt: now }, { merge: true })
      return true
    })
  } catch (err) {
    // Fail CLOSED: if we can't prove we haven't already told them, don't tell them again.
    console.error('connect-health-sweep: notice claim failed', { organizerId, code, err })
    return false
  }
}

async function notifyOrganizer(
  organizerId: string,
  event: any,
  verdict: Verdict,
  autoUnpublish: boolean
): Promise<void> {
  const title = autoUnpublish ? 'Ticket sales paused — payout account' : 'Your event can’t take payments'
  const message =
    `${event.title || 'Your event'}: ${verdict.error}` +
    (autoUnpublish ? ' Your event has been moved to draft until this is fixed.' : '')

  try {
    await createNotification(
      organizerId,
      'payout_account_blocked',
      title,
      message,
      '/organizer/settings/payouts',
      { eventId: event.id, code: verdict.code }
    )
  } catch (err) {
    console.error('connect-health-sweep: in-app notification failed', { organizerId, err })
  }

  try {
    await sendPushNotification(organizerId, `⚠️ ${title}`, message, '/organizer/settings/payouts', {
      type: 'payout_account_blocked',
      eventId: event.id,
      code: verdict.code,
    })
  } catch (err) {
    console.error('connect-health-sweep: push notification failed', { organizerId, err })
  }
}
