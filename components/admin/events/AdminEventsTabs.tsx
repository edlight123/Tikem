'use client'

interface Tab {
  id: 'pending' | 'published' | 'reported' | 'unpublished'
  label: string
  count: number
}

interface AdminEventsTabsProps {
  activeTab: Tab['id']
  onTabChange: (tab: Tab['id']) => void
  tabs: Tab[]
}

export function AdminEventsTabs({ activeTab, onTabChange, tabs }: AdminEventsTabsProps) {
  return (
    <div className="bg-console-ground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex gap-6 overflow-x-auto" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  label-mono whitespace-nowrap py-3 px-1 border-b-2 text-eyebrow uppercase tracking-[0.08em] flex items-center gap-2 transition-colors
                  ${isActive
                    ? 'border-console-text text-console-text'
                    : 'border-transparent text-console-mut hover:text-console-text'
                  }
                `}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="label-mono text-xs tabular-nums text-console-mut">
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
