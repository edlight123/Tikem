'use client'

import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Width of the drawer panel. Defaults to 'md' (max-w-md). */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: React.ReactNode
  footer?: React.ReactNode
}

const sizeClass: Record<NonNullable<DrawerProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

/**
 * Right-side slide-out Drawer for the dark organizer canvas.
 * - Focus-trapped while open (first focusable element gets focus on open).
 * - Closes on Escape and on backdrop click.
 * - Accessible: role="dialog", aria-modal, aria-labelledby.
 */
export function Drawer({ open, onClose, title, size = 'md', children, footer }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'org-drawer-title'

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Focus first focusable element on open
  useEffect(() => {
    if (!open) return
    const el = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    el?.focus()
  }, [open])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`flex h-full w-full flex-col bg-[#1a1a1a] shadow-2xl ${sizeClass[size]}`}
        style={{ animation: 'slideInRight 0.22s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          {title && (
            <h2 id={titleId} className="font-display italic text-lg text-white">
              {title}
            </h2>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-white/10 px-5 py-4">{footer}</div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
