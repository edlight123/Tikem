/**
 * Escape text before it lands inside HTML: an email body, or a document a
 * component writes into a popup.
 *
 * Anything a user or organizer typed (an event title, a venue, a refund
 * reason, a transfer message) is untrusted. Unescaped, `<script>` or
 * `<a href>` in it renders as live markup in the recipient's mail client or
 * in a same-origin window. Safe for both element text and quoted attribute
 * values.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
