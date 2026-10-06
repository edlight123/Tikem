/**
 * Mobile client for friend invites (web lib/invites, behind config/auth.invites).
 * Every call is best-effort and returns a neutral value on failure or when the
 * switch is off (the server answers 404 feature_off).
 */
import { backendFetch } from './backend';
import type { PublicUserSummary } from '../../types/social';

export type InvitePickerState = 'available' | 'invited' | 'going' | 'unavailable';
export interface InvitePickerFriend extends PublicUserSummary {
  state: InvitePickerState;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** The caller's connections with an invite state each; null on failure. */
export async function fetchInvitePicker(eventId: string): Promise<InvitePickerFriend[] | null> {
  try {
    const res = await backendFetch(`/api/events/${encodeURIComponent(eventId)}/invite`, { method: 'GET' });
    const data = await readJson(res);
    return res.ok && Array.isArray(data?.friends) ? data.friends : null;
  } catch {
    return null;
  }
}

export type SendInvitesOutcome =
  | { ok: true; sent: string[] }
  | { ok: false; reason: 'limit' | 'error' };

export async function sendInvites(eventId: string, friendIds: string[]): Promise<SendInvitesOutcome> {
  try {
    const res = await backendFetch(`/api/events/${encodeURIComponent(eventId)}/invite`, {
      method: 'POST',
      body: JSON.stringify({ friendIds }),
    });
    const data = await readJson(res);
    if (res.status === 429) return { ok: false, reason: 'limit' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true, sent: Array.isArray(data?.sent) ? data.sent : [] };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** https://www.tikem.co/i/{code}[?e=eventId], or null (switch off, signed out, failure). */
export async function fetchInviteLink(eventId?: string | null): Promise<string | null> {
  try {
    const q = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
    const res = await backendFetch(`/api/invites/link${q}`, { method: 'GET' });
    const data = await readJson(res);
    return res.ok && typeof data?.url === 'string' ? data.url : null;
  } catch {
    return null;
  }
}

export async function setInviteMute(uid: string, muted: boolean): Promise<boolean> {
  try {
    const res = await backendFetch(`/api/users/me/invite-mutes/${encodeURIComponent(uid)}`, {
      method: muted ? 'POST' : 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Claim a saved invite code for the signed-in (new) account. Resolves `done`
 * when the server gave a definitive answer (claimed or not claimable), so the
 * caller can forget the code; false keeps it for a later try.
 */
export async function claimInviteCode(code: string, eventId?: string | null): Promise<{ done: boolean }> {
  try {
    const res = await backendFetch('/api/invites/claim', {
      method: 'POST',
      body: JSON.stringify({ code, ...(eventId ? { eventId } : {}) }),
    });
    // Only a 200 is definitive (claimed, already claimed, not a new account,
    // bad code). 404 = switch off, 429/5xx = try later: keep the code.
    return { done: res.ok };
  } catch {
    return { done: false };
  }
}

export interface InviteSummary {
  sent: number;
  joined: number;
  purchased: number;
}

export async function fetchInviteSummary(): Promise<InviteSummary | null> {
  try {
    const res = await backendFetch('/api/invites/summary', { method: 'GET' });
    const data = await readJson(res);
    if (!res.ok || data?.enabled !== true) return null;
    return { sent: Number(data.sent) || 0, joined: Number(data.joined) || 0, purchased: Number(data.purchased) || 0 };
  } catch {
    return null;
  }
}
