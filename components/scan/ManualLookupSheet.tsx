'use client'

import { useState } from 'react'
import { X, Search, User, Mail, Ticket } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { StatusChip } from '@/components/ui/kit'

interface Attendee {
  ticketId: string
  attendeeName: string
  attendeeEmail: string
  ticketType: string
  checkedIn: boolean
}

interface ManualLookupSheetProps {
  isOpen: boolean
  onClose: () => void
  attendees: Attendee[]
  onSelect: (ticketId: string) => void
}

export function ManualLookupSheet({ isOpen, onClose, attendees, onSelect }: ManualLookupSheetProps) {
  const { t } = useTranslation('organizer')
  const [searchQuery, setSearchQuery] = useState('')

  if (!isOpen) return null

  const filteredAttendees = attendees.filter((attendee) => {
    const query = searchQuery.toLowerCase()
    return (
      attendee.attendeeName.toLowerCase().includes(query) ||
      attendee.attendeeEmail.toLowerCase().includes(query) ||
      attendee.ticketId.toLowerCase().includes(query)
    )
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface-raised-solid rounded-t-3xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-line-soft">
          <h2 className="text-xl font-bold text-fg">{t('door.manual_lookup', { defaultValue: 'Manual Lookup' })}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-raised rounded transition-colors"
          >
            <X className="w-5 h-5 text-fg-subtle" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-line-soft">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-fg-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('door.search_placeholder', { defaultValue: 'Search by name, email, or ticket ID...' })}
              className="w-full pl-10 pr-4 py-3 bg-surface rounded-xl text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
              autoFocus
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredAttendees.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-12 h-12 text-fg-muted mx-auto mb-3" />
              <p className="text-fg-subtle">
                {searchQuery ? 'No attendees found' : 'Start typing to search'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAttendees.map((attendee) => (
                <button
                  key={attendee.ticketId}
                  onClick={() => {
                    onSelect(attendee.ticketId)
                    onClose()
                  }}
                  className="w-full p-4 bg-surface hover:bg-surface-raised rounded-2xl transition-colors text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-4 h-4 text-fg-subtle flex-shrink-0" />
                        <span className="font-semibold text-fg truncate">
                          {attendee.attendeeName}
                        </span>
                        {attendee.checkedIn && (
                          <StatusChip tone="success">{t('actions.checked_in')}</StatusChip>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm text-fg-subtle mb-1">
                        <Mail className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{attendee.attendeeEmail}</span>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-fg-subtle">
                        <div className="flex items-center gap-1">
                          <Ticket className="w-3 h-3" />
                          <span>{attendee.ticketType}</span>
                        </div>
                        <span className="font-code">{attendee.ticketId.slice(0, 8)}...</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
