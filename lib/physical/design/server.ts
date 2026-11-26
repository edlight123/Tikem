/**
 * Server glue for printed-ticket designs: who the organizer is (the "PRÉSENTÉ
 * PAR" line), the tier being printed, and the design check with this event's
 * own image sources. Admin SDK.
 */

import { adminDb } from '@/lib/firebase/admin'
import { isOwnPrintedUpload, resolveImageSource } from './assets'
import { ticketLang } from './facts'
import { validateDesignInput, type DesignValidation } from './registry'
import type { ProofEventInput } from './proof'

export async function loadOrganizerName(orgId: string | null | undefined): Promise<string> {
  if (!orgId || orgId.includes('/')) return ''
  try {
    const snap = await adminDb.collection('public_profiles').doc(orgId).get()
    const d = snap.exists ? snap.data() || {} : {}
    return String(d.organization_name || d.display_name || d.name || '').trim()
  } catch {
    return ''
  }
}

/**
 * The event's poster, when it has one AND it is a link the printer may read
 * (a public image prefix of our bucket or an allow-listed image host): a
 * poster field pointing at a private object is never offered or accepted.
 */
export function eventPosterUrl(event: Record<string, any>, eventId: string): string | null {
  const url = String(event?.banner_image || event?.cover_image_url || event?.image_url || '').trim()
  return url && resolveImageSource(url, eventId) ? url : null
}

export function validateEventDesign(raw: unknown, eventId: string, event: Record<string, any>): DesignValidation {
  return validateDesignInput(raw, {
    isOwnUpload: (url) => isOwnPrintedUpload(url, eventId),
    posterUrl: eventPosterUrl(event, eventId),
  })
}

/** The facts a proof / print needs about the event and one of its tiers. */
export async function proofInputFor(params: {
  eventId: string
  event: Record<string, any>
  orgId: string | null | undefined
  tierId?: string | null
  tierName?: string | null
  tierPrice?: number | null
  lang?: string | null
}): Promise<ProofEventInput> {
  let tierName = String(params.tierName || '')
  let tierPrice = Number(params.tierPrice) || 0
  if (params.tierId && !params.tierId.includes('/')) {
    const snap = await adminDb.collection('ticket_tiers').doc(params.tierId).get().catch(() => null)
    const t = snap?.exists ? snap.data() || {} : null
    if (t && String(t.event_id || t.eventId || '') === params.eventId) {
      tierName = String(t.name || tierName || 'Ticket')
      tierPrice = Number(t.price) || 0
    }
  }
  return {
    eventId: params.eventId,
    event: params.event,
    tierName: tierName || 'VIP',
    tierPrice,
    currency: String(params.event?.currency || 'HTG').toUpperCase(),
    lang: ticketLang(params.event, params.lang),
    organizerName: (await loadOrganizerName(params.orgId)) || String(params.event?.organizer_name || ''),
  }
}
