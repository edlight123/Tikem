import { backendFetch } from './backend';

/** Mirrors `Obligation` in lib/account/deletion.ts (web). */
export type AccountObligation =
  | { type: 'upcoming_events_with_sales'; events: Array<{ id: string; title: string; ticketsSold: number }> }
  | { type: 'unwithdrawn_balance'; balances: Array<{ currency: string; amountMinor: number }> }
  | { type: 'withdrawals_in_flight'; count: number }
  | { type: 'promoter_wallet_balance'; balances: Array<{ currency: string; amountMinor: number }> };

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; code: 'reauth_required' | 'unauthorized' | 'deletion_failed' | 'network' }
  | { ok: false; code: 'organizer_has_active_obligations'; obligations: AccountObligation[] };

/** POST /api/account/delete. Never throws — every outcome is a result. */
export async function requestAccountDeletion(): Promise<AccountDeletionResult> {
  let res: Response;
  try {
    res = await backendFetch('/api/account/delete', { method: 'POST', body: '{}' });
  } catch {
    return { ok: false, code: 'network' };
  }
  const data: any = await res.json().catch(() => ({}));
  if (res.ok && data?.deleted) return { ok: true };
  if (data?.code === 'organizer_has_active_obligations') {
    return { ok: false, code: data.code, obligations: Array.isArray(data.obligations) ? data.obligations : [] };
  }
  if (data?.code === 'reauth_required' || data?.code === 'unauthorized') return { ok: false, code: data.code };
  return { ok: false, code: 'deletion_failed' };
}
