/**
 * Firestore + MonCash loader for the prefunding planner
 * (lib/payouts/prefunding-plan.ts). READ-ONLY toward money: it reads the live
 * prefunded balance, events, availability and withdrawal requests, and writes
 * only its own cache doc (prefunding_plan_cache/latest).
 *
 * Every per-event figure comes from loadEventAvailability(), i.e. the one
 * balance engine (computeEventAvailability) and the release ladder behind it.
 */

import { adminDb } from '@/lib/firebase/admin'
import { moncashPrefundedBalance } from '@/lib/moncash'
import {
  loadEventAvailability,
  loadOrganizerAvailabilityContext,
  type OrganizerAvailabilityContext,
} from '@/lib/payouts/availability-server'
import { normalizeCurrencyCode } from '@/lib/payouts/availability'
import { resolvePrefundingPlanConfig, type PrefundingPlanConfig } from '@/lib/payouts/prefunding-config'
import {
  computePrefundingPlan,
  type PayoutRailChoice,
  type PlanEventInput,
  type PlanWithdrawalInput,
  type PrefundingPlan,
} from '@/lib/payouts/prefunding-plan'

export const PREFUNDING_REQUESTS_COLLECTION = 'prefunding_requests'
const CACHE_REF = () => adminDb.collection('prefunding_plan_cache').doc('latest')

export type PoolBalanceReading = {
  balanceHtg: number | null
  checkedAt: string
  error: string | null
}

/** config/payouts → { prefunding, prefundingPlan (resolved) }. */
export async function loadPrefundingSettings(): Promise<{ config: PrefundingPlanConfig; prefunding: any }> {
  const snap = await adminDb.collection('config').doc('payouts').get()
  const data = snap.exists ? (snap.data() as any) || {} : {}
  return { config: resolvePrefundingPlanConfig(data.prefundingPlan), prefunding: data.prefunding || {} }
}

/** The live prefunded balance. Never throws: a failure is reported, not hidden. */
export async function readPoolBalance(now: Date = new Date()): Promise<PoolBalanceReading> {
  try {
    const { balance } = await moncashPrefundedBalance()
    return { balanceHtg: balance, checkedAt: now.toISOString(), error: null }
  } catch (e: any) {
    return { balanceHtg: null, checkedAt: now.toISOString(), error: String(e?.message || e || 'MonCash balance call failed') }
  }
}

function payoutRailFrom(profile: any): PayoutRailChoice {
  const method = String(profile?.method || '').toLowerCase()
  if (method === 'mobile_money' || method === 'moncash') return 'moncash'
  if (method === 'bank_transfer' || method === 'bank') return 'bank'
  return 'unknown'
}

async function organizerMeta(organizerId: string): Promise<{ rail: PayoutRailChoice; name: string | null }> {
  const [profileSnap, userSnap] = await Promise.all([
    adminDb.collection('organizers').doc(organizerId).collection('payoutProfiles').doc('haiti').get(),
    adminDb.collection('users').doc(organizerId).get(),
  ])
  const u = userSnap?.exists ? (userSnap.data() as any) || {} : {}
  const name = [u.organizer_name, u.business_name, u.full_name, u.display_name, u.displayName, u.name].find(
    (v) => typeof v === 'string' && v.trim()
  )
  return { rail: payoutRailFrom(profileSnap?.exists ? profileSnap.data() : null), name: name ? String(name).trim() : null }
}

/** Every event that settles in Haiti: currency HTG OR country HT (merged by id). */
async function loadHaitiEvents(): Promise<Array<{ id: string; data: any }>> {
  const [byCurrency, byCountry] = await Promise.all([
    adminDb.collection('events').where('currency', '==', 'HTG').get(),
    adminDb.collection('events').where('country', '==', 'HT').get(),
  ])
  const map = new Map<string, any>()
  for (const d of [...byCurrency.docs, ...byCountry.docs]) map.set(d.id, d.data() || {})
  return Array.from(map.entries()).map(([id, data]) => ({ id, data }))
}

/** MonCash withdrawals filed but not yet transferred out of the pool. */
export async function loadUnsentMoncashWithdrawals(): Promise<PlanWithdrawalInput[]> {
  const snap = await adminDb
    .collection('withdrawal_requests')
    .where('method', '==', 'moncash')
    .where('status', 'in', ['pending', 'processing'])
    .get()
  const out: PlanWithdrawalInput[] = []
  for (const doc of snap.docs) {
    const r = (doc.data() as any) || {}
    // Instant payouts and admin pool transfers have already left (or are being
    // reconciled against) the pool.
    if (r.prefundingUsed === true || r.adminTransferAt) continue
    const htg = Number(r.payoutAmountHtgCents)
    const amount = Number.isFinite(htg) && htg > 0
      ? Math.round(htg)
      : String(r.currency || 'HTG').toUpperCase() === 'HTG' && Number(r.amount) > 0
        ? Math.round(Number(r.amount))
        : null
    const created = r.createdAt?.toDate ? r.createdAt.toDate() : r.createdAt ? new Date(r.createdAt) : null
    out.push({
      id: doc.id,
      organizerId: String(r.organizerId || r.promoter_uid || ''),
      eventId: r.eventId ? String(r.eventId) : null,
      amountHtgMinor: amount,
      status: String(r.status || ''),
      createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
      payeeType: r.payee_type ? String(r.payee_type) : 'organizer',
    })
  }
  return out
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

/** Per-event planner inputs for every Haiti event, from the one availability engine. */
export async function loadPlanEvents(now: Date): Promise<PlanEventInput[]> {
  const events = await loadHaitiEvents()
  const byOrganizer = new Map<string, Array<{ id: string; data: any }>>()
  for (const e of events) {
    const org = String(e.data.organizer_id || e.data.organizerId || '')
    if (!org) continue
    const list = byOrganizer.get(org) || []
    list.push(e)
    byOrganizer.set(org, list)
  }

  const perOrganizer = await inBatches(Array.from(byOrganizer.entries()), 4, async ([organizerId, list]) => {
    const [context, meta]: [OrganizerAvailabilityContext, { rail: PayoutRailChoice; name: string | null }] =
      await Promise.all([loadOrganizerAvailabilityContext(organizerId, now), organizerMeta(organizerId)])
    const rows: PlanEventInput[] = []
    for (const e of list) {
      const a = await loadEventAvailability({ eventId: e.id, eventData: e.data, context, now })
      if (!a) continue
      if (!(a.balanceMinor > 0)) continue
      rows.push({
        eventId: e.id,
        title: String(e.data.title || 'Event'),
        organizerId,
        organizerName:
          [e.data.organizer_name, e.data.organizerName].find((v: any) => typeof v === 'string' && v.trim()) ||
          meta.name,
        currency: normalizeCurrencyCode(e.data.currency),
        payoutRail: meta.rail,
        balanceMinor: a.balanceMinor,
        availableNowMinor: a.availableNowMinor,
        releasedNow: a.releasedNow,
        reason: a.reason,
        availableAt: a.availableAt,
        effectiveEndsAt: a.effectiveEndsAt,
      })
    }
    return rows
  })
  return perOrganizer.flat()
}

export type LoadedPlan = { plan: PrefundingPlan; balance: PoolBalanceReading; config: PrefundingPlanConfig; prefunding: any }

/**
 * Load everything and compute. `balance` may be passed in by a caller that has
 * just read it (the refresh cron), so MonCash is not asked twice.
 */
export async function loadPrefundingPlan(opts: { now?: Date; balance?: PoolBalanceReading } = {}): Promise<LoadedPlan> {
  const now = opts.now || new Date()
  const [{ config, prefunding }, events, unsentWithdrawals, balance] = await Promise.all([
    loadPrefundingSettings(),
    loadPlanEvents(now),
    loadUnsentMoncashWithdrawals(),
    opts.balance ? Promise.resolve(opts.balance) : readPoolBalance(now),
  ])
  const plan = computePrefundingPlan({ now, events, unsentWithdrawals, poolBalanceHtg: balance.balanceHtg, config })
  await CACHE_REF()
    .set({
      computedAt: plan.computedAt,
      poolBalanceHtg: plan.poolBalanceHtg,
      minimumHtg: plan.minimum.amountHtg,
      minimumPoolNeedMinor: plan.minimum.poolNeedMinor,
      recommendedHtg: plan.recommended.amountHtg,
      maximumHtg: plan.maximum.amountHtg,
      warnings: plan.warnings.map((w) => w.code),
    })
    .catch((e: any) => console.warn('[prefunding-plan] cache write failed', e?.message || e))
  return { plan, balance, config, prefunding }
}

/** The cached 2-day pool need, when fresh enough; null = recompute. */
export async function readCachedMinimumNeed(maxAgeHours: number, now: Date = new Date()): Promise<number | null> {
  const snap = await CACHE_REF().get()
  if (!snap.exists) return null
  const d = (snap.data() as any) || {}
  const at = d.computedAt ? new Date(d.computedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  if (now.getTime() - at.getTime() > maxAgeHours * 3_600_000) return null
  const need = Number(d.minimumPoolNeedMinor)
  return Number.isFinite(need) ? need : null
}
