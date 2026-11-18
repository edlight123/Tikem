'use client'

import { X, MapPin, Tag, ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
import { ConsoleButton } from '@/components/admin/console'

interface FilterOptions {
  city: string
  category: string
  sortBy: 'newest' | 'soonest'
}

interface AdminEventsFiltersProps {
  isOpen: boolean
  onClose: () => void
  filters: FilterOptions
  onApply: (filters: FilterOptions) => void
}

const DEFAULT_FILTERS: FilterOptions = {
  city: '',
  category: '',
  sortBy: 'newest',
}

export function AdminEventsFilters({ isOpen, onClose, filters, onApply }: AdminEventsFiltersProps) {
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters)

  if (!isOpen) return null

  const handleApply = () => {
    onApply(localFilters)
    onClose()
  }

  const handleReset = () => {
    setLocalFilters(DEFAULT_FILTERS)
    onApply(DEFAULT_FILTERS)
    onClose()
  }

  const inputClass =
    'w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut'

  const sectionLabelClass =
    'label-mono flex items-center gap-2 text-eyebrow uppercase tracking-[0.18em] text-console-faint mb-3'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-scrim z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-console-panel shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4">
          <h3 className="label-mono text-meta font-bold uppercase tracking-[0.14em] text-console-text">
            Filters
          </h3>
          <button onClick={onClose} aria-label="Close filters" className="p-2 hover:bg-console-raise rounded">
            <X className="w-5 h-5 text-console-mut" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* City */}
          <div>
            <label className={sectionLabelClass}>
              <MapPin className="w-3.5 h-3.5" />
              City
            </label>
            <select
              value={localFilters.city}
              onChange={(e) => setLocalFilters({ ...localFilters, city: e.target.value })}
              className={inputClass}
            >
              <option value="">All cities</option>
              <option value="Port-au-Prince">Port-au-Prince</option>
              <option value="Cap-Haïtien">Cap-Haïtien</option>
              <option value="Jacmel">Jacmel</option>
              <option value="Les Cayes">Les Cayes</option>
              <option value="Gonaïves">Gonaïves</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label className={sectionLabelClass}>
              <Tag className="w-3.5 h-3.5" />
              Category
            </label>
            <select
              value={localFilters.category}
              onChange={(e) => setLocalFilters({ ...localFilters, category: e.target.value })}
              className={inputClass}
            >
              <option value="">All categories</option>
              <option value="Music">Music</option>
              <option value="Sports">Sports</option>
              <option value="Arts">Arts</option>
              <option value="Food">Food & Drink</option>
              <option value="Business">Business</option>
              <option value="Education">Education</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <label className={sectionLabelClass}>
              <ArrowUpDown className="w-3.5 h-3.5" />
              Sort By
            </label>
            <div className="space-y-2">
              {[
                { value: 'newest', label: 'Newest first' },
                { value: 'soonest', label: 'Soonest event date' },
              ].map((sort) => (
                <label key={sort.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sortBy"
                    value={sort.value}
                    checked={localFilters.sortBy === sort.value}
                    onChange={(e) => setLocalFilters({ ...localFilters, sortBy: e.target.value as FilterOptions['sortBy'] })}
                    className="w-4 h-4 accent-console-text focus:ring-console-mut"
                  />
                  <span className="text-sm text-console-mut">{sort.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4">
          <ConsoleButton onClick={handleReset} className="flex-1">
            Reset
          </ConsoleButton>
          <ConsoleButton variant="primary" onClick={handleApply} className="flex-1">
            Apply Filters
          </ConsoleButton>
        </div>
      </div>
    </>
  )
}
