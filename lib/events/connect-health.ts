/**
 * Pure decisions for the Connect health sweep (app/api/cron/connect-health-sweep).
 *
 * The sweep itself is all Firestore and Stripe; what is worth pinning down is
 * WHICH live events it should spend a Stripe call on, and when it is allowed to
 * notify an organizer again. Both are easy to get subtly wrong — sweeping past
 * events wastes calls, sweeping free events is meaningless, and a renotify
 * window that is off by a sign turns a warning into a daily nag.
 */
import { resolveEventPricing } from '@/lib/ticketPricing'
import { countrySupport } from '@/lib/country-support'

export type SweepCandidacy =
  | 'check'
  | 'no_organizer'
  | 'past'
  | 'free'
  | 'not_stripe_market'

/**
 * Should the sweep ask the publish gate about this live event?
 *
 * Only 'check' costs a Stripe call; every other verdict is a cheap local skip.
 */
export function sweepCandidacy(event: any, now: Date): SweepCandidacy {
  if (!String(event?.organizer_id || '')) return 'no_organizer'

  // Past events can no longer sell, so a broken payout account is not news here.
  // (Money already collected is a payout problem, not a publish problem.)
  const raw = event?.start_datetime
  const start = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
  if (start instanceof Date && !isNaN(start.getTime()) && start < now) return 'past'

  // Free events never touch Connect.
  if (!resolveEventPricing(event).hasPaidTier) return 'free'

  // Haiti and other non-Stripe markets are ungated by design — KYC is enforced
  // at withdrawal instead, so a missing payout profile is expected, not broken.
  // Read the country table directly rather than going through
  // getRequiredPayoutProfileIdForEventCountry: that module pulls in firebase-admin
  // at import time, which would make this file impossible to unit test. The table
  // is the source of truth either way — the resolver is a one-line wrapper on it.
  if (countrySupport(event?.country)?.requiredProfile !== 'stripe_connect') {
    return 'not_stripe_market'
  }

  return 'check'
}

/**
 * May we notify about this problem again?
 *
 * An absent/unreadable timestamp means we have never told them, so the first
 * notice goes out. Callers claim BEFORE sending.
 */
export function shouldRenotify(lastNotifiedAt: unknown, now: Date, windowHours: number): boolean {
  const last: any = lastNotifiedAt
  const lastAt = last?.toDate ? last.toDate() : last ? new Date(last) : null
  if (!(lastAt instanceof Date) || isNaN(lastAt.getTime())) return true

  const ageHours = (now.getTime() - lastAt.getTime()) / (1000 * 60 * 60)
  return ageHours >= windowHours
}
