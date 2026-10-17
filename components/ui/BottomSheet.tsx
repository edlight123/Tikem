'use client'

import { useEffect, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  showCloseButton?: boolean
}

export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
}: BottomSheetProps) {
  const { t } = useTranslation('common')
  // Portal target. Rendered only after mount so the server pass and the first
  // client pass agree (document does not exist during SSR).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (!isOpen || !mounted) return null

  /**
   * Portalled to <body>, and it has to be.
   *
   * A `position: fixed` element is positioned against the viewport ONLY if no
   * ancestor creates a containing block. On the mobile event page this sheet is
   * rendered inside the sticky buy bar, which carries `backdrop-blur` — and a
   * backdrop-filter creates a containing block just like a transform does. So
   * `inset-0` resolved against a 68px-tall bar partway down the page: the sheet
   * appeared mid-page with content showing below it, and near the navbar at the
   * top. Height fixes (dvh) could not help, because the problem was the origin,
   * not the size.
   *
   * A portal removes the whole class of bug: no caller's wrapper can capture
   * this sheet, whatever filters or transforms it grows later.
   */
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 h-[100dvh] bg-black/50 z-[100] transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container.
          A true bottom sheet on phones, a centred dialog from `sm` up.
          Centred at 85vh on a phone put the panel's top edge at roughly 60px,
          which is exactly where the sticky navbar sits, so the header tucked
          under it and the whole sheet read as mispositioned. Anchoring to the
          bottom edge keeps it clear of the navbar entirely and is the gesture
          people already expect from a sheet. */}
      <div
        className="fixed inset-0 z-[101] flex h-[100dvh] items-end justify-center p-0 sm:items-center sm:p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {/* OPAQUE, and it must stay opaque: this panel floats over page content
            (the fixed parent above), so a translucent fill lets the page show
            straight through the sheet, text over text. That is exactly what
            happened when a surface sweep treated it as a card, which broke
            guest checkout. #1c1c1c (the sheet token) lifts it off the page's own black. */}
        <div className="bg-[#1c1c1c] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] sm:max-h-[85vh] flex flex-col">
          {/* Header */}
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10 flex-shrink-0">
              {title && (
                <h3 className="text-lg font-bold text-white">{title}</h3>
              )}
              {showCloseButton && (
                <button
                  onClick={onClose}
                  aria-label={t('common.close', { defaultValue: 'Close' })}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-white/[0.04] transition-colors ml-auto sm:h-9 sm:w-9"
                >
                  <X className="w-5 h-5 text-white/50" />
                </button>
              )}
            </div>
          )}

          {/* Content. The extra bottom padding on phones clears the home
              indicator, so the last control in a sheet is never sitting under
              the gesture bar. */}
          <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
            {children}
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
