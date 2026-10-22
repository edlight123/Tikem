'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { format, isValid } from 'date-fns'
import { dateLocaleFor } from '@/lib/dateLocale'
import { Clock, Ticket } from 'lucide-react'

interface TransferAcceptFormProps {
  transfer: any
  ticket: any
  event: any
  sender: any
  currentUser: any
}

export default function TransferAcceptForm({ transfer, ticket, event, sender, currentUser }: TransferAcceptFormProps) {
  const { t, i18n } = useTranslation('common')
  const dfLocale = dateLocaleFor(i18n.language)
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)

  // Guard against missing/invalid event datetimes.
  const startDate = event?.start_datetime ? new Date(event.start_datetime) : null
  const endDate = event?.end_datetime ? new Date(event.end_datetime) : null
  const hasValidStart = Boolean(startDate && isValid(startDate))
  const hasValidEnd = Boolean(endDate && isValid(endDate))

  async function handleAccept() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/tickets/transfer/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferToken: transfer.transfer_token,
          action: 'accept'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.error || t('transfer.accept_failed', { defaultValue: 'Failed to accept transfer' })
        )
      }

      // Redirect to tickets page
      router.push('/tickets?transferred=true')
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  async function handleReject() {
    setShowRejectConfirm(false)
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/tickets/transfer/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferToken: transfer.transfer_token,
          action: 'reject'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.error || t('transfer.reject_failed', { defaultValue: 'Failed to reject transfer' })
        )
      }

      // Redirect to tickets page
      router.push('/tickets')
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#141414] rounded-xl sm:rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="text-white p-4 pb-0 sm:p-6 sm:pb-0">
        <h1 className="flex items-center gap-2.5 font-display lowercase !text-[26px] sm:!text-[30px] !leading-none mb-2">
          <Ticket className="h-6 w-6 shrink-0 text-white/60" strokeWidth={1.5} aria-hidden />
          {t('transfer.title', { defaultValue: 'Ticket Transfer' })}
        </h1>
        <p className="text-[13px] sm:text-base text-white/60">
          {t('transfer.received_ticket', { defaultValue: "You've received a ticket!" })}
        </p>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {/* Sender Info */}
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white/[0.055] rounded-xl">
          <p className="text-[13px] sm:text-sm text-white/80 mb-1">
            <strong>{sender?.name || sender?.full_name || t('transfer.someone', { defaultValue: 'Someone' })}</strong>{' '}
            {t('transfer.wants_to_transfer', { defaultValue: 'wants to transfer a ticket to you' })}
          </p>
          <p className="text-[11px] sm:text-xs text-white/50">
            {sender?.email || transfer.from_user_id}
          </p>
        </div>

        {/* Event Details */}
        {event && (
          <div className="mb-4 sm:mb-6">
            <h2 className="font-display italic !text-[22px] sm:!text-[24px] !leading-tight text-white mb-3 sm:mb-4">{String(event.title || '').replace(/^\[[^\]]*\]\s*/, '')}</h2>
            
            <div className="space-y-2.5 sm:space-y-3 text-white/70">
              <div className="flex items-start">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3 mt-0.5 flex-shrink-0 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[13px] sm:text-base font-semibold">
                    {hasValidStart
                      ? format(startDate as Date, 'EEEE, MMMM d, yyyy', { locale: dfLocale })
                      : t('transfer.date_tbc', { defaultValue: 'Date to be confirmed' })}
                  </p>
                  {hasValidStart && (
                    <p className="text-[11px] sm:text-sm text-white/60">
                      {format(startDate as Date, 'h:mm a', { locale: dfLocale })}
                      {hasValidEnd ? ` - ${format(endDate as Date, 'h:mm a', { locale: dfLocale })}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3 mt-0.5 flex-shrink-0 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[13px] sm:text-base font-semibold">{event.venue_name}</p>
                  <p className="text-[11px] sm:text-sm text-white/60">{event.address}</p>
                  <p className="text-[11px] sm:text-sm text-white/60">{event.commune}, {event.city}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Message from sender */}
        {transfer.message && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white/[0.055] rounded-xl">
            <p className="text-[11px] sm:text-sm font-semibold text-white/70 mb-1 sm:mb-2">
              {t('transfer.message_from_sender', { defaultValue: 'Message from sender:' })}
            </p>
            <p className="text-[13px] sm:text-base text-white/60 italic">&quot;{transfer.message}&quot;</p>
          </div>
        )}

        {/* Expiry Notice */}
        {transfer.expires_at && (
          <div className="mb-4 sm:mb-6 p-2.5 sm:p-3 bg-amber-500/10 rounded-xl">
            <p className="flex items-start gap-2 text-[11px] sm:text-sm text-amber-200">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t('transfer.expires_on', { defaultValue: 'This transfer expires on' })}{' '}
              <strong>{format(new Date(transfer.expires_at), 'MMM d, yyyy h:mm a', { locale: dfLocale })}</strong></span>
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-500/10 rounded-xl">
            <p className="text-[13px] sm:text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* Info */}
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white/[0.055] rounded-xl">
          <h3 className="text-[13px] sm:text-base font-semibold text-white mb-1.5 sm:mb-2">
            {t('transfer.what_happens_title', { defaultValue: 'What happens when you accept?' })}
          </h3>
          <ul className="text-[11px] sm:text-sm text-white/70 space-y-0.5 sm:space-y-1">
            <li>• {t('transfer.bullet_transferred', { defaultValue: 'This ticket will be transferred to your account' })}</li>
            <li>• {t('transfer.bullet_sender_loses_access', { defaultValue: 'The sender will no longer have access to it' })}</li>
            <li>
              •{' '}
              {t('transfer.bullet_new_code', {
                defaultValue:
                  "The ticket gets a new QR code. The sender's old code, screenshots and wallet pass stop working",
              })}
            </li>
            <li>• {t('transfer.bullet_view_qr', { defaultValue: "You'll be able to view the QR code and use it at the event" })}</li>
            <li>• {t('transfer.bullet_confirmation_emails', { defaultValue: 'Both you and the sender will receive confirmation emails' })}</li>
          </ul>
        </div>

        {/* Action Buttons */}
        {showRejectConfirm ? (
          <div className="bg-white/[0.055] rounded-xl p-3 sm:p-4">
            <p className="text-[13px] sm:text-sm text-white/70 mb-3">
              {t('transfer.reject_confirm_prompt', {
                defaultValue: "Are you sure you want to reject this ticket transfer? This can't be undone.",
              })}
            </p>
            <div className="flex gap-3 sm:gap-4">
              <button
                onClick={() => setShowRejectConfirm(false)}
                disabled={loading}
                className="flex-1 px-4 sm:px-6 py-2.5 sm:py-3 bg-white/[0.07] rounded text-[13px] sm:text-base text-white font-semibold hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed transition min-h-[44px]"
              >
                {t('transfer.keep_ticket', { defaultValue: 'Keep Ticket' })}
              </button>
              <button
                onClick={handleReject}
                disabled={loading}
                className="flex-1 px-4 sm:px-6 py-2.5 sm:py-3 bg-red-500/10 text-red-200 text-[13px] sm:text-base font-semibold rounded hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition min-h-[44px]"
              >
                {loading
                  ? t('transfer.processing', { defaultValue: 'Processing...' })
                  : t('transfer.reject_transfer', { defaultValue: 'Reject Transfer' })}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 sm:gap-4">
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={loading}
              className="flex-1 px-4 sm:px-6 py-2.5 sm:py-3 bg-white/[0.07] rounded text-[13px] sm:text-base text-white font-semibold hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed transition min-h-[44px]"
            >
              {t('transfer.reject_transfer', { defaultValue: 'Reject Transfer' })}
            </button>
            <button
              onClick={handleAccept}
              disabled={loading}
              className="flex-1 px-4 sm:px-6 py-2.5 sm:py-3 bg-white text-black text-[13px] sm:text-base font-semibold rounded hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition min-h-[44px]"
            >
              {loading
                ? t('transfer.processing', { defaultValue: 'Processing...' })
                : t('transfer.accept_ticket', { defaultValue: 'Accept Ticket' })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
