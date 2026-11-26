/**
 * Who can find an event (the organizer's "Visibility" setting). Mirrors the
 * web's lib/events/visibility.ts (__tests__/event-visibility.test.ts).
 *
 *   public   (default): listed everywhere (Home and its rails, Discover,
 *                       Search, categories, occasions, the organizer's page).
 *   unlisted:           reachable only by its direct link; ticket holders
 *                       still see it in their tickets.
 *
 * Stored as `show_on_explore`: `false` = unlisted, anything else = public.
 */
export type EventVisibility = 'public' | 'unlisted';

type VisibilityFields = { show_on_explore?: unknown } | null | undefined;

export function eventVisibility(e: VisibilityFields): EventVisibility {
  return e?.show_on_explore === false ? 'unlisted' : 'public';
}

export function isUnlisted(e: VisibilityFields): boolean {
  return eventVisibility(e) === 'unlisted';
}

/** Whether a public listing may show it. */
export function isPubliclyListed(e: VisibilityFields): boolean {
  return !isUnlisted(e);
}
