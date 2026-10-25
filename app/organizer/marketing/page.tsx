import { requireOrgPage } from '../_lib/orgPage'
import { getOrganizerCustomers } from '@/lib/firestore/organizer'
import MarketingClient from './MarketingClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OrganizerMarketingPage() {
  const { orgId } = await requireOrgPage('view', '/organizer/marketing')

  const { attendees } = await getOrganizerCustomers(orgId)
  return <MarketingClient attendees={attendees} />
}
