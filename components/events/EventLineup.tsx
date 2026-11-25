'use client'

import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import {
  lineupEntryFromRecord,
  lineupLinkLabel,
  lineupTimeRange,
  safeLineupLink,
} from '@/lib/lineup'

/**
 * The bill, on the public event page.
 *
 * Until now the lineup an organizer typed was written to the event doc and
 * rendered nowhere — so this is the reader for it. Each act gets a face, a
 * name, its role, its set window and a line about it, and the whole entry is a
 * link out when the organizer attached one.
 *
 * Every field past the name is optional, and each one degrades on its own: no
 * photo falls back to the initial, no link renders as static text, no set time
 * simply omits the time column. An event with four bare names still reads as a
 * clean list rather than a grid of empty slots.
 *
 * Renders nothing at all when there is no lineup, so the section never appears
 * as an empty heading.
 */
export default function EventLineup({
  guestlist,
  className = '',
  twelveHour = false,
}: {
  guestlist: unknown
  className?: string
  /** A Haiti event: set times read "8:00 PM", never "20:00". */
  twelveHour?: boolean
}) {
  const { t } = useTranslation('common')

  if (!Array.isArray(guestlist)) return null
  const entries = guestlist.map(lineupEntryFromRecord).filter((g) => g.name.trim())
  if (entries.length === 0) return null

  return (
    <section className={className}>
      <h2 className="mb-4 font-display lowercase italic !text-section !leading-snug text-fg">
        {t('events.lineup', { defaultValue: 'lineup' })}
      </h2>

      <ul className="space-y-1">
        {entries.map((g) => {
          const href = safeLineupLink(g.link)
          const when = lineupTimeRange(g.startTime, g.endTime, twelveHour)

          const body = (
            <>
              {g.photoUrl ? (
                // Not next/image: these are organizer-supplied URLs from any of
                // several hosts, and a remotePattern miss would 500 the optimizer
                // and blank the row. A plain img just loads it.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.photoUrl}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-line"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface text-lg font-bold text-fg-muted ring-1 ring-line"
                >
                  {g.name.trim().charAt(0).toUpperCase()}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-semibold text-fg">{g.name}</span>
                  {href && (
                    <ExternalLink
                      className="h-3.5 w-3.5 shrink-0 translate-y-[1px] text-fg-subtle transition-colors group-hover:text-fg-soft"
                      aria-hidden
                    />
                  )}
                </span>

                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-fg-subtle">
                  <span>{t(`composer.roles.${g.role}`, { defaultValue: g.role })}</span>
                  {when && (
                    <>
                      <span aria-hidden className="text-fg-faint">
                        ·
                      </span>
                      <span className="tabular-nums">{when}</span>
                    </>
                  )}
                </span>

                {g.description && (
                  <span className="mt-1.5 block max-w-[60ch] text-sm leading-relaxed text-fg-muted">
                    {g.description}
                  </span>
                )}

                {/* The link shown as text, so it is legible on a surface where
                    hover doesn't exist and the icon alone says nothing. */}
                {href && (
                  <span className="mt-1 block truncate text-caption text-fg-subtle">
                    {lineupLinkLabel(href)}
                  </span>
                )}
              </span>
            </>
          )

          const row = 'group flex items-start gap-4 rounded-xl px-2 py-3 -mx-2'

          return (
            <li key={g.id}>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={`${row} transition-colors hover:bg-surface-low`}
                >
                  {body}
                </a>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
