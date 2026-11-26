/**
 * Who can find an event (the organizer's "Visibility" setting).
 *
 *   public   (default): listed everywhere: Home and its rails (Tikèm picks,
 *                       new on Tikèm), Discover, Search, categories,
 *                       occasions, the organizer's public page, sitemaps,
 *                       the weekly digest and the follower push.
 *   unlisted:           reachable only by its direct link. Hidden from every
 *                       listing above and marked noindex; ticket holders still
 *                       see it in their tickets.
 *
 * Stored as the existing `show_on_explore` field: `false` = unlisted, anything
 * else (true, missing) = public, so every event saved before this setting
 * keeps its behaviour. A password-protected event is a separate control: it
 * gates the page itself, while this only decides whether it is listed.
 * Unlisted is not private: the event doc stays publicly readable, like any
 * published event, so anyone holding the link can open it.
 * mobile/lib/eventVisibility.ts mirrors this file
 * (__tests__/event-visibility.test.ts keeps the two in step).
 */
export type EventVisibility = 'public' | 'unlisted'

type VisibilityFields = { show_on_explore?: unknown } | null | undefined

export function eventVisibility(e: VisibilityFields): EventVisibility {
  return e?.show_on_explore === false ? 'unlisted' : 'public'
}

export function isUnlisted(e: VisibilityFields): boolean {
  return eventVisibility(e) === 'unlisted'
}

/** Whether a public listing (feeds, search, rails, profile, sitemap, digest) may show it. */
export function isPubliclyListed(e: VisibilityFields): boolean {
  return !isUnlisted(e)
}

/**
 * Whether a public listing may show it, moderation included: listed, not
 * rejected by an admin and not held for review after reports. The publish
 * state is the caller's query (is_published == true).
 */
export function isListable(e: (VisibilityFields & { rejected?: unknown; hidden_pending_review?: unknown }) | null | undefined): boolean {
  return isPubliclyListed(e) && e?.rejected !== true && e?.hidden_pending_review !== true
}

/** The stored fields for a chosen visibility. */
export function visibilityFields(v: EventVisibility): { show_on_explore: boolean } {
  return { show_on_explore: v !== 'unlisted' }
}
