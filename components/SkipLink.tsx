'use client'

/**
 * "Skip to content": the first stop for keyboard users (WCAG 2.4.1 bypass
 * blocks). Invisible until focused. Pages render their own navbar, so the
 * target is found at click time: the page's <main> when it has one, else the
 * first element after the navbar.
 */
import { useTranslation } from 'react-i18next'

export function findMainContent(doc: Document = document): HTMLElement | null {
  const main = doc.querySelector<HTMLElement>('#main-content, main, [role="main"]')
  if (main) return main
  let el: Element | null = doc.querySelector('body nav')
  while (el && !el.nextElementSibling) el = el.parentElement
  return (el?.nextElementSibling as HTMLElement | null) ?? null
}

export default function SkipLink() {
  const { t } = useTranslation('common')
  return (
    <a
      href="#main-content"
      onClick={(e) => {
        const target = findMainContent()
        if (!target) return
        e.preventDefault()
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
        target.scrollIntoView({ block: 'start' })
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded focus:bg-inverse focus:px-4 focus:py-2.5 focus:text-meta focus:font-semibold focus:text-on-inverse focus:shadow-2xl"
    >
      {t('a11y.skipToContent', { defaultValue: 'Skip to content' })}
    </a>
  )
}
