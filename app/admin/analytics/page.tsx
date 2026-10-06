import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'
import { AnalyticsHub } from '@/components/admin/AnalyticsHub'
import { InviteMetricsLine } from '@/components/admin/InviteMetricsLine'

export const revalidate = 120

export default async function AdminAnalyticsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <AdminBreadcrumbs items={[{ label: 'Analytics' }]} />

      <div className="mb-5 sm:mb-6">
        <h1 className="label-mono text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">
          Platform Analytics
        </h1>
        <p className="mt-1 text-[13px] text-console-mut">
          The live scorecard, every area drills into its own page
        </p>
      </div>

      <AnalyticsHub />
      <InviteMetricsLine />
    </div>
  )
}
