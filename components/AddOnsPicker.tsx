'use client'

/**
 * The buyer's add-ons step, under the tiers in the ticket selector: paid
 * extras sold with tickets (lib/addons/addOns.ts). Only add-ons the cart's
 * tiers allow are offered; prices shown are the stored ones and the server
 * reprices every line anyway.
 *
 * Compact rows on a fill, the same stepper as the tiers, nothing louder.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import {
  addOnAvailability,
  addOnOrderLimit,
  addOnRemaining,
  type EventAddOn,
} from '@/lib/addons/addOns'

export interface SelectedAddOn {
  id: string
  name: string
  option: string | null
  quantity: number
  unitPrice: number
}

/** Selection key: one line per add-on + option. */
export const addOnKey = (id: string, option: string | null) => `${id}\u0000${option ?? ''}`

export function selectedAddOnsFrom(addOns: EventAddOn[], quantities: Record<string, number>): SelectedAddOn[] {
  const out: SelectedAddOn[] = []
  for (const a of addOns) {
    const options = a.options && a.options.length > 0 ? a.options : [null]
    for (const option of options) {
      const q = quantities[addOnKey(a.id, option)] || 0
      if (q > 0) out.push({ id: a.id, name: a.name, option, quantity: q, unitPrice: a.price })
    }
  }
  return out
}

/** What the payment routes take: `[{ id, option, quantity }]` (never a price). */
export function addOnsRequestBody(selected: SelectedAddOn[] | null | undefined) {
  return (selected || []).map((a) => ({ id: a.id, option: a.option, quantity: a.quantity }))
}

/** The buyer-facing message for an add-on refusal from a payment route, or null for any other code. */
export function addOnErrorMessage(code: unknown, t: (key: string, opts?: any) => string): string | null {
  switch (String(code || '')) {
    case 'addon_sold_out':
    case 'addon_only_n_left':
      return t('addOns.errors.soldOut', { ns: 'events', defaultValue: 'One of your add-ons just sold out. Remove it or lower the quantity and try again.' })
    case 'addon_unavailable':
    case 'addon_not_started':
    case 'addon_ended':
      return t('addOns.errors.unavailable', { ns: 'events', defaultValue: 'One of your add-ons is no longer on sale. Remove it and try again.' })
    case 'addon_needs_tier':
      return t('addOns.errors.needsTier', { ns: 'events', defaultValue: 'One of your add-ons is only sold with a different ticket.' })
    case 'addon_limit':
      return t('addOns.errors.limit', { ns: 'events', defaultValue: 'You picked more of an add-on than one order allows.' })
    case 'addon_option_required':
    case 'addon_option_invalid':
      return t('addOns.errors.option', { ns: 'events', defaultValue: 'Choose a size or option for each add-on.' })
    case 'addon_rail_unsupported':
      return t('addOns.errors.rail', { ns: 'events', defaultValue: 'Add-ons can be paid by card or MonCash.' })
    case 'addon_too_many_lines':
    case 'addon_invalid':
      return t('addOns.errors.generic', { ns: 'events', defaultValue: "We couldn't add your add-ons. Please try again." })
    default:
      return null
  }
}

export default function AddOnsPicker({
  addOns,
  soldMap,
  cartTierIds,
  quantities,
  onChange,
  currency,
}: {
  addOns: EventAddOn[]
  soldMap?: Record<string, unknown> | null
  cartTierIds: string[]
  quantities: Record<string, number>
  onChange: (next: Record<string, number>) => void
  currency: string
}) {
  const { t } = useTranslation('events')
  const [optionFor, setOptionFor] = useState<Record<string, string>>({})
  const visible = addOns.filter((a) => {
    const v = addOnAvailability(a, { cartTierIds, soldMap })
    return v === 'available' || v === 'sold_out'
  })
  if (visible.length === 0) return null

  const totalFor = (a: EventAddOn) =>
    Object.entries(quantities).reduce((s, [k, q]) => (k.startsWith(`${a.id}\u0000`) ? s + q : s), 0)

  const step = (a: EventAddOn, option: string | null, delta: number) => {
    const key = addOnKey(a.id, option)
    const cur = quantities[key] || 0
    const remaining = addOnRemaining(a, soldMap)
    const cap = Math.min(addOnOrderLimit(a), remaining ?? Infinity)
    const others = totalFor(a) - cur
    const next = Math.max(0, Math.min(cap - others, cur + delta))
    onChange({ ...quantities, [key]: next })
  }

  const stepBtn =
    'flex h-10 w-10 items-center justify-center rounded bg-surface-raised transition-colors hover:bg-surface-high disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <section aria-labelledby="add-ons-title" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="add-ons-title" className="text-body font-semibold text-fg">
          {t('addOns.buyer.title', { defaultValue: 'Add-ons' })}
        </h4>
        <span className="text-caption text-fg-subtle">
          {t('addOns.buyer.subtitle', { defaultValue: 'Picked up at the event' })}
        </span>
      </div>
      {visible.map((a) => {
        const soldOut = addOnAvailability(a, { cartTierIds, soldMap }) === 'sold_out'
        const options: Array<string | null> = a.options && a.options.length > 0 ? a.options : [null]
        const limit = addOnOrderLimit(a)
        const atLimit = totalFor(a) >= Math.min(limit, addOnRemaining(a, soldMap) ?? Infinity)
        const chosen = totalFor(a) > 0
        const current: string | null = options[0] === null ? null : optionFor[a.id] || (options[0] as string)
        return (
          <div
            key={a.id}
            className={`rounded px-3 py-2.5 ${chosen ? 'bg-surface-raised' : 'bg-surface-low'} ${soldOut ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-fg">{a.name}</p>
                <p className="truncate text-caption text-fg-subtle">
                  <span className="font-medium text-brand-400">
                    {a.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
                  </span>
                  {a.description ? ` · ${a.description}` : ''}
                </p>
                {soldOut && (
                  <p className="mt-0.5 inline-flex items-center gap-1.5 text-caption text-danger">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                    {t('addOns.buyer.soldOut', { defaultValue: 'Sold out' })}
                  </p>
                )}
              </div>
              {!soldOut && (
                <Stepper
                  value={quantities[addOnKey(a.id, current)] || 0}
                  onMinus={() => step(a, current, -1)}
                  onPlus={() => step(a, current, 1)}
                  plusDisabled={atLimit}
                  name={current ? `${a.name} ${current}` : a.name}
                  className={stepBtn}
                  t={t}
                />
              )}
            </div>
            {/* Sizes: one chip row and the one stepper above (it counts the chosen size). */}
            {!soldOut && current !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('addOns.buyer.option', { defaultValue: 'Size' })}>
                {(options as string[]).map((option) => {
                  const on = option === current
                  const q = quantities[addOnKey(a.id, option)] || 0
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setOptionFor((prev) => ({ ...prev, [a.id]: option }))}
                      className={`h-8 min-w-[2.5rem] rounded px-2.5 text-meta font-medium transition-colors ${
                        on ? 'bg-inverse text-on-inverse' : 'bg-surface text-fg-soft hover:bg-surface-raised'
                      }`}
                    >
                      {option}
                      {q > 0 ? <span className={on ? '' : 'text-fg-subtle'}>{` ×${q}`}</span> : null}
                    </button>
                  )
                })}
              </div>
            )}
            {!soldOut && atLimit && chosen && (
              <p className="mt-1 text-caption text-fg-subtle">
                {t('addOns.buyer.limit', { defaultValue: 'Up to {{count}} per order', count: limit })}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}

function Stepper({
  value,
  onMinus,
  onPlus,
  plusDisabled,
  name,
  className,
  t,
}: {
  value: number
  onMinus: () => void
  onPlus: () => void
  plusDisabled: boolean
  name: string
  className: string
  t: (key: string, opts?: any) => string
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onMinus}
        disabled={value === 0}
        aria-label={t('addOns.buyer.decrease', { defaultValue: 'Fewer {{name}}', name })}
        className={className}
      >
        <Minus className="h-4 w-4 text-fg-soft" />
      </button>
      <span className="w-7 text-center text-body font-semibold tabular-nums text-fg">{value}</span>
      <button
        type="button"
        onClick={onPlus}
        disabled={plusDisabled}
        aria-label={t('addOns.buyer.increase', { defaultValue: 'More {{name}}', name })}
        className={className}
      >
        <Plus className="h-4 w-4 text-fg-soft" />
      </button>
    </div>
  )
}
