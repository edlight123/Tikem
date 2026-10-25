import { T } from '@/components/organizer/ui/TranslatedText'
import { createClient } from '@/lib/firebase-db/server'
import { requireOrgPage } from '../_lib/orgPage'
import PromoCodeManager from './PromoCodeManager'
import { adminDb } from '@/lib/firebase/admin'
import { PageHeader, MetricCard } from '@/components/organizer/ui'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'
import { Ticket, CheckCircle, Activity, XCircle } from 'lucide-react'

export const revalidate = 0

export default async function PromoCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>
}) {
  const { orgId } = await requireOrgPage('manage_events', '/organizer/promo-codes')

  const supabase = await createClient()
  const params = await searchParams

  // Fetch organizer's events from Firebase
  let events: any[] = []
  try {
    const eventsSnapshot = await adminDb
      .collection('events')
      .where('organizer_id', '==', orgId)
      .orderBy('created_at', 'desc')
      .get()
    
    events = eventsSnapshot.docs.map((doc: any) => {
      const data = doc.data()
      return {
        id: doc.id,
        title: data.title,
      }
    })
  } catch (error) {
    console.error('Failed to fetch events:', error)
  }

  // Fetch promo codes (no joins with Firebase)
  let promoCodesData: any[] = []
  
  try {
    const eventIds = events.map((e: any) => e.id).filter(Boolean)
    console.log('Fetching promo codes for event IDs:', eventIds.length, eventIds.slice(0, 5))
    
    if (eventIds.length > 0) {
      // Firebase `in()` supports max 30 values; chunk into groups of 30
      const chunks: string[][] = []
      for (let i = 0; i < eventIds.length; i += 30) {
        chunks.push(eventIds.slice(i, i + 30))
      }

      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from('promo_codes')
            .select('id,code,discount_type,discount_value,max_uses,uses_count,event_id,is_active,expires_at,created_at')
            .in('event_id', chunk)
            .order('created_at', { ascending: false })
        )
      )

      console.log('Query results from chunks:', results.map((r, i) => ({ chunk: i, dataLength: r.data?.length || 0, error: r.error })))

      const userPromoCodes = results.flatMap((r) => r.data || [])
      console.log('Fetched promo codes:', userPromoCodes.length, userPromoCodes)

      // Get event titles separately
      const eventsMap = new Map()
      events.forEach((event: any) => {
        eventsMap.set(event.id, event.title)
      })

      // Attach event data manually
      promoCodesData = userPromoCodes.map((pc: any) => ({
        ...pc,
        event: pc.event_id ? { title: eventsMap.get(pc.event_id) } : null,
      }))
    }
  } catch (error) {
    console.error('Failed to load promo codes:', error)
  }

  const eventsData = events || []

  // Metrics summary
  const totalCodes = promoCodesData.length
  const activeCodes = promoCodesData.filter((p: any) => p.is_active).length
  const totalUses = promoCodesData.reduce((sum: number, p: any) => sum + (p.uses_count || 0), 0)
  const percentActive = totalCodes > 0 ? Math.round((activeCodes / totalCodes) * 100) : 0

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <TranslatedPageHeader
          eyebrowKey="organizer"
          titleKey="promo_codes_title"
          subtitleKey="promo_codes_subtitle"
        />

        {/* Metrics */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard icon={Ticket} label={<T k="server_bits.total_codes" />} value={totalCodes} />
          <MetricCard icon={CheckCircle} label={<T k="server_bits.active" />} value={activeCodes} sublabel={`${percentActive}% active`} />
          <MetricCard icon={Activity} label={<T k="server_bits.total_uses" />} value={totalUses} />
          <MetricCard icon={XCircle} label={<T k="server_bits.inactive" />} value={totalCodes - activeCodes} />
        </div>

        <div className="mt-8">
          <PromoCodeManager
            events={eventsData}
            promoCodes={promoCodesData}
            organizerId={orgId}
          />
        </div>
      </div>
    </div>
  )
}
