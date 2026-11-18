'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Lock, Settings, Wrench } from 'lucide-react'
import { useAdminQueues } from '@/lib/realtime/AdminRealtimeProvider'
// queue-keys, NOT queue-summary: the latter imports firebase-admin, which must
// never reach the client bundle.
import { RAIL_GROUPS, railStat } from '@/lib/admin/queue-keys'
import { formatAge } from '@/lib/admin/age'
import { consoleAgeClass, useConsoleNow } from '@/components/admin/console'

const DEV_EMAILS = ['edward.laguerre+dev@gmail.com', 'edwardlaguerre7@gmail.com']

const BROWSE = [
  { label: 'People', href: '/admin/people' },
  { label: 'Events', href: '/admin/events' },
  { label: 'Orders', href: '/admin/orders' },
  { label: 'Analytics', href: '/admin/analytics' },
]

function RailLink({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active: boolean
  children?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex h-9 items-center justify-between gap-2 border-l-2 py-1.5 pl-3 pr-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut ${
        active
          ? 'border-console-text bg-console-panel font-semibold text-console-text'
          : 'border-transparent text-console-mut hover:bg-console-panel hover:text-console-text'
      }`}
    >
      <span className="truncate">{label}</span>
      {children}
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="label-mono px-3 pb-1.5 pt-5 text-eyebrow uppercase tracking-[0.18em] text-console-faint">
      {children}
    </div>
  )
}

/**
 * The Control Room rail. QUEUES (things needing a decision) apart from BROWSE
 * (things you look up), each queue carrying `count · oldest` — a count alone
 * cannot tell twelve items filed this morning from two filed last week.
 * The active route gets the same left-edge device the queue rows use.
 */
export function AdminSidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname()
  const { queues } = useAdminQueues()
  const now = useConsoleNow()

  const isDeveloper = !!userEmail && DEV_EMAILS.includes(userEmail)
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : Boolean(pathname?.startsWith(href))

  return (
    <nav
      aria-label="Admin"
      className="flex h-full w-60 shrink-0 flex-col overflow-y-auto bg-console-ground px-2 py-4"
    >
      <Link
        href="/admin"
        className="label-mono mb-2 px-3 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
      >
        <span className="text-meta font-bold tracking-[0.06em] text-console-text">TIKÈM</span>
        <span className="mt-0.5 block text-eyebrow tracking-[0.2em] text-console-faint">CONSOLE</span>
      </Link>

      <RailLink href="/admin" label="Needs you" active={isActive('/admin')} />

      <SectionLabel>Queues</SectionLabel>
      {RAIL_GROUPS.map((group) => {
        const stat = queues ? railStat(queues, group) : null
        // Three distinct states: not loaded yet, read failed, genuinely clear.
        const unreadable = queues !== null && stat === null
        return (
          <RailLink key={group.key} href={group.href} label={group.label} active={isActive(group.href)}>
            {stat && stat.count > 0 ? (
              <span className="label-mono shrink-0 text-eyebrow tabular-nums">
                <span className="text-console-mut">{stat.count}</span>
                {stat.oldestAt && now && (
                  <>
                    <span className="text-console-faint"> · </span>
                    <span className={consoleAgeClass(stat.oldestAt, now)}>{formatAge(stat.oldestAt, now)}</span>
                  </>
                )}
              </span>
            ) : unreadable ? (
              <span
                className="label-mono shrink-0 text-eyebrow text-console-faint"
                title="Count unavailable, this queue could not be read"
              >
, 
              </span>
            ) : null}
          </RailLink>
        )
      })}

      <SectionLabel>Browse</SectionLabel>
      {BROWSE.map((item) => (
        <RailLink key={item.href} href={item.href} label={item.label} active={isActive(item.href)} />
      ))}

      <div className="mt-auto pt-4">
        <RailLink href="/admin/trust/security" label="Security" active={isActive('/admin/trust/security')}>
          <Lock className="h-3.5 w-3.5 shrink-0 text-console-faint" />
        </RailLink>
        <RailLink href="/admin/system" label="Settings" active={isActive('/admin/system')}>
          <Settings className="h-3.5 w-3.5 shrink-0 text-console-faint" />
        </RailLink>
        {isDeveloper && (
          <RailLink href="/admin/system/dev" label="Dev" active={isActive('/admin/system/dev')}>
            <Wrench className="h-3.5 w-3.5 shrink-0 text-console-faint" />
          </RailLink>
        )}
      </div>
    </nav>
  )
}
