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
import QtyStepper from '@/components/QtyStepper'
import { formatMoney } from '@/lib/money'
import {
  addOnAvailability,
  addOnOrderLimit,
  addOnRemaining,
  type EventAddOn,
} from '@/lib/addons/addOns'

/** Stock at or under this shows "N left", like the app's tiers. */
const LOW_STOCK = 10

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
  eventStart = null,
  eventEnd = null,
}: {
  addOns: EventAddOn[]
  soldMap?: Record<string, unknown> | null
  cartTierIds: string[]
  quantities: Record<string, number>
  onChange: (next: Record<string, number>) => void
  currency: string
  /** The event's start and end: an add-on with no sales end stops selling when it ends. */
  eventStart?: string | null
  eventEnd?: string | null
}) {
  const { t } = useTranslation('events')
  const [optionFor, setOptionFor] = useState<Record<string, string>>({})
  const visible = addOns.filter((a) => {
    const v = addOnAvailability(a, { cartTierIds, soldMap, eventStart, eventEnd })
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

  return (
    <section aria-labelledby="add-ons-title">
      {/* The app's section label: small, uppercase, a quiet note on the right. */}
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div id="add-ons-title" className="text-caption font-bold uppercase tracking-[0.07em] text-fg-muted">
          {t('addOns.buyer.title', { defaultValue: 'Add-ons' })}
        </div>
        <span className="truncate text-caption text-fg-subtle">
          {t('addOns.buyer.subtitle', { defaultValue: 'Picked up at the event' })}
        </span>
      </div>
      <ul>
        {visible.map((a, index) => {
          const soldOut = addOnAvailability(a, { cartTierIds, soldMap, eventStart, eventEnd }) === 'sold_out'
          const options: Array<string | null> = a.options && a.options.length > 0 ? a.options : [null]
          const limit = addOnOrderLimit(a)
          const remaining = addOnRemaining(a, soldMap)
          const atLimit = totalFor(a) >= Math.min(limit, remaining ?? Infinity)
          const current: string | null = options[0] === null ? null : optionFor[a.id] || (options[0] as string)
          const picked = (options.filter(Boolean) as string[])
            .map((o) => ({ o, q: quantities[addOnKey(a.id, o)] || 0 }))
            .filter((x) => x.q > 0)
            .map((x) => `${x.o} × ${x.q}`)
            .join(', ')
          const note = soldOut
            ? t('addOns.buyer.soldOut', { defaultValue: 'Sold out' })
            : remaining !== null && remaining <= LOW_STOCK
              ? t('addOns.buyer.left', { defaultValue: '{{count}} left', count: remaining })
              : null
          return (
            <li
              key={a.id}
              className={`flex items-center gap-3 py-2.5 ${index < visible.length - 1 ? 'border-b border-line' : ''} ${
                soldOut ? 'opacity-70' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-body font-semibold text-fg">{a.name}</span>
                  <span className="shrink-0 text-body font-bold tabular-nums text-fg">{formatMoney(a.price, currency)}</span>
                </div>
                {(note || a.description) && (
                  <div className="mt-0.5 truncate text-eyebrow text-fg-muted">
                    {note ? <span className={soldOut ? 'text-danger' : ''}>{note}</span> : null}
                    {note && a.description ? ' · ' : ''}
                    {a.description}
                  </div>
                )}
                {/* Sizes: the app's chips (4px corner, white when chosen); the one
                    stepper counts the chosen size. */}
                {!soldOut && current !== null && (
                  <div
                    className="mt-2 flex flex-wrap gap-1.5"
                    role="radiogroup"
                    aria-label={t('addOns.buyer.option', { defaultValue: 'Size' })}
                  >
                    {(options as string[]).map((option) => {
                      const on = option === current
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setOptionFor((prev) => ({ ...prev, [a.id]: option }))}
                          className={`h-8 min-w-[2.5rem] rounded px-2.5 text-meta font-semibold transition-colors ${
                            on ? 'bg-inverse text-on-inverse' : 'bg-surface text-fg hover:bg-surface-raised'
                          }`}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                )}
                {picked && <div className="mt-1 text-eyebrow text-fg-muted">{picked}</div>}
                {!soldOut && atLimit && totalFor(a) > 0 && (
                  <div className="mt-0.5 text-eyebrow text-fg-subtle">
                    {t('addOns.buyer.limit', { defaultValue: 'Up to {{count}} per order', count: limit })}
                  </div>
                )}
              </div>
              <QtyStepper
                value={quantities[addOnKey(a.id, current)] || 0}
                hidden={soldOut}
                onMinus={() => step(a, current, -1)}
                onPlus={() => step(a, current, 1)}
                plusDisabled={atLimit}
                decreaseLabel={t('addOns.buyer.decrease', { defaultValue: 'Fewer {{name}}', name: current ? `${a.name} ${current}` : a.name })}
                increaseLabel={t('addOns.buyer.increase', { defaultValue: 'More {{name}}', name: current ? `${a.name} ${current}` : a.name })}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
