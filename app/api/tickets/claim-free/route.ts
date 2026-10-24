import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { hasEventAccess } from '@/lib/events/access-guard'
import { promoCanCoverOrder, promoBuyerKey, resolvePromoCode, type PromoDoc } from '@/lib/promo-codes'
import { resolvePromoterCode } from '@/lib/promoters'
import { resolveOrderAttribution } from '@/lib/tracking-links'
import {
  beginGuestCheckout,
  identityFromUser,
  type CheckoutIdentity,
} from '@/lib/guest/checkout'
import { guestTicketUrl, normalizePhone } from '@/lib/guest/identity'
import {
  checkEventPurchasable,
  invalidQuantityRefusal,
  normalizeTierLines,
  parseTicketQuantity,
} from '@/lib/tickets/purchasable'
// The free-ticket limits are shared with the card route, which can carry free
// lines in a multi-tier cart (lib/tickets/free-claim-policy).
import { MAX_FREE_TICKETS_PER_CLAIM } from '@/lib/tickets/free-claim-policy'
import { issueFreeClaim } from '@/lib/tickets/free-claim-issue'
import {
  eventAllowedPlusOnes,
  eventRequiresApproval,
  parseAttendInput,
  type PlusOne,
} from '@/lib/events/approval'

/**
 * Error responses carry BOTH a human-readable English `error` (unchanged wording,
 * so shipped clients and logs keep working) and a stable machine `code`. Clients
 * localize off `code` — mobile build 10 ignores it, newer clients use it instead
 * of showing raw English server copy to a buyer.
 */
function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
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
    const { eventId, quantity = 1, tierId, selections, promoCode, refCode, guest, accessCode, attribution: rawAttribution, plusOnes: rawPlusOnes } =
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
        `You can claim at most ${MAX_FREE_TICKETS_PER_CLAIM} free tickets per event.`,
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

    // Approval-list events issue tickets ONLY when the organizer approves a
    // request (docs/specs/approval-lists-and-plus-ones.md). A direct claim would
    // walk straight past the list.
    if (eventRequiresApproval(event)) {
      return fail('This event requires the host to approve each guest. Send a request instead.', 'approval_required', 403)
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

    // Plus-ones named on a free claim (lib/events/approval). Optional: a plain
    // quantity claim is unchanged. When sent, they ARE the extra tickets, so the
    // quantity is 1 + plus-ones and must fit the event's allowance.
    let plusOnes: PlusOne[] = []
    if (rawPlusOnes !== undefined && rawPlusOnes !== null) {
      const parsed = parseAttendInput({ plusOnes: rawPlusOnes }, eventAllowedPlusOnes(event), (p) => normalizePhone(p))
      if (!parsed.ok) return fail(parsed.error, parsed.code, 400)
      plusOnes = parsed.plusOnes
      if (plusOnes.length > 0 && (useSelections || ticketQuantity !== 1 + plusOnes.length)) {
        return fail('The ticket count must be you plus your plus-ones.', 'plus_ones_quantity_mismatch', 400)
      }
    }

    // The tier resolution, price gate, one-claim lock, inventory reservation,
    // ticket creation, delivery and notifications are shared with approval lists
    // (lib/tickets/free-claim-issue), so the two can never drift apart.
    const outcome = await issueFreeClaim(
      {
        eventId: String(eventId),
        event,
        identity,
        ticketQuantity,
        selections: requestedSelections,
        tierId: tierId || null,
        promo,
        promoter,
        attribution,
      },
      { plusOnes }
    )
    if (!outcome.ok) return fail(outcome.error, outcome.code, outcome.status)
    if (outcome.kind === 'existing') {
      return NextResponse.json({
        success: true,
        tickets: outcome.tickets,
        count: outcome.tickets.length,
        message: 'You already claimed a ticket for this event.',
      })
    }
    const { tickets: createdTickets, claims, promoApplied } = outcome
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
      promoApplied,
      // A guest has no /tickets page to be sent to — hand back their own signed link.
      ...(identity.guestToken ? { guestTicketUrl: guestTicketUrl(identity.guestToken) } : {}),
      message: `${ticketQuantity} free ticket${ticketQuantity !== 1 ? 's' : ''} claimed successfully!`
    })
  } catch (error: any) {
    console.error('Claim free ticket error:', error)
    return fail(error.message || 'Failed to claim free ticket', 'server_error', 500)
  }
}
