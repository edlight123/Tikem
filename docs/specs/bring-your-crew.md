# Bring your crew (referral credit)

Status: draft for owner review, 2026-10-05. Not built.

## Goal

Grow buyers through people who already bought, with a reward that is honest
(no inflated prices), costs Tikèm only when it brings real sales, and is hard
to farm.

## The offer (buyer-facing)

> **Bring your crew.** Share your link. When 3 friends buy tickets through it,
> you get up to **$5 / 500 HTG in Tikèm credit** for your next ticket.

- Shown on the ticket confirmation screen, the ticket detail screen, and the
  profile "Credits" page. WhatsApp share first, then copy link.
- Progress: "1 of 3 friends", with first names of friends who bought (only if
  they allow being shown, see privacy).
- A friend counts once, ever, and only for their first paid purchase through
  your link within 30 days of clicking it.

## Who pays, and why it's safe for margins

- Credit is funded from **Tikèm's 10% fee**, never from the organizer.
  Organizers always get their full net; a credit is a Tikèm discount at checkout.
- Reward = `min(cap, 50% of the platform fee the 3 qualifying purchases
  generated)`. Cap: $5 USD / 500 HTG / C$7 / €4.50 (per user's currency).
  - Example: 3 friends buy $20 tickets → Tikèm fee $6 → reward $3 (50%).
  - Example: 3 friends buy $60 tickets → fee $18 → reward capped at $5.
  - So Tikèm always keeps at least half of the fee those referrals generated.
- "Up to" is stated in the offer, so a smaller reward is never a surprise.
- Free tickets and comps never count.

## Credit rules

- Credit is **pending** until each qualifying purchase's event has ended and its
  refund window has closed without a refund or chargeback; then **available**.
- Available credit applies automatically at checkout (toggle to skip), up to the
  ticket's platform fee + face value, never below 0. Not withdrawable, not
  transferable, no cash value.
- Expires 90 days after it becomes available.
- One crew reward per 3 friends; it repeats (6 friends → 2 rewards), capped at
  4 rewards per user per month.

## Anti-abuse (the part that matters most)

A referral qualifies only if all hold:

1. Referee is a **different person**: different account, different verified
   email/phone, and their payment method differs from the referrer's
   (Stripe card fingerprint / MonCash payer number).
2. Referee's account is new to buying: no paid purchase before the click.
3. Not the event's organizer, their staff, or the organizer's promoter account
   (prevents organizer-funded farming through alt accounts).
4. Not the same device install id as the referrer (mobile), best-effort.
5. Purchase not refunded, not charged back, not checked-in-then-refunded.

Plus: per-user and per-IP limits on link creation/claims, admin view of top
referrers, and auto-hold when one referrer's crew shares payment instruments.

## Data model (server-only collections, Admin SDK)

- `crew_codes/{code}` → `{ uid, created_at }` (short code; one per user).
- `crew_referrals/{refereeUid}` → `{ referrer_uid, code, clicked_at,
  first_order_id, status: 'clicked'|'purchased'|'qualified'|'void',
  void_reason, fee_minor, currency }`. Keyed by referee, so a person can only
  ever be referred once.
- `users/{uid}/credit_ledger/{id}` → append-only entries
  `{ type: 'earned'|'applied'|'expired'|'reversed', amount_minor, currency,
  status: 'pending'|'available', related_ids, created_at }`.
- Rules: all of the above client-read-only for the owner (own ledger), no
  client writes.

## Flow

1. Link: `tikem.co/c/{code}` (and the app deep link). Sets a 30-day attribution
   cookie / AsyncStorage key; at signup or first checkout the server binds
   `crew_referrals/{refereeUid}` if none exists.
2. Purchase fulfilment (Stripe, MonCash, SogePay paths, all through the shared
   fulfilment functions) marks the referral `purchased` with the fee earned.
3. Nightly job (reuse the release-payouts cron pattern): purchases whose event
   ended + refund window closed and still live → `qualified`; every 3 qualified
   for a referrer → one `earned` ledger entry, `available`.
4. Refund/chargeback before qualification → `void`. After credit is earned and
   then a qualifying ticket is refunded → `reversed` entry (balance may go
   negative; negative balance blocks applying credit, never charges the user).
5. Checkout: `priceOrderCents` accepts `creditMinor` resolved server-side from
   the ledger; organizer net unchanged; Tikèm fee absorbs it.

## Reuse

- Attribution and click tracking: promoter links / tracking-links code.
- Fee math: `lib/fees.ts` + `lib/checkout/buyer-pricing.ts`.
- Payment identity: Stripe card fingerprint, MonCash `payer_phone`.
- Friends-going / connections: show "Ana and 2 others came with you" on success.

## Copy (en / fr / ht keys, no em-dashes)

- "Bring your crew" / "Amène ton crew" / "Mennen ekip ou"
- "When 3 friends buy through your link, you get up to $5 in Tikèm credit."

## Metrics

Share rate per buyer, link click→purchase conversion, qualified referrals per
sharer, cost per acquired buyer (credit paid / new buyers), fraud void rate.
Target: cost per new buyer < 50% of their first-purchase fee.

## Rollout

1. Build behind `config/features.crew_referrals` (off).
2. Test on template events with test accounts (both currencies).
3. Turn on in Haiti first, watch void rate and cost for 2 weeks, then diaspora.

## Open questions for the owner

1. Cap amount: $5 / 500 HTG OK, or smaller to start ($3 / 300 HTG)?
2. Should the friend also get something (e.g. no fee on their first ticket,
   funded the same way)? Two-sided offers convert better but cost more.
3. Show referrers their friends' first names, or only a count?
