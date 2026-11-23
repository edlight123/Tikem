/**
 * Publishing from the event screen. Pure: unit-tested from the root
 * (__tests__/mobile-publish-fix.test.ts).
 *
 * A draft, an imported one above all, had no Publish action on the event
 * screen: the editor's Save never publishes an existing event, and the only
 * control was the "Pause ticket sales" switch (turning it off is what
 * published). Tikra tester 2026-11-23 on the same screen: "it wouldn't move
 * past draft, I had to remake it". Now the screen offers Publish, shows the
 * server's refusal as it is, and pairs it with the way out.
 */
export type PublishFix = 'payouts' | 'edit' | null;

/** /api/events/[id]/publish refusals fixed in Payout settings (lib/events/publish-gate). */
const PAYOUT_CODES = new Set([
  'verification_required',
  'stripe_connect_required',
  'stripe_onboarding_incomplete',
  'stripe_account_unavailable',
  'payout_country_mismatch',
]);

/** Refusals fixed by editing the event (prices, currency). */
const EDIT_CODES = new Set(['tier_price_below_minimum', 'currency_country_mismatch']);

export function publishFixFor(code: string | null | undefined): PublishFix {
  const c = String(code || '');
  if (PAYOUT_CODES.has(c)) return 'payouts';
  if (EDIT_CODES.has(c)) return 'edit';
  return null;
}

const toMs = (v: unknown): number => {
  if (!v) return NaN;
  const d = typeof (v as any)?.toDate === 'function' ? (v as any).toDate() : new Date(v as any);
  return d instanceof Date ? d.getTime() : NaN;
};

/**
 * Offer Publish: not live, not closed (cancelled, completed, rejected) and not
 * over. A paused event is unpublished too; publishing puts it back on sale.
 * The server still decides (moderation, payouts, prices).
 */
export function canOfferPublish(
  event: { is_published?: unknown; status?: unknown; end_datetime?: unknown; start_datetime?: unknown } | null | undefined,
  now: number = Date.now()
): boolean {
  if (!event || event.is_published === true) return false;
  const status = String(event.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'completed' || status === 'rejected') return false;
  const end = toMs(event.end_datetime);
  const start = toMs(event.start_datetime);
  const over = Number.isFinite(end) ? end : start;
  return !(Number.isFinite(over) && over < now);
}
