'use client'

import Link from 'next/link'
import { BarChart3, Tag, QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function QuickLinksBar() {
  const { t } = useTranslation('organizer')

  const links = [
    { href: '/organizer/analytics', label: t('events_page.analytics'), icon: BarChart3 },
    { href: '/organizer/promo-codes', label: t('events_page.promo_codes'), icon: Tag },
    { href: '/organizer/scan', label: t('events_page.scan_tickets'), icon: QrCode },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="relative inline-flex items-center gap-1.5 rounded bg-white/[0.06] px-2.5 py-1.5 text-[13px] font-medium leading-[18px] text-white/70 transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] hover:bg-white/[0.12] hover:text-white"
        >
          <Icon className="h-4 w-4 text-brand-300" />
          {label}
        </Link>
      ))}
    </div>
  )
}
