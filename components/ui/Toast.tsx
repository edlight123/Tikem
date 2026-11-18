'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const noopShowToast: ToastContextType['showToast'] = () => {
  // Intentionally no-op
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fail-safe: some routes may not mount ToastProvider.
    // We prefer a no-op toast over crashing the entire app.
    return {
      showToast: noopShowToast,
    };
  }
  return context;
}

/* The icon is the ONLY thing that carries the variant.
   It used to be the surface: `bg-success/10` and friends are near-white tints
   (#F0FDF4, #FEF2F2, #FFFBEB) left over from the light theme, and the title on
   top of them was already `text-fg` — measured 1.05:1 against the fill, i.e.
   literally invisible, which is the "welcome back popup I cannot read" report.
   `info` was worse: a bulk find/replace had deleted its bg outright (the
   orphaned trailing space in `'border-brand-200 '`), so it was a transparent
   box with a mint hairline and the page showing straight through it.

   500-weight, not 600: the 600s were chosen to sit on a pale tint. On the dark
   surface below they drop to ~2.8:1 (warning) — the 500s clear 4.5:1. */
const toastIcons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 text-success-strong" />,
  error: <AlertCircle className="w-4 h-4 text-danger-strong" />,
  warning: <AlertTriangle className="w-4 h-4 text-warning-strong" />,
  info: <Info className="w-4 h-4 text-brand-400" />,
};

/* One surface for every variant. A toast FLOATS, so unlike a card it cannot use
   the `bg-surface-low` rung — 3% white is translucent and a poster underneath
   would read straight through it. #1c1c1c is the brief's named
   "elevated card / sheet (higher)" token: opaque, and a clear brightness step
   above the #0a0a0a page, which is how this app separates surfaces. No border —
   the fill does the separating (docs/POSH_DESIGN_BRIEF.md, "a fill, not a
   hairline"). */
const TOAST_SURFACE = 'bg-surface-raised-solid shadow-hard';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast = { ...toast, id };
    
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, toast.duration || 5000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/*
        Toast container.

        `bottom-4 right-4 max-w-md` was wrong on a phone in two ways: 448px of
        max-width does not fit in 402px, so the toast ran to 386px and touched
        the LEFT screen edge while keeping its 16px gap on the right; and a flat
        16px from the bottom put it underneath the mobile bottom nav, which
        reserves `--mobile-nav-h` (60px + safe-area) whenever it renders. Pinned
        to both edges it is symmetric on a phone, and the calc resolves to plain
        16px on every page that has no nav.
        z-[60] clears the nav's own z-50 rather than relying on DOM order.
      */}
      <div
        /* The live region has to be the always-mounted CONTAINER, not the toast:
           a screen reader only announces changes inside a region that already
           existed, so role="status" on a node that is itself being inserted
           announces nothing. */
        role="status"
        aria-live="polite"
        className="fixed left-4 right-4 z-[60] space-y-2 pointer-events-none
          bottom-[calc(1rem+var(--mobile-nav-h))]
          sm:left-auto sm:right-6 sm:bottom-6 sm:w-[380px]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`
              pointer-events-auto flex items-start gap-2.5 px-3.5 py-3
              rounded-3xl animate-slide-up
              ${TOAST_SURFACE}
            `}
          >
            <div className="flex-shrink-0 mt-0.5">
              {toastIcons[toast.type]}
            </div>

            <div className="flex-1 min-w-0">
              {/* Sizes stay at text-sm on purpose: `.mobile-typography h4/p` in
                  globals.css is (0,1,1) and overrides bare Tailwind sizes under
                  640px to exactly text-sm, so anything smaller would be silently
                  reverted — and 14px is the floor for body copy anyway. */}
              <h4 className="font-semibold text-fg text-sm">
                {toast.title}
              </h4>
              {toast.message && (
                <p className="text-sm text-fg-muted mt-0.5">
                  {toast.message}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss"
              className="flex-shrink-0 -mr-0.5 mt-0.5 text-fg-subtle hover:text-fg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
