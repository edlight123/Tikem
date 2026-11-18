'use client'

import { useTranslation } from 'react-i18next'

import { TabValidation } from '@/lib/event-validation'
import { Check, AlertCircle, FileText, MapPin, Clock, Ticket, Tag } from 'lucide-react'

interface StepperTabsProps {
  tabs: TabValidation[]
  currentTab: string
  onTabChange: (tabId: string) => void
}

const TAB_ICONS: Record<string, any> = {
  basic: FileText,
  location: MapPin,
  schedule: Clock,
  tickets: Ticket,
  details: Tag
}

export function StepperTabs({ tabs, currentTab, onTabChange }: StepperTabsProps) {
  const { t } = useTranslation('organizer')

  return (
    <div className="bg-surface-low border-b border-line">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Desktop Tabs */}
        <div className="hidden md:flex items-center justify-between">
          {tabs.map((tab, index) => {
            const Icon = TAB_ICONS[tab.id] || FileText
            const isActive = currentTab === tab.id
            const isCompleted = tab.isComplete
            const hasWarnings = tab.warnings.length > 0
            const isPast = tabs.findIndex(t => t.id === currentTab) > index

            return (
              <div key={tab.id} className="flex items-center flex-1">
                <button
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`relative flex items-center gap-3 px-4 py-4 transition-all flex-1 group ${
                    isActive
                      ? 'border-b-4'
                      : 'border-b-4 border-transparent hover:border-line'
                  }`}
                  style={{
                    borderBottomColor: isActive ? '#0F766E' : undefined
                  }}
                >
                  {/* Step Number/Status Icon */}
                  <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                    isActive
                      ? 'bg-inverse text-on-inverse'
                      : isCompleted
                      ? 'text-success-soft group-hover:bg-success-strong/15'
                      : hasWarnings || tab.missingFields.length > 0
                      ? 'text-warning-soft group-hover:bg-warning-strong/15'
                      : 'bg-surface-low text-fg-muted group-hover:bg-surface-raised'
                  }`}>
                    {isCompleted && !isActive ? (
                      <Check className="w-5 h-5" />
                    ) : (tab.missingFields.length > 0 || hasWarnings) && !isActive ? (
                      <AlertCircle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>

                  {/* Tab Label */}
                  <div className="text-left flex-1">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${
                      isActive
                        ? 'text-brand-300'
                        : isPast
                        ? 'text-fg-subtle'
                        : 'text-fg-subtle group-hover:text-fg-muted'
                    }`}>
                      Step {index + 1}
                    </p>
                    <p className={`font-bold text-sm ${
                      isActive
                        ? 'text-fg'
                        : 'text-fg-muted group-hover:text-fg'
                    }`}>
                      {tab.title}
                    </p>
                    
                    {/* Status Indicators */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isCompleted ? (
                        <span className="text-xs text-success-soft font-medium flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          {t('actions.complete')}
                        </span>
                      ) : tab.missingFields.length > 0 ? (
                        <span className="text-xs text-warning-soft font-medium">
                          {tab.missingFields.length} missing
                        </span>
                      ) : null}
                      {hasWarnings && (
                        <span className="text-xs text-warning-soft font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {tab.warnings.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Completion Badge */}
                  {isCompleted && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-success-strong text-fg rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </button>

                {/* Connector Line */}
                {index < tabs.length - 1 && (
                  <div className={`h-0.5 w-8 transition-all ${
                    isPast || isCompleted
                      ? 'bg-success-strong'
                      : 'bg-surface-low'
                  }`}></div>
                )}
              </div>
            )
          })}
        </div>

        {/* Mobile Dropdown */}
        <div className="md:hidden py-3">
          <div className="relative">
            <select
              value={currentTab}
              onChange={(e) => onTabChange(e.target.value)}
              className="w-full px-4 py-3 pr-10 bg-surface rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 appearance-none font-semibold text-fg"
            >
              {tabs.map((tab, index) => {
                const Icon = TAB_ICONS[tab.id] || FileText
                return (
                  <option key={tab.id} value={tab.id}>
                    {tab.isComplete ? '✓' : tab.missingFields.length > 0 ? '!' : '○'} Step {index + 1}: {tab.title}
                  </option>
                )
              })}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-5 h-5 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Mobile Status Summary */}
          <div className="mt-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {tabs.find(t => t.id === currentTab)?.isComplete ? (
                <span className="flex items-center gap-1 text-success-soft font-medium">
                  <Check className="w-4 h-4" />
                  {t('actions.complete')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-warning-soft font-medium">
                  <AlertCircle className="w-4 h-4" />
                  {tabs.find(t => t.id === currentTab)?.missingFields.length || 0} missing
                </span>
              )}
            </div>
            <span className="text-fg-subtle">
              {tabs.filter(t => t.isComplete).length} of {tabs.length} complete
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
