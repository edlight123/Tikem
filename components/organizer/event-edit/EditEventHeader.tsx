'use client'

import { useTranslation } from 'react-i18next'

import { StatusChip } from '@/components/ui/kit'
import { Eye, Save, Rocket, AlertCircle, CheckCircle } from 'lucide-react'
import Link from 'next/link'

interface EditEventHeaderProps {
  eventId?: string
  title: string
  isPublished: boolean
  completionPercentage: number
  missingItemsCount: number
  canPublish: boolean
  hasUnsavedChanges: boolean
  onSave: () => void
  onPublish: () => void
  isSaving: boolean
}

export function EditEventHeader({
  eventId,
  title,
  isPublished,
  completionPercentage,
  missingItemsCount,
  canPublish,
  hasUnsavedChanges,
  onSave,
  onPublish,
  isSaving
}: EditEventHeaderProps) {
  const { t } = useTranslation('organizer')

  return (
    <div className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: Title & Status */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl md:text-2xl font-bold text-white truncate">
                  {title || 'Untitled Event'}
                </h1>
                <StatusChip tone={isPublished ? 'success' : 'neutral'} className="text-sm">
                  {isPublished ? 'Published' : 'Draft'}
                </StatusChip>
                {hasUnsavedChanges && (
                  <span className="text-sm text-amber-300 font-medium flex items-center gap-1">
                    <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
                    {t('edit_event_header.unsaved')}
                  </span>
                )}
              </div>
              
              {/* Completion Progress */}
              <div className="flex items-center gap-3">
                <div className="flex-1 max-w-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white/60">
                      {completionPercentage}% Complete
                    </span>
                    {missingItemsCount > 0 && (
                      <span className="text-xs text-amber-300 font-medium">
                        {missingItemsCount} item{missingItemsCount !== 1 ? 's' : ''} missing
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-white/[0.07] rounded h-2">
                    <div
                      className={`h-2 rounded transition-all duration-500 ${
                        completionPercentage === 100
                          ? 'bg-emerald-400'
                          : completionPercentage >= 60
                          ? 'bg-white'
                          : 'bg-amber-500'
                      }`}
                      style={{ width: `${completionPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {canPublish ? (
                  <div className="hidden md:flex items-center gap-1.5 text-emerald-300 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" />
                    <span>{t('edit_event_header.ready_to_publish')}</span>
                  </div>
                ) : (
                  <div className="hidden md:flex items-center gap-1.5 text-amber-300 text-sm font-medium">
                    <AlertCircle className="w-4 h-4" />
                    <span>{t('edit_event_header.complete_required_fields')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Save Button */}
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || !hasUnsavedChanges}
              className={`flex items-center gap-2 px-4 py-2.5 rounded font-semibold transition-all ${
                hasUnsavedChanges
                  ? 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
                  : 'bg-white/[0.07] text-white/40 cursor-not-allowed'
              }`}
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isSaving ? 'Saving...' : 'Save'}
              </span>
            </button>

            {/* Preview Button */}
            {eventId && (
              <Link
                href={`/events/${eventId}`}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2.5 rounded font-semibold bg-white/[0.07] text-white/70 hover:bg-white/[0.12] transition-all"
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">{t('actions.preview')}</span>
              </Link>
            )}

            {/* Publish Button */}
            <button
              type="button"
              onClick={onPublish}
              disabled={!canPublish || isSaving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded font-semibold transition-all ${
                canPublish && !isSaving
                  ? isPublished
                    ? 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
                    : 'bg-white text-black hover:bg-white/90'
                  : 'bg-white/[0.07] text-white/40 cursor-not-allowed'
              }`}
              title={!canPublish ? `Complete ${missingItemsCount} required item${missingItemsCount !== 1 ? 's' : ''} to publish` : ''}
            >
              <Rocket className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isPublished ? 'Unpublish' : 'Publish'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile Status Indicator */}
        <div className="md:hidden mt-3 flex items-center gap-2">
          {canPublish ? (
            <div className="flex items-center gap-1.5 text-emerald-300 text-sm font-medium">
              <CheckCircle className="w-4 h-4" />
              <span>{t('edit_event_header.ready_to_publish')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-300 text-sm font-medium">
              <AlertCircle className="w-4 h-4" />
              <span>Complete {missingItemsCount} required field{missingItemsCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
