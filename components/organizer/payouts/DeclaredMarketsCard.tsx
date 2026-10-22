'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { updateDeclaredMarkets } from '@/app/organizer/settings/payouts/actions'
import { COUNTRY_SUPPORT } from '@/lib/country-support'
import { useTranslation } from 'react-i18next'
import {
  DECLARABLE_MARKETS,
  marketsForRail,
  normalizeDeclaredMarkets,
  railsForMarkets,
  type PayoutRailId,
} from '@/lib/organizer-markets'

/**
 * "Where do you run events?" — the question nothing used to ask.
 *
 * The answer only shapes what the organizer SEES: declare Haiti alone and the
 * Stripe Connect setup stops being offered; declare Haiti + the US and both
 * appear, named as two separate setups rather than a choice between rails.
 * It is re-editable at any moment, on purpose: a diaspora organizer adds
 * markets over time and must never be walled off by a month-one answer.
 *
 * It is NOT a gate. Publishing and withdrawal still resolve the required payout
 * profile from the EVENT's country, server-side.
 */

type Translate = (key: string, opts?: Record<string, any>) => string

const railCopy = (t: Translate): Record<PayoutRailId, { title: string; blurb: string }> => ({
  haiti: {
    title: t('markets.rail_haiti_title', { defaultValue: 'Haiti payouts' }),
    blurb: t('markets.rail_haiti_blurb', {
      defaultValue: 'Bank transfer (Sogebank, Unibank…) or MonCash. Tikèm verifies you.',
    }),
  },
  stripe_connect: {
    title: 'Stripe Connect',
    blurb: t('markets.rail_stripe_blurb', {
      defaultValue: 'Card payouts to a bank account outside Haiti. Stripe verifies you.',
    }),
  },
})

export default function DeclaredMarketsCard({
  initialMarkets,
  haitiConfigured,
  stripeConfigured,
  className,
}: {
  initialMarkets?: string[]
  haitiConfigured?: boolean
  stripeConfigured?: boolean
  className?: string
}) {
  const { t } = useTranslation('organizer')
  const router = useRouter()
  const [saved, setSaved] = useState<string[]>(() => normalizeDeclaredMarkets(initialMarkets))
  const [selected, setSelected] = useState<string[]>(() => normalizeDeclaredMarkets(initialMarkets))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const isDirty = useMemo(() => {
    if (selected.length !== saved.length) return true
    return selected.some((code, i) => code !== saved[i])
  }, [selected, saved])

  const rails = useMemo(() => railsForMarkets(saved), [saved])
  const configured: Record<PayoutRailId, boolean> = {
    haiti: Boolean(haitiConfigured),
    stripe_connect: Boolean(stripeConfigured),
  }

  const toggle = (code: string) => {
    setJustSaved(false)
    setSelected((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
    )
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const result = await updateDeclaredMarkets(selected)
      if (!result.success) {
        setError(result.error || t('markets.save_error', { defaultValue: 'Could not save your markets' }))
        return
      }
      const next = normalizeDeclaredMarkets(result.markets ?? selected)
      setSaved(next)
      setSelected(next)
      setJustSaved(true)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || t('markets.save_error', { defaultValue: 'Could not save your markets' }))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={`bg-white/[0.055] rounded-2xl overflow-hidden ${className || ''}`}>
      <div className="p-6">
        <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('markets.title', { defaultValue: 'Where you run events' })}</h2>
        <p className="mt-1 text-sm text-white/60">
          Pick every country you plan to hold events in. We&apos;ll only ask you to set up the
          payout methods those countries actually use, and you can change this whenever you
          expand.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {DECLARABLE_MARKETS.map((code) => {
            const isOn = selected.includes(code)
            return (
              <button
                key={code}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggle(code)}
                className={`inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors ${
                  isOn
                    ? 'bg-white text-black'
                    : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {isOn ? <Check className="h-3.5 w-3.5" /> : null}
                {COUNTRY_SUPPORT[code]?.name || code}
              </button>
            )
          })}
        </div>

        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="inline-flex items-center gap-2 rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSaving ? t('markets.saving', { defaultValue: 'Saving…' }) : t('markets.save', { defaultValue: 'Save markets' })}
          </button>
          {justSaved && !isDirty ? (
            <span className="text-sm text-white/50">{t('markets.saved_note', { defaultValue: 'Saved. You can update this any time.' })}</span>
          ) : null}
        </div>

        {/* What the declaration implies, stated plainly. Two markets on two
            different rails are TWO setups, not two options. */}
        <div className="mt-6 border-t border-white/[0.06] pt-5">
          {saved.length === 0 ? (
            <p className="text-sm text-white/50">
              {t('markets.none_declared', { defaultValue: 'Nothing declared yet, so every payout method is shown below.' })}
            </p>
          ) : rails.length === 0 ? (
            <p className="text-sm text-white/50">
              {t('markets.no_paid_yet', {
                defaultValue:
                  "Paid tickets aren't available in the markets you picked yet, so there's no payout method to set up. Free and RSVP events work today.",
              })}
            </p>
          ) : (
            <>
              <p className="text-sm text-white/60">
                {rails.length > 1
                  ? t('markets.needs_many', { count: rails.length, defaultValue: `Your markets need ${rails.length} separate payout setups. Completing one does not cover the other.` })
                  : t('markets.needs_one', { defaultValue: 'Your markets need one payout setup.' })}
              </p>
              <ul className="mt-3 space-y-3">
                {rails.map((rail) => {
                  const served = marketsForRail(rail, saved)
                    .map((code) => COUNTRY_SUPPORT[code]?.name || code)
                    .join(', ')
                  const isConfigured = configured[rail]
                  return (
                    <li key={rail} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          isConfigured ? 'bg-emerald-400' : 'bg-white/30'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">
                          {railCopy(t)[rail].title}
                          <span className="ml-2 text-xs font-normal text-white/50">
                            {isConfigured ? t('markets.set_up', { defaultValue: 'Set up' }) : t('markets.not_set_up', { defaultValue: 'Not set up' })}
                          </span>
                        </div>
                        <div className="text-xs text-white/50">
                          {served} · {railCopy(t)[rail].blurb}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
