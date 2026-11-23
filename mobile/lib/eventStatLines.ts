/**
 * The organizer event screen's numbers as two quiet lines (TestFlight
 * 2026-11-23: "these could be one or two lines max, no need for this grid"):
 *
 *   0/120 sold · 0 checked in
 *   0% sold · 12 views · 3 today
 *
 * Each segment is a number (drawn semibold) and a muted label. Pure, so the
 * singular/plural choice is tested in every language.
 */

import type { Language } from '../contexts/I18nContext';

export type StatSegment = { value: string; label: string };

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** French counts 0 and 1 as singular ("0 vendu"); English and Kreyòl only 1. */
export function isSingular(language: Language, n: number): boolean {
  return language === 'fr' ? Math.abs(n) < 2 : n === 1;
}

function percent(language: Language, n: number): string {
  // French sets a (narrow) space before the sign: "45 %".
  return language === 'fr' ? `${n} %` : `${n}%`;
}

export function eventStatLines(
  t: Translate,
  language: Language,
  {
    sold,
    capacity,
    checkedIn,
    sellThrough,
    views,
  }: {
    sold: number;
    /** 0 when the event has no real cap. */
    capacity: number;
    checkedIn: number;
    sellThrough: number | null;
    views: { total: number; today: number } | null;
  },
): StatSegment[][] {
  const k = (name: string, n: number) =>
    t(`organizerEventManagement.statLine.${name}${isSingular(language, n) ? 'One' : 'Other'}`);
  const first: StatSegment[] = [
    { value: capacity > 0 ? `${sold}/${capacity}` : String(sold), label: k('sold', sold) },
    { value: String(checkedIn), label: k('checkedIn', checkedIn) },
  ];
  const second: StatSegment[] = [];
  if (sellThrough !== null) {
    second.push({ value: percent(language, sellThrough), label: t('organizerEventManagement.statLine.sellThrough') });
  }
  if (views) {
    second.push({ value: views.total.toLocaleString(), label: k('views', views.total) });
    if (views.today > 0) {
      // "{count} today" already holds its number: one muted segment.
      second.push({ value: '', label: t('eventViews.today', { count: views.today }) });
    }
  }
  return second.length > 0 ? [first, second] : [first];
}
