'use client'

// The organizer door: one sentence, three facts and one white button.
// The facts are checked against the code, not the pitch deck:
//   fee      — per market (10% Haiti; US/CA/FR rate + fixed per ticket), processing absorbed by Tikèm (lib/checkout/buyer-pricing,
//              types/platform-settings DEFAULT_PLATFORM_SETTINGS; owner rule 2026-09-30)
//   payments — MonCash for Haiti events, cards (Stripe) for diaspora events. NatCash
//              and Haiti cards (Sogepay) are both feature-flagged off in BuyTicketButton.
//   payouts  — released 24h (established) to 72h (new organizer) after the event
//              (lib/payouts/release-rules ESTABLISHED/NEW_ORGANIZER_HOLD_HOURS).
// Change a fact here only when that code changes.

import Link from 'next/link'
import { useTranslation } from 'react-i18next'

export default function OrganizerBand() {
  const { t } = useTranslation('common')
  const facts = [
    t('home.org.fact_fee', { defaultValue: 'Low fees, processing included' }),
    t('home.org.fact_pay', { defaultValue: 'MonCash in Haiti, cards in the diaspora' }),
    t('home.org.fact_payout', { defaultValue: 'Funds available 72 hours after your event ends, 24 hours once you’re established' }),
  ]
  return (
    <section className="rounded bg-surface-low px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-12">
        <h2 className="font-grotesk font-bold text-fg text-balance !text-[clamp(34px,4.6vw,64px)] !leading-[0.95] tracking-[-0.035em] lg:col-span-7">
          {t('home.org.line', { defaultValue: 'Throw the fèt. We’ll run the door.' })}
        </h2>
        <div className="lg:col-span-5">
          <ul className="space-y-3">
            {facts.map((f) => (
              <li key={f} className="text-base leading-snug text-fg-soft">
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/create"
              className="inline-flex h-12 items-center rounded bg-inverse px-6 font-grotesk text-body font-semibold text-on-inverse outline-none transition-colors hover:bg-inverse-hover focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {t('home.org.cta', { defaultValue: 'Start selling' })}
            </Link>
            <Link
              href="/platform"
              className="rounded text-sm text-fg-muted underline-offset-4 outline-none transition-colors hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-fg/70"
            >
              {t('home.org.how', { defaultValue: 'How it works' })}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
