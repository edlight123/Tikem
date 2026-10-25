import { requireOrgPage } from '../_lib/orgPage'
import { getOrganizerCustomers } from '@/lib/firestore/organizer'
import OrdersClient from './OrdersClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OrganizerOrdersPage() {
  const { orgId } = await requireOrgPage('view', '/organizer/orders')

  const { orders } = await getOrganizerCustomers(orgId)
  return <OrdersClient orders={orders} />
}
