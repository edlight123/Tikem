'use client'

/**
 * The event page pieces for a community-shared event (lib/community):
 *  - CommunityCredit: "Shared by the community · From <organizer> · See the
 *    original", and "Is this your event? Claim it" while it is claimable.
 *  - CommunityTickets: in place of the buy button. Tikèm sells nothing for an
 *    event its organizer did not post (lib/tickets/purchasable refuses it), so
 *    it links out to the ticket link the member gave, or says so plainly.
 *  - CommunityPrice: what the member saw on the flyer, information only.
 * The source and ticket links are server-written and re-checked here
 * (http(s) only), so a planted javascript: link never renders.
 */
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { parseSourceUrl } from '@/lib/community/submissions'

export function CommunityCredit({ event, className = '' }: { event: Record<string, any>; className?: string }) {
  const { t } = useTranslation('common')
  const source = parseSourceUrl(event?.source_url)
  const name = typeof event?.source_name === 'string' ? event.source_name.trim() : ''
  return (
    <div className={`text-meta text-fg-muted ${className}`}>
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-fg/40" aria-hidden />
        <span>{t('community.event.shared')}</span>
        {name && (
          <>
            <span aria-hidden>·</span>
            <span className="text-fg">{t('community.event.from', { name })}</span>
          </>
        )}
        {source && (
          <>
            <span aria-hidden>·</span>
            <a href={source} target="_blank" rel="noopener noreferrer nofollow ugc" className="underline underline-offset-2 hover:text-fg">
              {t('community.event.source')}
            </a>
          </>
        )}
      </p>
      {event?.claimable === true && (
        <Link href={`/events/${event.id}/claim`} className="mt-2 inline-block underline underline-offset-2 hover:text-fg">
          {t('community.event.claim')}
        </Link>
      )}
    </div>
  )
}

export function CommunityTickets({ url, compact = false }: { url: string | null; compact?: boolean }) {
  const { t } = useTranslation('common')
  if (!url) {
    return (
      <div className="w-full rounded bg-surface px-4 py-3 text-center text-meta text-fg-muted">
        {t('community.event.not_sold')}
      </div>
    )
  }
  return (
    <div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="flex w-full items-center justify-center gap-2 rounded bg-inverse py-3 font-semibold text-on-inverse transition-colors hover:bg-inverse-hover"
      >
        {t('community.event.tickets_elsewhere')}
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </a>
      {!compact && <p className="mt-3 text-center text-xs text-fg-subtle">{t('community.event.tickets_elsewhere_note')}</p>}
    </div>
  )
}

export function communityPriceLabel(
  event: Record<string, any>,
  t: (k: string, o?: any) => string,
  numLocale: string
): string {
  if (event?.community_free === true) return t('common.free')
  const price = Number(event?.ticket_price)
  if (event?.community_free === false && Number.isFinite(price) && price > 0) {
    return `${event.currency || 'HTG'} ${price.toLocaleString(numLocale)}`
  }
  return t('community.event.price_unknown')
}

export function CommunityPrice({ event, numLocale }: { event: Record<string, any>; numLocale: string }) {
  const { t } = useTranslation('common')
  return (
    <div>
      <p className="font-grotesk text-3xl font-bold text-fg">{communityPriceLabel(event, t, numLocale)}</p>
      <p className="mt-1.5 text-meta text-fg-subtle">{t('community.event.price_note')}</p>
    </div>
  )
}
