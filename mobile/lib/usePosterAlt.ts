/**
 * Poster descriptions in the reader's language (lib/posterAlt).
 *
 *  - `usePosterAlt()(event)`: for a poster that stands alone (the event hero,
 *    a ticket's poster): the organizer's words, else a sentence from the facts.
 *  - `storedPosterAlt(event)`: only the organizer's words, for a card whose
 *    caption already reads the title, price, place and date.
 */
import { useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { cleanPosterAlt, posterAltText, type PosterAltEvent } from './posterAlt';

export function usePosterAlt(): (e: PosterAltEvent | null | undefined) => string {
  const { language } = useI18n();
  return useCallback((e: PosterAltEvent | null | undefined) => posterAltText(e, language), [language]);
}

export function storedPosterAlt(e: { poster_alt?: unknown } | null | undefined): string {
  return cleanPosterAlt(e?.poster_alt);
}
