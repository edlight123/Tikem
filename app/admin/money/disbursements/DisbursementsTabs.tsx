'use client'

import { useEffect, useState } from 'react'

/**
 * The two views of the disbursements screen.
 *
 * This was `PayoutOperationsClient`, which carried three views — pending
 * requests, event settlements and withdrawal history — plus its own page
 * header, breadcrumbs and quick links to disputes and release settings. All of
 * that navigation is now the Money hub's tab strip, and withdrawal history has
 * a route of its own at /admin/money/withdrawals, so what is left here is the
 * switch between the two things that genuinely live on this one screen.
 *
 * Deliberately NOT a second underlined nav strip: the hub's tabs are the
 * navigation, and two full-width rules stacked read as two levels of the same
 * thing. This is the console's in-page filter idiom instead — the same one the
 * withdrawals list uses for its status filter.
 */

interface DisbursementsTabsProps {
  pendingPayoutsContent: React.ReactNode
  eventSettlementsContent: React.ReactNode
}

type TabId = 'pending' | 'settlements'

export function DisbursementsTabs({
  pendingPayoutsContent,
  eventSettlementsContent,
}: DisbursementsTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('settlements')

  // Open the correct view from the URL hash so deep links like `#pending` and
  // `#settlements` still work. Defaults to settlements.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.replace('#', '')
    if (hash === 'pending' || hash === 'settlements') {
      setActiveTab(hash)
    }
  }, [])

  const selectTab = (id: TabId) => {
    setActiveTab(id)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${id}`)
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'pending', label: 'Pending Requests' },
    { id: 'settlements', label: 'Event Settlements' },
  ]

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`label-mono border-b-2 pb-1.5 text-eyebrow uppercase tracking-[0.14em] transition-colors ${
                isActive
                  ? 'border-console-text text-console-text'
                  : 'border-transparent text-console-mut hover:text-console-text'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'pending' && <div>{pendingPayoutsContent}</div>}
      {activeTab === 'settlements' && <div>{eventSettlementsContent}</div>}
    </div>
  )
}
