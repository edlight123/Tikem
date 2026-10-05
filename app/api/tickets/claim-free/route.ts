import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { notifyTicketPurchase, notifyOrganizerTicketSale } from '@/lib/notifications/helpers'
import { hasEventAccess } from '@/lib/events/access-guard'
import { FieldValue } from 'firebase-admin/firestore'
import {
  buildTierSoldIncrements,
  releaseInventoryReservation,
  reserveInventoryAtomic,
} from '@/lib/tickets/inventory'
import {
  calculateDiscount,
  promoBuyerKey,
  promoCanCoverOrder,
  redeemPromoInTransaction,
  resolvePromoCode,
  type PromoDoc,
} from '@/lib/promo-codes'
import { recordPromoterSale, resolvePromoterCode } from '@/lib/promoters'
import { ticketAttributionFields } from '@/lib/attribution'
import { recordAttributedSale, resolveOrderAttribution } from '@/lib/tracking-links'
import { computeSelectionTotal, toCents } from '@/lib/ticketPricing'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import {
  beginGuestCheckout,
  identityFromUser,
  type CheckoutIdentity,
} from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, guestTicketUrl } from '@/lib/guest/identity'
import {
  checkEventPurchasable,
  invalidQuantityRefusal,
  normalizeTierLines,
  parseTicketQuantity,
} from '@/lib/tickets/purchasable'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import crypto from 'crypto'

/** Hard cap on how many free tickets one claim may issue, across all tiers. */
const MAX_FREE_TICKETS_PER_CLAIM = 10

/**
 * Error responses carry BOTH a human-readable English `error` (unchanged wording,
 * so shipped clients and logs keep working) and a stable machine `code`. Clients
 * localize off `code` — mobile build 10 ignores it, newer clients use it instead
 * of showing raw English server copy to a buyer.
 */
function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

/** One validated line of a claim: which tier, how many, and what to name the tickets. */
interface TierClaim {
  /** '' for a legacy event with no tier docs — those tickets carry no tier_id. */
  tierId: string
  tierName: string
  quantity: number
  /** The tier's OWN price, straight from Firestore (major units). Never client-supplied. */
  unitPrice: number
}

/**
 * The once-per-event free-claim lock for this claimant.
 *
 * `create()` on a deterministic doc id is atomic: of two concurrent claims by the
 * same account (or the same guest email) exactly one gets the lock, which closes the
 * check-then-act gap between the "already holds a free ticket?" query and the
 * reservation below. A guest is keyed on a HASH of their email, so the lock doc
 * never stores the address itself.
 */
function freeClaimLockId(eventId: string, identity: CheckoutIdentity): string {
  if (identity.isGuest) {
    const email = String(identity.email || '').trim().toLowerCase()
    const digest = crypto.createHash('sha256').update(email).digest('hex').slice(0, 40)
    return `${eventId}__guest_${digest}`
  }
  return `${eventId}__${identity.id}`
}

/**
 * A legacy lock (no recorded ticket_ids) younger than this is a claim in flight:
 * the double tap the lock exists for.
 */
const FREE_CLAIM_LOCK_IN_FLIGHT_MS = 2 * 60 * 1000

/** The claimant's LIVE free tickets for this event (lib/tickets/status vocabulary). */
function liveFreeTicketsFor(docs: any[], eventId: string): any[] {
  return docs
    .map((d: any) => ({ id: d.id, ...d.data() }))
    .filter((t: any) => t.event_id === eventId && Number(t.price_paid ?? 0) === 0 && isLiveTicketStatus(t.status))
}

/** Statuses that void a free ticket for good. Anything else (transferred, unknown) is not void. */
const VOIDED_FREE_TICKET_STATUSES = new Set(['refunded', 'cancelled', 'canceled', 'voided', 'void'])

/** True only for a ticket that was refunded / cancelled and never used at the door. */
function isVoidedFreeTicket(t: any): boolean {
  if (t?.checked_in === true || t?.checked_in_at) return false
  const status = String(t?.status ?? '').toLowerCase().trim()
  if (isLiveTicketStatus(status)) return false
  return VOIDED_FREE_TICKET_STATUSES.has(status)
}

function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(err?.message || ''))
}

/**
 * A guest who has already claimed gets a NEUTRAL answer. The email they typed is
 * unverified, so echoing the earlier order's tickets (QR payloads, phone number)
 * would hand anyone who knows an address that person's tickets. The real owner
 * already has them in their inbox.
 */
const GUEST_ALREADY_CLAIMED_MESSAGE =
  'You already claimed a ticket for this event. Check your email for your tickets.'

/**
 * Sale-window / active / sold-out gate for a tier, mirroring the paid initiate
 * routes so a FREE tier is held to exactly the same rules as a paid one.
 */
function tierIsOnSale(
  tier: any,
  now: Date
): { ok: true } | { ok: false; reason: string; code: string } {
  if (tier?.is_active === false) {
    return { ok: false, reason: 'This ticket tier is not available.', code: 'tier_inactive' }
  }

  const salesStart = tier?.sales_start ? new Date(tier.sales_start) : null
  const salesEnd = tier?.sales_end ? new Date(tier.sales_end) : null

  if (salesStart && !Number.isNaN(salesStart.getTime()) && salesStart > now) {
    return {
      ok: false,
      reason: 'Ticket sales for this tier have not started yet.',
      code: 'tier_not_started',
    }
  }
  if (salesEnd && !Number.isNaN(salesEnd.getTime()) && salesEnd < now) {
    return { ok: false, reason: 'Ticket sales for this tier have ended.', code: 'tier_sales_ended' }
  }

  // 0 / missing total ⇒ unlimited (matches reserveInventoryAtomic's convention).
  const total = Number(tier?.total_quantity ?? tier?.quantity ?? 0)
  if (Number.isFinite(total) && total > 0) {
    const sold = Number(tier?.sold_quantity || 0)
    if (total - sold <= 0) {
      return { ok: false, reason: 'This ticket tier is sold out.', code: 'tier_sold_out' }
    }
  }

  return { ok: true }
}

/** A tier/event price as stored in Firestore, coerced to a finite non-negative number. */
function storedPrice(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function POST(request: Request) {
  try {
    // A missing session is no longer fatal: an RSVP may be claimed by a GUEST who
    // supplies `guest: { name, email, phone }`. The identity is resolved after the
    // event is loaded (the phone rule and the password gate both depend on it).
    const user = await getCurrentUser()

    console.log('=== CLAIM FREE TICKET ===')
    console.log('User:', user?.id, user?.email)

    // TWO accepted payload shapes:
    //
    //  1. `{ eventId, tierId?, quantity? }` — the ORIGINAL shape. Mobile build 10
    //     is in testers' hands sending exactly this, so its behavior is frozen:
    //     one tier (explicit via `tierId`, or auto-resolved to the event's free
    //     tier), `quantity` clamped to 1..10.
    //  2. `{ eventId, selections: [{ tierId, quantity }] }` — the web selector has
    //     no single-tier enforcement, so a free cart can span several tiers and
    //     quantities. Each line is validated independently and the whole claim is
    //     reserved atomically (all-or-nothing).
    //
    // `selections` wins when present and non-empty; otherwise shape 1 runs verbatim.
    //
    // OPTIONAL `promoCode` (raw code OR promo doc id, exactly like the paid
    // initiators accept) turns this into "issue a claim that the SERVER prices at
    // 0 after applying the promo". Nothing about the client's belief is trusted:
    // the tier price comes from Firestore, the promo comes from `promo_codes`, and
    // the discount is recomputed here. When `promoCode` is absent every code path
    // below behaves exactly as it did before.
    //
    // OPTIONAL `accessCode` is how a GUEST claims on a password-protected event:
    // they have no uid to hold a grant, so they present the code with the claim and
    // it is verified server-side before anything is created. A signed-in claimant
    // still unlocks through /api/events/verify-access and is admitted by their grant.
    const { eventId, quantity = 1, tierId, selections, promoCode, refCode, guest, accessCode, attribution: rawAttribution } =
      await request.json()
    // Whole-number quantities only. A line with quantity 0 is dropped (selectors send
    // untouched tiers at 0); any other non-integer refuses the claim rather than being
    // truncated into an order the claimant did not ask for. The 10-ticket cap below
    // keeps its own message.
    const selectionLines = normalizeTierLines(selections, Number.MAX_SAFE_INTEGER)
    if (!selectionLines.ok) {
      return fail(selectionLines.error, selectionLines.code, selectionLines.status)
    }
    const requestedSelections = selectionLines.lines
    const useSelections = requestedSelections.length > 0
    const requestedPromo = String(promoCode ?? '').trim()
    console.log(
      'Event ID:', eventId,
      'Quantity:', quantity,
      'Tier:', tierId || '(auto)',
      'Selections:', useSelections ? JSON.stringify(requestedSelections) : '(none)',
      'Promo:', requestedPromo ? '(provided)' : '(none)'
    )

    if (!eventId) {
      return fail('Event ID is required', 'missing_event_id', 400)
    }

    if (Array.isArray(selections) && selections.length > 0 && !useSelections) {
      // Caller sent a selections array but every line was unusable.
      return fail('No valid ticket selections provided', 'no_valid_selections', 400)
    }

    // Validate quantity. For the selections shape the total across all tiers is
    // capped — and REFUSED rather than truncated, since silently trimming a
    // multi-tier cart would issue an order the buyer never asked for.
    const selectionsTotal = requestedSelections.reduce((sum, s) => sum + s.quantity, 0)
    if (useSelections && selectionsTotal > MAX_FREE_TICKETS_PER_CLAIM) {
      return fail(
        `You can claim at most ${MAX_FREE_TICKETS_PER_CLAIM} free tickets at a time.`,
        'too_many_tickets',
        400
      )
    }
    // Shape 1 keeps its frozen clamp to 1..10 for WHOLE numbers; a fractional or
    // non-numeric quantity is refused (it used to reserve 1.5 seats and issue 2).
    let singleQuantity = 1
    if (!useSelections) {
      const asNumber = typeof quantity === 'string' ? Number(quantity) : quantity
      if (typeof asNumber !== 'number' || !Number.isInteger(asNumber)) {
        const refusal = invalidQuantityRefusal(MAX_FREE_TICKETS_PER_CLAIM)
        return fail(refusal.error, refusal.code, refusal.status)
      }
      singleQuantity = Math.min(Math.max(1, asNumber), MAX_FREE_TICKETS_PER_CLAIM)
    }
    const ticketQuantity = useSelections ? selectionsTotal : singleQuantity
    if (parseTicketQuantity(ticketQuantity, MAX_FREE_TICKETS_PER_CLAIM) === null) {
      const refusal = invalidQuantityRefusal(MAX_FREE_TICKETS_PER_CLAIM)
      return fail(refusal.error, refusal.code, refusal.status)
    }
    console.log('Validated quantity:', ticketQuantity)

    // Fetch event details from Firestore
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    
    console.log('Event fetch result:', { exists: eventDoc.exists, id: eventDoc.id })

    if (!eventDoc.exists) {
      return fail('Event not found', 'event_not_found', 404)
    }

    const event = { id: eventDoc.id, ...eventDoc.data() } as any

    // Cancelled, unpublished, rejected or finished events issue nothing.
    const purchasable = checkEventPurchasable(event)
    if (!purchasable.ok) {
      return fail(purchasable.error, purchasable.code, purchasable.status)
    }

    // Resolve the claimant: the signed-in user, or a validated guest contact record.
    // A guest gets a `guest_…` id and a signed retrieval token; everything below treats
    // that id exactly as it treats a uid.
    let identity: CheckoutIdentity
    if (user) {
      identity = identityFromUser(user)
    } else {
      const guestOutcome = await beginGuestCheckout({
        guestInput: guest,
        event,
        eventId: String(eventId),
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        accessCode,
        errorBody: (error, code) => ({ error, code }),
      })
      if (!guestOutcome.ok) return guestOutcome.response
      identity = guestOutcome.identity
    }

    // Password-protected events: require a valid access grant before issuing tickets.
    // A guest reaches this line only after beginGuestCheckout verified their code and
    // wrote a grant against their `guest_…` id, so the gate is as strict as it was.
    if (!(await hasEventAccess(event, eventId, identity.id))) {
      return fail('access_code_required', 'access_code_required', 403)
    }

    // ── Promo code, re-validated SERVER-SIDE ────────────────────────────────────
    // Same lookup + same rules as the paid initiators
    // (app/api/moncash-button/initiate/route.ts:157-160,
    //  app/api/create-payment-intent/route.ts:202-208): resolvePromoCode enforces
    // "belongs to THIS event" + is_active + not expired, and promoHasCapacity
    // enforces the usage cap softly here (the cap is enforced ATOMICALLY at
    // redemption below). The difference from the paid path: an unusable promo
    // there just charges full price, whereas here it must REFUSE — silently
    // dropping the discount would hand out a paid ticket for nothing.
    let promo: PromoDoc | null = null
    if (requestedPromo) {
      const resolved = await resolvePromoCode(String(eventId), requestedPromo)
      if (!resolved) {
        return fail('This promo code is not valid for this event.', 'promo_invalid', 400)
      }
      // Same pricing-time mirror of the redemption caps the paid routes use: the
      // whole claim's quantity, and this claimant's per-buyer allowance.
      const cover = await promoCanCoverOrder(resolved, {
        qty: ticketQuantity,
        buyerKey: promoBuyerKey(identity),
      })
      if (!cover.ok) {
        return cover.reason === 'cap'
          ? fail('This promo code has reached its usage limit.', 'promo_exhausted', 400)
          : fail('You have already used this promo code.', 'promo_already_used', 400)
      }
      promo = resolved
    }

    // Promoter attribution (optional). Unlike a promo, an unusable ref changes
    // NOTHING about the claim, so it is silently dropped rather than refused.
    const promoter = refCode ? await resolvePromoterCode(String(eventId), String(refCode)) : null
    // Tracking-link / utm attribution — re-resolved against this event; an RSVP
    // counts as a (zero-revenue) sale on the link.
    const attribution = await resolveOrderAttribution(String(eventId), rawAttribution, promoter?.code || null)

    /**
     * What the SERVER says one ticket of this tier costs after the promo.
     * The only pricing authority in this route — `calculateDiscount` is the exact
     * function both paid initiators use, so a code discounts identically here.
     */
    const chargedUnitPrice = (price: number): number =>
      promo ? calculateDiscount(price, promo).discountedPrice : price

    /** True when the server's own math makes this tier cost exactly nothing. */
    const zeroesToFree = (price: number): boolean => toCents(chargedUnitPrice(price)) === 0

    // Resolve WHICH tier is being claimed, and prove it is actually free.
    //
    // An event may offer a free tier alongside paid ones. `event.ticket_price` is
    // the LOWEST tier price, so it is 0 for such an event and cannot be used to
    // decide whether this claim is legitimate — that would let a buyer claim a
    // free ticket on any event whose cheapest tier happens to be 0. The tier's
    // OWN price is the authority, and it is held to the same sale-window /
    // is_active / sold-out gate as the paid routes.
    //
    // Both payload shapes end up as the same list of validated `TierClaim` lines.
    let claims: TierClaim[] = []

    let tierDocs: any[] = []
    try {
      const tiersSnap = await adminDb
        .collection('ticket_tiers')
        .where('event_id', '==', eventId)
        .get()
      tierDocs = tiersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
    } catch (tierErr) {
      console.warn('[claim-free] failed to load tiers', { message: (tierErr as any)?.message })
    }

    if (useSelections) {
      // Multi-tier claim. EVERY line is held to exactly the same gate as the
      // single-tier path: belongs to this event, its OWN price is 0, is_active,
      // inside the sale window, and not sold out. One bad line fails the claim —
      // partial issuance would charge the buyer's per-event free allowance for an
      // order they didn't get.
      const now = new Date()
      for (const sel of requestedSelections) {
        const tier = tierDocs.find((t: any) => String(t.id) === sel.tierId)
        if (!tier) {
          return fail('Ticket tier not found for this event', 'tier_not_found', 404)
        }
        const price = storedPrice(tier.price)
        if (!zeroesToFree(price)) {
          // With a promo the buyer's expectation was "this is free", so name the
          // real reason: the promo does not fully cover this tier. Partial
          // discounts belong on the paid checkout path.
          return promo
            ? fail(
                'This promo code does not make these tickets free.',
                'promo_not_free',
                400
              )
            : fail('This ticket tier is not free', 'tier_not_free', 400)
        }
        const onSale = tierIsOnSale(tier, now)
        if (!onSale.ok) {
          return fail(onSale.reason, onSale.code, 400)
        }
        claims.push({
          tierId: String(tier.id),
          tierName: String(tier.name || 'General Admission'),
          quantity: sel.quantity,
          unitPrice: price,
        })
      }
    } else if (tierId) {
      // Explicit tier: it must belong to THIS event, price out at 0 (on its own or
      // via the promo), and be on sale.
      const tier = tierDocs.find((t: any) => String(t.id) === String(tierId))
      if (!tier) {
        return fail('Ticket tier not found for this event', 'tier_not_found', 404)
      }
      const price = storedPrice(tier.price)
      if (!zeroesToFree(price)) {
        return promo
          ? fail('This promo code does not make these tickets free.', 'promo_not_free', 400)
          : fail('This ticket tier is not free', 'tier_not_free', 400)
      }
      const onSale = tierIsOnSale(tier, new Date())
      if (!onSale.ok) {
        return fail(onSale.reason, onSale.code, 400)
      }
      claims = [{
        tierId: String(tier.id),
        tierName: String(tier.name || 'General Admission'),
        quantity: ticketQuantity,
        unitPrice: price,
      }]
    } else if (tierDocs.length > 0) {
      // No explicit tier: pick the event's free tier. If NO tier is free, the
      // event has nothing to give away — refuse rather than issuing a ticket for
      // a paid tier at no charge.
      //
      // A promo deliberately does NOT widen this branch: choosing which PAID tier a
      // 100%-off code should zero is a decision only the buyer can make, and
      // guessing would hand out (say) the VIP tier because it happened to sort
      // first. The caller must name the tier.
      const freeTiers = tierDocs
        .filter((t: any) => storedPrice(t.price) === 0)
        .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      if (freeTiers.length === 0) {
        return promo
          ? fail('Select a ticket type to use this promo code.', 'promo_requires_tier', 400)
          : fail('This is not a free event', 'event_not_free', 400)
      }
      const onSaleFree = freeTiers.find((t: any) => tierIsOnSale(t, new Date()).ok)
      if (!onSaleFree) {
        const reason = tierIsOnSale(freeTiers[0], new Date())
        return reason.ok
          ? fail('No tickets available', 'no_tickets_available', 400)
          : fail(reason.reason, reason.code, 400)
      }
      claims = [{
        tierId: String(onSaleFree.id),
        tierName: String(onSaleFree.name || 'General Admission'),
        quantity: ticketQuantity,
        unitPrice: storedPrice(onSaleFree.price),
      }]
    } else {
      // Legacy event with no tier docs at all: fall back to the event-level price.
      const price = storedPrice(event.ticket_price)
      if (!zeroesToFree(price)) {
        return promo
          ? fail('This promo code does not make these tickets free.', 'promo_not_free', 400)
          : fail('This is not a free event', 'event_not_free', 400)
      }
      // Empty tierId — these tickets carry no tier and only count toward the
      // event-level tickets_sold (buildTierSoldIncrements skips them).
      claims = [{ tierId: '', tierName: 'General Admission', quantity: ticketQuantity, unitPrice: price }]
    }

    // ── Final price gate ────────────────────────────────────────────────────────
    // Independent of every branch above: recompute the whole order from the prices
    // this route READ OUT OF FIRESTORE and refuse unless the server's own total is
    // exactly 0. Money math runs on integer cents (computeSelectionTotal) so a
    // percentage promo can't leave a fraction of a gourde behind and slip through
    // as "close enough to free".
    const grossTotalCents = toCents(
      computeSelectionTotal(claims.map((c) => ({ price: c.unitPrice, quantity: c.quantity })))
    )
    const netTotalCents = toCents(
      computeSelectionTotal(
        claims.map((c) => ({ price: chargedUnitPrice(c.unitPrice), quantity: c.quantity }))
      )
    )
    if (netTotalCents !== 0) {
      console.warn('[claim-free] refusing non-zero claim', { eventId, netTotalCents })
      return promo
        ? fail('This promo code does not make these tickets free.', 'promo_not_free', 400)
        : fail('This ticket tier is not free', 'tier_not_free', 400)
    }
    // How much the promo actually took off. 0 means the tiers were already free and
    // the promo did nothing — in that case we must NOT burn one of its uses below.
    const promoDiscountCents = Math.max(0, grossTotalCents - netTotalCents)

    // Per-user dedup: never issue a second FREE ticket to the same user for the same
    // event (prevents refresh/double-click and scripted abuse from claiming unlimited
    // free inventory). Query by attendee_id only (single-field, auto-indexed) and
    // filter in memory — a user holds few tickets, so this avoids a composite index.
    //
    // Scoped to free tickets: on an event with free AND paid tiers, a buyer who
    // already PAID must not be told they "already claimed" the free tier, and their
    // paid ticket must not be returned as if it were the claim.
    //
    // A GUEST has a freshly-minted id, so `attendee_id` would never match anything.
    // Their dedup key is the EMAIL they just gave — the one identifier that survives
    // across their (session-less) visits. Both are single-field equality queries, so
    // neither needs a composite index.
    const userTicketsSnap = identity.isGuest
      ? await adminDb.collection('tickets').where('guest_email', '==', identity.email).get()
      : await adminDb.collection('tickets').where('attendee_id', '==', identity.id).get()
    // A signed-in claimant is deduped on their LIVE free tickets only: one that
    // was refunded, cancelled or voided no longer holds the claim. (A guest's
    // answer is neutral either way, so any earlier ticket still counts.)
    const existing = identity.isGuest
      ? userTicketsSnap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((t: any) => t.event_id === eventId && Number(t.price_paid ?? 0) === 0)
      : liveFreeTicketsFor(userTicketsSnap.docs, String(eventId))
    if (existing.length > 0) {
      console.log('User already has free ticket(s) for event:', eventId, 'count:', existing.length)
      if (identity.isGuest) {
        return fail(GUEST_ALREADY_CLAIMED_MESSAGE, 'already_claimed', 409)
      }
      return NextResponse.json({
        success: true,
        tickets: existing,
        count: existing.length,
        message: 'You already claimed a ticket for this event.',
      })
    }

    // Take the once-per-event lock BEFORE reserving, so two simultaneous claims by
    // the same claimant cannot both pass the query above and both be issued.
    const lockRef = adminDb.collection('free_claim_locks').doc(freeClaimLockId(String(eventId), identity))
    let lockHeld = false
    try {
      await lockRef.create({
        event_id: String(eventId),
        kind: identity.isGuest ? 'guest' : 'account',
        created_at: new Date().toISOString(),
      })
      lockHeld = true
    } catch (lockErr: any) {
      if (isAlreadyExists(lockErr)) {
        console.log('[claim-free] concurrent/previous claim holds the lock', { eventId })
        if (identity.isGuest) {
          return fail(GUEST_ALREADY_CLAIMED_MESSAGE, 'already_claimed', 409)
        }
        // Signed in: the claim reopens ONLY when every ticket it issued has been
        // voided (refunded / cancelled). A ticket transferred to someone else
        // still holds it, or a claimant could farm free tickets: claim, transfer,
        // claim again. Decided inside a transaction on the lock:
        //  - the lock records its ticket_ids → read each by id; any one still live
        //    (whoever holds it now) or checked in, or missing → the claim holds
        //  - a legacy lock (no ticket_ids) → the claimant's tickets for this
        //    event by their claimant fields; any live one holds it, and if none
        //    can be found the claim also holds (it cannot be shown to be void)
        //  - a fresh lock with nothing issued yet → a concurrent claim mid-way
        // When the claim holds, the claimant's own live tickets come back, or a
        // 409 — never "success" with zero tickets (build 44 read that as
        // "N tickets claimed").
        const takeover = await adminDb.runTransaction(async (tx: any) => {
          const lockSnap = await tx.get(lockRef)
          const ownSnap = await tx.get(
            adminDb.collection('tickets').where('attendee_id', '==', identity.id)
          )
          const ownLive = liveFreeTicketsFor(ownSnap?.docs || [], String(eventId))
          const held = () =>
            ownLive.length > 0
              ? ({ outcome: 'has_tickets' as const, tickets: ownLive })
              : ({ outcome: 'held' as const })

          const lock = lockSnap?.exists ? lockSnap.data() || {} : null
          if (!lock) {
            // Released between our create() and now: take it fresh.
            tx.set(lockRef, {
              event_id: String(eventId),
              kind: 'account',
              created_at: new Date().toISOString(),
            })
            return { outcome: 'taken' as const }
          }

          const recordedIds: string[] = Array.isArray(lock.ticket_ids)
            ? lock.ticket_ids.map((id: any) => String(id)).filter(Boolean)
            : []
          let issuedTickets: any[]
          if (recordedIds.length > 0) {
            const snaps = await Promise.all(
              recordedIds.map((id) => tx.get(adminDb.collection('tickets').doc(id)))
            )
            // A recorded ticket that no longer exists cannot be shown void.
            if (snaps.some((snap: any) => !snap?.exists)) return held()
            issuedTickets = snaps.map((snap: any) => snap.data() || {})
          } else {
            const createdAt = lock.created_at ? new Date(lock.created_at).getTime() : NaN
            if (Number.isFinite(createdAt) && Date.now() - createdAt < FREE_CLAIM_LOCK_IN_FLIGHT_MS) {
              return held()
            }
            const eventTicketsSnap = await tx.get(
              adminDb.collection('tickets').where('event_id', '==', String(eventId))
            )
            issuedTickets = (eventTicketsSnap?.docs || [])
              .map((d: any) => d.data() || {})
              .filter(
                (t: any) =>
                  t.event_id === String(eventId) &&
                  Number(t.price_paid ?? 0) === 0 &&
                  [t.attendee_id, t.user_id, t.original_attendee_id, t.claimed_by].some(
                    (v: any) => v != null && String(v) === String(identity.id)
                  )
              )
            if (issuedTickets.length === 0) return held()
          }
          if (!issuedTickets.every(isVoidedFreeTicket)) return held()

          tx.set(lockRef, {
            event_id: String(eventId),
            kind: 'account',
            created_at: new Date().toISOString(),
            replaced_voided_claim_at: new Date().toISOString(),
            previous_ticket_ids: recordedIds,
          })
          return { outcome: 'taken' as const }
        })
        if (takeover.outcome === 'has_tickets') {
          return NextResponse.json({
            success: true,
            tickets: takeover.tickets,
            count: takeover.tickets.length,
            message: 'You already claimed a ticket for this event.',
          })
        }
        if (takeover.outcome === 'held') {
          return fail('You already claimed a ticket for this event.', 'already_claimed', 409)
        }
        lockHeld = true
      } else {
        // A transient failure to write the lock must not block a legitimate claim;
        // the per-claimant query above already ran.
        console.warn('[claim-free] could not take claim lock (continuing)', { message: lockErr?.message })
      }
    }
    /** Give the claimant their one claim back when this attempt issues nothing. */
    const releaseLock = async () => {
      if (!lockHeld) return
      lockHeld = false
      try {
        await lockRef.delete()
      } catch (e) {
        console.warn('[claim-free] failed to release claim lock', { message: (e as any)?.message })
      }
    }

    // Atomic capacity gate + increment (same helper the paid paths use). Reserving BEFORE issuing
    // tickets serializes concurrent claims through a Firestore transaction so the event can't be
    // oversold, and the increment is done here (no separate non-atomic update below).
    //
    // ALL-OR-NOTHING for a multi-tier claim: one call with every tier increment, so
    // the whole order is checked and committed inside a single transaction. If any
    // one tier lacks capacity the buyer gets nothing and can retry, rather than
    // being left with a partial order that has already burned their one free claim
    // for this event.
    const tierIncrements = buildTierSoldIncrements(
      claims.map((c) => ({ tierId: c.tierId, quantity: c.quantity }))
    )
    const reservation = await reserveInventoryAtomic({
      eventId,
      quantity: ticketQuantity,
      tierIncrements,
      logPrefix: '[claim-free]',
    })
    if (!reservation.ok) {
      await releaseLock()
      const remaining = Number(reservation.remaining ?? 0)
      if (remaining <= 0) {
        return fail('No tickets available', 'no_tickets_available', 400)
      }
      return fail(
        `Only ${remaining} ticket${remaining !== 1 ? 's' : ''} remaining`,
        'limited_availability',
        400
      )
    }

    // ── Promo redemption: the authoritative usage-cap gate ──────────────────────
    // Same helper the paid pipeline calls (lib/tickets/fulfillment.ts:335), which
    // re-reads uses_count/max_uses inside a Firestore transaction and only then
    // increments + writes the `promo_code_usage` record. Two differences from the
    // paid path, both deliberate:
    //   • it runs BEFORE tickets exist, so a cap-reached code can still be refused
    //     cleanly (the paid path has already taken money, so it keeps the tickets
    //     and just logs);
    //   • ANY non-redemption is fatal here. If we cannot record the redemption we
    //     must not give the ticket away, otherwise a single-use code would issue
    //     unlimited free tickets.
    // The reservation made just above is released so the refusal doesn't leak
    // inventory.
    if (promo && promoDiscountCents > 0) {
      const redeem = await redeemPromoInTransaction({
        promoId: promo.id,
        qty: ticketQuantity,
        userId: identity.id,
        // A guest's `guest_…` id is minted per claim, so it cannot carry a per-buyer
        // cap. Their EMAIL can — the same identifier the free-ticket dedup above
        // keys on.
        buyerKey: promoBuyerKey(identity),
        eventId,
        discountApplied: promoDiscountCents / 100,
      })
      if (!redeem.redeemed) {
        await releaseLock()
        await releaseInventoryReservation({
          eventId,
          quantity: ticketQuantity,
          tierIncrements,
          logPrefix: '[claim-free]',
        })
        console.warn('[claim-free] promo redemption refused', {
          eventId,
          promoId: promo.id,
          capReached: redeem.capReached,
        })
        if (redeem.buyerCapReached) {
          return fail('You have already used this promo code.', 'promo_already_used', 400)
        }
        return redeem.capReached
          ? fail('This promo code has reached its usage limit.', 'promo_exhausted', 400)
          : fail('Could not apply this promo code. Please try again.', 'promo_redeem_failed', 400)
      }
    }

    // Create tickets one at a time to ensure each gets a unique ID, tier by tier so
    // every ticket carries the tier it was actually claimed against.
    const createdTickets: any[] = []
    try {
      for (const claim of claims) {
        for (let i = 0; i < claim.quantity; i++) {
          const ticketData = {
            event_id: eventId,
            attendee_id: identity.id,
            attendee_name: identity.name || identity.email || 'Guest',
            // A guest ticket carries its buyer's contact details so support and refunds
            // can find it by email or phone without a uid to join on.
            ...(identity.isGuest
              ? { is_guest: true, guest_email: identity.email, guest_phone: identity.phone || null }
              : {}),
            status: 'valid',
            price_paid: 0,
            currency: event.currency || 'HTG',
            payment_method: 'free',
            purchased_at: FieldValue.serverTimestamp(),
            tier_name: claim.tierName || 'General Admission',
            tier_id: claim.tierId,
            // Include event date fields for scanner
            start_datetime: event.start_datetime || null,
            end_datetime: event.end_datetime || null,
            event_date: event.start_datetime || null,
            venue_name: event.venue_name || null,
            city: event.city || null,
            // Audit trail for a promo-zeroed ticket. Added ONLY when a promo actually
            // paid for it, so a plain free claim keeps its exact historical doc shape.
            ...(promo && promoDiscountCents > 0
              ? { promo_code_id: promo.id, original_price: claim.unitPrice }
              : {}),
            // Promoter attribution — added only when a valid ref arrived, keeping the
            // plain claim's doc shape unchanged. Free claims earn no commission; the
            // promoter still gets credit for driving the RSVP.
            ...(promoter ? { promoter_id: promoter.id, promoter_code: promoter.code } : {}),
            // Visit attribution — likewise only when there is any.
            ...ticketAttributionFields(attribution),
          }

          const ticketRef = await adminDb.collection('tickets').add(ticketData)

          // Now update with QR code data using the actual ticket ID
          await ticketRef.update({ qr_code_data: ticketRef.id })

          const createdTicketDoc = await ticketRef.get()
          const createdTicket = { id: createdTicketDoc.id, ...createdTicketDoc.data() }
          createdTickets.push(createdTicket)
          console.log('Created ticket:', createdTicket.id, 'with QR:', createdTicket.id)
        }
      }
    } catch (issueErr) {
      // Nothing issued: hand the seats and the claimant's one claim back so a retry
      // can succeed. (A partial issue keeps both — the claimant holds tickets.)
      if (createdTickets.length === 0) {
        await releaseInventoryReservation({
          eventId,
          quantity: ticketQuantity,
          tierIncrements,
          logPrefix: '[claim-free]',
        })
        await releaseLock()
      }
      throw issueErr
    }
    
    console.log('Created tickets:', createdTickets.length)

    // Record WHICH tickets this claim issued. A later claim reads exactly these by
    // id and reopens only once every one is refunded / cancelled (see the takeover
    // above); one transferred away keeps the claim taken.
    if (lockHeld) {
      try {
        await lockRef.set(
          { issued_at: new Date().toISOString(), ticket_ids: createdTickets.map((t: any) => String(t.id)) },
          { merge: true }
        )
      } catch (e) {
        console.warn('[claim-free] failed to stamp claim lock', { message: (e as any)?.message })
      }
    }

    // NOTE: inventory was already reserved/incremented atomically by reserveInventoryAtomic above,
    // so we intentionally do NOT increment tickets_sold again here.

    // Record the tickets against the guest order so the retrieval link renders them.
    if (identity.isGuest && identity.guestOrderKey) {
      await attachTicketsToGuestOrder(
        identity.guestOrderKey,
        createdTickets.map((t: any) => String(t.id))
      )
    }

    // Attribute the claim to its promoter. Zero-revenue order ⇒ zero commission
    // (both commission types), but the tickets/orders counters still credit them.
    if (promoter && createdTickets.length > 0) {
      await recordPromoterSale({
        promoterId: promoter.id,
        eventId,
        ticketIds: createdTickets.map((t: any) => String(t.id)),
        quantity: ticketQuantity,
        orderGrossCents: 0,
        currency: event.currency || 'HTG',
        paymentMethod: 'free',
        paymentId: null,
        buyerUserId: identity.isGuest ? null : identity.id,
        buyerEmail: identity.email || null,
      })
    }

    // Count the claim on its tracking link. A claim has no gateway id; its first
    // ticket's id is unique to this one request, so the marker still makes the
    // count exactly-once.
    if (attribution?.tracking_link_id && createdTickets.length > 0) {
      await recordAttributedSale(attribution, {
        eventId: String(eventId),
        orderKey: `free_${createdTickets[0].id}`,
        quantity: ticketQuantity,
        revenueCents: 0,
        currency: String(event.currency || 'HTG'),
        paymentMethod: 'free',
      })
    }

    // ── DELIVER THE TICKET ──────────────────────────────────────────────────────
    // This route used to import no email module at all: an attendee of a free/RSVP
    // event got an in-app notification and nothing else — no confirmation, no QR code,
    // nothing to show at the door unless they happened to open the app again. A free
    // ticket is still a ticket, so it goes out over the same pipeline the paid paths
    // use (email with the QR; SMS for a guest, WhatsApp for an account holder).
    //
    // Best-effort: the tickets are already issued and are the buyer's regardless of
    // whether the mail provider is reachable.
    try {
      await sendTicketConfirmation({
        ticketId: String(createdTickets[0].id),
        qrPayload: (createdTickets[0] as any).qr_code_data || createdTickets[0].id,
        event,
        recipient: {
          // Resolved from the session or from the guest record created above — never
          // from an address the request body could name for someone else's order.
          email: identity.email,
          name: identity.name,
          phone: identity.phone,
          isGuest: identity.isGuest,
        },
        quantity: ticketQuantity,
        tierName: claims[0]?.tierName,
        ticketPrice: 0,
        currency: event.currency || 'HTG',
        guestToken: identity.guestToken || null,
        logPrefix: '[claim-free]',
      })
    } catch (error) {
      console.error('[claim-free] failed to deliver ticket confirmation', error)
    }

    // Send in-app notification for free ticket claim
    try {
      // A guest has no account for an in-app notification to land in.
      if (!identity.isGuest) {
        await notifyTicketPurchase(
          identity.id,
          eventId,
          event.title,
          ticketQuantity
        )
      }

      // Notify organizer
      await notifyOrganizerTicketSale(
        event.organizer_id,
        eventId,
        event.title,
        ticketQuantity,
        0, // free event
        identity.name
      )
    } catch (error) {
      console.error('Failed to send notification:', error)
      // Don't fail the claim if notification fails
    }

    console.log('=== SUCCESS ===')
    // `issued` says exactly what was created, per tier — a multi-tier claim's
    // caller must be able to see which tiers it actually got, not just a count.
    // Additive only: `success` / `tickets` / `count` / `message` keep the shape
    // and the wording shipped clients (mobile build 10) already parse.
    return NextResponse.json({
      success: true,
      tickets: createdTickets,
      count: ticketQuantity,
      issued: claims.map((c) => ({
        tierId: c.tierId || null,
        tierName: c.tierName,
        quantity: c.quantity,
      })),
      // Additive: tells the caller a promo (not a 0-price tier) paid for this claim.
      promoApplied: Boolean(promo && promoDiscountCents > 0),
      // A guest has no /tickets page to be sent to — hand back their own signed link.
      ...(identity.guestToken ? { guestTicketUrl: guestTicketUrl(identity.guestToken) } : {}),
      message: `${ticketQuantity} free ticket${ticketQuantity !== 1 ? 's' : ''} claimed successfully!`
    })
  } catch (error: any) {
    console.error('Claim free ticket error:', error)
    return fail(error.message || 'Failed to claim free ticket', 'server_error', 500)
  }
}
