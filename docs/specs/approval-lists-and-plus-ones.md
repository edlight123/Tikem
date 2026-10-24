# Approval lists and plus-ones

Status: v1 approved by the owner, built 2026-10-24. Design from Stitch project
`7258845792079223737` (Tikèm Mobile, Organizer & Staff).

## Goal

Let an organizer run an exclusive or private FREE event where guests ask for a
spot and the organizer chooses who gets in, and let guests bring named
plus-ones.

## Scope (v1)

- **Free / RSVP events only.** "Require approval" is disabled in both
  composers when any tier costs money, and every server path refuses it.
- Plus-ones work on any free event that has the setting on, with or without
  approval. With approval they ride on the request; without it, the same sheet
  (no note) sends them to `/api/tickets/claim-free` as `plusOnes`, which names
  the extra tickets. A plain quantity claim keeps working unchanged.
- Signed-in guests only. A guest checkout (no account) cannot request; the
  sheet asks them to sign in, because the requester must be notifiable and the
  issued tickets must land in an account.
- TODO (out of scope): **paid approval** (approve, then the guest pays within
  a window). It needs a payment link per approved request, a hold on the seat
  between approval and payment, and a refund story for MonCash. Not started.

## Organizer settings (per event)

Stored on `events/{id}`:

| field | type | meaning |
| --- | --- | --- |
| `requires_approval` | boolean, default false | guests request; the organizer approves or declines |
| `plus_ones_max` | integer 0 to 3, default 0 | how many named plus-ones a guest may bring |

Both composers write them. Web: `app/organizer/events/EventComposer.tsx`.
App: `mobile/screens/organizer/CreateEventFlowRefactored.tsx` (create and edit).

## The cap interaction

A plus-one ticket is issued to the requester, through the free-claim path, so
it counts against `MAX_FREE_TICKETS_PER_PERSON` (2 since 2026-10-24) and the
one-claim-per-person-per-event lock. So:

```
allowed plus-ones = clamp(min(plus_ones_max, MAX_FREE_TICKETS_PER_PERSON - 1), 0, 3)
```

With the cap at 2, an organizer who picks 3 still gets 1. The composers show
the effective number ("Guests can bring 1 while the free limit is 2 per
person"), and the server clamps the same way. If the cap is raised, plus-ones
open up with no other change. Helper: `allowedPlusOnes()` in
`lib/events/approval.ts`, mirrored in `mobile/lib/attendRequests.ts` (a parity
test keeps them equal).

## Data model

`attend_requests/{eventId}__{uid}`, one per person per event (deterministic id,
so a double tap cannot make two). Server-only: the default-deny rule covers it
and no client reads it directly. All reads go through the API.

| field | notes |
| --- | --- |
| `event_id`, `organizer_id` | organizer_id copied from the event at request time |
| `requester_id` | the uid |
| `requester_name`, `requester_email`, `requester_avatar_url` | email from Firebase Auth (never the profile copy) |
| `plus_ones` | `[{ first_name, phone }]`, phone optional (null) |
| `note` | 0 to 280 chars |
| `quantity` | 1 + plus_ones.length |
| `status` | `pending` / `approving` (transient, held while issuing) / `approved` / `declined` / `cancelled` |
| `ticket_ids` | set on approval |
| `created_at`, `updated_at`, `decided_at` | ISO strings (see the timestamp-drift note: this collection only ever writes these three) |
| `decided_by` | organizer uid |
| `last_error` | the issuance refusal code, when an approval failed and the request went back to pending |

Issued tickets carry `approval_request_id`, and plus-one tickets carry
`plus_one_name` (and `plus_one_phone` when given). The requester can transfer
them with the existing transfer feature. No guest accounts are created.

## Server routes

All writes use the Admin SDK in API routes.

| route | who | does |
| --- | --- | --- |
| `GET /api/events/[id]/attend-request` | signed-in guest | their own request (or null), plus the event's effective plus-one allowance |
| `POST /api/events/[id]/attend-request` | signed-in guest | create (or re-open a cancelled) request: `{ plusOnes: [{ firstName, phone? }], note? }` |
| `DELETE /api/events/[id]/attend-request` | signed-in guest | cancel their own PENDING request |
| `GET /api/organizer/events/[id]/requests` | event owner or admin | every request, pending first, with counts |
| `POST /api/organizer/events/[id]/requests` | event owner or admin | `{ action: 'approve' \| 'decline', requestId }` or `{ action: 'approve_all' }` |

Refusals carry a stable `code`: `approval_not_enabled`, `approval_paid_event`,
`access_code_required`, `too_many_plus_ones`, `plus_one_name_required`,
`note_too_long`, `already_claimed`, `request_declined`, `request_not_pending`,
`not_event_owner`, plus every code the free-claim issuance can return
(`no_tickets_available`, `busy_try_again`, ...).

### Issuing

Approving calls `issueFreeClaim()` in `lib/tickets/free-claim-issue.ts`, the
core that `/api/tickets/claim-free` now also calls. The route was split, not
copied: tier resolution, the price gate, the one-claim lock, the atomic
inventory reservation (shards, never `tickets_sold`), ticket creation, delivery
and the organizer notification all run the same code. The access-code gate
(`hasEventAccess`) is checked for the REQUESTER at request time and again at
approval.

Approval is two-phase: a transaction moves `pending` to `approving` (so two
approve taps cannot both issue), issuance runs, then the request becomes
`approved` with its `ticket_ids`. If issuance refuses (sold out, already
claimed), the request goes back to `pending` with `last_error` and the
organizer sees why. "Approve all" approves pending requests one by one, oldest
first, and reports each outcome; it stops issuing when the event sells out.

### Direct claims are closed on approval events

`/api/tickets/claim-free` refuses `requires_approval` events with
`approval_required` (403). The card, MonCash and SogePay initiators refuse free
lines on such an event the same way, so a mixed cart cannot route around the
list.

## Notifications

All through `lib/notifications/helpers.ts` (`createNotification` + push via
`sendPushNotification`, never the same-named trigger module's wrappers):

- organizer: "New request" when a guest asks (transactional);
- guest: "You're in" on approval, "Request not approved" on decline.

Email: on approval the guest gets the ticket confirmation from the existing
email kit, re-headed "Approved" with a line saying the host approved them, and
carrying the QR. No email on decline (in-app and push only).

## Screens (Stitch ids, project 7258845792079223737)

- `668ea553341444c7b0fefa1f19173533` organizer Requests (app)
- `4d0474f2462042c2a23f5eb1dde0fae0` organizer Requests (web)
- `83599c799500480c9d85c6380f67e656` attendee "Request to join" sheet
- `3d94ae23570d41ccb95b15d7888e9f86` attendee request states on the event page

Built within the house rules: 4px corners, fills not hairlines, status as dot +
uppercase label (amber pending, emerald approved, grey declined), serif section
rails, white primary CTA. Stitch inventions dropped: the bottom tab bar on the
sheet, a "LIVE EVENT" eyebrow, mono on phone numbers, a "Closed" disabled
button on the declined state.

## Firestore rules and indexes

- `attend_requests` needs no rule (default deny; server-only).
- `events` create/update gain one guard: `requires_approval` cannot be true
  while `has_paid_tiers` is true. Needs `firebase deploy --only firestore:rules`;
  the server already refuses the combination, so this is defence in depth.
- No composite indexes: the organizer list is a single equality query on
  `event_id`, sorted in memory.
