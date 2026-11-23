import { Platform, Share } from 'react-native';

import type { Language } from '../contexts/I18nContext';
import { formatEventTime } from './dates';

/**
 * The single event-share helper used across Discover / Home / Favorites so the
 * share sheet always shows the SAME text. Beta feedback: a bare title + link had
 * no context, so we now compose a richer blurb from the event's OWN data
 * (title, date · venue, then the tikem.co link; no description, since the link's
 * preview card is the poster and the owner wants the text kept minimal),
 * gracefully omitting whatever the event doesn't carry — most cards won't have
 * every field. No locale keys are added: the only localized bit is the date,
 * formatted on the event's own clock via `formatEventTime` using the caller's
 * current `language`.
 */
export async function shareEvent(event: any, language: Language = 'en'): Promise<void> {
  if (!event) return;

  const lines: string[] = [];

  // Title (first line, on its own).
  const title = typeof event.title === 'string' ? event.title.trim() : '';
  if (title) lines.push(title);

  // Date · venue — each part optional, joined only when present.
  const when = event.start_datetime
    ? formatEventTime(event.start_datetime, event, 'EEE, MMM d · h:mm a', language)
    : '';
  const where = [event.venue_name, event.city, event.location]
    .find((v) => typeof v === 'string' && v.trim().length > 0);
  const meta = [when, typeof where === 'string' ? where.trim() : '']
    .filter(Boolean)
    .join(' · ');
  if (meta) lines.push(meta);

  // The canonical tikem.co event URL (unchanged from the original helper).
  const url = `https://www.tikem.co/events/${event.id}`;

  try {
    await shareLink({ title: title || undefined, text: lines.join('\n'), url });
  } catch (e) {
    console.warn('[share] Share failed:', e);
  }
}

/**
 * Share a web link so it unfurls into its preview card (the event poster).
 *
 * iOS gets it as Share's `url`, which iMessage turns into the rich preview
 * bubble (inside `message` as well, the link showed twice and the card could
 * be suppressed); Android ignores `url`, so there the link goes at the end of
 * the message, set off by a blank line, where WhatsApp and Messages pick it
 * up. Rejects like Share.share does. Port of Tikra c1562627.
 */
export async function shareLink({ title, text, url }: { title?: string; text?: string; url: string }): Promise<void> {
  const body = (text || '').trim();
  if (Platform.OS === 'ios') {
    await Share.share(body ? { title, message: body, url } : { title, url });
  } else {
    await Share.share({ title, message: body ? `${body}\n\n${url}` : url });
  }
}
