/**
 * How an unread count reads on a badge: nothing at zero (or a bad value), the
 * number up to 9, then "9+". Shared by the Home header chat icon, the Profile
 * Messages row and anything else that opens Messages, so they never disagree.
 * The count itself comes from lib/attendeeUnread (GET /api/messages).
 */
export function unreadBadgeLabel(count: number | null | undefined): string | null {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9 ? '9+' : String(n);
}

/** Screen-reader label: "Messages" or "Messages, 3". */
export function unreadA11yLabel(title: string, count: number | null | undefined): string {
  const n = Math.floor(Number(count));
  return Number.isFinite(n) && n > 0 ? `${title}, ${n}` : title;
}
