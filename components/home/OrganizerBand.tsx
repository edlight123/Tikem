'use client'

// The organizer door: one sentence, three facts and one white button.
// The facts are checked against the code, not the pitch deck:
//   fee      — 10% everywhere, processing absorbed by Tikèm (lib/checkout/buyer-pricing,
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
    t('home.org.fact_fee', { defaultValue: '10% all-in, processing included' }),
    t('home.org.fact_pay', { defaultValue: 'MonCash in Haiti, cards in the diaspora' }),
    t('home.org.fact_payout', { defaultValue: 'Payouts released 24–72 hours after your event' }),
  ]
  return (
    <section className="rounded-2xl bg-white/[0.045] px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-12">
        <h2 className="font-grotesk font-bold text-white text-balance !text-[clamp(34px,4.6vw,64px)] !leading-[0.95] tracking-[-0.035em] lg:col-span-7">
          {t('home.org.line', { defaultValue: 'Throw the fèt. We’ll run the door.' })}
        </h2>
        <div className="lg:col-span-5">
          <ul className="space-y-3">
            {facts.map((f) => (
              <li key={f} className="text-[16px] leading-snug text-white/75">
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/create"
              className="inline-flex h-12 items-center rounded-xl bg-white px-6 font-grotesk text-[15px] font-semibold text-black outline-none transition-colors hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {t('home.org.cta', { defaultValue: 'Start selling' })}
            </Link>
            <Link
              href="/platform"
              className="rounded text-[14px] text-white/55 underline-offset-4 outline-none transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {t('home.org.how', { defaultValue: 'How it works' })}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
