'use client'

/**
 * Modal dialog keyboard behaviour (WCAG 2.1.2 no keyboard trap, 2.4.3 focus
 * order; the ARIA dialog pattern) in one hook. While `active`:
 *  - focus moves into the dialog (the `initialFocus` control, else the first
 *    focusable, else the panel itself);
 *  - Tab and Shift+Tab cycle inside it;
 *  - Escape calls `onEscape`;
 *  - on close, focus returns to whatever opened it.
 *
 * Used by components/ui/BottomSheet and the shared Modal in components/ui/kit.
 */

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The keyboard-reachable controls inside `root`, in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  // Skip controls that are hidden, inert or out of the a11y tree. The layout
  // check (display:none descendants) only runs where layout exists (not jsdom).
  const hasLayout = root.getClientRects().length > 0
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
      (!hasLayout || el.getClientRects().length > 0 || el === document.activeElement)
  )
}

export interface DialogFocusOptions {
  onEscape?: () => void
  initialFocus?: RefObject<HTMLElement | null>
  /** Move focus in on open (default true). */
  autoFocus?: boolean
}

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: DialogFocusOptions = {}
): void {
  const onEscapeRef = useRef(options.onEscape)
  onEscapeRef.current = options.onEscape
  const { initialFocus, autoFocus = true } = options

  useEffect(() => {
    if (!active) return
    const opener = document.activeElement as HTMLElement | null

    const timer = window.setTimeout(() => {
      const root = ref.current
      if (!root || !autoFocus) return
      if (root.contains(document.activeElement)) return
      const target = initialFocus?.current || focusableIn(root)[0] || root
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }, 0)

    const onKeyDown = (e: KeyboardEvent) => {
      const root = ref.current
      if (!root) return
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.stopPropagation()
        onEscapeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(root)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement as HTMLElement | null
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      // Give focus back to the opener if it is still on the page.
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        window.setTimeout(() => opener.focus({ preventScroll: true }), 0)
      }
    }
  }, [active, ref, initialFocus, autoFocus])
}
