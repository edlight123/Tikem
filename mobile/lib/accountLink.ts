/**
 * The app's side of account completion, email on a phone account and account
 * merges (server: lib/auth/account/handlers.ts). Every call is authenticated
 * with the Firebase ID token; nothing here writes Firestore directly.
 */

import { backendJson } from './api/backend';

export class AccountLinkError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly retryAfterSec?: number) {
    super(code);
    this.name = 'AccountLinkError';
  }
}

async function post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await backendJson<T>(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (err: any) {
    const status = err?.status;
    const code = typeof err?.code === 'string' ? err.code : status === 404 ? 'unavailable' : status ? 'generic' : 'network';
    throw new AccountLinkError(code, status, typeof err?.payload?.retryAfterSec === 'number' ? err.payload.retryAfterSec : undefined);
  }
}

export function completeProfile(firstName: string, lastName: string): Promise<{ ok: true; fullName: string }> {
  return post('/api/account/profile/complete', { firstName, lastName });
}

export function startEmailCode(email: string, locale: string): Promise<{ ok: true; taken: boolean; resendAfterSec: number }> {
  return post('/api/account/email/start', { email, locale });
}

export type EmailVerifyResult =
  | { status: 'attached'; email: string }
  | { status: 'merge_available'; mergeId: string }
  | { status: 'needs_review' }
  | { status: 'blocked'; code?: string };

export function verifyEmailCode(email: string, code: string): Promise<EmailVerifyResult> {
  return post('/api/account/email/verify', { email, code });
}

export function saveEmailForLater(email: string): Promise<{ ok: true }> {
  return post('/api/account/email/later', { email });
}

/** Combine the accounts. `token` comes back when the caller's own account was the one retired. */
export function commitMerge(mergeId: string): Promise<{ status: 'merged'; targetUid: string; token?: string }> {
  return post('/api/account/merge', { mergeId });
}

const KNOWN = new Set([
  'invalid_name',
  'invalid_email',
  'email_already_set',
  'email_taken',
  'cooldown',
  'rate_limited',
  'send_failed',
  'invalid_code',
  'too_many_attempts',
  'account_disabled',
  'merge_expired',
  'merge_in_progress',
  'target_has_other_phone',
  'network',
]);

/** Locale key for an account-link error code. */
export function accountErrorKey(code?: string | null): string {
  return code && KNOWN.has(code) ? `account.errors.${code}` : 'account.errors.generic';
}
