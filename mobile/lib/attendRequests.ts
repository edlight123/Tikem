/**
 * Request-to-attend approval lists and plus-ones, app side.
 * Spec: docs/specs/approval-lists-and-plus-ones.md.
 *
 * The pure helpers MIRROR lib/events/approval.ts (same names, same behaviour;
 * a parity test keeps them equal). The API calls go to:
 *   GET/POST/DELETE /api/events/:id/attend-request      the guest's own request
 *   GET/POST        /api/organizer/events/:id/requests  the organizer's list
 */

import { backendJson } from './api/backend';
import { MAX_FREE_TICKETS_PER_PERSON } from './ticketPricing';

/** The most plus-ones an organizer can offer, before the free-ticket cap. */
export const PLUS_ONES_SETTING_MAX = 3;

/** A note to the host, in characters. */
export const ATTEND_NOTE_MAX = 280;

/** A plus-one's first name, in characters. */
export const PLUS_ONE_NAME_MAX = 60;

export type AttendRequestStatus = 'pending' | 'approving' | 'approved' | 'declined' | 'cancelled';

export interface PlusOne {
  first_name: string;
  phone: string | null;
}

/** The organizer's own setting, sanitised to an integer 0..PLUS_ONES_SETTING_MAX. */
export function plusOnesSetting(event: { plus_ones_max?: unknown } | null | undefined): number {
  const n = Math.floor(Number(event?.plus_ones_max ?? 0));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, PLUS_ONES_SETTING_MAX);
}

/**
 * How many plus-ones a guest may actually name. Plus-one tickets are issued to
 * the requester through the free-claim path, so requester + plus-ones must fit
 * the per-person free cap: with the cap at 2, an organizer's "3" means 1.
 */
export function allowedPlusOnes(setting: unknown, cap: number = MAX_FREE_TICKETS_PER_PERSON): number {
  const s = plusOnesSetting({ plus_ones_max: setting });
  const room = Math.max(0, Math.floor(Number(cap) || 0) - 1);
  return Math.max(0, Math.min(s, room, PLUS_ONES_SETTING_MAX));
}

/** The plus-ones a guest may name on this event. */
export function eventAllowedPlusOnes(event: { plus_ones_max?: unknown } | null | undefined): number {
  return allowedPlusOnes(event?.plus_ones_max);
}

/** Does the event ask guests to request a spot? */
export function eventRequiresApproval(event: { requires_approval?: unknown } | null | undefined): boolean {
  return event?.requires_approval === true;
}

// ── API: the guest's own request ─────────────────────────────────────────────

export interface OwnAttendRequest {
  id: string;
  status: AttendRequestStatus;
  plus_ones: PlusOne[];
  note: string;
  quantity: number;
  created_at: string | null;
  decided_at: string | null;
}

export interface OwnRequestState {
  requiresApproval: boolean;
  allowedPlusOnes: number;
  request: OwnAttendRequest | null;
}

const ownPath = (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/attend-request`;

export function getOwnAttendRequest(eventId: string): Promise<OwnRequestState> {
  return backendJson<OwnRequestState>(ownPath(eventId));
}

export interface PlusOneInput {
  firstName: string;
  phone?: string;
}

export function sendAttendRequest(
  eventId: string,
  body: { plusOnes: PlusOneInput[]; note: string }
): Promise<{ ok: true; created: boolean; request: OwnAttendRequest }> {
  return backendJson(ownPath(eventId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function cancelAttendRequest(eventId: string): Promise<{ ok: true }> {
  return backendJson(ownPath(eventId), { method: 'DELETE' });
}

// ── API: the organizer's list ────────────────────────────────────────────────

export interface OrganizerAttendRequest {
  id: string;
  status: AttendRequestStatus;
  requester_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  plus_ones: PlusOne[];
  note: string;
  quantity: number;
  created_at: string | null;
  decided_at: string | null;
  last_error: string | null;
}

export interface OrganizerRequestsResponse {
  requests: OrganizerAttendRequest[];
  counts: { pending: number; approved: number; declined: number };
  requiresApproval: boolean;
  allowedPlusOnes: number;
}

const orgPath = (eventId: string) => `/api/organizer/events/${encodeURIComponent(eventId)}/requests`;

export function getEventRequests(eventId: string): Promise<OrganizerRequestsResponse> {
  return backendJson<OrganizerRequestsResponse>(orgPath(eventId));
}

export function decideEventRequest(
  eventId: string,
  requestId: string,
  action: 'approve' | 'decline'
): Promise<{ ok: true }> {
  return backendJson(orgPath(eventId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, requestId }),
  });
}

export interface ApproveAllResult {
  ok: true;
  approved: number;
  failed: number;
  stoppedBecause: string | null;
  results: Array<{ id: string; ok: boolean; code?: string }>;
}

export function approveAllEventRequests(eventId: string): Promise<ApproveAllResult> {
  return backendJson<ApproveAllResult>(orgPath(eventId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve_all' }),
  });
}

/**
 * The locale key (under `attendRequests.errors`) for a server refusal code.
 * Unknown codes fall back to `generic`.
 */
export function attendErrorKey(code: string | undefined | null): string {
  switch (code) {
    case 'auth_required':
    case 'approval_not_enabled':
    case 'approval_paid_event':
    case 'access_code_required':
    case 'too_many_plus_ones':
    case 'plus_one_name_required':
    case 'note_too_long':
    case 'already_claimed':
    case 'request_declined':
    case 'request_not_pending':
    case 'request_not_found':
    case 'no_tickets_available':
    case 'limited_availability':
    case 'busy_try_again':
    case 'event_ended':
    case 'event_cancelled':
      return code;
    default:
      return 'generic';
  }
}
