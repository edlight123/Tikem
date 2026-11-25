'use client'

/**
 * The composer's "Add-ons" section: paid extras sold with tickets (a bottle or
 * table package, a VIP upgrade, parking, drinks, a T-shirt in sizes). One
 * compact row per add-on; tap it to edit. The parent owns the drafts and saves
 * them with the event (lib/addons/editor.ts → events.add_ons).
 *
 * Quiet by design (owner, 2026-11-18): compact rows on a fill, no cards, no
 * explainers beyond one hint line, 40pt controls, the one 4px corner.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { draftProblem, emptyAddOnDraft, parseOptionList, type AddOnDraft } from '@/lib/addons/editor'
import { formatMoney } from '@/lib/money'
import { ADD_ON_PRESETS, type AddOnPresetKey } from '@/lib/addons/presets'

export interface AddOnsEditorTier {
  docId?: string
  name: string
}

const inputCls =
  'min-h-10 w-full min-w-0 rounded bg-surface px-3 py-2 text-base text-fg [color-scheme:dark] placeholder:text-fg-subtle transition-colors focus:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand-400/50 sm:text-sm'
// The app's sheet labels: small, uppercase, letter-spaced.
const labelCls = 'mb-1 block truncate text-caption font-semibold uppercase tracking-[0.07em] text-fg-muted'

export default function AddOnsEditor({
  drafts,
  onChange,
  tiers,
  currency,
}: {
  drafts: AddOnDraft[]
  onChange: (next: AddOnDraft[]) => void
  tiers: AddOnsEditorTier[]
  currency: string
}) {
  const { t } = useTranslation('events')
  const [openId, setOpenId] = useState<string | null>(null)
  const savedTiers = tiers.filter((tr): tr is { docId: string; name: string } => Boolean(tr.docId))

  const patch = (id: string, p: Partial<AddOnDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...p } : d)))
  const remove = (id: string) => onChange(drafts.filter((d) => d.id !== id))
  const add = (preset?: AddOnPresetKey) => {
    const d = emptyAddOnDraft()
    if (preset) {
      const p = ADD_ON_PRESETS[preset]
      d.name = t(`addOns.presets.${preset}`, { defaultValue: p.name })
      d.options = p.options.join(', ')
    }
    onChange([...drafts, d])
    setOpenId(d.id)
  }

  const problemText = (p: ReturnType<typeof draftProblem>) =>
    p === 'name'
      ? t('addOns.editor.needsName', { defaultValue: 'Give this add-on a name.' })
      : p === 'price'
        ? t('addOns.editor.needsPrice', { defaultValue: 'Set a price above 0.' })
        : p === 'window'
          ? t('addOns.editor.badWindow', { defaultValue: 'Sales must end after they start.' })
          : ''

  return (
    <div className="space-y-2">
      {drafts.map((d) => {
        const open = openId === d.id
        const options = parseOptionList(d.options)
        const problem = draftProblem(d)
        return (
          <div key={d.id} className="rounded bg-surface-low">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : d.id)}
              className="flex min-h-[3.25rem] w-full items-center gap-3 px-3 py-2 text-start"
              aria-expanded={open}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-fg">
                  {d.name.trim() || t('addOns.editor.untitled', { defaultValue: 'New add-on' })}
                </span>
                <span className="block truncate text-caption text-fg-subtle">
                  {[
                    Number(d.price) > 0 ? formatMoney(Number(d.price), currency) : null,
                    d.quantity
                      ? t('addOns.editor.stockCount', { defaultValue: '{{count}} available', count: Number(d.quantity) })
                      : t('addOns.editor.unlimited', { defaultValue: 'Unlimited' }),
                    options.length > 0 ? options.join(' · ') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {problem && (
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-caption text-warning">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                    {problemText(problem)}
                  </span>
                )}
              </span>
              {!d.active && (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-fg-subtle">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-fg-faint" />
                  {t('addOns.editor.hiddenBadge', { defaultValue: 'Paused' })}
                </span>
              )}
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {open && (
              <div className="space-y-3 px-3 pb-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.name', { defaultValue: 'Name' })}</span>
                    <input
                      className={inputCls}
                      value={d.name}
                      maxLength={60}
                      placeholder={t('addOns.editor.namePlaceholder', { defaultValue: 'Bottle package, Parking, T-shirt…' })}
                      onChange={(e) => patch(d.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>
                      {t('addOns.editor.price', { defaultValue: 'Price ({{currency}})', currency })}
                    </span>
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={d.price}
                      placeholder="0"
                      onChange={(e) => patch(d.id, { price: e.target.value.replace(/[^0-9.]/g, '') })}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className={labelCls}>
                    {t('addOns.editor.description', { defaultValue: 'Description (optional)' })}
                  </span>
                  <input
                    className={inputCls}
                    value={d.description}
                    maxLength={240}
                    placeholder={t('addOns.editor.descriptionPlaceholder', { defaultValue: '1 bottle + mixers, for 4' })}
                    onChange={(e) => patch(d.id, { description: e.target.value })}
                  />
                </label>

                <label className="block">
                  <span className={labelCls}>{t('addOns.editor.options', { defaultValue: 'Sizes or options (optional)' })}</span>
                  <input
                    className={inputCls}
                    value={d.options}
                    placeholder={t('addOns.editor.optionsPlaceholder', { defaultValue: 'S, M, L, XL' })}
                    onChange={(e) => patch(d.id, { options: e.target.value })}
                  />
                  <span className="mt-1 block text-caption text-fg-subtle">
                    {t('addOns.editor.optionsHint', {
                      defaultValue: 'Separate with commas. Buyers pick one; all options share the stock.',
                    })}
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.quantity', { defaultValue: 'Stock' })}</span>
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      value={d.quantity}
                      placeholder={t('addOns.editor.unlimited', { defaultValue: 'Unlimited' })}
                      onChange={(e) => patch(d.id, { quantity: e.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.maxPerOrder', { defaultValue: 'Max per order' })}</span>
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      value={d.maxPerOrder}
                      placeholder="10"
                      onChange={(e) => patch(d.id, { maxPerOrder: e.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.salesStart', { defaultValue: 'Sales start (optional)' })}</span>
                    <input
                      type="datetime-local"
                      className={inputCls}
                      value={d.salesStart}
                      onChange={(e) => patch(d.id, { salesStart: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.salesEnd', { defaultValue: 'Sales end (optional)' })}</span>
                    <input
                      type="datetime-local"
                      className={inputCls}
                      value={d.salesEnd}
                      min={d.salesStart || undefined}
                      onChange={(e) => patch(d.id, { salesEnd: e.target.value })}
                    />
                  </label>
                </div>

                <div>
                  <span className={labelCls}>{t('addOns.editor.onlyWith', { defaultValue: 'Only with these tickets' })}</span>
                  {savedTiers.length === 0 ? (
                    <div className="text-caption text-fg-subtle">
                      {t('addOns.editor.onlyWithSaveFirst', {
                        defaultValue: 'Sold with any ticket. Save the event first to limit it to certain tickets.',
                      })}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {savedTiers.map((tr) => {
                          const on = d.tierIds.includes(tr.docId)
                          return (
                            <button
                              key={tr.docId}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                patch(d.id, {
                                  tierIds: on ? d.tierIds.filter((x) => x !== tr.docId) : [...d.tierIds, tr.docId],
                                })
                              }
                              className={`min-h-10 rounded px-3 text-meta font-medium transition-colors ${
                                on ? 'bg-inverse text-on-inverse' : 'bg-surface text-fg-muted hover:bg-surface-raised'
                              }`}
                            >
                              {tr.name || t('addOns.editor.ticket', { defaultValue: 'Ticket' })}
                            </button>
                          )
                        })}
                      </div>
                      {d.tierIds.length === 0 && (
                        <div className="mt-1 text-caption text-fg-subtle">
                          {t('addOns.editor.anyTicket', { defaultValue: 'None selected: sold with any ticket.' })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <label className="flex min-h-10 items-center gap-2 text-meta text-fg-soft">
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={(e) => patch(d.id, { active: e.target.checked })}
                      className="h-4 w-4 accent-brand-500"
                    />
                    {t('addOns.editor.onSale', { defaultValue: 'On sale' })}
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded px-3 text-meta font-medium text-danger-soft transition-colors hover:bg-surface"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t('addOns.editor.remove', { defaultValue: 'Remove' })}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Quick starts for what Haitian organizers sell most; each prefills a row. */}
      <div className="flex flex-wrap gap-2 pt-1">
        {(Object.keys(ADD_ON_PRESETS) as AddOnPresetKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => add(key)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded bg-surface px-3 text-meta font-medium text-fg-soft transition-colors hover:bg-surface-raised"
          >
            <Plus className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
            {t(`addOns.presets.${key}`, { defaultValue: ADD_ON_PRESETS[key].name })}
          </button>
        ))}
        <button
          type="button"
          onClick={() => add()}
          className="inline-flex min-h-10 items-center gap-1.5 rounded bg-surface px-3 text-meta font-medium text-fg-soft transition-colors hover:bg-surface-raised"
        >
          <Plus className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
          {t('addOns.editor.add', { defaultValue: 'Other' })}
        </button>
      </div>
    </div>
  )
}
