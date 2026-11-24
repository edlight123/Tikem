'use client'

import { useTranslation } from 'react-i18next'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Check, ExternalLink, Tag, Megaphone, Share2 } from 'lucide-react'
import { OrgEmptyState, StatusChip } from '@/components/organizer/ui'
import { useToast } from '@/components/ui/Toast'

interface PromoCode {
  id: string
  code: string
  discount_type: string
  discount_value: number
  uses: number
  max_uses: number | null
  is_active: boolean
}

interface EventMarketingClientProps {
  eventId: string
  eventTitle: string
  promoCodes: PromoCode[]
}

function discountLabel(type: string, value: number) {
  if (type === 'percentage') return `${value}% off`
  return `${value} off`
}

export default function EventMarketingClient({
  eventId,
  eventTitle,
  promoCodes,
}: EventMarketingClientProps) {
  const { t } = useTranslation('organizer')

  const { showToast } = useToast()
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const eventUrl = origin ? `${origin}/events/${eventId}` : `/events/${eventId}`

  const copyLink = async () => {
    const url = `${window.location.origin}/events/${eventId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast({ type: 'error', title: 'Couldn’t copy link', message: 'Copy it manually from the field.' })
    }
  }

  const socialLinks = [
    {
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodeURIComponent(`${eventTitle}, ${eventUrl}`)}`,
    },
    {
      label: 'X / Twitter',
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(eventTitle)}&url=${encodeURIComponent(eventUrl)}`,
    },
    {
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Share link */}
      <div className="rounded-2xl p-5 bg-surface">
        <div className="mb-4 flex items-center gap-2">
          <Share2 className="h-4 w-4 text-fg-muted" />
          <h2 className="font-display lowercase italic !text-section !leading-snug text-fg">{t('event_marketing.share_your_event')}</h2>
        </div>

        {/* URL row */}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 overflow-hidden rounded-xl px-4 py-3 text-sm text-fg-muted bg-surface">
            <ExternalLink className="h-4 w-4 shrink-0 text-fg-subtle" />
            <span className="truncate">{eventUrl || `/events/${eventId}`}</span>
          </div>
          <button
            type="button"
            onClick={copyLink}
            aria-label={t('event_marketing.copy_event_link')}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {copied ? <><Check className="h-4 w-4" />{t('event_marketing.copied')}</> : <><Copy className="h-4 w-4" />{t('event_marketing.copy_link')}</>}
          </button>
          <Link
            href={`/events/${eventId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded bg-surface-raised text-fg-muted transition-colors hover:bg-surface-high hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label={t('event_marketing.open_in_new_tab')}
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        {/* Social share */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="label-mono uppercase text-fg-muted">{t('event_marketing.share_on')}</span>
          {socialLinks.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-high hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* Promo codes. Empty: the heading and a quiet empty state on the
          canvas, no card around nothing and no explainer (owner, 2026-11-18). */}
      {promoCodes.length === 0 ? (
        <section>
          <h2 className="font-display lowercase italic !text-section !leading-snug text-fg">{t('event_marketing.promo_codes')}</h2>
          <OrgEmptyState
            variant="quiet"
            icon={Tag}
            title={t('event_marketing.no_promo_codes')}
            action={
              <Link
                href={`/organizer/promo-codes?eventId=${eventId}`}
                className="inline-flex items-center gap-2 rounded bg-inverse px-4 py-2.5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Tag className="h-4 w-4" />
                {t('event_marketing.create_promo_code')}
              </Link>
            }
          />
        </section>
      ) : (
      <div className="rounded-2xl bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display lowercase italic !text-section !leading-snug text-fg">{t('event_marketing.promo_codes')}</h2>
          <Link
            href={`/organizer/promo-codes?eventId=${eventId}`}
            className="inline-flex items-center gap-2 rounded bg-surface-raised px-4 py-2.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Tag className="h-4 w-4" />
            {t('event_marketing.create_code')}
          </Link>
        </div>

          <div className="divide-y divide-line-soft">
            {promoCodes.map((code) => (
              <div key={code.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-code font-semibold text-fg">{code.code}</span>
                    <StatusChip tone={code.is_active ? 'success' : 'neutral'}>
                      {code.is_active ? 'Active' : 'Inactive'}
                    </StatusChip>
                  </div>
                  <p className="mt-0.5 text-sm text-fg-subtle">
                    {discountLabel(code.discount_type, code.discount_value)}
                    {' · '}
                    {code.uses} use{code.uses !== 1 ? 's' : ''}
                    {code.max_uses != null ? ` / ${code.max_uses}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
      </div>
      )}

      {/* Promoters */}
      <div className="rounded-2xl p-5 bg-surface">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display lowercase italic !text-section !leading-snug text-fg">{t('event_marketing.promoters')}</h2>
          <Link
            href={`/organizer/events/${eventId}/promoters`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded bg-surface-raised px-4 py-2.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {t('event_marketing.manage_promoters')}
          </Link>
        </div>
      </div>

      {/* SMS campaigns, coming soon: one quiet row, not a big card with an
          explainer (owner, 2026-11-18: "avoid big cards"). */}
      <div className="flex items-center gap-3 px-1 text-sm">
        <Megaphone className="h-4 w-4 text-fg-subtle" strokeWidth={1.5} />
        <span className="font-semibold text-fg-muted">{t('event_marketing.sms_campaigns')}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
          <span className="h-1.5 w-1.5 rounded-full bg-fg/30" aria-hidden />
          {t('actions.coming_soon')}
        </span>
      </div>
    </div>
  )
}
