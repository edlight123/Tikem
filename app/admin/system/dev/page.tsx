import Link from 'next/link'
import { ConsoleCaption, ConsolePage, ConsolePanel, ConsoleTabs } from '@/components/admin/console'
import { systemTabs } from '../tabs'

export const metadata = {
  title: 'Dev tools | System | Admin | Tikèm',
  description: 'Tools that read and write the database directly',
}

const TOOLS = [
  {
    name: 'Database Debug',
    description: 'Inspect and debug Firestore database contents',
    href: '/admin/system/dev/debug-db',
  },
  {
    name: 'Test Data',
    description: 'Create test users, events, and other data for development',
    href: '/admin/system/dev/create-test-data',
  },
  {
    name: 'Seed Events',
    description: 'Generate sample events for testing and development',
    href: '/admin/system/dev/seed-events',
  },
]

/**
 * The dev tools index.
 *
 * Reaching this page at all means `app/admin/system/dev/layout.tsx` already let
 * you through `requireDevTools`, so the tab strip can show the Dev tools tab
 * unconditionally here — there is no one on this page who is not allowed it.
 */
export default function DevToolsPage() {
  return (
    <ConsolePage title="System">
      <ConsoleTabs tabs={systemTabs(true)} />
      <ConsoleCaption>
        These read and write the live database directly, with no confirmation beyond the one each
        tool asks for. They are for development and testing, not for fixing production data.
      </ConsoleCaption>

      <div className="space-y-2">
        {TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className="block">
            <ConsolePanel className="px-4 py-3.5 transition-colors hover:bg-console-raise">
              <div className="text-sm font-semibold text-console-text">{tool.name}</div>
              <div className="mt-0.5 text-meta text-console-mut">{tool.description}</div>
            </ConsolePanel>
          </Link>
        ))}
      </div>
    </ConsolePage>
  )
}
