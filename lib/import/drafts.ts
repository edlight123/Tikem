import 'server-only'
/**
 * Write imported events as DRAFTS in an organizer's account (link import and
 * Eventbrite). One draft per organizer and source event (`imp_<hash>`):
 * importing again updates that draft. An event that is live, or one
 * moderation or the organizer closed (rejected, under review, cancelled,
 * frozen), is never touched, so a re-import cannot reopen it.
 *
 * The doc matches what the web composer creates (app/organizer/events/
 * EventComposer.tsx): snake_case ISO `created_at` / `updated_at`, the
 * moderation defaults the admin Events tabs filter on (is_published,
 * rejected, reports_count: a doc missing one is invisible there), a country
 * and currency pair firestore.rules accepts, and its own ticket_tiers docs.
 * The photo is copied into our bucket (lib/import/safe-fetch limits apply).
 */
import { createHash } from 'crypto'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { downloadUrl, existingDownloadUrl } from '@/lib/firebase/downloadUrl'
import { safeFetchImage } from '@/lib/import/safe-fetch'
import { resolveImportMarket, type ImportFlag } from '@/lib/import/market'
import { defaultPassFeesToBuyer, pickDefaultComposerCountry, timezoneForEvent } from '@/lib/events/composer-country'
import { getDeclaredMarkets } from '@/lib/firestore/organizer-markets'
import type { DraftInput } from '@/lib/import/draft-input'

/** The draft id for one organizer's copy of one source event. */
export function importDraftId(orgId: string, key: string): string {
  return `imp_${createHash('sha1').update(`${orgId}|${key}`).digest('hex').slice(0, 20)}`
}

/** True when an existing event must not be overwritten by an import. */
export function importMustSkip(prev: Record<string, any> | null): boolean {
  if (!prev) return false
  return (
    prev.is_published === true ||
    prev.rejected === true ||
    prev.hidden_pending_review === true ||
    prev.payouts_frozen === true ||
    !!prev.cancelled_at ||
    ['published', 'rejected', 'cancelled'].includes(String(prev.status || '').toLowerCase())
  )
}

/** Copy a remote photo into our bucket; null on any failure (the composer then offers a poster). */
export async function storeImage(orgId: string, src: string | null): Promise<string | null> {
  if (!src) return null
  try {
    const img = await safeFetchImage(src)
    if (!img) return null
    const name = `event-images/imports/${orgId}/${createHash('sha1').update(src).digest('hex').slice(0, 20)}.${img.ext}`
    const file = adminStorage.bucket().file(name)
    const existing = await existingDownloadUrl(file)
    if (existing) return existing
    await file.save(img.data, { contentType: img.type, resumable: false })
    return await downloadUrl(file)
  } catch {
    return null
  }
}

/** Where a new event of this org starts: first declared market, then saved defaults, then Haiti (as /organizer/events/new). */
export async function orgStartingCountry(orgId: string): Promise<string> {
  try {
    const [markets, userSnap, orgSnap] = await Promise.all([
      getDeclaredMarkets(orgId).catch(() => [] as string[]),
      adminDb.collection('users').doc(orgId).get(),
      adminDb.collection('organizers').doc(orgId).get(),
    ])
    const u = userSnap.exists ? (userSnap.data() as any) : null
    const o = orgSnap.exists ? (orgSnap.data() as any) : null
    return pickDefaultComposerCountry(markets[0], u?.default_country, o?.default_country)
  } catch {
    return 'HT'
  }
}

export interface DraftResult {
  id: string
  title: string
  /** Left alone: already live or closed. */
  skipped?: boolean
  /** Prices or place to check before publishing (lib/import/market). */
  flags?: ImportFlag[]
  sourceCurrency?: string | null
}

export async function writeDraft(
  ctx: { orgId: string; userId: string; orgName: string; fallbackCountry: string },
  d: DraftInput,
): Promise<DraftResult> {
  const id = importDraftId(ctx.orgId, d.key)
  const ref = adminDb.collection('events').doc(id)
  const existing = await ref.get()
  const prev = existing.exists ? existing.data() || {} : null
  // Ids are per org, and rules keep clients off imp_ ids; never take over a doc that isn't ours.
  if (importMustSkip(prev) || (prev && prev.organizer_id && prev.organizer_id !== ctx.orgId)) return { id, title: d.title, skipped: true }

  const tiers = d.tiers.length ? d.tiers : [{ name: 'Free', price: 0, quantity: 100 }]
  const prices = tiers.map((t) => t.price)
  const market = resolveImportMarket({ country: d.country, currency: d.currency, prices, fallbackCountry: ctx.fallbackCountry })
  const now = new Date().toISOString()
  const banner = await storeImage(ctx.orgId, d.image)
  const paid = prices.some((p) => p > 0)
  const total = tiers.reduce((s, t) => s + t.quantity, 0)
  const city = d.online ? '' : d.city

  const data: Record<string, any> = {
    organizer_id: ctx.orgId,
    organizer_name: ctx.orgName || prev?.organizer_name || '',
    title: d.title,
    description: d.description,
    summary: prev?.summary || '',
    category: prev?.category || 'Other',
    venue_name: d.online ? '' : d.venue,
    address: d.online ? '' : d.address,
    city,
    commune: '',
    country: market.country,
    currency: market.currency,
    timezone: timezoneForEvent(market.country, city),
    start_datetime: d.start,
    end_datetime: d.end && Date.parse(d.end) > Date.parse(d.start) ? d.end : new Date(Date.parse(d.start) + 2 * 3_600_000).toISOString(),
    is_online: d.online,
    ticket_price: Math.min(...prices),
    has_paid_tiers: paid,
    is_rsvp: !paid,
    total_tickets: total,
    capacity: total,
    total_capacity: total,
    ticket_name: tiers[0].name,
    fee_incidence: prev?.fee_incidence || (defaultPassFeesToBuyer(market.country) ? 'buyer' : 'organizer'),
    show_on_explore: prev?.show_on_explore ?? true,
    imported: {
      source: d.source,
      url: d.url,
      key: d.key,
      at: now,
      review: market.flags,
      source_currency: market.sourceCurrency,
    },
    // Always a draft: the organizer reviews it in the composer and publishes
    // through /api/events/[id]/publish, which runs every publish gate.
    is_published: false,
    status: 'draft',
    updated_at: now,
  }
  // A real photo replaces whatever the draft showed; none keeps the old one.
  if (banner) data.banner_image_url = banner
  else if (!prev?.banner_image_url) data.banner_image_url = null
  if (!prev) {
    Object.assign(data, {
      created_by: ctx.userId,
      created_at: now,
      tags: [],
      rejected: false,
      reports_count: 0,
    })
  }
  await ref.set(data, { merge: true })

  // Ticket types: only for a new draft. Once it exists the organizer owns
  // them in the composer (sold_quantity and created_at are never rewritten).
  if (!prev) {
    const batch = adminDb.batch()
    tiers.slice(0, 20).forEach((t, i) =>
      batch.set(adminDb.collection('ticket_tiers').doc(`${id}-t${i}`), {
        event_id: id,
        name: t.name,
        description: '',
        price: t.price,
        total_quantity: t.quantity,
        sold_quantity: 0,
        unlimited: false,
        is_active: true,
        max_per_order: null,
        enable_waitlist: false,
        sales_start: null,
        sales_end: null,
        valid_from: null,
        valid_until: null,
        sort_order: i,
        created_at: now,
        updated_at: now,
      }),
    )
    await batch.commit()
  }
  return { id, title: d.title, flags: market.flags, sourceCurrency: market.sourceCurrency }
}
