/**
 * Keeping `payout_releases` honest after the payout leaves.
 *
 * /api/cron/release-payouts creates a Stripe payout on the organizer's
 * connected account and records it in `payout_releases`. That record used to
 * keep whatever status Stripe reported at creation (`pending`) forever, and the
 * cron counts every row that is not failed/canceled as already released — so a
 * payout the bank bounced was counted as paid for good and the organizer's
 * money sat in their Stripe balance with nothing ever releasing it again.
 *
 * This module is the ONE place a release row's status moves after creation:
 *  - the Stripe webhook (Connect events payout.paid / payout.failed /
 *    payout.canceled / payout.updated) calls handleStripePayoutUpdate;
 *  - the cron's reconciliation pass retrieves payouts stuck in pending /
 *    in_transit for more than STUCK_PAYOUT_DAYS and feeds them through the same
 *    function, so a missed webhook cannot strand a row either.
 *
 * A failed payout stops counting as released (summarizeEventReleases) and the
 * next cron run re-releases it under a NEW idempotency key (releaseAttemptDocId)
 * — reusing the old key would make Stripe replay the failed payout. After
 * MAX_STRIPE_PAYOUT_FAILURES failures the event is parked in the admin review
 * queue instead of retried.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { sendEmail } from '@/lib/email'
import { renderEmail, title as titleBlock, p, gap, button, bigFigure, appUrl } from '@/lib/email-kit/layout'
import { intlLocaleFor } from '@/lib/dateLocale'

export const PAYOUT_RELEASES_COLLECTION = 'payout_releases'
export const PAYOUT_RELEASE_NOTICES_COLLECTION = 'payout_release_notices'
export const PAYOUT_REVIEW_QUEUE_COLLECTION = 'payout_review_queue'

/** Stripe-side failures of one event's payouts before a human must look. */
export const MAX_STRIPE_PAYOUT_FAILURES = 3
/** A payout still pending / in transit after this long is re-checked with Stripe. */
export const STUCK_PAYOUT_DAYS = 10
/** A `reserved` row (payout create never confirmed) older than this is looked up. */
export const STUCK_RESERVATION_HOURS = 24
/** Reason written to the review queue when the failure cap trips. */
export const REPEATED_FAILURE_REASON = 'stripe_payout_failed_repeatedly'

/** payout_releases statuses that mean "no money left the balance". */
export const NON_RELEASING_STATUSES = new Set(['failed', 'canceled', 'cancelled'])
const TERMINAL_STATUSES = new Set(['paid', 'failed', 'canceled', 'cancelled'])

function toMinor(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function ms(value: unknown): number {
  if (!value) return 0
  const raw: any = (value as any)?.toDate ? (value as any).toDate() : value
  const t = raw instanceof Date ? raw.getTime() : new Date(raw as any).getTime()
  return Number.isFinite(t) ? t : 0
}

// ── Pure accounting ─────────────────────────────────────────────────────────

export type EventReleaseSummary = {
  /** Minor units that may already be on their way to the bank. */
  releasedMinor: number
  /** Payouts Stripe accepted and then failed/canceled (not create-time errors). */
  stripeFailureCount: number
  lastFailureAt: string | null
  lastFailureCode: string | null
}

/**
 * Sum one event's release rows.
 *
 * A `reserved` row is one whose Stripe outcome we never confirmed; counting it
 * as released is the only safe reading because the payout may exist. failed /
 * canceled rows are excluded — that money is back in the connected balance.
 */
export function summarizeEventReleases(rows: Array<Record<string, any>>): EventReleaseSummary {
  let releasedMinor = 0
  let stripeFailureCount = 0
  let lastFailureMs = 0
  let lastFailureCode: string | null = null
  for (const row of rows) {
    const status = String(row?.status || '').toLowerCase()
    if (row?.stripeFailed === true) {
      stripeFailureCount += 1
      const at = ms(row?.failedAt)
      if (at >= lastFailureMs) {
        lastFailureMs = at
        lastFailureCode = row?.failureCode ? String(row.failureCode) : null
      }
    }
    if (NON_RELEASING_STATUSES.has(status)) continue
    releasedMinor += Math.max(0, toMinor(row?.amountMinor))
  }
  return {
    releasedMinor,
    stripeFailureCount,
    lastFailureAt: lastFailureMs ? new Date(lastFailureMs).toISOString() : null,
    lastFailureCode,
  }
}

export async function loadEventReleaseSummary(eventId: string): Promise<EventReleaseSummary> {
  const snapshot = await adminDb.collection(PAYOUT_RELEASES_COLLECTION).where('eventId', '==', eventId).get()
  return summarizeEventReleases(snapshot.docs.map((d: any) => d.data() || {}))
}

/**
 * Deterministic release doc id (and so idempotency key) for one attempt.
 *
 * One attempt per (event, UTC day) as before; after the k-th Stripe-side
 * failure the id gains `_r{k}`, so the retry gets a FRESH idempotency key
 * instead of replaying the payout that just failed.
 */
export function releaseAttemptDocId(eventId: string, attemptDay: string, stripeFailureCount: number): string {
  const base = `${eventId}_${attemptDay}`
  return stripeFailureCount > 0 ? `${base}_r${stripeFailureCount}` : base
}

/**
 * Has an admin cleared the event since its last failure? Only a review item
 * resolved as `released` AFTER the latest failure lets the cron try again once
 * the cap has tripped.
 */
export function failureCapCleared(review: Record<string, any> | null | undefined, lastFailureAt: string | null): boolean {
  if (!review) return false
  if (String(review.status || '') !== 'released') return false
  const resolvedMs = ms(review.resolvedAt || review.updatedAt)
  return resolvedMs > 0 && resolvedMs > ms(lastFailureAt)
}

// ── Status transitions ──────────────────────────────────────────────────────

/**
 * Next stored status for a row, given what Stripe says now. Returns null when
 * the row must not change:
 *  - failed / canceled are final for that payout (Stripe never un-fails one);
 *  - paid can still become failed (a bank can return a payout days later),
 *    but never goes back to pending / in_transit.
 */
export function nextReleaseStatus(currentRaw: unknown, stripeStatusRaw: unknown): string | null {
  const current = String(currentRaw || '').toLowerCase()
  const incoming = String(stripeStatusRaw || '').toLowerCase()
  if (!incoming || incoming === current) return null
  if (current === 'failed' || current === 'canceled' || current === 'cancelled') return null
  if (current === 'paid' && incoming !== 'failed') return null
  if (!['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(incoming)) return null
  return incoming
}

export type PayoutUpdateResult = {
  matched: boolean
  releaseDocId: string | null
  eventId: string | null
  organizerId: string | null
  previousStatus: string | null
  status: string | null
  /** This update is the one that turned a counted payout into a failure. */
  newlyFailed: boolean
}

async function findReleaseRef(payout: any, stripeAccountId: string | null): Promise<any | null> {
  const payoutId = String(payout?.id || '')
  if (payoutId) {
    const byPayout = await adminDb
      .collection(PAYOUT_RELEASES_COLLECTION)
      .where('payoutId', '==', payoutId)
      .limit(1)
      .get()
    if (!byPayout.empty) return byPayout.docs[0].ref
  }
  // The payout can fail before the cron has written payoutId back (it writes
  // after create returns). The cron stamps releaseDocId into the metadata.
  const releaseDocId = payout?.metadata?.releaseDocId ? String(payout.metadata.releaseDocId) : ''
  if (!releaseDocId) return null
  const ref = adminDb.collection(PAYOUT_RELEASES_COLLECTION).doc(releaseDocId)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  // Never let one account's event move another account's row.
  if (stripeAccountId && data.stripeAccountId && String(data.stripeAccountId) !== stripeAccountId) return null
  if (data.payoutId && payoutId && String(data.payoutId) !== payoutId) return null
  return ref
}

/**
 * Apply Stripe's view of one payout to its release row. Idempotent: replaying
 * the same payout state is a no-op, and `newlyFailed` is true for exactly one
 * caller (the transaction reads the row it writes).
 */
export async function applyStripePayoutUpdate(params: {
  payout: any
  stripeAccountId: string | null
  source: 'webhook' | 'reconcile' | 'create'
  stripeEventId?: string | null
  now?: Date
}): Promise<PayoutUpdateResult> {
  const { payout, stripeAccountId } = params
  const nowIso = (params.now || new Date()).toISOString()
  const empty: PayoutUpdateResult = {
    matched: false,
    releaseDocId: null,
    eventId: null,
    organizerId: null,
    previousStatus: null,
    status: null,
    newlyFailed: false,
  }

  const ref = await findReleaseRef(payout, stripeAccountId)
  if (!ref) return empty

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return empty
    const row = snap.data() || {}
    const previousStatus = String(row.status || '') || null
    const next = nextReleaseStatus(previousStatus, payout?.status)

    const base: PayoutUpdateResult = {
      matched: true,
      releaseDocId: String(ref.id),
      eventId: row.eventId ? String(row.eventId) : null,
      organizerId: row.organizerId ? String(row.organizerId) : null,
      previousStatus,
      status: next || previousStatus,
      newlyFailed: false,
    }

    const update: Record<string, any> = {
      stripePayoutStatus: payout?.status || null,
      lastStripeSyncAt: nowIso,
      lastStripeSyncSource: params.source,
      updatedAt: nowIso,
    }
    if (!row.payoutId && payout?.id) update.payoutId = String(payout.id)
    if (payout?.arrival_date) update.arrivalDate = payout.arrival_date
    if (params.stripeEventId) update.lastStripeEventId = params.stripeEventId

    if (next) {
      update.status = next
      if (next === 'paid') update.paidAt = nowIso
      if (next === 'failed' || next === 'canceled') {
        update.stripeFailed = true
        update.failedAt = nowIso
        update.failureCode = payout?.failure_code || (next === 'canceled' ? 'canceled' : null)
        update.failureMessage = payout?.failure_message ? String(payout.failure_message).slice(0, 500) : null
        // No longer counted as released; the next cron run may send it again.
        update.reReleaseEligible = true
        base.newlyFailed = true
      }
    }

    tx.set(ref, update, { merge: true })
    return base
  })
}

// ── Notifications ───────────────────────────────────────────────────────────

type Lang = 'en' | 'fr' | 'ht'

function langOf(raw: unknown): Lang {
  const code = String(raw || 'en').slice(0, 2).toLowerCase()
  return code === 'fr' || code === 'ht' ? code : 'en'
}

function formatAmount(minor: number, currency: string, lang: Lang): string {
  const cents = Math.max(0, Math.round(Number(minor) || 0))
  const n = new Intl.NumberFormat(intlLocaleFor(lang), {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
  return `${n} ${String(currency || '').toUpperCase()}`.trim()
}

/** Pure copy, exported for tests. */
export function payoutFailedCopy(lang: Lang, amount: string, bankProblem: boolean) {
  const fix = {
    en: bankProblem ? ' Check the bank account on your Stripe payout settings.' : '',
    fr: bankProblem ? ' Vérifiez le compte bancaire dans vos paramètres de paiement Stripe.' : '',
    ht: bankProblem ? ' Verifye kont bank lan nan paramèt peman Stripe ou.' : '',
  }[lang]
  return {
    en: {
      title: "Your payout didn't go through",
      body: `Your ${amount} payout was returned by the bank. The money is back in your balance and we'll try again automatically.${fix}`,
      cta: 'View payouts',
      status: 'Failed',
    },
    fr: {
      title: "Votre virement n'a pas abouti",
      body: `Votre virement de ${amount} a été retourné par la banque. Le montant est de retour sur votre solde et nous réessaierons automatiquement.${fix}`,
      cta: 'Voir mes paiements',
      status: 'Échec',
    },
    ht: {
      title: 'Peman ou an pa pase',
      body: `Bank lan retounen peman ${amount} ou a. Lajan an tounen nan balans ou, n ap eseye ankò otomatikman.${fix}`,
      cta: 'Wè peman yo',
      status: 'Pa pase',
    },
  }[lang]
}

/** Stripe failure codes that mean the organizer must fix their bank details. */
const BANK_PROBLEM_CODES = new Set([
  'account_closed',
  'account_frozen',
  'bank_account_restricted',
  'bank_ownership_changed',
  'could_not_process',
  'debit_not_authorized',
  'incorrect_account_holder_name',
  'incorrect_account_holder_address',
  'incorrect_account_holder_tax_id',
  'invalid_account_number',
  'invalid_currency',
  'no_account',
  'unsupported_card',
])

/** Claim a notice once. Fails CLOSED (no claim → no send). */
async function claimNotice(id: string, data: Record<string, any>): Promise<boolean> {
  const ref = adminDb.collection(PAYOUT_RELEASE_NOTICES_COLLECTION).doc(id)
  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (snap.exists) return false
      tx.set(ref, { ...data, claimedAt: new Date().toISOString() })
      return true
    })
  } catch (err) {
    console.error('[payout-releases] notice claim failed; not sending', { id, err })
    return false
  }
}

/** Tell the organizer a released payout failed. Once per release row. Never throws. */
export async function notifyOrganizerPayoutFailed(releaseDocId: string): Promise<boolean> {
  try {
    const snap = await adminDb.collection(PAYOUT_RELEASES_COLLECTION).doc(releaseDocId).get()
    if (!snap.exists) return false
    const row = snap.data() || {}
    const organizerId = row.organizerId ? String(row.organizerId) : ''
    if (!organizerId) return false
    if (!(await claimNotice(`${releaseDocId}_failed`, { releaseDocId, outcome: 'failed' }))) return false

    const userSnap = await adminDb.collection('users').doc(organizerId).get().catch(() => null as any)
    const user = userSnap?.exists ? (userSnap.data() as any) || {} : {}
    const lang = langOf(user.language)
    const amount = formatAmount(toMinor(row.amountMinor), String(row.currency || ''), lang)
    const copy = payoutFailedCopy(lang, amount, BANK_PROBLEM_CODES.has(String(row.failureCode || '')))
    const actionUrl = '/organizer/payouts'
    const meta: Record<string, any> = { kind: 'stripe_payout_failed', releaseDocId }
    if (row.eventId) meta.eventId = String(row.eventId)

    try {
      await createNotification(organizerId, 'withdrawal_update', copy.title, copy.body, actionUrl, meta)
    } catch (err) {
      console.error('[payout-releases] in-app notification failed', { releaseDocId, err })
    }
    try {
      await sendPushNotification(organizerId, copy.title, copy.body, actionUrl, {
        type: 'withdrawal_update',
        kind: 'stripe_payout_failed',
        releaseDocId,
      })
    } catch (err) {
      console.error('[payout-releases] push failed', { releaseDocId, err })
    }

    const email = typeof user.email === 'string' ? user.email : null
    if (email) {
      const cur = String(row.currency || '').toUpperCase()
      const figure = amount.endsWith(` ${cur}`) ? amount.slice(0, -(cur.length + 1)) : amount
      const html = renderEmail({
        lang,
        title: copy.title,
        preheader: copy.body,
        status: { label: copy.status, tone: 'red' },
        footer: 'organizer',
        blocks: [
          titleBlock(copy.title, 34),
          gap(24),
          bigFigure(figure, cur),
          gap(24),
          p(copy.body),
          gap(28),
          button(copy.cta, `${appUrl()}${actionUrl}`),
        ],
      })
      const result = await sendEmail({ to: email, subject: copy.title, html })
      if (!result?.success) console.warn('[payout-releases] email not sent', { releaseDocId, code: (result as any)?.code })
    }
    return true
  } catch (err) {
    console.error('[payout-releases] organizer notify failed', { releaseDocId, err })
    return false
  }
}

/**
 * Park an event in the admin review queue after repeated Stripe failures, and
 * tell admins once per failure count. A pending review row blocks the cron, and
 * an admin resolving it as `released` (resolvedAt after the last failure) lets
 * it try again. An item an admin left pending for another reason is kept, with
 * the failure facts added. Never throws.
 */
export async function flagRepeatedPayoutFailures(params: {
  eventId: string
  organizerId: string | null
  stripeAccountId: string | null
  summary: EventReleaseSummary
  currency?: string | null
  now?: Date
}): Promise<{ flagged: boolean }> {
  const { eventId, summary } = params
  if (summary.stripeFailureCount < MAX_STRIPE_PAYOUT_FAILURES) return { flagged: false }
  const nowIso = (params.now || new Date()).toISOString()
  try {
    const ref = adminDb.collection(PAYOUT_REVIEW_QUEUE_COLLECTION).doc(eventId)
    const snap = await ref.get()
    const existing = snap.exists ? (snap.data() as any) || {} : null
    const failureFacts = {
      payoutFailureCount: summary.stripeFailureCount,
      lastPayoutFailureAt: summary.lastFailureAt,
      lastPayoutFailureCode: summary.lastFailureCode,
      payoutFailureFlaggedAt: nowIso,
    }

    if (failureCapCleared(existing, summary.lastFailureAt)) return { flagged: false }

    // An admin already decided (held / rejected / …) AFTER the latest failure:
    // their answer stands; re-opening it every hourly run would override them.
    const decidedAfterFailure =
      existing &&
      String(existing.status || '') !== 'pending' &&
      ms(existing.resolvedAt) > ms(summary.lastFailureAt)
    if (decidedAfterFailure) return { flagged: true }

    if (!existing) {
      await ref.set({
        eventId,
        organizerId: params.organizerId,
        stripeAccountId: params.stripeAccountId,
        amountMinor: 0,
        currency: params.currency || null,
        reason: REPEATED_FAILURE_REASON,
        tier: null,
        status: 'pending',
        ...failureFacts,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    } else if (String(existing.status || '') === 'pending') {
      await ref.set({ ...failureFacts, updatedAt: nowIso }, { merge: true })
    } else {
      // Resolved before these failures happened: it needs a fresh decision.
      await ref.set(
        {
          status: 'pending',
          reason: REPEATED_FAILURE_REASON,
          previousResolution: {
            status: existing.status || null,
            resolvedAt: existing.resolvedAt || null,
            reason: existing.reason || null,
          },
          ...failureFacts,
          updatedAt: nowIso,
        },
        { merge: true }
      )
    }

    if (await claimNotice(`${eventId}_flag_${summary.stripeFailureCount}`, { eventId, outcome: 'flagged' })) {
      const snaps = await Promise.all(
        ['admin', 'super_admin'].map((role) => adminDb.collection('users').where('role', '==', role).get())
      )
      const adminIds = Array.from(new Set(snaps.flatMap((s: any) => s.docs.map((d: any) => String(d.id)))))
      const title = 'Stripe payout keeps failing'
      const message = `Payouts for event ${eventId} have failed ${summary.stripeFailureCount} times${summary.lastFailureCode ? ` (last: ${summary.lastFailureCode})` : ''}. Automatic release is paused until you review it.`
      const actionUrl = '/admin/money'
      await Promise.all(
        adminIds.map(async (adminId) => {
          try {
            await createNotification(adminId, 'withdrawal_escalated', title, message, actionUrl, { eventId })
          } catch (err) {
            console.error('[payout-releases] admin in-app failed', { adminId, err })
          }
          try {
            await sendPushNotification(adminId, title, message, actionUrl, { type: 'withdrawal_escalated', eventId })
          } catch (err) {
            console.error('[payout-releases] admin push failed', { adminId, err })
          }
        })
      )
    }
    return { flagged: true }
  } catch (err) {
    console.error('[payout-releases] flag failed', { eventId, err })
    return { flagged: false }
  }
}

/**
 * The full reaction to one Stripe payout update: move the row, and on a fresh
 * failure tell the organizer and (past the cap) the admins.
 */
export async function handleStripePayoutUpdate(params: {
  payout: any
  stripeAccountId: string | null
  source: 'webhook' | 'reconcile'
  stripeEventId?: string | null
  now?: Date
}): Promise<PayoutUpdateResult> {
  const result = await applyStripePayoutUpdate(params)
  if (result.matched && result.newlyFailed && result.releaseDocId) {
    await notifyOrganizerPayoutFailed(result.releaseDocId)
    if (result.eventId) {
      const summary = await loadEventReleaseSummary(result.eventId)
      await flagRepeatedPayoutFailures({
        eventId: result.eventId,
        organizerId: result.organizerId,
        stripeAccountId: params.stripeAccountId,
        summary,
        currency: params.payout?.currency || null,
        now: params.now,
      })
    }
  }
  return result
}

// ── Reconciliation (cron) ───────────────────────────────────────────────────

export type ReconcileSummary = {
  checked: number
  updated: number
  newlyFailed: number
  stillPending: number
  errors: number
  details: Array<{ releaseDocId: string; outcome: string }>
}

const MAX_RECONCILE_PER_RUN = 100

/**
 * Re-check release rows Stripe should have settled by now:
 *  - pending / in_transit rows older than STUCK_PAYOUT_DAYS: retrieve the
 *    payout on the connected account and apply its real status;
 *  - reserved rows (create outcome never written back) older than
 *    STUCK_RESERVATION_HOURS: find the payout by its releaseDocId metadata; if
 *    Stripe has no such payout, the money never left and the row is failed so
 *    the amount becomes releasable again.
 * Rows still unsettled after the check are marked needsAdminAttention.
 * Bounded and never throws — the release loop must still run.
 */
export async function reconcileStuckPayoutReleases(stripe: any, now: Date = new Date()): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, updated: 0, newlyFailed: 0, stillPending: 0, errors: 0, details: [] }
  const nowIso = now.toISOString()
  const stuckBefore = now.getTime() - STUCK_PAYOUT_DAYS * 24 * 60 * 60 * 1000
  const reservedBefore = now.getTime() - STUCK_RESERVATION_HOURS * 60 * 60 * 1000

  // Equality queries per status: single-field indexes, no composite needed.
  const rows: Array<{ ref: any; id: string; data: any }> = []
  for (const status of ['pending', 'in_transit', 'reserved']) {
    try {
      const snap = await adminDb
        .collection(PAYOUT_RELEASES_COLLECTION)
        .where('status', '==', status)
        .limit(MAX_RECONCILE_PER_RUN)
        .get()
      for (const doc of snap.docs) rows.push({ ref: doc.ref, id: String(doc.id), data: doc.data() || {} })
    } catch (err: any) {
      console.error('[payout-releases] reconcile query failed', { status, message: err?.message })
      summary.errors += 1
    }
  }

  for (const { ref, id, data } of rows) {
    if (summary.checked >= MAX_RECONCILE_PER_RUN) break
    const status = String(data.status || '')
    const createdMs = ms(data.createdAt)
    if (!createdMs) continue
    if (status === 'reserved' ? createdMs > reservedBefore : createdMs > stuckBefore) continue
    const stripeAccountId = data.stripeAccountId ? String(data.stripeAccountId) : ''
    if (!stripeAccountId) continue
    summary.checked += 1

    try {
      let payout: any = null
      if (data.payoutId) {
        payout = await stripe.payouts.retrieve(String(data.payoutId), { stripeAccount: stripeAccountId })
      } else {
        const createdSec = Math.floor(createdMs / 1000)
        const list = await stripe.payouts.list(
          { created: { gte: createdSec - 3600, lte: createdSec + 26 * 3600 }, limit: 100 },
          { stripeAccount: stripeAccountId }
        )
        payout = (list?.data || []).find((po: any) => String(po?.metadata?.releaseDocId || '') === id) || null
        if (!payout) {
          if (list?.has_more) {
            await ref.set({ needsAdminAttention: true, reconcileNote: 'reservation_lookup_inconclusive', updatedAt: nowIso }, { merge: true })
            summary.stillPending += 1
            summary.details.push({ releaseDocId: id, outcome: 'inconclusive' })
            continue
          }
          // Stripe never created it: nothing left the balance. Not a Stripe-side
          // failure (stripeFailed stays unset) — the next attempt may reuse the
          // same key safely because no payout exists under it.
          await ref.set(
            { status: 'failed', error: 'payout_never_created', reconciledAt: nowIso, updatedAt: nowIso },
            { merge: true }
          )
          summary.updated += 1
          summary.details.push({ releaseDocId: id, outcome: 'never_created' })
          continue
        }
      }

      const result = await handleStripePayoutUpdate({ payout, stripeAccountId, source: 'reconcile', now })
      if (result.newlyFailed) summary.newlyFailed += 1
      const settled = result.status && TERMINAL_STATUSES.has(String(result.status))
      if (result.status !== result.previousStatus || !data.payoutId) summary.updated += 1
      if (!settled) {
        summary.stillPending += 1
        await ref.set({ needsAdminAttention: true, stuckSince: data.createdAt || null, reconciledAt: nowIso }, { merge: true })
      } else {
        await ref.set({ reconciledAt: nowIso }, { merge: true })
      }
      summary.details.push({ releaseDocId: id, outcome: String(result.status || 'unmatched') })
    } catch (err: any) {
      summary.errors += 1
      const message = String(err?.raw?.message || err?.message || 'reconcile failed').slice(0, 500)
      console.error('[payout-releases] reconcile failed', { releaseDocId: id, message })
      await ref
        .set({ needsAdminAttention: true, reconcileError: message, reconciledAt: nowIso }, { merge: true })
        .catch(() => {})
      summary.details.push({ releaseDocId: id, outcome: 'error' })
    }
  }

  return summary
}

/**
 * Write a just-created payout back to its reservation without clobbering a
 * webhook that got there first (a payout can fail before create() returns to
 * us): the status only moves along nextReleaseStatus.
 */
export async function recordCreatedPayout(releaseRef: any, payout: any, now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString()
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(releaseRef)
    const row = snap.exists ? snap.data() || {} : {}
    const current = String(row.status || 'reserved')
    const update: Record<string, any> = {
      payoutId: payout?.id || row.payoutId || null,
      arrivalDate: payout?.arrival_date || null,
      updatedAt: nowIso,
    }
    // A failure the webhook already recorded wins over create()'s stale view.
    const alreadyFailed = row.stripeFailed === true
    if (!alreadyFailed) {
      update.stripePayoutStatus = payout?.status || null
      update.status = current === 'reserved' ? String(payout?.status || 'pending') : nextReleaseStatus(current, payout?.status) || current
    }
    tx.set(releaseRef, update, { merge: true })
  })
}
