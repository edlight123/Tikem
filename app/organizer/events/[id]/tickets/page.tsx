import { T } from '@/components/organizer/ui/TranslatedText'
import { requireAuth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { adminDb } from '@/lib/firebase/admin'
import { Pencil, Ticket } from 'lucide-react'
import { PageHeader, OrgEmptyState } from '@/components/organizer/ui'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'
import { StatusChip } from '@/components/ui/kit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Tier {
  id: string
  name: string
  price: number
  quantity: number
  sold: number
}

export default async function EventTicketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, error } = await requireAuth()
  if (error || !user) redirect(`/auth/login?redirect=/organizer/events/${id}/tickets`)
  if (user.role !== 'organizer') redirect(`/organizer?redirect=/organizer/events/${id}/tickets`)

  const eventDoc = await adminDb.collection('events').doc(id).get()
  if (!eventDoc.exists) notFound()
  const eventData = eventDoc.data()!
  if (eventData.organizer_id !== user.id && !(user as any).isAdmin) notFound()

  const currency = String(eventData.currency || 'HTG')

  const tiersSnap = await adminDb.collection('ticket_tiers').where('event_id', '==', id).get()
  const tiers: Tier[] = tiersSnap.docs
    .map((doc: any) => {
      const d = doc.data()
      return {
        id: doc.id,
        name: String(d.name || d.tier_name || 'General Admission'),
        price: Number(d.price || 0),
        quantity: Number(d.total_quantity || d.quantity || 0),
        sold: Number(d.sold_quantity || d.sold || 0),
      }
    })
    .sort((a: Tier, b: Tier) => a.price - b.price)

  const money = (n: number) => (n > 0 ? `${currency} ${n.toLocaleString()}` : 'Free')

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 md:py-10">
      <TranslatedPageHeader
          eyebrowKey="event"
          titleKey="tickets_title"
          subtitleKey="tickets_subtitle"
          actions={
          <Link
            href={`/organizer/events/${id}/edit`}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Pencil className="h-4 w-4" />
            <T k="server_bits.edit_tickets" />
          </Link>
          }
        />

      <div className="mt-8">
        {tiers.length === 0 ? (
          <OrgEmptyState
            icon={Ticket}
            title={<T k="server_bits.no_ticket_types_yet" />}
            description={<T k="server_bits.add_ticket_types_desc" />}
            action={
              <Link
                href={`/organizer/events/${id}/edit`}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Pencil className="h-4 w-4" />
                <T k="server_bits.add_tickets" />
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {tiers.map((tier) => {
              const pct = tier.quantity > 0 ? Math.min(100, Math.round((tier.sold / tier.quantity) * 100)) : 0
              const soldOut = tier.quantity > 0 && tier.sold >= tier.quantity
              return (
                <div
                  key={tier.id}
                  className="rounded-2xl bg-white/[0.03] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-white">{tier.name}</p>
                      <p className="mt-0.5 text-sm font-mono tabular-nums text-white/70">{money(tier.price)}</p>
                    </div>
                    <StatusChip tone={soldOut ? 'danger' : 'success'}>
                      {soldOut ? 'Sold out' : 'On sale'}
                    </StatusChip>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="label-mono uppercase text-white/70">Sold</span>
                      <span className="font-semibold font-mono tabular-nums text-white">
                        {tier.sold}
                        {tier.quantity > 0 && <span className="text-white/70"> / {tier.quantity}</span>}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.12]">
                      <div
                        className={`h-2 rounded-full ${soldOut ? 'bg-red-500' : 'bg-white'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
