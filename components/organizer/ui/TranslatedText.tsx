'use client'

import { useTranslation } from 'react-i18next'

/**
 * One translated string, for use inside a SERVER component.
 *
 * Most remaining English on organizer pages is not a whole view worth splitting
 * out — it is a heading here, an empty state there, a metric label — scattered
 * through pages that must stay server components because they read auth cookies
 * and query Firestore with the Admin SDK.
 *
 * Moving a hundred lines of render to a client file for the sake of four words
 * is the more dangerous change: it means deciding what data crosses the
 * boundary, in a page that currently works. This crosses a KEY instead, which is
 * the smallest thing that can cross, and leaves the page exactly as it was.
 *
 *   <h2>Event not found</h2>
 *   <h2><T k="event_earnings.event_not_found" /></h2>
 *
 * Use a real split (see AnalyticsView) when a whole view needs translating, and
 * this when the text is incidental to a page that is mostly data.
 */
export function T({ k, values }: { k: string; values?: Record<string, string | number> }) {
  const { t } = useTranslation('organizer')
  return <>{values ? t(k, values) : t(k)}</>
}
