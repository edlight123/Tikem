import { createClient } from '@/lib/firebase-db/server'
import { requireAuth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import EventComposer from '../../EventComposer'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { getOrganizerVerificationStatus } from '@/lib/organizerVerification'

export const dynamic = 'force-dynamic'

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, error } = await requireAuth()

  if (error || !user) {
    redirect(`/auth/login?redirect=/organizer/events/${id}/edit`)
  }

  if (user.role !== 'organizer') {
    redirect(`/organizer?redirect=/organizer/events/${id}/edit`)
  }

  // Demo mode — render the composer with the in-memory demo event.
  if (isDemoMode()) {
    const event = DEMO_EVENTS.find((e) => e.id === id)
    if (!event) notFound()
    return <EventComposer userId={user.id} event={event} isVerified />
  }

  const supabase = await createClient()

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('organizer_id', user.id)
    .single()

  if (!event) notFound()

  // Load the canonical ticket tiers so the composer is prefilled with them.
  const { data: tierRows } = await supabase
    .from('ticket_tiers')
    .select('*')
    .eq('event_id', id)

  const initialTiers = (tierRows || [])
    // A tier removed in an earlier edit is kept (deactivated) for its sales
    // history, never shown in the editor again.
    .filter((t: any) => t?.archived !== true)
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((t: any) => ({
      id: String(t.id ?? Math.random().toString(36).slice(2, 9)),
      // The doc this row saves back INTO (the composer updates in place, so the
      // sold count and every ticket's tier_id survive the edit).
      docId: t.id ? String(t.id) : undefined,
      // Floor for the quantity field.
      sold_quantity: Number(t.sold_quantity ?? 0) || 0,
      name: t.name ?? '',
      price: String(t.price ?? 0),
      qty: String(t.total_quantity ?? t.quantity ?? 0),
      // Per-tier sale + entry windows MUST ride along: the composer writes
      // every editable field on save, so omitting these here would erase
      // every configured window on any unrelated edit.
      sales_start: t.sales_start ?? null,
      sales_end: t.sales_end ?? null,
      valid_from: t.valid_from ?? null,
      valid_until: t.valid_until ?? null,
      // Same rule, same reason, for every OTHER per-tier field: `syncTiers`
      // writes every editable field on save, so anything not hydrated here is
      // erased by an unrelated edit. The composer reads snake_case or camel,
      // and derives `unlimited` from the sentinel quantity.
      description: t.description ?? null,
      is_active: t.is_active,
      max_per_order: t.max_per_order ?? null,
      enable_waitlist: t.enable_waitlist ?? null,
    }))

  const verification = await getOrganizerVerificationStatus(user.id)

  return (
    <EventComposer
      userId={user.id}
      event={event}
      initialTiers={initialTiers.length > 0 ? initialTiers : undefined}
      isVerified={verification.isVerified}
      verificationStatus={verification.status || undefined}
    />
  )
}
