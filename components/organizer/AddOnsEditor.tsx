'use client'

/**
 * The composer's "Add-ons" section: extras sold alongside tickets (a meal, a
 * T-shirt in sizes, parking, a book, raffle entries). Compact cards; tap one
 * to edit it in place, Done folds it back. The parent owns the drafts and
 * saves them with the event (lib/addons/editor.ts → events.add_ons; the stored
 * shape and field names are unchanged: sales_start / sales_end ISO instants,
 * tier_ids = ticket_tiers doc ids).
 *
 * A ticket restriction can name a ticket row that is not saved yet (its local
 * row id); the composer swaps it for the doc id once the tiers are written.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import ImageUpload from '@/components/ImageUpload'
import { DateTimeLocalField } from '@/components/ui/DateTimeField'
import { draftProblem, emptyAddOnDraft, parseOptionList, type AddOnDraft } from '@/lib/addons/editor'
import { MAX_ADD_ON_OPTIONS, ADD_ON_OPTION_MAX } from '@/lib/addons/addOns'

export interface AddOnsEditorTier {
  /** The row's local id (always set): what an unsaved ticket is referenced by. */
  key: string
  /** The saved ticket_tiers doc id, once the row is saved. */
  docId?: string
  name: string
}

const inputCls =
  'w-full rounded bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none focus:bg-surface-high'
const labelCls = 'mb-1.5 block text-xs font-medium text-fg-muted'
const hintCls = 'mt-1 block text-xs text-fg-faint'

export default function AddOnsEditor({
  drafts,
  onChange,
  tiers,
  currency,
  uploadEndpoint,
}: {
  drafts: AddOnDraft[]
  onChange: (next: AddOnDraft[]) => void
  tiers: AddOnsEditorTier[]
  currency: string
  uploadEndpoint?: string
}) {
  const { t } = useTranslation('events')
  const [openId, setOpenId] = useState<string | null>(null)
  const [optionText, setOptionText] = useState('')
  const [showProblem, setShowProblem] = useState(false)

  const patch = (id: string, p: Partial<AddOnDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...p } : d)))
  const remove = (id: string) => onChange(drafts.filter((d) => d.id !== id))
  const add = () => {
    const d = emptyAddOnDraft()
    onChange([...drafts, d])
    setOpenId(d.id)
    setOptionText('')
    setShowProblem(false)
  }
  const toggleOpen = (id: string) => {
    setOpenId(openId === id ? null : id)
    setOptionText('')
    setShowProblem(false)
  }
  const done = (d: AddOnDraft) => {
    if (draftProblem(d) || !d.name.trim()) {
      setShowProblem(true)
      return
    }
    setOpenId(null)
    setShowProblem(false)
  }

  const problemText = (p: ReturnType<typeof draftProblem> | 'name') =>
    p === 'name'
      ? t('addOns.editor.needsName', { defaultValue: 'Give this add-on a name.' })
      : p === 'price'
        ? t('addOns.editor.needsPrice', { defaultValue: 'Add-ons are paid items: set a price above 0.' })
        : p === 'window'
          ? t('addOns.editor.badWindow', { defaultValue: 'Sales must end after they start.' })
          : ''

  const addOption = (d: AddOnDraft) => {
    const list = parseOptionList(d.options)
    const next = optionText.replace(/,/g, ' ').trim().slice(0, ADD_ON_OPTION_MAX)
    if (!next || list.length >= MAX_ADD_ON_OPTIONS) return
    if (!list.some((o) => o.toLowerCase() === next.toLowerCase())) patch(d.id, { options: [...list, next].join(', ') })
    setOptionText('')
  }
  const removeOption = (d: AddOnDraft, opt: string) =>
    patch(d.id, { options: parseOptionList(d.options).filter((o) => o !== opt).join(', ') })

  return (
    <div className="space-y-2">
      {drafts.length === 0 && (
        <p className="text-sm text-fg-subtle">
          {t('addOns.editor.empty', {
            defaultValue: 'Sell extras with tickets: meals, merch, parking, books or raffle entries.',
          })}
        </p>
      )}

      {drafts.map((d) => {
        const open = openId === d.id
        const options = parseOptionList(d.options)
        const problem = draftProblem(d) || (open && showProblem && !d.name.trim() ? 'name' : null)
        return (
          <div key={d.id} className="rounded bg-surface-low">
            <button
              type="button"
              onClick={() => toggleOpen(d.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-start"
              aria-expanded={open}
            >
              {d.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface">
                  <ShoppingBag className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">
                  {d.name.trim() || t('addOns.editor.untitled', { defaultValue: 'New add-on' })}
                </span>
                <span className="block truncate text-xs text-fg-subtle">
                  {[
                    Number(d.price) > 0 ? `${Number(d.price).toLocaleString()} ${currency}` : null,
                    d.quantity
                      ? t('addOns.editor.stockCount', { defaultValue: '{{count}} available', count: Number(d.quantity) })
                      : t('addOns.editor.unlimited', { defaultValue: 'Unlimited' }),
                    options.length > 0 ? options.join(' · ') : null,
                    !d.active ? t('addOns.editor.hiddenBadge', { defaultValue: 'Hidden' }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {problem && (!open || showProblem) && (
                  <span className="mt-0.5 block text-xs text-danger-soft">{problemText(problem)}</span>
                )}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {open && (
              <div className="space-y-4 px-3 pb-3 pt-1">
                {/* Name and price */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.name', { defaultValue: 'Name' })}</span>
                    <input
                      className={inputCls}
                      value={d.name}
                      maxLength={60}
                      autoFocus={!d.name}
                      placeholder={t('addOns.editor.namePlaceholder', { defaultValue: 'Iftar meal, T-shirt, Parking…' })}
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
                      placeholder="0.00"
                      onChange={(e) => patch(d.id, { price: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className={labelCls}>
                    {t('addOns.editor.description', { defaultValue: 'Description (optional)' })}
                  </span>
                  <textarea
                    className={`${inputCls} min-h-[64px]`}
                    value={d.description}
                    maxLength={240}
                    placeholder={t('addOns.editor.descriptionPlaceholder', { defaultValue: 'What it is, and how buyers get it.' })}
                    onChange={(e) => patch(d.id, { description: e.target.value })}
                  />
                </label>

                <div>
                  <span className={labelCls}>{t('addOns.editor.photo', { defaultValue: 'Photo (optional)' })}</span>
                  <ImageUpload
                    compact
                    variant="square"
                    currentImage={d.imageUrl || null}
                    endpoint={uploadEndpoint}
                    onImageUploaded={(url) => patch(d.id, { imageUrl: url })}
                  />
                </div>

                {/* Options as chips */}
                <div>
                  <span className={labelCls}>{t('addOns.editor.options', { defaultValue: 'Options (optional)' })}</span>
                  {options.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {options.map((o) => (
                        <span key={o} className="inline-flex items-center gap-1 rounded bg-surface py-1 pl-3 pr-1 text-xs font-medium text-fg">
                          {o}
                          <button
                            type="button"
                            onClick={() => removeOption(d, o)}
                            aria-label={t('addOns.editor.removeOption', { defaultValue: 'Remove {{name}}', name: o })}
                            className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-surface-high hover:text-fg"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {options.length < MAX_ADD_ON_OPTIONS && (
                    <div className="flex gap-2">
                      <input
                        className={inputCls}
                        value={optionText}
                        maxLength={ADD_ON_OPTION_MAX}
                        placeholder={t('addOns.editor.optionPlaceholder', { defaultValue: 'Add an option, like S or M' })}
                        onChange={(e) => setOptionText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault()
                            addOption(d)
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => addOption(d)}
                        disabled={!optionText.trim()}
                        className="inline-flex shrink-0 items-center gap-1 rounded bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-high disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {t('addOns.editor.optionAdd', { defaultValue: 'Add' })}
                      </button>
                    </div>
                  )}
                  <span className={hintCls}>
                    {t('addOns.editor.optionsChipHint', { defaultValue: 'Buyers pick one. Every option shares the stock.' })}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelCls}>{t('addOns.editor.quantity', { defaultValue: 'Total available' })}</span>
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

                {/* Sales window: the same date-time control as the event's own dates. */}
                <div className="space-y-3">
                  <div>
                    <span className={labelCls}>{t('addOns.editor.salesStart', { defaultValue: 'Sales start (optional)' })}</span>
                    <DateTimeLocalField
                      value={d.salesStart}
                      onChange={(v) => patch(d.id, { salesStart: v })}
                      defaultTime="09:00"
                      clearLabel={t('addOns.editor.clearDate', { defaultValue: 'Clear' })}
                      datePlaceholder={t('addOns.editor.pickDate', { defaultValue: 'Pick a date' })}
                      timePlaceholder={t('addOns.editor.pickTime', { defaultValue: 'Time' })}
                    />
                    <span className={hintCls}>
                      {t('addOns.editor.salesStartHint', { defaultValue: 'Empty: on sale as soon as the event is.' })}
                    </span>
                  </div>
                  <div>
                    <span className={labelCls}>{t('addOns.editor.salesEnd', { defaultValue: 'Sales end (optional)' })}</span>
                    <DateTimeLocalField
                      value={d.salesEnd}
                      onChange={(v) => patch(d.id, { salesEnd: v })}
                      min={d.salesStart ? d.salesStart.slice(0, 10) : undefined}
                      invalid={draftProblem(d) === 'window'}
                      defaultTime="23:59"
                      clearLabel={t('addOns.editor.clearDate', { defaultValue: 'Clear' })}
                      datePlaceholder={t('addOns.editor.pickDate', { defaultValue: 'Pick a date' })}
                      timePlaceholder={t('addOns.editor.pickTime', { defaultValue: 'Time' })}
                    />
                    <span className={hintCls}>
                      {t('addOns.editor.salesEndHint', { defaultValue: 'Empty: on sale until the event starts.' })}
                    </span>
                  </div>
                </div>

                {/* Ticket restriction: checkboxes, saved or not */}
                <fieldset>
                  <legend className={labelCls}>{t('addOns.editor.onlyWith', { defaultValue: 'Only with these tickets' })}</legend>
                  {tiers.length === 0 ? (
                    <p className="text-xs text-fg-faint">
                      {t('addOns.editor.noTickets', {
                        defaultValue: 'Add a ticket type first to limit this add-on to it. Until then, it sells with any ticket.',
                      })}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {tiers.map((tr) => {
                        const refs = [tr.key, tr.docId].filter(Boolean) as string[]
                        const on = d.tierIds.some((x) => refs.includes(x))
                        return (
                          <label key={tr.key} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm text-fg hover:bg-surface">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                patch(d.id, {
                                  tierIds: on ? d.tierIds.filter((x) => !refs.includes(x)) : [...d.tierIds, tr.docId || tr.key],
                                })
                              }
                              className="h-4 w-4 accent-brand-500"
                            />
                            {tr.name.trim() || t('addOns.editor.ticket', { defaultValue: 'Ticket' })}
                          </label>
                        )
                      })}
                      <p className="px-2 text-xs text-fg-faint">
                        {t('addOns.editor.anyTicket', { defaultValue: 'None selected: sold with any ticket.' })}
                      </p>
                    </div>
                  )}
                </fieldset>

                {/* On sale */}
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded bg-surface-low px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-medium text-fg">{t('addOns.editor.onSale', { defaultValue: 'On sale' })}</span>
                    <span className="block text-xs text-fg-faint">
                      {t('addOns.editor.onSaleHint', { defaultValue: 'Turn off to hide it without deleting it.' })}
                    </span>
                  </span>
                  <span className="relative inline-flex shrink-0">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={d.active}
                      onChange={(e) => patch(d.id, { active: e.target.checked })}
                      className="peer sr-only"
                    />
                    <span className="h-6 w-10 rounded-full bg-surface-high transition-colors peer-checked:bg-brand-500" aria-hidden="true" />
                    <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-inverse shadow-sm transition-transform peer-checked:translate-x-4" aria-hidden="true" />
                  </span>
                </label>

                {showProblem && problem && <p className="text-sm text-danger-soft" role="alert">{problemText(problem)}</p>}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    className="inline-flex items-center gap-1.5 rounded px-2.5 py-2 text-sm font-medium text-danger-soft hover:bg-danger-strong/10"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t('addOns.editor.remove', { defaultValue: 'Remove' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => done(d)}
                    className="inline-flex h-10 items-center gap-1.5 rounded bg-inverse px-5 text-sm font-semibold text-on-inverse hover:opacity-90"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {t('addOns.editor.done', { defaultValue: 'Done' })}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-2 rounded bg-surface px-3 py-2 text-sm font-medium text-fg-soft hover:bg-surface-high"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('addOns.editor.add', { defaultValue: 'Add an add-on' })}
      </button>
    </div>
  )
}
