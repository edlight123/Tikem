/**
 * Turn a checkout failure into copy a buyer can read.
 *
 * `backendJson` throws an Error whose message is the server string PLUS the
 * request URL (`… [https://www.tikem.co/api/create-payment-intent]`), and older
 * servers passed Stripe's developer text straight through. A tester saw
 * "No such destination: 'acct_1Sfyt…' [https://www.tikem.co/api/…]" in the
 * payment sheet. Nothing from an Error's `message` is rendered as-is any more:
 * known codes map to localized copy, the server's own `error` field is shown
 * only when it carries nothing internal, and everything else gets the caller's
 * localized fallback.
 */

/** The server's typed code for "this organizer's Stripe account can't take the charge". */
export const ORGANIZER_PAYMENTS_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'organizer_payments_unavailable',
  // Code shipped by the server between 2026-09-06 and this change.
  'organizer_payouts_unavailable',
]);

export type CheckoutErrorKind = 'organizer_unavailable' | 'card_declined' | 'network' | 'other';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Things that must never reach a buyer: Stripe object ids, secret/publishable
 * keys, URLs, bracketed request paths, stack-ish text, and Stripe's own name
 * in a developer sentence ("No such destination", "Invalid API key").
 */
const INTERNAL_PATTERNS: RegExp[] = [
  /\b(acct|pi|pm|seti|cus|ch|py|tr|src|evt|sk|pk|rk|whsec)_[A-Za-z0-9]{4,}/,
  /https?:\/\//i,
  /\[[^\]]*\/[^\]]*\]/, // "[.../api/...]"
  /\/api\//i,
  /no such (destination|account|payment_intent|customer)/i,
  /api key/i,
  /STRIPE_|EXPO_PUBLIC_|firebase|firestore/i,
  /\b(TypeError|ReferenceError|undefined is not|null is not|Unexpected token)\b/,
  /Request failed \(\d{3}\)/,
];

export function looksInternal(text: string): boolean {
  return INTERNAL_PATTERNS.some((re) => re.test(text));
}

export function classifyCheckoutError(err: any): CheckoutErrorKind {
  const code = String(err?.code || err?.payload?.code || '');
  if (ORGANIZER_PAYMENTS_UNAVAILABLE_CODES.has(code)) return 'organizer_unavailable';
  if (code === 'card_declined') return 'card_declined';
  const message = String(err?.message || '').toLowerCase();
  if (message.includes('network request failed') || message.includes('failed to fetch')) return 'network';
  // A server that predates the typed code still says so in words.
  if (/no such destination|isn't set up to receive card payments|can't accept card payments/i.test(String(err?.message || ''))) {
    return 'organizer_unavailable';
  }
  return 'other';
}

/**
 * The single message to show for a failed checkout step.
 *
 * `fallbackKey` is the localized generic for this payment method
 * (e.g. 'paymentModal.errors.paymentFailed').
 */
export function friendlyCheckoutError(
  err: any,
  t: Translate,
  fallbackKey: string,
  opts: { alternativeMethodName?: string | null } = {}
): string {
  switch (classifyCheckoutError(err)) {
    case 'organizer_unavailable':
      return opts.alternativeMethodName
        ? t('paymentModal.errors.organizerCardUnavailableTryOther', { method: opts.alternativeMethodName })
        : t('paymentModal.errors.organizerCardUnavailable');
    case 'card_declined':
      return t('paymentModal.errors.cardDeclined');
    case 'network':
      return t('paymentModal.errors.network');
    default:
      break;
  }

  // The server's own copy for expected refusals ("Only 2 tickets remaining for
  // this tier.") is worth showing — but only the `error` field, never the
  // Error's message (which carries the URL), and only when it is clean.
  const serverMessage = typeof err?.payload?.error === 'string' ? err.payload.error.trim() : '';
  const status = Number(err?.status || 0);
  if (serverMessage && status >= 400 && status < 500 && serverMessage.length <= 200 && !looksInternal(serverMessage)) {
    return serverMessage;
  }

  // Stripe SDK errors (PaymentSheet) carry `localizedMessage`, which Stripe
  // writes for customers in the device language.
  const sdkMessage = typeof err?.localizedMessage === 'string' ? err.localizedMessage.trim() : '';
  if (sdkMessage && !looksInternal(sdkMessage)) return sdkMessage;

  return t(fallbackKey);
}
