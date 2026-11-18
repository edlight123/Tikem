import { notFound } from 'next/navigation'
import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'
import { AnalyticsSection } from '@/components/admin/AnalyticsSection'
import { ANALYTICS_SECTIONS } from '@/components/admin/AnalyticsHub'

export const revalidate = 120

export default async function AdminAnalyticsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  const meta = ANALYTICS_SECTIONS.find((s) => s.id === section)
  if (!meta) notFound()

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <AdminBreadcrumbs
        items={[{ label: 'Analytics', href: '/admin/analytics' }, { label: meta.label }]}
      />

      <div className="mb-5 sm:mb-6">
        <h1 className="label-mono text-body font-bold uppercase tracking-[0.14em] text-console-text">
          {meta.label}
        </h1>
        <p className="mt-1 text-meta text-console-mut">{meta.blurb}</p>
      </div>

      <AnalyticsSection section={section} />
    </div>
  )
}
