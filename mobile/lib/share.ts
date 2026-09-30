import { Share } from 'react-native';

import type { Language } from '../contexts/I18nContext';
import { safeFormatForLanguage } from './dates';

/**
 * The single event-share helper used across Discover / Home / Favorites so the
 * share sheet always shows the SAME text. Beta feedback: a bare title + link had
 * no context, so we now compose a richer blurb from the event's OWN data
 * (title, date · venue, a short description snippet, then the tikem.co link),
 * gracefully omitting whatever the event doesn't carry — most cards won't have
 * every field. No locale keys are added: the only localized bit is the date,
 * formatted via `safeFormatForLanguage` using the caller's current `language`.
 */
const SNIPPET_MAX = 140;

/** Trim a description to ~SNIPPET_MAX chars on a word boundary, adding an ellipsis. */
function snippet(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= SNIPPET_MAX) return text;
  const cut = text.slice(0, SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s.,;:!?-]+$/, '')}…`;
}

export async function shareEvent(event: any, language: Language = 'en'): Promise<void> {
  if (!event) return;

  const lines: string[] = [];

  // Title (first line, on its own).
  const title = typeof event.title === 'string' ? event.title.trim() : '';
  if (title) lines.push(title);

  // Date · venue — each part optional, joined only when present.
  const when = event.start_datetime
    ? safeFormatForLanguage(event.start_datetime, 'EEE, MMM d · h:mm a', language)
    : '';
  const where = [event.venue_name, event.city, event.location]
    .find((v) => typeof v === 'string' && v.trim().length > 0);
  const meta = [when, typeof where === 'string' ? where.trim() : '']
    .filter(Boolean)
    .join(' · ');
  if (meta) lines.push(meta);

  // One-line description snippet.
  if (typeof event.description === 'string' && event.description.trim()) {
    const snip = snippet(event.description);
    if (snip) lines.push(snip);
  }

  // The canonical tikem.co event URL (unchanged from the original helper),
  // set off by a blank line so it reads as the call-to-action.
  const url = `https://www.tikem.co/events/${event.id}`;
  const message = lines.length ? `${lines.join('\n')}\n\n${url}` : url;

  try {
    await Share.share({
      title: title || undefined,
      message,
    });
  } catch (e) {
    console.warn('[share] Share failed:', e);
  }
}
