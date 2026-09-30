'use client'

import { X, ExternalLink, CheckCircle, XCircle, Trash2, User, Ticket, Calendar, MapPin, Star } from 'lucide-react'
import { format } from 'date-fns'
import { useState } from 'react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/Toast'
import { ConsoleButton, ConsoleState, consoleTone } from '@/components/admin/console'
import { AdminReportsPanel } from './AdminReportsPanel'

// Guard against missing/malformed dates: date-fns `format` throws
// "RangeError: Invalid time value" on an Invalid Date, which would crash the
// whole detail sheet when opening a legacy/seed event with a bad date field.
function safeFormat(value: string | undefined, fmt: string, fallback = ', '): string {
  if (!value) return fallback
  const d = new Date(value)
  return isNaN(d.getTime()) ? fallback : format(d, fmt)
}

interface Event {
  id: string
  title: string
  description?: string
  start_datetime: string
  end_datetime: string
  city: string
  venue_name?: string
  address?: string
  banner_image_url?: string
  category?: string
  is_published: boolean
  featured?: boolean
  max_attendees: number
  organizer_id: string
  organizer_name: string
  organizer_email: string
  organizer_verified?: boolean
  tickets_sold?: number
  reports_count?: number
  hidden_pending_review?: boolean
  audit_logs?: Array<{
    id: string
    action: string
    admin_email: string
    timestamp: string
    details?: any
  }>
}

interface AdminEventDetailSheetProps {
  event: Event | null
  isOpen: boolean
  onClose: () => void
  onAction: (action: 'publish' | 'unpublish' | 'delete' | 'feature' | 'unfeature', reason?: string) => void
  /** Called after reports were dismissed/actioned so the list can refresh. */
  onReportsResolved?: () => void
}

const SECTION_LABEL = 'label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint'

export function AdminEventDetailSheet({ event, isOpen, onClose, onAction, onReportsResolved }: AdminEventDetailSheetProps) {
  const { t } = useTranslation('common')
  const { showToast } = useToast()
  const [reason, setReason] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isExporting, setIsExporting] = useState<'full' | 'summary' | null>(null)

  if (!isOpen || !event) return null

  const handleUnpublish = () => {
    if (!reason.trim()) {
      showToast({
        type: 'warning',
        title: 'Reason required',
        message: 'Please provide a reason for unpublishing',
      })
      return
    }
    onAction('unpublish', reason)
    setReason('')
  }

  const handleDelete = () => {
    if (!reason.trim()) {
      showToast({
        type: 'warning',
        title: 'Reason required',
        message: 'Please provide a reason for deletion',
      })
      return
    }
    onAction('delete', reason)
    setReason('')
    setShowDeleteConfirm(false)
  }

  const downloadCsv = async (mode: 'full' | 'summary') => {
    try {
      setIsExporting(mode)
      const res = await fetch(`/api/admin/events/${encodeURIComponent(event.id)}/export?mode=${mode}`, {
        method: 'GET',
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Export failed (${res.status})`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `event_${event.id}_${mode}_financials_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: e?.message || 'Failed to download CSV',
      })
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Side Panel */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[600px] lg:w-[700px] bg-console-panel shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4">
          <h3 className="label-mono text-[13px] font-bold uppercase tracking-[0.14em] text-console-text">
            {t('admin.event_details')}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-console-raise rounded"
          >
            <X className="w-5 h-5 text-console-mut" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Banner */}
          {event.banner_image_url ? (
            <div className="relative w-full h-48 bg-console-ground">
              <Image
                src={event.banner_image_url}
                alt={event.title}
                fill
                className="object-cover"
              />
            </div>
          ) : (
            <div className="w-full h-48 bg-console-raise flex items-center justify-center">
              <span className="text-6xl">🎉</span>
            </div>
          )}

          <div className="p-6 space-y-8">
            {/* Title & Status */}
            <div>
              <div className="flex items-start justify-between gap-4 mb-2">
                <h2 className="text-2xl font-bold text-console-text">{event.title}</h2>
                <span className="flex-shrink-0 mt-1.5">
                  <ConsoleState tone={consoleTone(event.is_published ? 'published' : 'draft')}>
                    {event.is_published ? t('admin.published') : t('admin.draft')}
                  </ConsoleState>
                </span>
              </div>

              {event.category && (
                <span className="label-mono text-[11px] uppercase tracking-[0.08em] text-console-mut">
                  {event.category}
                </span>
              )}
            </div>

            {/* Event Info */}
            <div className="grid grid-cols-2 gap-6">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-console-faint mt-0.5" />
                <div>
                  <div className={`${SECTION_LABEL} mb-1`}>{t('admin.date_time')}</div>
                  <div className="label-mono text-sm tabular-nums text-console-text">
                    {safeFormat(event.start_datetime, 'MMM d, yyyy')}
                  </div>
                  <div className="label-mono text-xs tabular-nums text-console-mut">
                    {safeFormat(event.start_datetime, 'h:mm a')} - {safeFormat(event.end_datetime, 'h:mm a')}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-console-faint mt-0.5" />
                <div>
                  <div className={`${SECTION_LABEL} mb-1`}>{t('admin.location')}</div>
                  <div className="text-sm text-console-text">{event.venue_name || 'TBD'}</div>
                  <div className="label-mono text-xs text-console-mut">{event.city}</div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Ticket className="w-5 h-5 text-console-faint mt-0.5" />
                <div>
                  <div className={`${SECTION_LABEL} mb-1`}>{t('admin.max_capacity')}</div>
                  <div className="label-mono text-sm tabular-nums text-console-text">
                    {event.tickets_sold || 0} / {event.max_attendees} {t('admin.tickets_sold').toLowerCase()}
                  </div>
                </div>
              </div>
            </div>

            {/* Description */}
            {event.description && (
              <div>
                <h4 className={`${SECTION_LABEL} mb-2`}>Description</h4>
                <p className="text-sm text-console-mut whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}

            {/* Organizer Info */}
            <div>
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-console-faint mt-0.5" />
                <div className="flex-1">
                  <h4 className={`${SECTION_LABEL} mb-1`}>Organizer</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-console-text">{event.organizer_name}</span>
                    {event.organizer_verified && (
                      <CheckCircle className="w-4 h-4 text-console-green" />
                    )}
                  </div>
                  <div className="text-xs text-console-mut">{event.organizer_email}</div>
                </div>
                {event.organizer_id ? (
                  <a
                    href={`/admin/people/organizers/${event.organizer_id}`}
                    className="text-console-mut hover:text-console-text text-sm font-medium flex items-center gap-1"
                  >
                    View
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : null}
              </div>
            </div>

            {/* Reports — open user reports with dismiss / unpublish / ban. */}
            {(event.reports_count ?? 0) > 0 && (
              <AdminReportsPanel
                kind="event"
                targetId={event.id}
                hiddenPendingReview={event.hidden_pending_review}
                onResolved={onReportsResolved}
              />
            )}

            {/* Audit Log */}
            {event.audit_logs && event.audit_logs.length > 0 && (
              <div>
                <h4 className={`${SECTION_LABEL} mb-3`}>Activity Timeline</h4>
                <div className="space-y-3">
                  {event.audit_logs.map((log) => (
                    <div key={log.id} className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 bg-console-raise rounded-full flex items-center justify-center">
                        <span className="text-xs">📝</span>
                      </div>
                      <div>
                        <div className="text-sm text-console-text">{log.action}</div>
                        <div className="text-xs text-console-faint">
                          By {log.admin_email} • {safeFormat(log.timestamp, 'MMM d, h:mm a')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions Footer */}
        <div className="p-4 space-y-3">
          {/* Reason Input (for unpublish/delete) */}
          {!event.is_published || showDeleteConfirm ? (
            <div>
              <label className={`block ${SECTION_LABEL} mb-2`}>
                {showDeleteConfirm ? t('admin.reason_for_deletion') : t('admin.reason_for_action')}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('admin.reason_placeholder')}
                className="w-full px-3 py-2 rounded bg-console-ground text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut resize-none"
                rows={2}
              />
            </div>
          ) : null}

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {event.is_published ? (
              <>
                <ConsoleButton
                  variant="danger"
                  onClick={handleUnpublish}
                  className="flex-1 flex items-center justify-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  {t('admin.unpublish')}
                </ConsoleButton>
                <ConsoleButton variant="danger" onClick={() => setShowDeleteConfirm(true)} aria-label="Delete event">
                  <Trash2 className="w-4 h-4" />
                </ConsoleButton>
              </>
            ) : showDeleteConfirm ? (
              <>
                <ConsoleButton onClick={() => setShowDeleteConfirm(false)} className="flex-1">
                  {t('admin.cancel')}
                </ConsoleButton>
                <ConsoleButton variant="danger" onClick={handleDelete} className="flex-1">
                  {t('admin.confirm_delete')}
                </ConsoleButton>
              </>
            ) : (
              <>
                <ConsoleButton
                  variant="primary"
                  onClick={() => onAction('publish')}
                  className="flex-1 flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  {t('admin.approve_publish')}
                </ConsoleButton>
                <ConsoleButton variant="danger" onClick={() => setShowDeleteConfirm(true)} aria-label="Delete event">
                  <Trash2 className="w-4 h-4" />
                </ConsoleButton>
              </>
            )}
          </div>

          {/* Feature toggle */}
          <button
            onClick={() => onAction(event.featured ? 'unfeature' : 'feature')}
            className={`w-full flex items-center justify-center gap-2 rounded bg-console-raise px-4 py-2 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut ${
              event.featured
                ? 'text-console-amber hover:opacity-90'
                : 'text-console-mut hover:text-console-text'
            }`}
          >
            <Star className={`w-4 h-4 ${event.featured ? 'fill-current' : ''}`} />
            {event.featured ? t('admin.unfeature') : t('admin.feature')}
          </button>

          <div className="flex items-center gap-2">
            <ConsoleButton
              onClick={() => downloadCsv('full')}
              disabled={isExporting !== null}
              className="flex-1"
            >
              {isExporting === 'full' ? 'Downloading…' : 'Download Financials CSV'}
            </ConsoleButton>
            <ConsoleButton
              onClick={() => downloadCsv('summary')}
              disabled={isExporting !== null}
              className="flex-1"
            >
              {isExporting === 'summary' ? 'Downloading…' : 'Download Summary CSV'}
            </ConsoleButton>
          </div>

          <a
            href={`/events/${event.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center px-4 py-2 text-console-mut hover:text-console-text font-medium text-sm"
          >
            {t('admin.view_public')} →
          </a>
        </div>
      </div>
    </>
  )
}
