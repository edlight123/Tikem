'use client'

import type { KeyboardEvent, RefObject } from 'react'
import { Bold, Italic, List, ListOrdered } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { continueList, toggleList, toggleWrap, type EditResult, type Selection } from '@/lib/richText'

/**
 * Bold / italic / bullets / numbers for a plain <textarea> holding an event
 * description. The text stays the light markdown lib/richText reads, so
 * nothing but a string is ever saved.
 */

type Edit = (text: string, sel: Selection) => EditResult

function applyEdit(el: HTMLTextAreaElement | null, value: string, onChange: (v: string) => void, edit: Edit) {
  const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : { start: value.length, end: value.length }
  const r = edit(value, sel)
  onChange(r.text)
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(r.selection.start, r.selection.end)
  })
}

/** onChange for the textarea: continues a list when Enter ends a list line. */
export function richTextareaChange(
  el: HTMLTextAreaElement,
  prev: string,
  next: string,
  onChange: (v: string) => void,
) {
  const r = continueList(prev, next)
  if (!r) return onChange(next)
  onChange(r.text)
  requestAnimationFrame(() => el.setSelectionRange(r.selection.start, r.selection.end))
}

/** onKeyDown for the textarea: Cmd/Ctrl+B and Cmd/Ctrl+I. */
export function richTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, value: string, onChange: (v: string) => void) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
  const k = e.key.toLowerCase()
  if (k !== 'b' && k !== 'i') return
  e.preventDefault()
  applyEdit(e.currentTarget, value, onChange, (t, s) => toggleWrap(t, s, k === 'b' ? '**' : '*'))
}

export default function FormattingToolbar({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation('common')
  const buttons: { key: string; label: string; Icon: typeof Bold; edit: Edit }[] = [
    { key: 'bold', label: t('composer.format.bold', { defaultValue: 'Bold' }), Icon: Bold, edit: (s, sel) => toggleWrap(s, sel, '**') },
    { key: 'italic', label: t('composer.format.italic', { defaultValue: 'Italic' }), Icon: Italic, edit: (s, sel) => toggleWrap(s, sel, '*') },
    { key: 'bullets', label: t('composer.format.bullets', { defaultValue: 'Bulleted list' }), Icon: List, edit: (s, sel) => toggleList(s, sel, 'bullet') },
    { key: 'numbers', label: t('composer.format.numbers', { defaultValue: 'Numbered list' }), Icon: ListOrdered, edit: (s, sel) => toggleList(s, sel, 'number') },
  ]
  return (
    <div
      role="toolbar"
      aria-label={t('composer.format.toolbar', { defaultValue: 'Text formatting' })}
      className="mb-1.5 flex items-center gap-1"
    >
      {buttons.map(({ key, label, Icon, edit }) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          // Keep the textarea's selection: a mousedown on the button would blur it first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyEdit(textareaRef.current, value, onChange, edit)}
          className="flex h-8 w-8 items-center justify-center rounded-[4px] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        </button>
      ))}
    </div>
  )
}
