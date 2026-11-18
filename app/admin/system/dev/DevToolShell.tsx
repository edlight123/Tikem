import type { ReactNode } from 'react'
import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'

/**
 * The frame around one dev tool.
 *
 * A tool sits BELOW the Dev tools index, not beside it, so it carries no tab
 * strip — the breadcrumb trail is the way back up, which is the same choice the
 * user and organizer detail screens make.
 *
 * The container and title match `ConsolePage` exactly; they are spelled out
 * here rather than composed because `ConsolePage` has no slot above its title
 * for a trail, and three tools hand-rolling the same wrapper is how a console
 * drifts.
 */
export default function DevToolShell({
  title,
  href,
  children,
}: {
  title: string
  /** This tool's own route, so the trail's last crumb is honest about where you are. */
  href: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
      <AdminBreadcrumbs
        items={[
          { label: 'System', href: '/admin/system' },
          { label: 'Dev tools', href: '/admin/system/dev' },
          { label: title, href },
        ]}
      />
      <h1 className="label-mono mb-4 text-body font-bold uppercase tracking-[0.14em] text-console-text">
        {title}
      </h1>
      {children}
    </div>
  )
}
