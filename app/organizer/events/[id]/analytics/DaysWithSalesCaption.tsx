'use client'

import { Trans } from 'react-i18next'

/**
 * "Last <n> days with sales", where the number keeps its mono styling.
 *
 * The sentence had a <span> in the middle of it, so the naive extraction would
 * have translated the fragment "Last" on its own — which produces the wrong word
 * order in both target languages. French puts the adjective after the count
 * ("Les 7 derniers jours"), Kreyòl leads with it ("7 dènye jou").
 *
 * <Trans> keeps the sentence whole in the locale file and lets the translation
 * decide where the number goes, with <n> marking the styled slot.
 */
export function DaysWithSalesCaption({ count }: { count: number }) {
  return (
    <p className="mt-2 text-xs text-fg-subtle">
      <Trans
        i18nKey="event_analytics.days_with_sales"
        ns="organizer"
        count={count}
        components={{ n: <span className="font-mono tabular-nums" /> }}
      />
    </p>
  )
}
