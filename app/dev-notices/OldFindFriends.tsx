'use client'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Users } from 'lucide-react'
export function OldFindFriendsCard() {
  const { t } = useTranslation('profile')
  return (
    <section className="relative overflow-hidden rounded bg-surface p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.10),transparent_70%)]"
      />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-surface-raised text-fg-soft">
            <Users className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-400" />
          <span className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
            {"Friends"}
          </span>
        </div>
        <h2 className="mt-4 font-display lowercase italic !text-section !leading-snug text-fg">
          {"Find your people"}
        </h2>
        <p className="mt-1.5 max-w-lg !text-sm !leading-relaxed text-fg-muted">{"See who you know on Tik\u00e8m. More friends, better picks, and you can invite them to events."}</p>
        <Link
          href="/connections?tab=find"
          className="mt-4 inline-flex h-10 items-center gap-2 rounded bg-inverse px-5 text-meta font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/70"
        >
          {"Find friends"}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

