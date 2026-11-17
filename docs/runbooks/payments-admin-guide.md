# Payments: admin guide

How money moves on Tikèm and what an admin does when something needs a human.
Last reviewed 2026-11-17 (payment audit). Code paths are given so you can check
any rule here against what actually runs.

## Who can do what

| Action | Who |
| --- | --- |
| Approve or dismiss a flagged Stripe payout (Money → Payout review) | admin |
| Mark a withdrawal paid / failed, reject a withdrawal | admin |
| Send a withdrawal through the prefunded MonCash pool | **super admin** |
| Turn prefunding on or off (`config/payouts.prefunding`) | **super admin** |
| Change the MonCash funding plan | **super admin** |

Nobody can approve a payout to, or send a prefunded transfer to, their own account.

## Buyer payments

### Card (Stripe)
- Tikèm is the merchant of record. Tickets are issued by the Stripe webhook
  (`lib/tickets/stripe-fulfillment.ts`), once per payment, with ids derived from it.
- **Paid after the event was cancelled, or long after it ended** (more than 6 h,
  to allow for late webhooks): the buyer is refunded automatically and no ticket
  is issued. The order shows `refund_reason: event_cancelled | event_ended`.
- **Sold out between checkout and payment:** refunded automatically
  (`refunded_capacity`). A refund that fails is flagged `needs_refund` and shows
  in Money → Refunds; retries keep refunding, never issue.

### MonCash / NatCash / SogePay
- Seats are held for **12 minutes** while the buyer is on the wallet's page.
- Ticket ids are derived from the order (`mm_…`), so a retry after a crash fills
  in the missing tickets instead of issuing a second set. Earnings and promo
  redemption are booked once per order.
- **Hourly reconcile** (`/api/cron/moncash-reconcile`) asks Digicel about every
  order from the last 7 days that is pending, failed in the last 48 h, or stuck
  processing, and finishes the ones that were paid. A buyer who paid late gets
  their ticket without anyone acting.
- A buyer who is shown "payment didn't go through" is told to check My Tickets
  before paying again, because the reconcile may still find the payment.
- Re-opening checkout sends the buyer back to the payment Digicel already opened
  for that order (no second payment).
- Orders that sit `pending` past 7 days are no longer checked. On 2026-11-17, 111
  such orders (Dec 2025 – Sep 2026, none with a ticket or a seat hold) were closed
  as `failed` / `failure_reason: abandoned` / `failure_source: stale_cleanup`.

**When to act:** an order with `needs_review: true` (an old-pipeline order that
died half-way) or `needs_refund: true` (paid but sold out, amount mismatch,
cancelled). Check the payment in the MonCash portal, then pay the refund by hand
and mark it paid in Money → Refunds.

## Refunds
- Card refunds go through Stripe automatically. MonCash refunds are **manual**:
  they land in Money → Refunds; pay them from the MonCash account, then mark paid.
- Every refunded ticket **gives its seat back** (once), except on a cancelled event.
- A refund after the organizer was already paid becomes **organizer debt**,
  taken from their next withdrawal in the same currency.

## Chargebacks (Stripe disputes)
- A new dispute **freezes the event's payouts**, flags the organizer high-risk,
  and emails admins and the organizer.
- The disputed tickets become `disputed`: refused at the door and removed from the
  organizer's balance. Lost → they stay that way (the loss is the organizer's,
  through the debt above). Won → the tickets work again.
- Lifting the freeze is an admin decision (Money → Disputes).

## Stripe payouts (release job)
- `/api/cron/release-payouts` runs hourly. It pays each event what it earned,
  **minus refunds and chargebacks**, never more than the Stripe balance.
- Events that need a human land in **Payout review**. Approving lets the job pay
  **one payout of up to the amount shown, within 14 days**. The payout uses the
  approval up; a bigger amount, a later payout or an expired approval comes back
  to the queue. An approval cannot be given by the organizer themselves.
- Today 0 organizers have a connected Stripe account, so this job pays nothing yet.

## MonCash withdrawals and prefunding
- Organizers and promoters withdraw to their **verified saved MonCash number**;
  a transfer to any other number is refused and must be paid by hand after
  confirming with the payee.
- **Manual** withdrawals: approve, pay from the MonCash account, mark completed.
- **Instant** (prefunded) withdrawals pay from Tikèm's own MonCash pool. The payee
  pays 3%; Digicel charges Tikèm about 3% of the transfer.
- **One daily cap** (`config/payouts.adminTransferCaps.dailyHtgCents`, default
  1,000,000 HTG) covers everything that leaves the pool that day: instant payouts
  and admin prefunded transfers together, each counted **with Digicel's 3% fee**.
  A per-transfer cap (default 250,000 HTG, fee included) applies too.
- A transfer MonCash **definitively rejects** moved nothing: the withdrawal goes
  back to the queue (or the payee's balance is restored) and its share of the
  day's cap is given back. A transfer that is only **unconfirmed** keeps its cap
  share and is settled by the reconcile job.
- **Marking an instant withdrawal failed:** Tikèm asks MonCash first. If MonCash
  says it was paid, it is marked completed instead. If someone just sent it, the
  fail is refused ("was just sent") — check MonCash, then retry with
  "confirmed not paid".

## Where to look
| Question | Place |
| --- | --- |
| Is a buyer's order paid? | `pending_transactions` (by `order_id`), MonCash portal |
| Why no ticket? | order `failure_reason`, `needs_refund`, `needs_review` |
| Refunds to pay by hand | Money → Refunds |
| Payouts waiting on a decision | Money → Payout review |
| Prefunded pool and plan | Money → MonCash funding |
| Disputes | Money → Disputes |
