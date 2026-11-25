'use client'

/**
 * The add-ons bought with an order (lib/addons/addOns.ts), on the buyer's
 * ticket. They live on the order's first ticket; the order's other tickets
 * carry `add_ons_ticket_id` and show a one-line note instead.
 *
 * Compact rows on a fill; state is a dot + label, never a filled pill.
 */
import { useTranslation } from 'react-i18next'
import { ticketAddOns } from '@/lib/addons/addOns'

export default function TicketAddOns({
  ticket,
  className = '',
}: {
  ticket: Record<string, any> | null | undefined
  className?: string
}) {
  const { t } = useTranslation('events')
  const addOns = ticketAddOns(ticket)
  if (addOns.length === 0) {
    if (!ticket?.add_ons_ticket_id) return null
    return (
      <p className={`text-caption text-fg-subtle ${className}`}>
        {t('addOns.ticket.onFirstTicket', { defaultValue: "Your order's add-ons are on its first ticket." })}
      </p>
    )
  }
  return (
    <section className={`rounded bg-surface px-4 py-3 ${className}`} aria-labelledby="ticket-add-ons-title">
      <h3 id="ticket-add-ons-title" className="text-meta font-semibold text-fg">
        {t('addOns.ticket.title', { defaultValue: 'Your add-ons' })}
      </h3>
      <ul className="mt-1">
        {addOns.map((a, i) => (
          <li key={`${a.id}-${i}`} className="flex min-h-10 items-center justify-between gap-3 text-meta">
            <span className="min-w-0 truncate text-fg-soft">
              {a.name}
              {a.option ? <span className="text-fg-subtle"> ({a.option})</span> : null}
              <span className="text-fg-subtle"> × {a.quantity}</span>
            </span>
            {a.picked_up_at ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-success">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                {t('addOns.ticket.pickedUp', { defaultValue: 'Picked up' })}
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-fg-subtle">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-fg-faint" />
                {t('addOns.ticket.toCollect', { defaultValue: 'To collect' })}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-caption text-fg-subtle">
        {t('addOns.ticket.howToCollect', { defaultValue: 'Show this ticket at the event to collect them.' })}
      </p>
    </section>
  )
}
