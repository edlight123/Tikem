# Organization teams (2026-10-25)

Owner request: a person added to an organizer's team must really be able to run that org
(the Team page used to promise "Admin: full access" while granting nothing).

## Roles (single source: `lib/organizer/teamRoles.ts`, mirrored in `mobile/lib/orgTeamRoles.ts`)

| action            | owner | admin | manager | staff |
|-------------------|:-----:|:-----:|:-------:|:-----:|
| `view` dashboard, events, orders, guests, analytics, messages | ✓ | ✓ | ✓ | |
| `manage_events` create/edit/publish/cancel, tiers, comps, promo codes, event staff, refunds, check-in, messages | ✓ | ✓ | ✓ | |
| `manage_team` invite / re-role / remove (never the owner) | ✓ | ✓ | | |
| `manage_settings` org profile, branding, notifications, defaults | ✓ | ✓ | | |
| `owner_only` payouts, withdrawals, payout profiles/destinations/bank/MonCash, Stripe Connect, identity verification, danger zone (deactivate/delete/export) | ✓ | | | |

Staff = nothing org-wide; door access stays per event (event → Staff tab).
Platform admins (role admin/super_admin) keep their existing override on events.

## Data

- `organizers/{orgId}/team/{uid}` `{uid, email, name, role, status:'active'}`. orgId = owner's uid = events' `organizer_id`.
- `users/{uid}/org_memberships/{orgId}` mirror `{org_id, role, org_name}`.
- `org_team_invites/{id}` `{org_id, email, role, token_hash, expires_at, accepted_at, revoked_at}`; accepted via `/team/accept?invite=&token=` (web page) → `POST /api/organizer/team/accept`, or automatically for verified emails (`claimInvitesByVerifiedEmail`, run by `GET /api/organizer/orgs`).
- All server-written. Rules: `isOrgTeam(orgId, roles)` / `managesOrg(orgId)` in firestore.rules; `isEventOrganizer` already honours admin/manager.

## Acting org

`lib/organizer/context.ts`:
- `getOrgContext()` → `{ user, orgId, role, isOwner, isPlatformAdmin }`. Org chosen by header `X-Tikem-Org` (mobile) or cookie `tikem_org` (web), validated against membership; else own org (organizers); else first membership; else null.
- `requireOrg(action)` → `{ok, value: ctx}` | `{ok:false, response}` for API routes.
- `requireEventAccess(eventId, action)` → `{ok, value:{user, event, eventId, orgId, role}}` | response. Use for any per-event route.
- `canOnEvent(user, event, action)` for code that already has the event loaded.
- Endpoints: `GET/POST /api/organizer/orgs` (list + switch), `/api/organizer/team` (GET roster incl. invites with id `invite:<id>`, POST invite, PATCH role, DELETE ?memberId=).

## Conversion rule

Anywhere organizer-scoped code uses the signed-in user's id as "the organizer" (`user.id`, `uid`, `organizer_id == user.id`, `organizer_id !== user.id`), use the acting org (`ctx.orgId`) or the event's org via `requireEventAccess`/`canOnEvent`, gated by the action from the table. Personal things (the member's own profile, own tickets, notifications addressed to them) keep `user.id`. Records that note who did something (`created_by`, `updated_by`, audit logs) keep the actor's `user.id`. New events created by a member get `organizer_id = ctx.orgId` (and `created_by = user.id`).
