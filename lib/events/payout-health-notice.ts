/**
 * Telling an organizer their payout account can no longer take money.
 *
 * Two callers share this so they share one dedupe record:
 *   - the nightly Connect health sweep (app/api/cron/connect-health-sweep), and
 *   - checkout itself, the moment a buyer is turned away because the organizer's
 *     Stripe account cannot receive a destination charge.
 *
 * Both claim `payout_health_notices/{organizerId}_{code}` before sending, so an
 * organizer hears about one problem at most once per RENOTIFY_AFTER_HOURS no
 * matter how many buyers hit it or whether the cron got there first.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { shouldRenotify } from '@/lib/events/connect-health'
import type { DestinationUnreadyReason } from '@/lib/checkout/destination-readiness'
import type { PublishGateBlockCode } from '@/lib/events/publish-gate'

/** Don't re-nag an organizer about the same problem more often than this. */
export const RENOTIFY_AFTER_HOURS = 72

const PAYOUT_SETTINGS_URL = '/organizer/settings/payouts'

/**
 * Claim the right to notify this organizer about this problem, at most once per
 * RENOTIFY_AFTER_HOURS. Claims BEFORE sending (the reminder-claim convention):
 * a duplicate silence is better than notifying the same person every single day.
 */
export async function claimOrganizerNotice(organizerId: string, code: string, now: Date): Promise<boolean> {
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
    console.error('payout-health-notice: claim failed', { organizerId, code, err })
    return false
  }
}

/** In-app + push. Each half is best-effort and never throws. */
export async function sendPayoutBlockedNotice(params: {
  organizerId: string
  eventId: string
  code: string
  title: string
  message: string
}): Promise<void> {
  const { organizerId, eventId, code, title, message } = params

  try {
    await createNotification(organizerId, 'payout_account_blocked', title, message, PAYOUT_SETTINGS_URL, {
      eventId,
      code,
    })
  } catch (err) {
    console.error('payout-health-notice: in-app notification failed', { organizerId, err })
  }

  try {
    await sendPushNotification(organizerId, `⚠️ ${title}`, message, PAYOUT_SETTINGS_URL, {
      type: 'payout_account_blocked',
      eventId,
      code,
    })
  } catch (err) {
    console.error('payout-health-notice: push notification failed', { organizerId, err })
  }
}

/** Map a checkout readiness reason onto the publish-gate code the sweep uses, so both dedupe together. */
export function publishGateCodeForReason(reason: DestinationUnreadyReason): PublishGateBlockCode {
  if (reason === 'missing') return 'stripe_connect_required'
  if (reason === 'charges_disabled') return 'stripe_onboarding_incomplete'
  return 'stripe_account_unavailable'
}

/**
 * Checkout just turned a card buyer away because of the organizer's Stripe
 * account. Mark the event (the same `payout_blocked` marker the sweep writes, so
 * the organizer console flags it) and tell the organizer — at most once per
 * window. Never throws: this runs on a buyer's request and must not change what
 * the buyer is told.
 */
export async function flagOrganizerCardCheckoutBlocked(params: {
  organizerId: string
  event: { id?: string; title?: string; payout_blocked?: boolean; payout_blocked_code?: string | null; payout_blocked_at?: any }
  eventId: string
  reason: DestinationUnreadyReason
  now?: Date
}): Promise<void> {
  const { organizerId, event, eventId, reason } = params
  const now = params.now || new Date()
  const code = publishGateCodeForReason(reason)

  try {
    if (!(event.payout_blocked === true && event.payout_blocked_code === code)) {
      await adminDb.collection('events').doc(eventId).update({
        payout_blocked: true,
        payout_blocked_code: code,
        payout_blocked_reason: organizerFacingReason(reason),
        payout_blocked_at: event.payout_blocked_at || now,
      })
    }
  } catch (err) {
    console.error('payout-health-notice: could not mark event', { eventId, err })
  }

  try {
    if (await claimOrganizerNotice(organizerId, code, now)) {
      await sendPayoutBlockedNotice({
        organizerId,
        eventId,
        code,
        title: 'A buyer couldn’t pay by card',
        message: `${event.title || 'Your event'}: ${organizerFacingReason(reason)}`,
      })
    }
  } catch (err) {
    console.error('payout-health-notice: notify failed', { organizerId, err })
  }
}

export function organizerFacingReason(reason: DestinationUnreadyReason): string {
  if (reason === 'missing') {
    return 'Card payments need a connected Stripe payout account. Connect Stripe in Payout settings to start taking card sales.'
  }
  if (reason === 'charges_disabled') {
    return 'Your Stripe payout account can’t accept payments yet. Finish Stripe onboarding in Payout settings to resume card sales.'
  }
  return 'Your Stripe payout account could not be found. Accounts connected before Tikèm switched to live payments must be reconnected — reconnect Stripe in Payout settings so buyers can pay by card.'
}
