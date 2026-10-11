/**
 * Stripe Connect account lifecycle for organizers: creating the Express
 * account, telling a live account from a STALE one, and replacing a stale id.
 *
 * WHY "STALE" EXISTS
 * Tikèm moved to a new Stripe platform account in September 2026. Every
 * connected-account id minted before that belongs to the OLD platform, and the
 * new key can no longer see it: retrieve answers `account_invalid` /
 * `resource_missing` / "No such account" / "does not have access to account".
 * Before this module the onboarding route reused the stored id forever, so
 * accountLinks.create threw on every attempt and those organizers could never
 * reconnect. Now a stale id is archived on the profile and a fresh account is
 * created in its place.
 *
 * TRUST
 * The profile's `stripeAccountId` is written ONLY here (and on first creation
 * in the connect route) — never from a client payload. The settings server
 * action strips it, and payoutProfiles is server-write-only in firestore.rules.
 */
import { adminDb } from '@/lib/firebase/admin'
import { getPayoutProfileRef } from '@/lib/firestore/payout-profiles'
import { normalizeSupportedCountry } from '@/lib/country-support'

export type StripeConnectCountry = 'US' | 'CA' | 'FR'
export type StripeAccountLocation = 'united_states' | 'canada' | 'france'

const COUNTRY_TO_LOCATION: Record<StripeConnectCountry, StripeAccountLocation> = {
  US: 'united_states',
  CA: 'canada',
  FR: 'france',
}

/** 'united_states' | 'us' | 'USA' | 'France' … → 'US' | 'CA' | 'FR', or null for anything else. */
export function toStripeConnectCountry(raw: unknown): StripeConnectCountry | null {
  const code = normalizeSupportedCountry(raw)
  return code === 'US' || code === 'CA' || code === 'FR' ? code : null
}

/** The profile's canonical accountLocation spelling for a Connect country. */
export function accountLocationForCountry(country: StripeConnectCountry): StripeAccountLocation {
  return COUNTRY_TO_LOCATION[country]
}

function errText(err: any): string {
  return String(err?.raw?.message || err?.message || '')
}

/**
 * True only when Stripe is saying "this account is not yours / does not exist"
 * — the old-platform case. Deliberately NARROWER than the checkout's
 * isUnusableAccountError: a rate limit, a network blip or an unrelated invalid
 * request must never make us archive a working account and mint a new one.
 */
export function isStaleStripeAccountError(err: any): boolean {
  if (!err) return false
  const code = String(err?.code || err?.raw?.code || '')
  if (code === 'account_invalid' || code === 'resource_missing') {
    // resource_missing is generic; only trust it when it is about the account.
    if (code === 'account_invalid') return true
    const param = String(err?.param || err?.raw?.param || '')
    return param === '' || param === 'account' || param === 'id' || /account/i.test(errText(err))
  }
  const text = errText(err)
  if (/no such account/i.test(text)) return true
  if (/does not have access to account/i.test(text)) return true
  if (/application access may have been revoked/i.test(text)) return true
  return false
}

export type ConnectedAccountResolution =
  | { state: 'ok'; account: any }
  | { state: 'stale'; reason: string }

/**
 * Retrieve the stored account and classify it. A retrieve that SUCCEEDS but is
 * stamped for a different organizer is treated as stale too: it is not this
 * organizer's account and nothing should be onboarded or paid into it.
 * Any other Stripe failure is re-thrown — the caller cannot prove staleness.
 */
export async function resolveConnectedAccount(
  stripe: any,
  organizerId: string,
  stripeAccountId: string
): Promise<ConnectedAccountResolution> {
  let account: any
  try {
    account = await stripe.accounts.retrieve(stripeAccountId)
  } catch (err: any) {
    if (isStaleStripeAccountError(err)) {
      return { state: 'stale', reason: String(err?.code || err?.raw?.code || 'no_such_account') }
    }
    throw err
  }
  if (!account || account.deleted === true) return { state: 'stale', reason: 'account_deleted' }
  const owner = account?.metadata?.organizerId
  if (owner && String(owner) !== organizerId) return { state: 'stale', reason: 'foreign_account' }
  return { state: 'ok', account }
}

/** The account settings every organizer account is created with. */
export function expressAccountParams(params: {
  organizerId: string
  country: StripeConnectCountry
  email?: string | null
}) {
  return {
    type: 'express',
    country: params.country,
    ...(params.email ? { email: params.email } : {}),
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    settings: {
      payouts: {
        // MANUAL payout schedule. Ticket sales are destination charges, so the
        // money is the organizer's from the moment of sale — this does not put it
        // in Tikèm's custody. What it stops is the automatic hop from their Stripe
        // balance to their bank, which is the only thing that made an
        // attendance/hold policy unenforceable. Release is triggered by
        // /api/cron/release-payouts.
        schedule: { interval: 'manual' },
      },
    },
    metadata: { organizerId: params.organizerId },
  }
}

export async function createExpressAccount(
  stripe: any,
  params: { organizerId: string; country: StripeConnectCountry; email?: string | null }
): Promise<any> {
  return stripe.accounts.create(expressAccountParams(params))
}

export type ArchivedStripeAccount = {
  id: string
  archivedAt: string
  reason: string
}

/**
 * Swap a stale account id for a freshly created one, atomically.
 *
 * The transaction only commits if the profile STILL points at `oldId`; a
 * concurrent request that already replaced it wins, and the caller is told to
 * use that id instead (and should delete the account it just created).
 */
export async function replaceStripeAccountId(params: {
  organizerId: string
  oldId: string | null
  newId: string
  reason: string
  accountLocation: StripeAccountLocation
  now?: Date
}): Promise<{ replaced: boolean; stripeAccountId: string }> {
  const ref = getPayoutProfileRef(params.organizerId, 'stripe_connect')
  const nowIso = (params.now || new Date()).toISOString()

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const current = snap.exists ? (snap.data() as any) || {} : {}
    const currentId = current.stripeAccountId ? String(current.stripeAccountId) : null

    if (currentId && currentId !== params.oldId) {
      return { replaced: false, stripeAccountId: currentId }
    }

    const previous: ArchivedStripeAccount[] = Array.isArray(current.previousStripeAccountIds)
      ? current.previousStripeAccountIds.filter((e: any) => e && typeof e.id === 'string')
      : []
    if (params.oldId && !previous.some((e) => e.id === params.oldId)) {
      previous.push({ id: params.oldId, archivedAt: nowIso, reason: params.reason })
    }

    const update: Record<string, any> = {
      payoutProvider: 'stripe_connect',
      accountLocation: params.accountLocation,
      stripeAccountId: params.newId,
      previousStripeAccountIds: previous,
      stripeAccountReplacedAt: nowIso,
      // The status snapshot described the old account; clear it until the new
      // account's first account.updated arrives.
      stripeAccountStatus: null,
      updatedAt: nowIso,
    }
    if (!snap.exists) update.createdAt = nowIso
    tx.set(ref, update, { merge: true })
    return { replaced: true, stripeAccountId: params.newId }
  })
}

/** Best-effort removal of an account we created but lost a race to store. */
export async function deleteOrphanAccount(stripe: any, accountId: string): Promise<void> {
  try {
    await stripe.accounts.del(accountId)
  } catch (err: any) {
    console.warn('[stripe-connect] could not delete orphaned account', { accountId, message: err?.message })
  }
}

/** The JSON a route returns when the stored account is unusable. */
export function reconnectNeededBody(reason: string) {
  return {
    connected: false,
    status: 'reconnect_needed' as const,
    code: 'reconnect_needed' as const,
    reconnectRequired: true,
    reason,
    error: 'Your Stripe payout account needs to be reconnected. Start Stripe setup again to create a new one.',
  }
}

// ── account.updated snapshot ────────────────────────────────────────────────

export type StripeAccountStatusSnapshot = {
  accountId: string
  country: string | null
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  disabledReason: string | null
  currentlyDue: string[]
  eventuallyDue: string[]
  pastDue: string[]
  pendingVerification: string[]
  currentDeadline: number | null
  /** One-word summary the UI can switch on. */
  state: 'verified' | 'requires_more_info' | 'incomplete' | 'in_review'
  /** True when Stripe wants something from the organizer right now. */
  needsMoreInfo: boolean
  /** Stripe `event.created` (seconds) of the event this snapshot came from. */
  sourceEventCreated: number | null
  updatedAt: string
}

const arr = (v: any): string[] => (Array.isArray(v) ? v.map(String) : [])

export function accountStatusSnapshot(
  account: any,
  opts: { eventCreated?: number | null; now?: Date } = {}
): StripeAccountStatusSnapshot {
  const req = account?.requirements || {}
  const currentlyDue = arr(req.currently_due)
  const eventuallyDue = arr(req.eventually_due)
  const pastDue = arr(req.past_due)
  const disabledReason = req.disabled_reason ? String(req.disabled_reason) : null
  const detailsSubmitted = account?.details_submitted === true
  const chargesEnabled = account?.charges_enabled === true
  const payoutsEnabled = account?.payouts_enabled === true

  const state: StripeAccountStatusSnapshot['state'] =
    detailsSubmitted && chargesEnabled && payoutsEnabled && currentlyDue.length === 0 && pastDue.length === 0
      ? 'verified'
      : disabledReason || pastDue.length > 0
        ? 'requires_more_info'
        : currentlyDue.length > 0 || eventuallyDue.length > 0
          ? 'incomplete'
          : 'in_review'

  return {
    accountId: String(account?.id || ''),
    country: account?.country ? String(account.country) : null,
    detailsSubmitted,
    chargesEnabled,
    payoutsEnabled,
    disabledReason,
    currentlyDue,
    eventuallyDue,
    pastDue,
    pendingVerification: arr(req.pending_verification),
    currentDeadline: Number.isFinite(Number(req.current_deadline)) && req.current_deadline ? Number(req.current_deadline) : null,
    state,
    needsMoreInfo: Boolean(disabledReason) || pastDue.length > 0 || currentlyDue.length > 0,
    sourceEventCreated: opts.eventCreated ?? null,
    updatedAt: (opts.now || new Date()).toISOString(),
  }
}

export type RecordAccountStatusResult =
  | { recorded: true; organizerId: string }
  | { recorded: false; reason: 'no_organizer' | 'not_current_account' | 'stale_event' }

/**
 * Store the account's requirements on the organizer's stripe_connect profile
 * (`stripeAccountStatus`) so the payouts UI can say "Stripe needs more info"
 * without a live Stripe call.
 *
 * Only written when the profile's CURRENT account is the one the event is
 * about (an archived old-platform account must not overwrite the new one), and
 * only when the event is not older than the snapshot already stored — Stripe
 * does not guarantee delivery order.
 */
export async function recordStripeAccountStatus(
  account: any,
  opts: { eventCreated?: number | null; now?: Date } = {}
): Promise<RecordAccountStatusResult> {
  const accountId = String(account?.id || '')
  const organizerId = String(account?.metadata?.organizerId || '')
  if (!accountId || !organizerId) return { recorded: false, reason: 'no_organizer' }

  const ref = getPayoutProfileRef(organizerId, 'stripe_connect')
  const snapshot = accountStatusSnapshot(account, opts)

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const current = snap.exists ? (snap.data() as any) || {} : {}
    if (String(current.stripeAccountId || '') !== accountId) {
      return { recorded: false, reason: 'not_current_account' } as RecordAccountStatusResult
    }
    const storedCreated = Number(current?.stripeAccountStatus?.sourceEventCreated || 0)
    if (opts.eventCreated && storedCreated && opts.eventCreated < storedCreated) {
      return { recorded: false, reason: 'stale_event' } as RecordAccountStatusResult
    }
    tx.set(ref, { stripeAccountStatus: snapshot }, { merge: true })
    return { recorded: true, organizerId } as RecordAccountStatusResult
  })
}
