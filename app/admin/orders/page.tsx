import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'
import { AdminOrdersClient } from '@/components/admin/orders/AdminOrdersClient'

export const revalidate = 0
export const dynamic = 'force-dynamic'

export default async function AdminOrdersPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      <AdminBreadcrumbs
        items={[
          { label: 'Orders', href: '/admin/orders' }
        ]}
      />

      {/* Mono caps page title — the Control Room pattern. "Orders", not
          "Orders Management": the console's own nav already says this is
          where you manage things. */}
      <div className="mt-4">
        <h1 className="label-mono text-body font-bold uppercase tracking-[0.14em] text-console-text">
          Orders
        </h1>
        <p className="mt-1 text-meta text-console-mut">Every ticket order across all events</p>
      </div>

      <div className="mt-6">
        <AdminOrdersClient />
      </div>
    </div>
  )
}
