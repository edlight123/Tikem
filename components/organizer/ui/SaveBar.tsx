'use client'

import { useTranslation } from 'react-i18next'

import React, { useEffect } from 'react'
import { ConfirmationDialog } from './ConfirmationDialog'

interface SaveBarProps {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  saveLabel?: string
  discardLabel?: string
}

/**
 * Fixed bottom bar that appears when a form has unsaved changes.
 * Animates in from the bottom; invisible when `dirty` is false.
 */
export function SaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  saveLabel = 'Save changes',
  discardLabel = 'Discard',
}: SaveBarProps) {
  const { t } = useTranslation('organizer')

  if (!dirty) return null

  return (
    <div
      role="region"
      aria-label={t('save_bar.unsaved_changes')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0a0a0a]/95 px-4 py-3 backdrop-blur-md sm:px-6"
      style={{ animation: 'slideUp 0.2s ease-out' }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <p className="text-sm text-white/60">{t('save_bar.unsaved_short')}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          >
            {discardLabel}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded bg-white px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}

interface UnsavedChangesPromptProps {
  dirty: boolean
  onStay: () => void
  onLeave: () => void
}

/**
 * Confirmation dialog shown when the user tries to navigate away with dirty state.
 * The caller is responsible for detecting the navigation intent and opening this.
 */
export function UnsavedChangesPrompt({
  dirty,
  onStay,
  onLeave,
}: UnsavedChangesPromptProps) {
  const { t } = useTranslation('organizer')

  // Warn on browser tab close / refresh
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  return (
    <ConfirmationDialog
      open={dirty}
      onClose={onStay}
      onConfirm={onLeave}
      title={t('save_bar.discard_changes_q')}
      description={t('save_bar.unsaved_leave_warning')}
      confirmLabel="Discard & leave"
      cancelLabel="Stay on page"
      variant="danger"
    />
  )
}
