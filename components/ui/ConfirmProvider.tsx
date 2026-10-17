'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ConsoleButton } from '@/components/admin/console'

export interface ConfirmOptions {
  title: string
  /** Supporting copy: state the impact and the affected record. */
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' = red destructive confirm; 'default' = filled primary. */
  variant?: 'default' | 'danger'
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Console-styled confirmation dialog (Control Room): panel elevation on a dim
 * backdrop, mono-caps title, and the console button set. Focus-trapped enough
 * for a two-button dialog — Esc cancels, cancel takes initial focus.
 */
function ConsoleConfirmDialog({
  open,
  loading,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  tone = 'console',
}: {
  tone?: 'console' | 'posh'
  open: boolean
  loading?: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = 'console-confirm-title'
  const descId = 'console-confirm-desc'

  // Esc to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Focus cancel on open (safer default for destructive dialogs)
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />

      {/* Dialog */}
      {tone === 'posh' ? (
        // Public-site dialog (POSH): sheet fill, serif title, pill buttons.
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          className="relative w-full max-w-sm rounded-2xl bg-[#1c1c1c] p-6 shadow-2xl"
        >
          <h2 id={titleId} className="font-display text-[26px] lowercase leading-tight text-white">
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-2 text-sm leading-relaxed text-white/60">
              {description}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              ref={cancelRef}
              type="button"
              onClick={onClose}
              disabled={loading}
              className="h-11 rounded-full bg-white/[0.07] px-5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={
                variant === 'danger'
                  ? 'h-11 rounded-full bg-red-500/15 px-5 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/25 disabled:opacity-50'
                  : 'h-11 rounded-full bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50'
              }
            >
              {loading ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      ) : (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="relative w-full max-w-sm rounded-lg bg-console-panel p-6 shadow-xl"
      >
        <h2
          id={titleId}
          className="label-mono text-[13px] font-bold uppercase tracking-[0.14em] text-console-text"
        >
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-2 text-sm text-console-mut">
            {description}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <ConsoleButton ref={cancelRef} type="button" variant="quiet" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </ConsoleButton>
          <ConsoleButton
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Working…' : confirmLabel}
          </ConsoleButton>
        </div>
      </div>
      )}
    </div>
  )
}

/**
 * Promise-based confirmation provider. Renders the console confirmation dialog
 * and exposes `useConfirm()` returning `confirm(options) => Promise<boolean>`, a
 * drop-in replacement for `window.confirm` for destructive admin actions.
 *
 *   const confirmDialog = useConfirm()
 *   if (!(await confirmDialog({ title: 'Ban organizer?', variant: 'danger' }))) return
 */
/**
 * `tone="posh"` renders the public-site dialog (organizer pages); the default
 * stays the admin console's.
 */
export function ConfirmProvider({
  children,
  tone = 'console',
}: {
  children: React.ReactNode
  tone?: 'console' | 'posh'
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions>({ title: '' })
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    const normalized = typeof options === 'string' ? { title: options } : options
    setOpts(normalized)
    setPending(false)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((result: boolean) => {
    setOpen(false)
    setPending(false)
    const r = resolver.current
    resolver.current = null
    r?.(result)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConsoleConfirmDialog
        tone={tone}
        open={open}
        loading={pending}
        onClose={() => settle(false)}
        onConfirm={() => settle(true)}
        title={opts.title}
        description={opts.description}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        variant={opts.variant}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // Fallback so a missing provider never breaks a destructive guard.
    return async (options) => {
      if (typeof window === 'undefined') return false
      const o = typeof options === 'string' ? { title: options } : options
      return window.confirm([o.title, o.description].filter(Boolean).join('\n\n'))
    }
  }
  return ctx
}
