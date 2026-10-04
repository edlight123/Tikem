'use client'

import Link from 'next/link'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import { Instagram } from 'lucide-react'

// Tikèm's own accounts, and the studio that builds it. EdLight Labs is the
// technology division of EdLight Initiative, not a separate company.
const INSTAGRAM_URL = 'https://www.instagram.com/tikem.co/'
const EDLIGHT_LABS_URL = 'https://www.edlight.org/labs'

interface FooterLink {
  href: string
  label: string
}

/**
 * Site footer for public routes. Dark, POSH-styled: near-black canvas, hairline
 * top border, muted text, teal reserved for a sparing hover accent. Rendered
 * once from the root layout; it hides itself on the admin surface (which has its
 * own chrome) so it never double-renders there.
 */
export default function Footer() {
  const pathname = usePathname()
  const { t } = useTranslation('common')

  // Admin has its own shell (AdminSidebar) — keep the public footer out of it.
  if (pathname?.startsWith('/admin')) {
    return null
  }

  const year = new Date().getFullYear()
  const builtBy = t('footer.built_by', { labs: '%LABS%', defaultValue: 'Built by {{labs}}' }).split('%LABS%')

  const discoverLinks: FooterLink[] = [
    { href: '/discover', label: t('nav.home', { defaultValue: 'Events' }) },
    { href: '/resources', label: t('nav.resources', { defaultValue: 'Guides' }) },
    { href: '/platform', label: t('nav.platform', { defaultValue: 'Platform' }) },
  ]

  const companyLinks: FooterLink[] = [
    // The vision page belongs under Company, above support and the legal
    // links: it is the "who are you and why" answer, not a help article.
    { href: '/vision', label: t('footer.vision', { defaultValue: 'Vision' }) },
    { href: '/support', label: t('footer.support', { defaultValue: 'Support' }) },
    { href: '/legal/privacy', label: t('footer.privacy', { defaultValue: 'Privacy' }) },
    { href: '/legal/terms', label: t('footer.terms', { defaultValue: 'Terms' }) },
    { href: '/legal/refunds', label: t('footer.refunds', { defaultValue: 'Refunds' }) },
  ]

  const linkClass =
    'text-sm text-white/60 transition-colors duration-200 hover:text-brand-300'

  return (
    <footer
      aria-label={t('footer.landmark', { defaultValue: 'Site footer' })}
      className="bg-[#0a0a0a]"
    >
      <div className="mx-auto max-w-7xl px-4 pb-[calc(3rem+var(--mobile-nav-h))] pt-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-2 md:grid-cols-4">
          {/* Brand + tagline + the diaspora, written into the identity */}
          <div className="col-span-2 md:col-span-2">
            <Link href="/" className="inline-flex items-center">
              <TikemWordmark className="text-[28px] text-white" />
            </Link>
            <p className="mt-3 font-display lowercase italic text-[17px] text-white/60">
              {t('footer.tagline_short', { defaultValue: 'where Haiti goes out.' })}
            </p>
            <p className="mt-4 max-w-sm text-[11px] font-medium uppercase tracking-[0.16em] leading-relaxed text-white/35">
              Port-au-Prince · Cap-Haïtien · Miami · New York · Montréal · Paris
            </p>
            {/* Language sits here, under the cities, rather than in the bottom
                row where it first went: the app-install banner is
                `fixed inset-x-4 bottom-4` and covers that row on a phone
                until it is dismissed, so a control put there is invisible to
                exactly the first-time visitor most likely to need it. Beside
                the places we cover is also simply where a reader looks. */}
            <LanguageSwitcher className="mt-6 -ml-1.5" />
          </div>

          {/* Discover column */}
          <nav aria-label={t('footer.discover', { defaultValue: 'Discover' })}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
              {t('footer.discover', { defaultValue: 'Discover' })}
            </h2>
            <ul className="mt-4 space-y-3">
              {discoverLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Company / legal column */}
          <nav aria-label={t('footer.company', { defaultValue: 'Company' })}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
              {t('footer.company', { defaultValue: 'Company' })}
            </h2>
            <ul className="mt-4 space-y-3">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Bottom row: copyright, then where to follow us and who builds it. */}
        <div className="mt-14 flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/40">
            {t('footer.copyright', { year, defaultValue: '© {{year}} Tikèm' })}
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-white/40">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('footer.instagram', { defaultValue: 'Tikèm on Instagram' })}
              className="inline-flex items-center gap-1.5 text-white/60 transition-colors duration-200 hover:text-brand-300"
            >
              <Instagram size={14} aria-hidden="true" />
              @tikem.co
            </a>
            {/* One translatable sentence; the brand name is spliced in as a link
                so each language can put it where its grammar wants it. */}
            <span>
              {builtBy[0]}
              <a
                href={EDLIGHT_LABS_URL}
                target="_blank"
                rel="noopener"
                className="text-white/60 transition-colors duration-200 hover:text-brand-300"
              >
                EdLight Labs
              </a>
              {builtBy[1]}
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
