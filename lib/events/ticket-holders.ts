/**
 * Everyone holding a live ticket for an event, once per person: the audience
 * of an event-change notice (lib/events/change-notices) and of an organizer's
 * message to attendees (lib/events/attendee-broadcast).
 *
 * Rows come from the shared loader (lib/organizer/eventOrdersLoader), so
 * guest checkouts, comps, free claims and every payment rail are included,
 * and "live" is lib/tickets/status (valid | confirmed | active, plus
 * checked_in): never a single status string, or MonCash / SogePay buyers drop
 * out. Unsold printed tickets are not people.
 */
import { isSoldTicketStatus, isUnsoldPrintedRow, type EventTicketRow } from '@/lib/organizer/eventOrders'
import { isHaitiEvent } from '@/lib/datetime/eventClock'
import type { EmailLang } from '@/lib/email-kit/i18n'

export type TicketHolder = {
  /** Stable per person: `u:<uid>` for an account, `e:<email>` for a guest. */
  key: string
  uid: string | null
  email: string
}

/** Pure: dedupe live rows into people. `excludeUid` drops the sender. */
export function holdersFromRows(rows: EventTicketRow[], opts: { excludeUid?: string | null } = {}): TicketHolder[] {
  const people = new Map<string, TicketHolder>()
  for (const r of rows) {
    if (!isSoldTicketStatus(r.status) || isUnsoldPrintedRow(r)) continue
    const uid = r.isGuest ? null : String(r.buyerKey || '').trim() || null
    // buyerKey falls back to an email or a name when a ticket has no buyer id;
    // only a real account id (no '@', no spaces) is a uid.
    const realUid = uid && !uid.includes('@') && !/\s/.test(uid) && !uid.startsWith('ticket:') ? uid : null
    if (realUid && opts.excludeUid && realUid === opts.excludeUid) continue
    const email = String(r.buyer?.email || '').trim().toLowerCase()
    const key = realUid ? `u:${realUid}` : email ? `e:${email}` : null
    if (!key) continue
    const prev = people.get(key)
    people.set(key, { key, uid: realUid, email: prev?.email || email })
  }
  // An account and a guest checkout with the same address are one person.
  const accountEmails = new Set(Array.from(people.values()).filter((p) => p.uid && p.email).map((p) => p.email))
  return Array.from(people.values())
    .filter((p) => p.uid || !accountEmails.has(p.email))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The language of a notice about this event. Haiti tickets are in French
 * (owner, 2026-11-25), so a Haiti event's notices are French unless the
 * person chose Kreyòl; elsewhere the person's own language.
 */
export function noticeLangFor(resolved: EmailLang, event: Record<string, any> | null | undefined): EmailLang {
  if (isHaitiEvent(event as any)) return resolved === 'ht' ? 'ht' : 'fr'
  return resolved
}
